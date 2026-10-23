-- ROOM 7 calendar: keep the public calendar feed truthful.
--
-- 1. Deleting a meeting left its calendar event confirmed, so the "Add to
--    calendar" link kept handing out an invitation to a room that no longer
--    exists. Deleting a meeting now cancels its calendar event (SEQUENCE goes
--    up, so calendars that already have it remove it).
-- 2. A description change now raises SEQUENCE too, so calendars refresh it.
-- 3. The timezone and reminders are sanity checked on the server, not only in
--    the browser: an unknown zone becomes Africa/Lagos, reminders are whole
--    minutes between 1 minute and 4 weeks, at most five.
-- 4. Event codes must look like room codes.
--
-- PArAsYtE

begin;

create or replace function public.room7_calendar_events_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cleaned integer[];
begin
  if new.timezone is null
     or not exists (
       select 1 from pg_timezone_names z where z.name = new.timezone
     ) then
    new.timezone := 'Africa/Lagos';
  end if;

  select coalesce(array_agg(m order by m desc), array[]::integer[])
  into cleaned
  from (
    select distinct least(40320, greatest(1, r)) as m
    from unnest(coalesce(new.reminder_minutes, array[]::integer[])) as r
    order by 1 desc
    limit 5
  ) x;

  new.reminder_minutes :=
    case when cardinality(cleaned) = 0 then array[60, 15] else cleaned end;

  if tg_op = 'UPDATE' then
    -- Ownership is immutable. A manager may administer the event without
    -- becoming its creator.
    new.created_by := old.created_by;

    -- Calendar clients use SEQUENCE to recognise schedule/status revisions.
    if new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.join_url is distinct from old.join_url
       or new.status is distinct from old.status then
      new.sequence := old.sequence + 1;
    else
      new.sequence := old.sequence;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Deleting a meeting cancels its calendar event.
create or replace function public.room7_cancel_calendar_on_room_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.room7_calendar_events
  set status = 'cancelled'
  where status <> 'cancelled'
    and (
      meeting_id = old.id
      or event_code = upper(old.room_code)
    );

  return old;
end;
$$;

revoke all on function public.room7_cancel_calendar_on_room_delete()
from public, anon, authenticated;

drop trigger if exists room7_cancel_calendar_on_room_delete
on public.workspace_rooms;

create trigger room7_cancel_calendar_on_room_delete
before delete on public.workspace_rooms
for each row
execute function public.room7_cancel_calendar_on_room_delete();

-- NOT VALID: existing rows are left alone, every new or changed row is checked.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'room7_calendar_events_code_check'
  ) then
    alter table public.room7_calendar_events
      add constraint room7_calendar_events_code_check
      check (event_code ~ '^[A-Z0-9]{4,20}$') not valid;
  end if;
end;
$$;

commit;
