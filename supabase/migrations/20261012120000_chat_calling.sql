-- Calling from Chat: ring a colleague into a private ROOM 7 call.
--
-- How it works: the caller's browser creates a ROOM 7 room (the same video
-- service the workspace already uses), then asks this database to ring the
-- other person in the chat. The other person sees an Accept / Decline banner
-- anywhere in the workspace. Accepting joins them to the same ROOM 7 room.
--
-- Access: an administrator decides who may start calls (Administration >
-- Calling). Administrators can always call. Anyone can answer a call.
--
-- Safe to run twice.

begin;

-- 1. Who may start calls.
create table if not exists public.workspace_calling_access (
  employee_id uuid primary key references public.employee_profiles(id) on delete cascade,
  granted_by uuid references public.employee_profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);

alter table public.workspace_calling_access enable row level security;

drop policy if exists "calling access read" on public.workspace_calling_access;
create policy "calling access read"
on public.workspace_calling_access
for select to authenticated
using (employee_id = auth.uid() or public.current_workspace_role() = 'admin');

drop policy if exists "calling access admin write" on public.workspace_calling_access;
create policy "calling access admin write"
on public.workspace_calling_access
for all to authenticated
using (public.current_workspace_role() = 'admin')
with check (public.current_workspace_role() = 'admin');

revoke all on public.workspace_calling_access from anon;
grant select, insert, update, delete on public.workspace_calling_access to authenticated;

create or replace function public.has_calling_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employee_profiles p
    where p.id = auth.uid() and p.active = true
      and (
        lower(p.role) = 'admin'
        or exists (select 1 from public.workspace_calling_access a where a.employee_id = p.id)
      )
  );
$$;

revoke all on function public.has_calling_access() from public, anon;
grant execute on function public.has_calling_access() to authenticated;

-- 2. The calls themselves. Written only through the functions below.
create table if not exists public.chat_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.social_conversations(id) on delete cascade,
  caller_id uuid not null references public.employee_profiles(id) on delete cascade,
  callee_id uuid not null references public.employee_profiles(id) on delete cascade,
  room_code text not null,
  kind text not null check (kind in ('voice', 'video')),
  status text not null default 'ringing'
    check (status in ('ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index if not exists idx_chat_calls_callee on public.chat_calls(callee_id, created_at desc);
create index if not exists idx_chat_calls_caller on public.chat_calls(caller_id, created_at desc);

alter table public.chat_calls enable row level security;

drop policy if exists "chat calls participants read" on public.chat_calls;
create policy "chat calls participants read"
on public.chat_calls
for select to authenticated
using (caller_id = auth.uid() or callee_id = auth.uid());

revoke all on public.chat_calls from anon;
revoke insert, update, delete on public.chat_calls from authenticated;
grant select on public.chat_calls to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_calls'
     ) then
    alter publication supabase_realtime add table public.chat_calls;
  end if;
end
$$;

-- 3. Start a call. The room must be one the caller just created.
create or replace function public.start_chat_call(
  p_conversation uuid,
  p_kind text,
  p_room_code text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  other uuid;
  call_id uuid;
  caller_name text;
begin
  if me is null or not public.has_calling_access() then
    raise exception 'Calling is not enabled on your account. Reach out to Admin to give you access.'
      using errcode = '42501';
  end if;
  if p_kind not in ('voice', 'video') then
    raise exception 'Unknown call type';
  end if;

  select m.user_id into other
  from public.social_conversation_members m
  join public.social_conversations c on c.id = m.conversation_id and c.is_group = false
  where m.conversation_id = p_conversation
    and m.user_id <> me
    and exists (
      select 1 from public.social_conversation_members mine
      where mine.conversation_id = p_conversation and mine.user_id = me
    )
  limit 1;

  if other is null then
    raise exception 'Calls can only be started inside your own direct chats';
  end if;
  if not exists (select 1 from public.employee_profiles where id = other and active = true) then
    raise exception 'That person is not an active employee';
  end if;
  if not exists (
    select 1 from public.workspace_rooms r
    where r.room_code = p_room_code and r.created_by = me and r.status = 'active'
  ) then
    raise exception 'The call room could not be verified';
  end if;

  -- One live ring per caller at a time.
  update public.chat_calls set status = 'cancelled'
  where caller_id = me and status = 'ringing';

  insert into public.chat_calls(conversation_id, caller_id, callee_id, room_code, kind)
  values (p_conversation, me, other, p_room_code, p_kind)
  returning id into call_id;

  select coalesce(nullif(btrim(full_name), ''), email) into caller_name
  from public.employee_profiles where id = me;

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  values (other, 'call', caller_name || ' is calling',
          case when p_kind = 'video' then 'Incoming video call' else 'Incoming voice call' end,
          'social_conversation', p_conversation, 'skipped');

  return call_id;
end;
$$;

revoke all on function public.start_chat_call(uuid, text, text) from public, anon;
grant execute on function public.start_chat_call(uuid, text, text) to authenticated;

-- 4. Answer, decline, cancel, or end a call.
create or replace function public.respond_chat_call(p_call uuid, p_status text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  call_row public.chat_calls%rowtype;
  caller_name text;
  next_status text := p_status;
begin
  select * into call_row from public.chat_calls where id = p_call for update;
  if not found or me is null or me not in (call_row.caller_id, call_row.callee_id) then
    raise exception 'Call not found';
  end if;

  if p_status in ('accepted', 'declined') and me <> call_row.callee_id then
    raise exception 'Only the person being called can do that';
  end if;
  if p_status in ('cancelled', 'missed', 'ended') and me <> call_row.caller_id
     and not (p_status = 'ended' and call_row.status = 'accepted') then
    raise exception 'Only the caller can do that';
  end if;
  if p_status not in ('accepted', 'declined', 'cancelled', 'missed', 'ended') then
    raise exception 'Unknown call status';
  end if;

  if call_row.status <> 'ringing' and p_status <> 'ended' then
    return call_row.status;
  end if;

  if p_status = 'accepted' and call_row.created_at < now() - interval '90 seconds' then
    next_status := 'missed';
  end if;

  update public.chat_calls
  set status = next_status,
      answered_at = case when next_status = 'accepted' then now() else answered_at end
  where id = p_call;

  if call_row.status = 'ringing' then
    delete from public.notifications
    where user_id = call_row.callee_id and type = 'call'
      and entity_id = call_row.conversation_id;

    if next_status in ('missed', 'cancelled') then
      select coalesce(nullif(btrim(full_name), ''), email) into caller_name
      from public.employee_profiles where id = call_row.caller_id;
      insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
      values (call_row.callee_id, 'call_missed', 'Missed call from ' || caller_name,
              case when call_row.kind = 'video' then 'Video call' else 'Voice call' end,
              'social_conversation', call_row.conversation_id, 'skipped');
    end if;
  end if;

  return next_status;
end;
$$;

revoke all on function public.respond_chat_call(uuid, text) from public, anon;
grant execute on function public.respond_chat_call(uuid, text) to authenticated;

commit;
