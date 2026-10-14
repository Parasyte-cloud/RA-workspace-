begin;

-- ============================================================
-- RideArrivo Department Communications
-- Message authorization, history boundaries and idempotent sends.
-- ============================================================


-- ------------------------------------------------------------
-- Client-side idempotency key.
--
-- Existing messages remain valid because this column is nullable.
-- New governed sends use send_chat_message().
-- ------------------------------------------------------------

alter table public.social_messages
add column if not exists client_message_id uuid;

create unique index if not exists
social_messages_client_message_id_unique
on public.social_messages(
  conversation_id,
  sender_id,
  client_message_id
)
where client_message_id is not null;


-- ------------------------------------------------------------
-- History-aware message authorization.
--
-- Active membership is always required.
--
-- Non-governed legacy/direct conversations retain their existing
-- full-history semantics.
--
-- Governed rooms:
--   full            -> all retained history
--   from_join_date  -> only messages at/after the member boundary
--
-- Archived rooms remain readable; write authorization is handled
-- separately by can_write_to_conversation().
-- ------------------------------------------------------------

create or replace function public.can_read_message(
  p_conversation_id uuid,
  p_created_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and exists(
      select 1
      from public.social_conversation_members m
      join public.employee_profiles e
        on e.id = m.user_id
       and e.active = true
      left join public.chat_rooms r
        on r.conversation_id = m.conversation_id
      where m.conversation_id = p_conversation_id
        and m.user_id = auth.uid()
        and m.removed_at is null
        and (
          r.conversation_id is null
          or r.history_policy = 'full'
          or (
            r.history_policy = 'from_join_date'
            and p_created_at >= coalesce(
              m.history_from,
              m.joined_at
            )
          )
        )
    );
$$;

revoke all
on function public.can_read_message(uuid, timestamptz)
from public, anon;

grant execute
on function public.can_read_message(uuid, timestamptz)
to authenticated, service_role;


-- ------------------------------------------------------------
-- Replace the old message policies.
--
-- Direct-message table inserts remain supported for the existing
-- frontend until the Chat shell migration is complete, but they now
-- use the same active-member / active-room authorization primitive.
-- ------------------------------------------------------------

drop policy if exists
"social messages member read"
on public.social_messages;

create policy "social messages member read"
on public.social_messages
for select
to authenticated
using(
  deleted_at is null
  and public.can_read_message(
    conversation_id,
    created_at
  )
);

drop policy if exists
"social messages member send"
on public.social_messages;

create policy "social messages member send"
on public.social_messages
for insert
to authenticated
with check(
  sender_id = auth.uid()
  and deleted_at is null
  and public.can_write_to_conversation(
    conversation_id
  )
);


-- ------------------------------------------------------------
-- Idempotent, server-authorized message send.
--
-- Authorization is checked before an existing idempotent result is
-- returned, so removed/inactive employees cannot use an old client key
-- to retrieve a message after losing access.
-- ------------------------------------------------------------

create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_body text,
  p_reply_to_id uuid,
  p_client_message_id uuid
)
returns public.social_messages
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_message public.social_messages%rowtype;
  v_reply public.social_messages%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if p_client_message_id is null then
    raise exception 'Client message identifier is required';
  end if;

  if not public.can_write_to_conversation(
    p_conversation_id
  ) then
    raise exception 'Conversation write access required'
      using errcode = '42501';
  end if;

  -- Idempotent retry: return the original persisted row without
  -- mutating its body or reply target.
  select *
  into v_message
  from public.social_messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id = v_actor
    and m.client_message_id = p_client_message_id
  limit 1;

  if found then
    return v_message;
  end if;

  if char_length(v_body) < 1 then
    raise exception 'A message cannot be empty';
  end if;

  if char_length(v_body) > 10000 then
    raise exception 'That message is too long';
  end if;

  if p_reply_to_id is not null then
    select *
    into v_reply
    from public.social_messages m
    where m.id = p_reply_to_id
      and m.conversation_id = p_conversation_id;

    if not found
       or not public.can_read_message(
         v_reply.conversation_id,
         v_reply.created_at
       ) then
      raise exception 'Reply message not found or not accessible'
        using errcode = '42501';
    end if;
  end if;

  begin
    insert into public.social_messages(
      conversation_id,
      sender_id,
      body,
      reply_to_id,
      client_message_id
    )
    values(
      p_conversation_id,
      v_actor,
      v_body,
      p_reply_to_id,
      p_client_message_id
    )
    returning *
    into v_message;

  exception
    when unique_violation then
      -- Concurrent retries using the same key converge on the first row.
      select *
      into v_message
      from public.social_messages m
      where m.conversation_id = p_conversation_id
        and m.sender_id = v_actor
        and m.client_message_id = p_client_message_id
      limit 1;

      if not found then
        raise;
      end if;
  end;

  return v_message;
end;
$$;

revoke all
on function public.send_chat_message(
  uuid,
  text,
  uuid,
  uuid
)
from public, anon;

grant execute
on function public.send_chat_message(
  uuid,
  text,
  uuid,
  uuid
)
to authenticated;


commit;
