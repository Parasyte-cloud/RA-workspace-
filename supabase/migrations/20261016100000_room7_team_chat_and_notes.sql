-- ROOM 7: saved team chat and member-readable meeting notes.
--
-- 1. workspace_room_messages: a chat that belongs to the room, like a Teams
--    meeting chat. It works during the meeting and afterwards (7 days after
--    the meeting ends, then read-only). Only people in the room can read or
--    write. All writes go through functions that check membership.
-- 2. my_room_minutes: lets people who were in a meeting read its notes.
--    Until now only administrators could, everyone else got an email excerpt.
-- 3. workspace_room_action_items: the action items found in the notes, so
--    people can tick them off. Filled by the room-ai-webhook function.
--
-- Safe to run twice.

begin;

-- ---------- membership helper ----------
create or replace function public.can_use_room_chat(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (select 1 from public.workspace_rooms r where r.id = p_room)
    and (
      exists (
        select 1 from public.workspace_room_participants p
        where p.room_id = p_room and p.user_id = auth.uid() and p.removed_at is null
      )
      or exists (
        select 1 from public.workspace_rooms r
        where r.id = p_room and r.created_by = auth.uid()
      )
      or exists (
        select 1 from public.employee_profiles e
        where e.id = auth.uid() and e.role = 'admin'
      )
    );
$$;
revoke all on function public.can_use_room_chat(uuid) from public, anon;
grant execute on function public.can_use_room_chat(uuid) to authenticated;

-- ---------- chat ----------
create table if not exists public.workspace_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.workspace_rooms(id) on delete cascade,
  sender_id uuid not null references public.employee_profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  reply_to_id uuid references public.workspace_room_messages(id) on delete set null,
  client_message_id text check (client_message_id is null or char_length(client_message_id) <= 64),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (room_id, sender_id, client_message_id)
);

create index if not exists workspace_room_messages_room_idx
  on public.workspace_room_messages (room_id, created_at desc);

alter table public.workspace_room_messages enable row level security;
revoke all on public.workspace_room_messages from public, anon, authenticated;
grant select on public.workspace_room_messages to authenticated;
grant all on public.workspace_room_messages to service_role;

drop policy if exists room_messages_read on public.workspace_room_messages;
create policy room_messages_read on public.workspace_room_messages
  for select to authenticated
  using (public.can_use_room_chat(room_id));

create or replace function public.send_room_message(
  p_room uuid,
  p_body text,
  p_reply uuid default null,
  p_client text default null
)
returns public.workspace_room_messages
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  clean text := btrim(coalesce(p_body, ''));
  room public.workspace_rooms%rowtype;
  existing public.workspace_room_messages%rowtype;
  saved public.workspace_room_messages%rowtype;
  client text := nullif(btrim(coalesce(p_client, '')), '');
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.can_use_room_chat(p_room) then
    raise exception 'You are not part of this meeting';
  end if;
  if char_length(clean) < 1 then
    raise exception 'A message cannot be empty';
  end if;
  if char_length(clean) > 4000 then
    raise exception 'That message is too long';
  end if;

  select * into room from public.workspace_rooms where id = p_room;
  if room.status = 'ended' and room.ended_at < now() - interval '7 days' then
    raise exception 'This meeting chat is now read only';
  end if;

  -- A retry of the same message returns the first copy instead of a duplicate.
  if client is not null then
    select * into existing from public.workspace_room_messages
    where room_id = p_room and sender_id = me and client_message_id = client;
    if found then
      return existing;
    end if;
  end if;

  if (select count(*) from public.workspace_room_messages
      where sender_id = me and created_at > now() - interval '10 seconds') >= 15 then
    raise exception 'You are sending messages too quickly';
  end if;

  if p_reply is not null and not exists (
    select 1 from public.workspace_room_messages m
    where m.id = p_reply and m.room_id = p_room
  ) then
    p_reply := null;
  end if;

  insert into public.workspace_room_messages (room_id, sender_id, body, reply_to_id, client_message_id)
  values (p_room, me, clean, p_reply, client)
  returning * into saved;

  return saved;
end;
$$;
revoke all on function public.send_room_message(uuid, text, uuid, text) from public, anon;
grant execute on function public.send_room_message(uuid, text, uuid, text) to authenticated;

