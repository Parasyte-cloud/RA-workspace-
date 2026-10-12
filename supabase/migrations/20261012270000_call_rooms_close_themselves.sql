-- Call rooms close themselves.
--
-- A call started from Chat makes a ROOM 7 room behind the scenes. Before this
-- change that room stayed ACTIVE after the call ended: hanging up ended the
-- chat call but never the room, and the room was only closed if the caller's
-- own browser was still open. Declined, missed and cancelled calls piled up
-- as "ACTIVE" meetings in the ROOM 7 list.
--
-- 1. When a chat call reaches a final state, its room is ended by the database.
-- 2. A call that was answered but never hung up (both browsers closed) is
--    ended after 4 hours, and its room with it.
-- 3. Rooms left over from earlier calls are cleaned up once, here.
--
-- Safe to run twice. Run it BEFORE the matching app release.

begin;

create or replace function public.end_call_room()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('declined', 'cancelled', 'missed', 'ended')
     and old.status is distinct from new.status
     and new.room_code is not null then
    update public.workspace_rooms
    set status = 'ended', ended_at = now()
    where room_code = new.room_code and status = 'active';
  end if;
  return new;
end;
$$;

revoke all on function public.end_call_room() from public, anon, authenticated;

drop trigger if exists chat_calls_end_room on public.chat_calls;
create trigger chat_calls_end_room
  after update of status on public.chat_calls
  for each row execute function public.end_call_room();

-- Answered calls nobody hung up. Part of the same sweep that marks rings missed.
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

  update public.chat_calls
  set status = 'ended', ended_at = now()
  where status = 'accepted'
    and coalesce(answered_at, created_at) < now() - interval '4 hours'
    and (caller_id = me or callee_id = me);

  return total;
end;
$$;

revoke all on function public.expire_chat_calls() from public, anon;
grant execute on function public.expire_chat_calls() to authenticated;

-- One-off cleanup: rooms that belong to a chat call which is over (or that
-- were started more than 4 hours ago and never closed).
update public.workspace_rooms r
set status = 'ended', ended_at = now()
where r.status = 'active'
  and exists (
    select 1 from public.chat_calls c
    where c.room_code = r.room_code
      and (c.status in ('declined', 'cancelled', 'missed', 'ended')
           or c.created_at < now() - interval '4 hours')
  );

commit;
