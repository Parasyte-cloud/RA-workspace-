-- Calendar: birthdays, work anniversaries and festivals appear on their own.
--
-- Nothing is copied into the events table. The calendar asks this function for
-- the occasions in the dates on screen, and it works them out from live data:
--   * birthdays   from the date of birth each person saves in My Profile
--   * anniversaries from the start date HR records on the person's record
--   * festivals and public holidays from the list below (HR and Admin edit it)
-- So the moment someone saves their date of birth, it is on the calendar, and
-- it moves or disappears if they change it or leave.
--
-- Only the day and month of a birthday are shown, never the year or the age.
--
-- This also lets HR set a start date from People & HR, by replacing
-- update_employee_record with a version that takes a start date.
--
-- Safe to run twice.

begin;

-- 1. Festivals and public holidays.
create table if not exists public.workspace_festivals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'holiday' check (kind in ('holiday', 'festival')),
  month int not null check (month between 1 and 12),
  day int not null check (day between 1 and 31),
  year int check (year is null or year between 2000 and 2100),
  approximate boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists workspace_festivals_unique
on public.workspace_festivals (lower(name), month, day, coalesce(year, 0));

alter table public.workspace_festivals enable row level security;

drop policy if exists "festivals read" on public.workspace_festivals;
create policy "festivals read"
on public.workspace_festivals
for select to authenticated
using (true);

drop policy if exists "festivals manage" on public.workspace_festivals;
create policy "festivals manage"
on public.workspace_festivals
for all to authenticated
using (public.has_workspace_role(array['hr', 'admin']))
with check (public.has_workspace_role(array['hr', 'admin']));

revoke all on public.workspace_festivals from anon;
grant select, insert, update, delete on public.workspace_festivals to authenticated;

-- Fixed every year (year is empty).
insert into public.workspace_festivals (name, kind, month, day, year, note) values
  ('New Year''s Day', 'holiday', 1, 1, null, null),
  ('Workers'' Day', 'holiday', 5, 1, null, null),
  ('Democracy Day', 'holiday', 6, 12, null, null),
  ('Independence Day', 'holiday', 10, 1, null, null),
  ('Christmas Day', 'holiday', 12, 25, null, null),
  ('Boxing Day', 'holiday', 12, 26, null, null)
on conflict do nothing;

-- Movable dates for 2026 and 2027. Easter dates are fixed by the calendar.
-- Islamic festival dates depend on the moon being sighted, so they are marked
-- approximate: HR should correct them when the government announces the day.
insert into public.workspace_festivals (name, kind, month, day, year, approximate, note) values
  ('Good Friday', 'holiday', 4, 3, 2026, false, null),
  ('Easter Monday', 'holiday', 4, 6, 2026, false, null),
  ('Eid al-Fitr', 'holiday', 3, 20, 2026, true, 'Approximate. Confirm when the date is announced.'),
  ('Eid al-Adha', 'holiday', 5, 27, 2026, true, 'Approximate. Confirm when the date is announced.'),
  ('Eid-el-Maulud', 'holiday', 8, 25, 2026, true, 'Approximate. Confirm when the date is announced.'),
  ('Good Friday', 'holiday', 3, 26, 2027, false, null),
  ('Easter Monday', 'holiday', 3, 29, 2027, false, null),
  ('Eid al-Fitr', 'holiday', 3, 10, 2027, true, 'Approximate. Confirm when the date is announced.'),
  ('Eid al-Adha', 'holiday', 5, 17, 2027, true, 'Approximate. Confirm when the date is announced.'),
  ('Eid-el-Maulud', 'holiday', 8, 15, 2027, true, 'Approximate. Confirm when the date is announced.')
on conflict do nothing;

