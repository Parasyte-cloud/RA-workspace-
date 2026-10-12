-- Chat calls, round two: a proper call history.
--
-- 1. Calls remember when they ended, so the chat can show "Voice call, 4:32".
-- 2. A call nobody answers is marked missed by the DATABASE after 45 seconds,
--    no matter whose browser is open. Before, only the caller's own browser
--    could do it, so a caller who closed the tab left a call "ringing" for ever
--    and the other person never saw a missed call.
-- 3. Either person may mark an answered call as ended, once.
--
-- Safe to run twice. Run it BEFORE the matching app release.

begin;

alter table public.chat_calls
  add column if not exists ended_at timestamptz;

create index if not exists idx_chat_calls_conversation
  on public.chat_calls(conversation_id, created_at desc);

-- 1. Answer, decline, cancel or end a call (same name and arguments as before).
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
  if p_status not in ('accepted', 'declined', 'cancelled', 'missed', 'ended') then
    raise exception 'Unknown call status';
  end if;

  select * into call_row from public.chat_calls where id = p_call for update;
  if not found or me is null or me not in (call_row.caller_id, call_row.callee_id) then
    raise exception 'Call not found';
  end if;

  if p_status in ('accepted', 'declined') and me <> call_row.callee_id then
    raise exception 'Only the person being called can do that';
  end if;
  if p_status in ('cancelled', 'missed') and me <> call_row.caller_id then
    raise exception 'Only the caller can do that';
  end if;

  -- Ending is for answered calls only, by either person, and happens once.
  if p_status = 'ended' then
    if call_row.status <> 'accepted' then
      return call_row.status;
    end if;
    update public.chat_calls set status = 'ended', ended_at = now() where id = p_call;
    return 'ended';
  end if;

  -- Everything else only applies while the phone is still ringing.
  if call_row.status <> 'ringing' then
    return call_row.status;
  end if;

  if p_status = 'accepted' and call_row.created_at < now() - interval '60 seconds' then
    next_status := 'missed';
  end if;

  update public.chat_calls
  set status = next_status,
      answered_at = case when next_status = 'accepted' then now() else answered_at end
  where id = p_call;

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

  return next_status;
end;
$$;

revoke all on function public.respond_chat_call(uuid, text) from public, anon;
grant execute on function public.respond_chat_call(uuid, text) to authenticated;

-- 2. Mark calls that rang out as missed. Either person's browser may call it,
-- and it only touches that person's own calls.
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

  return total;
end;
$$;

revoke all on function public.expire_chat_calls() from public, anon;
grant execute on function public.expire_chat_calls() to authenticated;

commit;