create or replace function public.edit_room_message(p_id uuid, p_body text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  msg public.workspace_room_messages%rowtype;
  clean text := btrim(coalesce(p_body, ''));
  stamp timestamptz := now();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into msg from public.workspace_room_messages where id = p_id for update;
  if not found or msg.sender_id <> me or not public.can_use_room_chat(msg.room_id) then
    raise exception 'Message not found';
  end if;
  if msg.deleted_at is not null then
    raise exception 'This message was deleted';
  end if;
  if msg.created_at < now() - interval '24 hours' then
    raise exception 'Messages can only be edited for 24 hours';
  end if;
  if char_length(clean) < 1 or char_length(clean) > 4000 then
    raise exception 'That message is not valid';
  end if;
  update public.workspace_room_messages set body = clean, edited_at = stamp where id = p_id;
  return stamp;
end;
$$;
revoke all on function public.edit_room_message(uuid, text) from public, anon;
grant execute on function public.edit_room_message(uuid, text) to authenticated;

-- The sender can delete their own message. The meeting creator and
-- administrators can delete anyone's (moderation).
create or replace function public.delete_room_message(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  msg public.workspace_room_messages%rowtype;
  moderator boolean;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into msg from public.workspace_room_messages where id = p_id for update;
  if not found or not public.can_use_room_chat(msg.room_id) then
    raise exception 'Message not found';
  end if;
  moderator := exists (select 1 from public.workspace_rooms r where r.id = msg.room_id and r.created_by = me)
    or exists (select 1 from public.employee_profiles e where e.id = me and e.role = 'admin');
  if msg.sender_id <> me and not moderator then
    raise exception 'You can only delete your own messages';
  end if;
  update public.workspace_room_messages
  set deleted_at = now(), body = 'Message deleted'
  where id = p_id and deleted_at is null;
end;
$$;
revoke all on function public.delete_room_message(uuid) from public, anon;
grant execute on function public.delete_room_message(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_room_messages'
     ) then
    alter publication supabase_realtime add table public.workspace_room_messages;
  end if;
end $$;

-- ---------- action items ----------
create table if not exists public.workspace_room_action_items (
  id uuid primary key default gen_random_uuid(),
  minutes_id uuid not null references public.workspace_room_minutes(id) on delete cascade,
  room_id uuid not null references public.workspace_rooms(id) on delete cascade,
  position integer not null default 0,
  body text not null check (char_length(body) between 1 and 1000),
  owner_name text check (owner_name is null or char_length(owner_name) <= 120),
  owner_id uuid references public.employee_profiles(id) on delete set null,
  due_text text check (due_text is null or char_length(due_text) <= 120),
  done boolean not null default false,
  done_by uuid references public.employee_profiles(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workspace_room_action_items_minutes_idx
  on public.workspace_room_action_items (minutes_id, position);

alter table public.workspace_room_action_items enable row level security;
revoke all on public.workspace_room_action_items from public, anon, authenticated;
grant select on public.workspace_room_action_items to authenticated;
grant all on public.workspace_room_action_items to service_role;

drop policy if exists room_action_items_read on public.workspace_room_action_items;
create policy room_action_items_read on public.workspace_room_action_items
  for select to authenticated
  using (public.can_use_room_chat(room_id));

create or replace function public.set_room_action_done(p_id uuid, p_done boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  item public.workspace_room_action_items%rowtype;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select * into item from public.workspace_room_action_items where id = p_id;
  if not found or not public.can_use_room_chat(item.room_id) then
    raise exception 'Action item not found';
  end if;
  update public.workspace_room_action_items
  set done = coalesce(p_done, false),
      done_by = case when coalesce(p_done, false) then me else null end,
      done_at = case when coalesce(p_done, false) then now() else null end
  where id = p_id;
end;
$$;
revoke all on function public.set_room_action_done(uuid, boolean) from public, anon;
grant execute on function public.set_room_action_done(uuid, boolean) to authenticated;

-- ---------- notes for the people who were there ----------
create or replace function public.my_room_minutes(p_room uuid)
returns table (
  id uuid,
  session_id text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  participant_count integer,
  summary_markdown text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.can_use_room_chat(p_room) then
    raise exception 'You are not part of this meeting';
  end if;
  return query
  select m.id, m.session_id, m.status, m.started_at, m.ended_at,
         m.duration_seconds, m.participant_count, m.summary_markdown
  from public.workspace_room_minutes m
  where m.room_id = p_room
  order by coalesce(m.started_at, m.created_at) desc
  limit 20;
end;
$$;
revoke all on function public.my_room_minutes(uuid) from public, anon;
grant execute on function public.my_room_minutes(uuid) to authenticated;

commit;
