-- Chat upgrade: mute a conversation, @everyone and @here in rooms, search
-- across all chats, and message threads. Nothing here changes who may read or
-- post; every function re-uses the existing membership and history rules.
-- Safe to run twice.

begin;

-- ---------- 1. Mute ----------
create table if not exists public.chat_conversation_prefs (
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  conversation_id uuid not null references public.social_conversations(id) on delete cascade,
  muted_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.chat_conversation_prefs enable row level security;
revoke all on public.chat_conversation_prefs from public, anon, authenticated;
grant select on public.chat_conversation_prefs to authenticated;
grant all on public.chat_conversation_prefs to service_role;

drop policy if exists chat_prefs_own_read on public.chat_conversation_prefs;
create policy chat_prefs_own_read on public.chat_conversation_prefs
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.set_chat_mute(p_conversation_id uuid, p_duration text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  choice text := lower(btrim(coalesce(p_duration, '')));
  until_at timestamptz;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'You are not part of this conversation';
  end if;

  until_at := case choice
    when 'off' then null
    when '1h' then now() + interval '1 hour'
    when '8h' then now() + interval '8 hours'
    when '1d' then now() + interval '1 day'
    when '1w' then now() + interval '7 days'
    when 'forever' then 'infinity'::timestamptz
    else null
  end;
  if choice not in ('off', '1h', '8h', '1d', '1w', 'forever') then
    raise exception 'Choose how long to mute';
  end if;

  insert into public.chat_conversation_prefs (user_id, conversation_id, muted_until, updated_at)
  values (me, p_conversation_id, until_at, now())
  on conflict (user_id, conversation_id)
  do update set muted_until = excluded.muted_until, updated_at = now();

  return until_at;
end;
$$;
revoke all on function public.set_chat_mute(uuid, text) from public, anon;
grant execute on function public.set_chat_mute(uuid, text) to authenticated;

-- A muted conversation makes no ordinary message alert. Mentions of you by
-- name still arrive (they are a different notification type), @everyone and
-- @here do not break through a mute.
create or replace function public.skip_muted_chat_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.type = 'chat_message'
     and new.entity_id is not null
     and exists (
       select 1
       from public.chat_conversation_prefs p
       where p.user_id = new.user_id
         and p.conversation_id = new.entity_id
         and p.muted_until is not null
         and p.muted_until > now()
     ) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.skip_muted_chat_notification() from public, anon, authenticated;

drop trigger if exists skip_muted_chat_notification on public.notifications;
create trigger skip_muted_chat_notification
  before insert on public.notifications
  for each row execute function public.skip_muted_chat_notification();

-- ---------- 2. @everyone and @here ----------
-- Only in a room. In a room with more than 8 people, only a room admin or a
-- Chat administrator may use it, so it cannot be used to spam a big room.
create or replace function public.register_chat_broadcast_mention(p_message_id uuid, p_kind text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  msg public.social_messages%rowtype;
  kind text := lower(btrim(coalesce(p_kind, '')));
  member_count integer;
  sender_name text;
  notified integer := 0;
  recipient uuid;
  existing uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if kind not in ('everyone', 'here') then
    raise exception 'Unknown mention';
  end if;

  select * into msg from public.social_messages where id = p_message_id and sender_id = me;
  if not found then
    raise exception 'Message not found or not owned by caller';
  end if;
  if not public.can_write_to_conversation(msg.conversation_id) then
    raise exception 'Conversation write access required';
  end if;
  if not exists (select 1 from public.chat_rooms r where r.conversation_id = msg.conversation_id) then
    raise exception '@everyone and @here only work in rooms';
  end if;

  select count(*) into member_count
  from public.social_conversation_members m
  join public.employee_profiles p on p.id = m.user_id and p.active
  where m.conversation_id = msg.conversation_id and m.removed_at is null;

  if member_count > 8 and not public.is_room_admin(msg.conversation_id) then
    raise exception 'Only a room admin can use @% in a room this size', kind;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into sender_name
  from public.employee_profiles where id = me;

  for recipient in
    select m.user_id
    from public.social_conversation_members m
    join public.employee_profiles p on p.id = m.user_id and p.active
    where m.conversation_id = msg.conversation_id
      and m.removed_at is null
      and m.user_id <> me
      and (
        kind = 'everyone'
        or exists (
          select 1 from public.employee_device_sessions s
          where s.employee_id = m.user_id and s.last_seen_at > now() - interval '10 minutes'
        )
      )
  loop
    insert into public.chat_message_mentions (message_id, conversation_id, mentioned_user_id)
    values (msg.id, msg.conversation_id, recipient)
    on conflict do nothing;

    -- A muted conversation stays quiet for @everyone and @here.
    if exists (
      select 1 from public.chat_conversation_prefs p
      where p.user_id = recipient and p.conversation_id = msg.conversation_id
        and p.muted_until is not null and p.muted_until > now()
    ) then
      continue;
    end if;

    select n.id into existing
    from public.notifications n
    where n.user_id = recipient
      and n.entity_id = msg.conversation_id
      and n.type in ('chat_message', 'chat_mention')
      and n.read_at is null
    order by n.created_at desc
    limit 1;

    if existing is not null then
      update public.notifications
      set type = 'chat_mention',
          title = '@' || kind || ' from ' || coalesce(sender_name, 'someone'),
          body = left(regexp_replace(coalesce(msg.body, ''), '\s+', ' ', 'g'), 140),
          created_at = now()
      where id = existing;
    else
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id, email_status)
      values (
        recipient, 'chat_mention',
        '@' || kind || ' from ' || coalesce(sender_name, 'someone'),
        left(regexp_replace(coalesce(msg.body, ''), '\s+', ' ', 'g'), 140),
        'social_conversation', msg.conversation_id, 'skipped'
      );
    end if;
    notified := notified + 1;
  end loop;

  return notified;
end;
$$;
revoke all on function public.register_chat_broadcast_mention(uuid, text) from public, anon;
grant execute on function public.register_chat_broadcast_mention(uuid, text) to authenticated;

-- ---------- 3. Search across all chats ----------
do $$
begin
  begin
    create extension if not exists pg_trgm;
  exception when others then
    raise notice 'pg_trgm not available; search will still work, just slower';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create index if not exists social_messages_body_trgm_idx
      on public.social_messages using gin (body gin_trgm_ops);
  end if;
end $$;

create or replace function public.search_chat_messages(p_query text, p_limit integer default 30)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if char_length(q) < 2 then
    return;
  end if;
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at
  from public.social_messages m
  where m.deleted_at is null
    and m.body ilike pattern
    and public.can_read_message(m.conversation_id, m.created_at)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
end;
$$;
revoke all on function public.search_chat_messages(text, integer) from public, anon;
grant execute on function public.search_chat_messages(text, integer) to authenticated;

-- ---------- 4. Threads ----------
create index if not exists social_messages_reply_idx
  on public.social_messages (reply_to_id) where reply_to_id is not null;

create or replace function public.get_chat_thread(p_root uuid)
returns setof public.social_messages
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  root public.social_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into root from public.social_messages where id = p_root;
  if not found or not public.can_read_message(root.conversation_id, root.created_at) then
    raise exception 'Thread not found';
  end if;

  return query
  select m.*
  from public.social_messages m
  where m.conversation_id = root.conversation_id
    and (m.id = root.id or m.reply_to_id = root.id)
    and m.deleted_at is null
    and public.can_read_message(m.conversation_id, m.created_at)
  order by m.created_at asc
  limit 500;
end;
$$;
revoke all on function public.get_chat_thread(uuid) from public, anon;
grant execute on function public.get_chat_thread(uuid) to authenticated;

commit;