-- 2. Everything that happens on its own, for the dates on screen.
create or replace function public.get_calendar_occasions(p_from date, p_to date)
returns table(
  kind text,
  title text,
  occurs_on date,
  employee_id uuid,
  years int,
  approximate boolean,
  note text
)
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
  -- Birthdays: day and month only.
  select 'birthday'::text,
         coalesce(nullif(btrim(p.full_name), ''), p.email),
         (p.date_of_birth + make_interval(years => y.yr - extract(year from p.date_of_birth)::int))::date,
         p.id,
         null::int,
         false,
         null::text
  from public.employee_profiles p
  cross join generate_series(extract(year from p_from)::int, extract(year from p_to)::int) as y(yr)
  where p.active = true
    and p.date_of_birth is not null
    and (p.date_of_birth + make_interval(years => y.yr - extract(year from p.date_of_birth)::int))::date
        between p_from and p_to

  union all

  -- Work anniversaries: from the second year on.
  select 'anniversary'::text,
         coalesce(nullif(btrim(p.full_name), ''), p.email),
         (p.start_date + make_interval(years => y.yr - extract(year from p.start_date)::int))::date,
         p.id,
         y.yr - extract(year from p.start_date)::int,
         false,
         null::text
  from public.employee_profiles p
  cross join generate_series(extract(year from p_from)::int, extract(year from p_to)::int) as y(yr)
  where p.active = true
    and p.start_date is not null
    and y.yr - extract(year from p.start_date)::int >= 1
    and (p.start_date + make_interval(years => y.yr - extract(year from p.start_date)::int))::date
        between p_from and p_to

  union all

  -- Festivals and public holidays.
  select f.kind,
         f.name,
         make_date(y.yr, f.month, least(f.day, extract(day from (make_date(y.yr, f.month, 1) + interval '1 month' - interval '1 day'))::int)),
         null::uuid,
         null::int,
         f.approximate,
         f.note
  from public.workspace_festivals f
  cross join generate_series(extract(year from p_from)::int, extract(year from p_to)::int) as y(yr)
  where (f.year is null or f.year = y.yr)
    and make_date(y.yr, f.month, least(f.day, extract(day from (make_date(y.yr, f.month, 1) + interval '1 month' - interval '1 day'))::int))
        between p_from and p_to

  order by 3, 1, 2;
end;
$$;

revoke all on function public.get_calendar_occasions(date, date) from public, anon;
grant execute on function public.get_calendar_occasions(date, date) to authenticated;

-- 3. HR can record a start date. The old six argument version is replaced.
drop function if exists public.update_employee_record(uuid, text, text, text, uuid, text);

create or replace function public.update_employee_record(
  target uuid,
  new_full_name text,
  new_department text,
  new_job_title text,
  new_manager uuid,
  new_role text default null,
  new_start_date date default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  caller_role text := public.current_workspace_role();
  old_row public.employee_profiles%rowtype;
  next_role text;
  next_start date;
begin
  if actor is null or not public.has_workspace_role(array['hr', 'admin']) then
    raise exception 'Only People & HR or an administrator can do this' using errcode = '42501';
  end if;

  select * into old_row from public.employee_profiles where id = target;
  if not found then
    raise exception 'Employee not found';
  end if;
  if lower(old_row.role) = 'admin' and caller_role <> 'admin' then
    raise exception 'Only an administrator can edit an administrator';
  end if;
  if nullif(btrim(new_full_name), '') is null then
    raise exception 'Name is required';
  end if;
  if new_manager = target then
    raise exception 'An employee cannot be their own manager';
  end if;
  if new_manager is not null and not exists (
    select 1 from public.employee_profiles where id = new_manager
  ) then
    raise exception 'Manager not found';
  end if;

  next_role := old_row.role;
  if new_role is not null and lower(new_role) <> lower(old_row.role) then
    if caller_role <> 'admin' then
      raise exception 'Only an administrator can change a role' using errcode = '42501';
    end if;
    next_role := lower(new_role);
  end if;

  next_start := coalesce(new_start_date, old_row.start_date);

  update public.employee_profiles
  set full_name = btrim(new_full_name),
      department = coalesce(nullif(btrim(new_department), ''), 'Unassigned'),
      job_title = btrim(coalesce(new_job_title, '')),
      manager_id = new_manager,
      role = next_role,
      start_date = next_start,
      updated_at = now()
  where id = target;

  insert into public.admin_audit_log(
    actor_id, target_employee_id, action, entity_type, entity_id, source, metadata
  ) values (
    actor, target, 'employee.record_edited', 'employee_profiles', target::text, 'people-hr',
    jsonb_build_object(
      'before', jsonb_build_object(
        'full_name', old_row.full_name, 'department', old_row.department,
        'job_title', old_row.job_title, 'manager_id', old_row.manager_id,
        'role', old_row.role, 'start_date', old_row.start_date
      ),
      'after', jsonb_build_object(
        'full_name', btrim(new_full_name),
        'department', coalesce(nullif(btrim(new_department), ''), 'Unassigned'),
        'job_title', btrim(coalesce(new_job_title, '')),
        'manager_id', new_manager, 'role', next_role, 'start_date', next_start
      )
    )
  );
end;
$$;

revoke all on function public.update_employee_record(uuid, text, text, text, uuid, text, date) from public, anon;
grant execute on function public.update_employee_record(uuid, text, text, text, uuid, text, date) to authenticated;

commit;
