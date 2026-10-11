-- Calendar, full version: repeating events, personal events, invitations with
-- replies, reminders, and who is on leave.
--
--   * Events can repeat (daily, weekly, every two weeks, monthly, yearly).
--   * Visibility: "everyone" (company calendar), "invited" (only the people
--     you invite) or "private" (only you). Anyone can keep private events and
--     invite people to their own events; only HR, Admin and managers publish to
--     everyone, as before.
--   * Invited people are notified and can answer Going / Maybe / Can't.
--   * Each event can carry a reminder (minutes before it starts).
--   * get_calendar_leave shows who is out on approved leave, dates only. The
--     reason and type of leave are never shown.
--
-- Safe to run twice.

begin;

-- 1. New event columns.
alter table public.workspace_events
  add column if not exists recurrence text not null default 'none',
  add column if not exists recurrence_until date,
  add column if not exists visibility text not null default 'everyone',
  add column if not exists reminder_minutes int;

alter table public.workspace_events drop constraint if exists workspace_events_recurrence_check;
alter table public.workspace_events add constraint workspace_events_recurrence_check
  check (recurrence in ('none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'));

alter table public.workspace_events drop constraint if exists workspace_events_visibility_check;
alter table public.workspace_events add constraint workspace_events_visibility_check
  check (visibility in ('everyone', 'invited', 'private'));

alter table public.workspace_events drop constraint if exists workspace_events_reminder_check;
alter table public.workspace_events add constraint workspace_events_reminder_check
  check (reminder_minutes is null or reminder_minutes between 0 and 10080);

-- 2. Invitations.
create table if not exists public.workspace_event_attendees (
  event_id uuid not null references public.workspace_events(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  response text not null default 'pending' check (response in ('pending', 'going', 'maybe', 'declined')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, employee_id)
);

create index if not exists idx_event_attendees_employee
on public.workspace_event_attendees(employee_id);

-- Helpers are security definer so the two tables' policies do not call each
-- other in a loop.
create or replace function public.is_event_attendee(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_event_attendees a
    where a.event_id = p_event and a.employee_id = auth.uid()
  );
$$;

create or replace function public.event_owner(p_event uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select created_by from public.workspace_events where id = p_event;
$$;

revoke all on function public.is_event_attendee(uuid) from public, anon;
revoke all on function public.event_owner(uuid) from public, anon;
grant execute on function public.is_event_attendee(uuid) to authenticated;
grant execute on function public.event_owner(uuid) to authenticated;

-- 3. Event policies.
drop policy if exists "workspace events read" on public.workspace_events;
drop policy if exists "workspace events manage" on public.workspace_events;
drop policy if exists "events select" on public.workspace_events;
drop policy if exists "events insert" on public.workspace_events;
drop policy if exists "events update" on public.workspace_events;
drop policy if exists "events delete" on public.workspace_events;

create policy "events select"
on public.workspace_events for select to authenticated
using (
  visibility = 'everyone'
  or created_by = auth.uid()
  or public.is_event_attendee(id)
);

create policy "events insert"
on public.workspace_events for insert to authenticated
with check (
  created_by = auth.uid()
  and (visibility in ('private', 'invited') or public.has_workspace_role(array['hr', 'admin', 'manager']))
);

create policy "events update"
on public.workspace_events for update to authenticated
using (
  created_by = auth.uid()
  or (visibility <> 'private' and public.has_workspace_role(array['hr', 'admin', 'manager']))
)
with check (
  (created_by = auth.uid()
    and (visibility in ('private', 'invited') or public.has_workspace_role(array['hr', 'admin', 'manager'])))
  or (visibility <> 'private' and public.has_workspace_role(array['hr', 'admin', 'manager']))
);

create policy "events delete"
on public.workspace_events for delete to authenticated
using (
  created_by = auth.uid()
  or (visibility <> 'private' and public.has_workspace_role(array['hr', 'admin', 'manager']))
);

-- 4. Attendee policies.
alter table public.workspace_event_attendees enable row level security;

drop policy if exists "attendees select" on public.workspace_event_attendees;
drop policy if exists "attendees insert" on public.workspace_event_attendees;
drop policy if exists "attendees delete" on public.workspace_event_attendees;
drop policy if exists "attendees respond" on public.workspace_event_attendees;

create policy "attendees select"
on public.workspace_event_attendees for select to authenticated
using (
  employee_id = auth.uid()
  or public.event_owner(event_id) = auth.uid()
  or public.has_workspace_role(array['hr', 'admin'])
);

create policy "attendees insert"
on public.workspace_event_attendees for insert to authenticated
with check (public.event_owner(event_id) = auth.uid());

create policy "attendees delete"
on public.workspace_event_attendees for delete to authenticated
using (public.event_owner(event_id) = auth.uid());

create policy "attendees respond"
on public.workspace_event_attendees for update to authenticated
using (employee_id = auth.uid())
with check (employee_id = auth.uid());

revoke all on public.workspace_event_attendees from anon;
revoke update on public.workspace_event_attendees from authenticated;
grant select, insert, delete on public.workspace_event_attendees to authenticated;
grant update (response, responded_at) on public.workspace_event_attendees to authenticated;

-- 5. Tell people when they are invited.
create or replace function public.notify_event_invite()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ev public.workspace_events%rowtype;
  who text;
begin
  select * into ev from public.workspace_events where id = new.event_id;
  if not found or new.employee_id = ev.created_by then
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into who
  from public.employee_profiles where id = ev.created_by;

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  values (
    new.employee_id,
    'event_invite',
    'Invitation: ' || ev.title,
    coalesce(who, 'A colleague') || ' invited you on '
      || to_char(ev.starts_at at time zone 'Africa/Lagos', 'FMDy DD Mon, HH12:MI AM'),
    'workspace_event',
    ev.id,
    'skipped'
  );
  return new;
end;
$$;

revoke all on function public.notify_event_invite() from public, anon, authenticated;

drop trigger if exists notify_event_invite on public.workspace_event_attendees;
create trigger notify_event_invite
after insert on public.workspace_event_attendees
for each row execute function public.notify_event_invite();

-- 6. Who is out. Dates only, never the reason or type of leave.
create or replace function public.get_calendar_leave(p_from date, p_to date)
returns table(employee_id uuid, full_name text, start_date date, end_date date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.employee_profiles where id = auth.uid() and active = true
  ) then
    raise exception 'Active workspace profile required' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose a date range of at most 400 days';
  end if;

  return query
  select l.employee_id,
         coalesce(nullif(btrim(p.full_name), ''), p.email),
         l.start_date,
         l.end_date
  from public.leave_requests l
  join public.employee_profiles p on p.id = l.employee_id and p.active = true
  where l.status = 'approved'
    and l.start_date <= p_to
    and l.end_date >= p_from
  order by l.start_date, 2;
end;
$$;

revoke all on function public.get_calendar_leave(date, date) from public, anon;
grant execute on function public.get_calendar_leave(date, date) to authenticated;

commit;
