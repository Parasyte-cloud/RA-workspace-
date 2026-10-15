begin;

-- ============================================================
-- RideArrivo Chat mentions and room unread state
-- ============================================================

create table if not exists public.chat_message_mentions (
  message_id uuid not null
    references public.social_messages(id)
    on delete cascade,

  conversation_id uuid not null
    references public.social_conversations(id)
    on delete cascade,

  mentioned_user_id uuid not null
    references public.employee_profiles(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  primary key (message_id, mentioned_user_id)
);

create index if not exists
  chat_message_mentions_recipient_idx
on public.chat_message_mentions(
  mentioned_user_id,
  conversation_id,
  created_at desc
);

alter table public.chat_message_mentions
  enable row level security;

revoke all
on public.chat_message_mentions
from public, anon, authenticated;

grant all
on public.chat_message_mentions
to service_role;


-- ------------------------------------------------------------
-- Keep one unread notification per conversation.
--
-- A prior mention remains a mention until that conversation
-- is read. Removed room members receive no new alerts.
-- ------------------------------------------------------------

create or replace function public.notify_social_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender_name text;
  recipient record;
  existing uuid;
  existing_type text;
  existing_title text;
  existing_body text;
  unread_count bigint;
  preview text :=
    left(
      regexp_replace(
        coalesce(new.body, ''),
        '\s+',
        ' ',
        'g'
      ),
      140
    );
begin
  select
    coalesce(
      nullif(btrim(full_name), ''),
      email
    )
  into sender_name
  from public.employee_profiles
  where id = new.sender_id;

  for recipient in
    select m.user_id
    from public.social_conversation_members m
    join public.employee_profiles p
      on p.id = m.user_id
     and p.active = true
    where m.conversation_id = new.conversation_id
      and m.user_id <> new.sender_id
      and m.removed_at is null
  loop
    existing := null;
    existing_type := null;
    existing_title := null;
    existing_body := null;

    select
      n.id,
      n.type,
      n.title,
      n.body
    into
      existing,
      existing_type,
      existing_title,
      existing_body
    from public.notifications n
    where n.user_id = recipient.user_id
      and n.type in (
        'chat_message',
        'chat_mention'
      )
      and n.entity_id = new.conversation_id
      and n.read_at is null
    order by n.created_at desc
    limit 1;

    if existing is null then
      insert into public.notifications(
        user_id,
        type,
        title,
        body,
        entity_type,
        entity_id,
        email_status
      )
      values (
        recipient.user_id,
        'chat_message',
        coalesce(sender_name, 'New message'),
        preview,
        'social_conversation',
        new.conversation_id,
        'skipped'
      );
    else
      select count(*)
      into unread_count
      from public.social_messages sm
      join public.social_conversation_members me
        on me.conversation_id = sm.conversation_id
       and me.user_id = recipient.user_id
       and me.removed_at is null
      where sm.conversation_id = new.conversation_id
        and sm.sender_id <> recipient.user_id
        and sm.deleted_at is null
        and sm.created_at >
          coalesce(
            me.last_read_at,
            me.joined_at,
            'epoch'::timestamptz
          );

      update public.notifications
      set
        title =
          case
            when existing_type = 'chat_mention'
              then existing_title
            else
              coalesce(sender_name, 'New message')
              ||
              case
                when unread_count > 1
                  then
                    ' (' ||
                    unread_count ||
                    ' new messages)'
                else ''
              end
          end,

        body =
          case
            when existing_type = 'chat_mention'
              then existing_body
            else preview
          end,

        created_at = now()
      where id = existing;
    end if;
  end loop;

  return new;
end;
$$;

revoke all
on function public.notify_social_message()
from public, anon, authenticated;


-- ------------------------------------------------------------
-- Register mentions for a message already owned by the caller.
--
-- Used by attachment messages, which have an existing upload
-- workflow before the message row is persisted.
-- ------------------------------------------------------------

create or replace function public.register_chat_message_mentions(
  p_message_id uuid,
  p_mentioned_user_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  message_row public.social_messages%rowtype;
  requested_count integer;
  valid_count integer;
  sender_name text;
  newly_inserted_user_ids uuid[];
begin
  if actor is null then
    raise exception 'Not signed in';
  end if;

  select sm.*
  into message_row
  from public.social_messages sm
  where sm.id = p_message_id
    and sm.sender_id = actor;

  if not found then
    raise exception 'Message not found or not owned by caller';
  end if;

  if not public.can_write_to_conversation(
    message_row.conversation_id
  ) then
    raise exception 'Conversation write access required';
  end if;

  with requested as (
    select distinct u.mentioned_user_id
    from unnest(
      coalesce(
        p_mentioned_user_ids,
        '{}'::uuid[]
      )
    ) as u(mentioned_user_id)
    where u.mentioned_user_id is not null
      and u.mentioned_user_id <> actor
  )
  select count(*)
  into requested_count
  from requested;

  with requested as (
    select distinct u.mentioned_user_id
    from unnest(
      coalesce(
        p_mentioned_user_ids,
        '{}'::uuid[]
      )
    ) as u(mentioned_user_id)
    where u.mentioned_user_id is not null
      and u.mentioned_user_id <> actor
  )
  select count(*)
  into valid_count
  from requested r
  join public.social_conversation_members m
    on m.conversation_id = message_row.conversation_id
   and m.user_id = r.mentioned_user_id
   and m.removed_at is null
  join public.employee_profiles p
    on p.id = r.mentioned_user_id
   and p.active = true;

  if requested_count <> valid_count then
    raise exception
      'Mention targets must be active members of this conversation';
  end if;

  with inserted as (
    insert into public.chat_message_mentions(
      message_id,
      conversation_id,
      mentioned_user_id
    )
    select
      message_row.id,
      message_row.conversation_id,
      r.mentioned_user_id
    from (
      select distinct u.mentioned_user_id
      from unnest(
        coalesce(
          p_mentioned_user_ids,
          '{}'::uuid[]
        )
      ) as u(mentioned_user_id)
      where u.mentioned_user_id is not null
        and u.mentioned_user_id <> actor
    ) r
    on conflict do nothing
    returning mentioned_user_id
  )
  select coalesce(
    array_agg(mentioned_user_id),
    '{}'::uuid[]
  )
  into newly_inserted_user_ids
  from inserted;

  if cardinality(
    newly_inserted_user_ids
  ) = 0 then
    return;
  end if;

  select
    coalesce(
      nullif(btrim(full_name), ''),
      email
    )
  into sender_name
  from public.employee_profiles
  where id = actor;

  -- Upgrade the existing conversation notification instead of
  -- inserting a second alert.
  with requested as (
    select u.mentioned_user_id
    from unnest(
      newly_inserted_user_ids
    ) as u(mentioned_user_id)
  )
  update public.notifications n
  set
    type = 'chat_mention',
    title =
      '@' ||
      coalesce(sender_name, 'Someone') ||
      ' mentioned you',
    body =
      left(
        regexp_replace(
          coalesce(message_row.body, ''),
          '\s+',
          ' ',
          'g'
        ),
        140
      ),
    entity_type = 'social_conversation',
    created_at = now()
  from requested r
  where n.user_id = r.mentioned_user_id
    and n.entity_id = message_row.conversation_id
    and n.type in (
      'chat_message',
      'chat_mention'
    )
    and n.read_at is null;

  -- Defensive fallback if the normal message notification could
  -- not be created for a valid current member.
  with requested as (
    select u.mentioned_user_id
    from unnest(
      newly_inserted_user_ids
    ) as u(mentioned_user_id)
  )
  insert into public.notifications(
    user_id,
    type,
    title,
    body,
    entity_type,
    entity_id,
    email_status
  )
  select
    r.mentioned_user_id,
    'chat_mention',
    '@' ||
      coalesce(sender_name, 'Someone') ||
      ' mentioned you',
    left(
      regexp_replace(
        coalesce(message_row.body, ''),
        '\s+',
        ' ',
        'g'
      ),
      140
    ),
    'social_conversation',
    message_row.conversation_id,
    'skipped'
  from requested r
  where not exists (
    select 1
    from public.notifications n
    where n.user_id = r.mentioned_user_id
      and n.entity_id = message_row.conversation_id
      and n.type in (
        'chat_message',
        'chat_mention'
      )
      and n.read_at is null
  );
end;
$$;

revoke all
on function public.register_chat_message_mentions(
  uuid,
  uuid[]
)
from public, anon;

grant execute
on function public.register_chat_message_mentions(
  uuid,
  uuid[]
)
to authenticated, service_role;


-- ------------------------------------------------------------
-- Atomic plain-text message + mentions.
--
-- The existing send_chat_message() remains authoritative for
-- message authorization, reply scope, and idempotency.
-- ------------------------------------------------------------

create or replace function public.send_chat_message_with_mentions(
  p_conversation_id uuid,
  p_body text,
  p_reply_to_id uuid,
  p_client_message_id uuid,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
)
returns public.social_messages
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  existing public.social_messages%rowtype;
  saved public.social_messages%rowtype;
  requested_count integer;
  valid_count integer;
begin
  if actor is null then
    raise exception 'Not signed in';
  end if;

  if not public.can_write_to_conversation(
    p_conversation_id
  ) then
    raise exception 'Conversation write access required';
  end if;

  -- Preserve the original idempotent message contract.
  if p_client_message_id is not null then
    select sm.*
    into existing
    from public.social_messages sm
    where sm.conversation_id = p_conversation_id
      and sm.sender_id = actor
      and sm.client_message_id = p_client_message_id
    limit 1;

    if found then
      return existing;
    end if;
  end if;

  with requested as (
    select distinct u.mentioned_user_id
    from unnest(
      coalesce(
        p_mentioned_user_ids,
        '{}'::uuid[]
      )
    ) as u(mentioned_user_id)
    where u.mentioned_user_id is not null
      and u.mentioned_user_id <> actor
  )
  select count(*)
  into requested_count
  from requested;

  with requested as (
    select distinct u.mentioned_user_id
    from unnest(
      coalesce(
        p_mentioned_user_ids,
        '{}'::uuid[]
      )
    ) as u(mentioned_user_id)
    where u.mentioned_user_id is not null
      and u.mentioned_user_id <> actor
  )
  select count(*)
  into valid_count
  from requested r
  join public.social_conversation_members m
    on m.conversation_id = p_conversation_id
   and m.user_id = r.mentioned_user_id
   and m.removed_at is null
  join public.employee_profiles p
    on p.id = r.mentioned_user_id
   and p.active = true;

  if requested_count <> valid_count then
    raise exception
      'Mention targets must be active members of this conversation';
  end if;

  saved := public.send_chat_message(
    p_conversation_id,
    p_body,
    p_reply_to_id,
    p_client_message_id
  );

  perform public.register_chat_message_mentions(
    saved.id,
    p_mentioned_user_ids
  );

  return saved;
end;
$$;

revoke all
on function public.send_chat_message_with_mentions(
  uuid,
  text,
  uuid,
  uuid,
  uuid[]
)
from public, anon;

grant execute
on function public.send_chat_message_with_mentions(
  uuid,
  text,
  uuid,
  uuid,
  uuid[]
)
to authenticated, service_role;


-- ------------------------------------------------------------
-- WhatsApp-style unread summary for all current conversations.
-- ------------------------------------------------------------

create or replace function public.list_chat_unread_summary()
returns table(
  conversation_id uuid,
  unread_count bigint,
  mentioned boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    membership.conversation_id,

    count(message.id)::bigint as unread_count,

    coalesce(
      bool_or(
        mention.mentioned_user_id = auth.uid()
      ),
      false
    ) as mentioned

  from public.social_conversation_members membership

  join public.employee_profiles self
    on self.id = membership.user_id
   and self.active = true

  left join public.social_messages message
    on message.conversation_id =
         membership.conversation_id
   and message.sender_id <> auth.uid()
   and message.deleted_at is null
   and message.created_at >
       coalesce(
         membership.last_read_at,
         membership.joined_at,
         'epoch'::timestamptz
       )

  left join public.chat_message_mentions mention
    on mention.message_id = message.id
   and mention.mentioned_user_id = auth.uid()

  where auth.uid() is not null
    and membership.user_id = auth.uid()
    and membership.removed_at is null

  group by membership.conversation_id;
$$;

revoke all
on function public.list_chat_unread_summary()
from public, anon;

grant execute
on function public.list_chat_unread_summary()
to authenticated, service_role;


-- Reading the chat clears ordinary and mention notifications.
create or replace function public.clear_chat_notification_on_read()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.last_read_at is distinct from old.last_read_at then
    delete from public.notifications
    where user_id = new.user_id
      and type in (
        'chat_message',
        'chat_mention'
      )
      and entity_id = new.conversation_id;
  end if;

  return new;
end;
$$;

revoke all
on function public.clear_chat_notification_on_read()
from public, anon, authenticated;

commit;
