begin;

create table if not exists public.room7_calendar_events (
  id uuid primary key default gen_random_uuid(),
  event_code text not null unique,
  meeting_id uuid,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Africa/Lagos',
  join_url text not null,
  organizer_name text,
  organizer_email text,
  sequence integer not null default 0,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled')),
  reminder_minutes integer[] not null default array[60, 15],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint room7_calendar_events_time_check
    check (ends_at > starts_at)
);

create index if not exists
  room7_calendar_events_starts_at_idx
on public.room7_calendar_events(starts_at);

alter table public.room7_calendar_events enable row level security;

revoke all on public.room7_calendar_events from anon;
revoke all on public.room7_calendar_events from authenticated;

grant select, insert, update on public.room7_calendar_events to authenticated;

drop policy if exists room7_calendar_events_read
  on public.room7_calendar_events;

create policy room7_calendar_events_read
on public.room7_calendar_events
for select
to authenticated
using (
  created_by = auth.uid()
  or public.has_workspace_role(array['manager', 'admin'])
);

drop policy if exists room7_calendar_events_create
  on public.room7_calendar_events;

create policy room7_calendar_events_create
on public.room7_calendar_events
for insert
to authenticated
with check (
  created_by = auth.uid()
);

drop policy if exists room7_calendar_events_update
  on public.room7_calendar_events;

create policy room7_calendar_events_update
on public.room7_calendar_events
for update
to authenticated
using (
  created_by = auth.uid()
  or public.has_workspace_role(array['manager', 'admin'])
)
with check (
  created_by = auth.uid()
  or public.has_workspace_role(array['manager', 'admin'])
);


create or replace function public.room7_calendar_events_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- Ownership is immutable. A manager may administer the event without
    -- becoming its creator.
    new.created_by := old.created_by;

    -- Calendar clients use SEQUENCE to recognise schedule/status revisions.
    if new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
       or new.title is distinct from old.title
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

drop trigger if exists room7_calendar_events_before_write
on public.room7_calendar_events;

create trigger room7_calendar_events_before_write
before insert or update
on public.room7_calendar_events
for each row
execute function public.room7_calendar_events_before_write();

commit;
