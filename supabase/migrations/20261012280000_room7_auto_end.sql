-- ROOM 7 rooms that nobody ended.
--
-- A normal meeting stays ACTIVE until its host presses End. People forget, so
-- rooms from last week still showed as live and could be joined. This closes
-- any room that is more than 12 hours old, unless it is part of a scheduled
-- event that has not finished.
--
-- It runs every 15 minutes through pg_cron if that is enabled. If it is not,
-- run  select public.end_stale_rooms();  now and then.
--
-- Safe to run twice.

begin;

create or replace function public.end_stale_rooms(p_hours integer default 12)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.workspace_rooms r
  set status = 'ended', ended_at = now()
  where r.status = 'active'
    and r.created_at < now() - make_interval(hours => greatest(p_hours, 1))
    and not exists (
      select 1
      from public.room7_external_rooms e
      where e.room_id = r.id
        and e.event_state in ('draft', 'pre_event', 'doors_open', 'live', 'intermission')
        and (e.scheduled_end is null or e.scheduled_end > now() - interval '2 hours')
    );

  get diagnostics v_count = row_count;

  -- Keep the public event pages in step with the rooms just closed.
  update public.room7_external_rooms e
  set event_state = 'ended'
  from public.workspace_rooms r
  where e.room_id = r.id
    and r.status = 'ended'
    and e.event_state in ('draft', 'pre_event', 'doors_open', 'live', 'intermission')
    and (e.scheduled_end is null or e.scheduled_end <= now() - interval '2 hours');

  return v_count;
end;
$$;

revoke all on function public.end_stale_rooms(integer) from public, anon, authenticated;
grant execute on function public.end_stale_rooms(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ridearrivo-end-stale-rooms';
    perform cron.schedule('ridearrivo-end-stale-rooms', '*/15 * * * *', 'select public.end_stale_rooms();');
  else
    raise notice 'pg_cron is not enabled: run select public.end_stale_rooms() every 15 minutes instead.';
  end if;
end;
$$;

-- Close the rooms that are already stale.
select public.end_stale_rooms();

commit;
