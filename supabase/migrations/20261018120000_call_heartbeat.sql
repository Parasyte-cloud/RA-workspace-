-- Calls end when the app is swiped away.
--
-- Before this, an answered call stayed "In progress" until someone hung up or
-- 4 hours passed. Swiping the app away (or losing signal for good) never hangs
-- up, so the person looked busy ("on another call") for hours and callers got a
-- missed call. Now:
--
--   * Both phones send a heartbeat every 15 seconds while a call is open
--     (chat_call_heartbeat). It also tells the app if the call was ended
--     elsewhere.
--   * An answered call with no heartbeat for 60 seconds is ended by the
--     database (end_stale_calls_for), by the same sweep that marks rings as
--     missed and again whenever a new call is started.
--   * Calls from an older app version never send a heartbeat, so they keep the
--     old 4 hour rule until that phone updates.
--
-- Safe to run twice. Run it BEFORE the matching app release.

begin;

alter table public.chat_calls add column if not exists heartbeat_at timestamptz;

create or replace function public.chat_call_heartbeat(p_call uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  current_status text;
begin
  if me is null then
    return null;
  end if;
  select status into current_status
  from public.chat_calls
  where id = p_call and me in (caller_id, callee_id);
  if current_status = 'accepted' then
    update public.chat_calls set heartbeat_at = now() where id = p_call;
  end if;
  return current_status;
end;
$$;

revoke all on function public.chat_call_heartbeat(uuid) from public, anon;
grant execute on function public.chat_call_heartbeat(uuid) to authenticated;

create or replace function public.end_stale_calls_for(p_user uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.chat_calls
  set status = 'ended', ended_at = now()
  where status = 'accepted'
    and (caller_id = p_user or callee_id = p_user)
    and (
      (heartbeat_at is not null and heartbeat_at < now() - interval '60 seconds')
      or (heartbeat_at is null and coalesce(answered_at, created_at) < now() - interval '4 hours')
    );
$$;

revoke all on function public.end_stale_calls_for(uuid) from public, anon, authenticated;

create or replace function public.expire_chat_calls()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  stale record;
  caller_name text;
  total integer := 0;
begin
  if me is null then
    return 0;
  end if;

  for stale in
    select * from public.chat_calls
    where status = 'ringing'
      and created_at < now() - interval '45 seconds'
      and (caller_id = me or callee_id = me)
    for update
  loop
    update public.chat_calls set status = 'missed' where id = stale.id;
    total := total + 1;

    delete from public.notifications
    where user_id = stale.callee_id and type = 'call'
      and entity_id = stale.conversation_id;

    select coalesce(nullif(btrim(full_name), ''), email) into caller_name
    from public.employee_profiles where id = stale.caller_id;

    insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
    values (stale.callee_id, 'call_missed', 'Missed call from ' || caller_name,
            case when stale.kind = 'video' then 'Video call' else 'Voice call' end,
            'social_conversation', stale.conversation_id, 'skipped');
  end loop;

  -- Answered calls nobody is on any more (see end_stale_calls_for).
  perform public.end_stale_calls_for(me);

  return total;
end;
$$;

revoke all on function public.expire_chat_calls() from public, anon;
grant execute on function public.expire_chat_calls() to authenticated;

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

  -- Serialise concurrent callers aimed at the same person, so two people
  -- cannot both see "free" and ring at once.
  perform pg_advisory_xact_lock(hashtextextended('chat-call:' || other::text, 0));

  -- A call whose app was swiped away or closed never hung up. Clear dead calls
  -- of both people first, so a stuck call cannot make someone look busy.
  perform public.end_stale_calls_for(other);
  perform public.end_stale_calls_for(me);

  select coalesce(nullif(btrim(full_name), ''), email) into caller_name
  from public.employee_profiles where id = me;

  if exists (
    select 1 from public.chat_calls c
    where (c.callee_id = other or c.caller_id = other)
      and c.caller_id <> me
      and (
        (c.status = 'ringing' and c.created_at > now() - interval '60 seconds')
        or (c.status = 'accepted' and coalesce(c.answered_at, c.created_at) > now() - interval '4 hours')
      )
  ) or exists (
    select 1 from public.chat_calls c
    where c.callee_id = other and c.caller_id = me
      and c.status = 'accepted'
      and coalesce(c.answered_at, c.created_at) > now() - interval '4 hours'
  ) then
    insert into public.chat_calls(conversation_id, caller_id, callee_id, room_code, kind, status)
    values (p_conversation, me, other, p_room_code, p_kind, 'missed');

    insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
    values (other, 'call_missed', 'Missed call from ' || caller_name,
            'You were on another call',
            'social_conversation', p_conversation, 'skipped');
    return null;
  end if;

  -- One live ring per caller at a time.
  update public.chat_calls set status = 'cancelled'
  where caller_id = me and status = 'ringing';

  insert into public.chat_calls(conversation_id, caller_id, callee_id, room_code, kind)
  values (p_conversation, me, other, p_room_code, p_kind)
  returning id into call_id;

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  values (other, 'call', caller_name || ' is calling',
          case when p_kind = 'video' then 'Incoming video call' else 'Incoming voice call' end,
          'social_conversation', p_conversation, 'skipped');

  return call_id;
end;
$$;

revoke all on function public.start_chat_call(uuid, text, text) from public, anon;
grant execute on function public.start_chat_call(uuid, text, text) to authenticated;

-- One-off: calls that are stuck as "In progress" right now (older than 10
-- minutes with no heartbeat column yet) are ended, and their rooms with them.
update public.chat_calls
set status = 'ended', ended_at = now()
where status = 'accepted' and heartbeat_at is null
  and coalesce(answered_at, created_at) < now() - interval '10 minutes';

commit;
