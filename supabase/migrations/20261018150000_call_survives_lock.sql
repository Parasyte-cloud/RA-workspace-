-- Calls survive a locked phone or another app, and a quiet phone no longer
-- blocks people from ringing through.
--
--  * A call is ended by the database only after 15 minutes without a
--    heartbeat (was 150 seconds). A locked phone or a long app switch keeps
--    the call; the other person sees "reconnecting" rather than a hang up.
--  * Starting a call treats the other person as busy only if their call has a
--    heartbeat from the last 75 seconds. A swiped-away or locked phone stops
--    blocking new calls after that, so the next call rings normally.
-- Run after 20261018120000 and 20261018130000. Safe to run twice.

begin;

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
      (heartbeat_at is not null and heartbeat_at < now() - interval '15 minutes')
      or (heartbeat_at is null and coalesce(answered_at, created_at) < now() - interval '4 hours')
    );
$$;
revoke all on function public.end_stale_calls_for(uuid) from public, anon, authenticated;

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

  -- "On another call" only counts while that other call is really alive: its
  -- phone has sent a heartbeat in the last 75 seconds (or is an older app that
  -- never sends one and the call is under 4 hours old). A call whose phone went
  -- quiet (locked, offline, swiped away) no longer stops people ringing through.
  if exists (
    select 1 from public.chat_calls c
    where (c.callee_id = other or c.caller_id = other)
      and c.caller_id <> me
      and (
        (c.status = 'ringing' and c.created_at > now() - interval '60 seconds')
        or (c.status = 'accepted' and (
              c.heartbeat_at > now() - interval '75 seconds'
              or (c.heartbeat_at is null and coalesce(c.answered_at, c.created_at) > now() - interval '4 hours')
           ))
      )
  ) or exists (
    select 1 from public.chat_calls c
    where c.callee_id = other and c.caller_id = me
      and c.status = 'accepted'
      and (
        c.heartbeat_at > now() - interval '75 seconds'
        or (c.heartbeat_at is null and coalesce(c.answered_at, c.created_at) > now() - interval '4 hours')
      )
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

commit;
