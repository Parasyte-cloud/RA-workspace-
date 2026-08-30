-- RideArrivo Workspace
-- Time & Attendance control plane
--
-- Default operating schedule:
--   Monday-Friday
--   09:00-17:00
--   Africa/Lagos
--
-- Attendance timestamps are server-authoritative.
-- Browser/client supplied timestamps are never used for clock events.

begin;

-- ============================================================
-- WORK SCHEDULES
-- ============================================================

create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Africa/Lagos',
  start_time time without time zone not null default '09:00',
  end_time time without time zone not null default '17:00',
  work_days smallint[] not null default array[1,2,3,4,5]::smallint[],
  grace_minutes integer not null default 0 check (grace_minutes between 0 and 120),
  active boolean not null default true,
  is_default boolean not null default false,
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  check (
    work_days <@
    array[1,2,3,4,5,6,7]::smallint[]
  )
);

create unique index if not exists work_schedules_one_default_idx
on public.work_schedules(is_default)
where is_default = true and active = true;

insert into public.work_schedules (
  name,
  timezone,
  start_time,
  end_time,
  work_days,
  grace_minutes,
  active,
  is_default
)
select
  'RideArrivo Standard Work Week',
  'Africa/Lagos',
  '09:00'::time,
  '17:00'::time,
  array[1,2,3,4,5]::smallint[],
  0,
  true,
  true
where not exists (
  select 1
  from public.work_schedules
  where is_default = true
    and active = true
);

-- ============================================================
-- COMPANY HOLIDAYS
-- ============================================================

create table if not exists public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null,
  description text,
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- DAILY ATTENDANCE SESSION
-- ============================================================

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.employee_profiles(id) on delete cascade,

  work_date date not null,

  schedule_id uuid not null
    references public.work_schedules(id),

  -- Snapshot schedule values so historical attendance does not
  -- change if the schedule is edited later.
  timezone text not null,
  scheduled_start_time time without time zone not null,
  scheduled_end_time time without time zone not null,

  clock_in_at timestamptz not null,
  clock_out_at timestamptz,

  clock_in_source text not null default 'workspace',
  clock_out_source text,

  status text not null default 'open'
    check (status in ('open','closed','corrected')),

  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(employee_id, work_date),

  check (
    clock_out_at is null
    or clock_out_at >= clock_in_at
  )
);

create index if not exists attendance_sessions_employee_date_idx
on public.attendance_sessions(employee_id, work_date desc);

create index if not exists attendance_sessions_work_date_idx
on public.attendance_sessions(work_date desc);

create index if not exists attendance_sessions_status_idx
on public.attendance_sessions(status, work_date desc);

-- ============================================================
-- BREAKS
-- ============================================================

create table if not exists public.attendance_breaks (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.attendance_sessions(id) on delete cascade,

  started_at timestamptz not null default now(),
  ended_at timestamptz,

  created_at timestamptz not null default now(),

  check (
    ended_at is null
    or ended_at >= started_at
  )
);

create index if not exists attendance_breaks_session_idx
on public.attendance_breaks(session_id, started_at);

create unique index if not exists attendance_breaks_one_open_idx
on public.attendance_breaks(session_id)
where ended_at is null;

-- ============================================================
-- CORRECTION WORKFLOW
-- ============================================================

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.attendance_sessions(id) on delete cascade,

  employee_id uuid not null
    references public.employee_profiles(id) on delete cascade,

  requested_by uuid not null
    references public.employee_profiles(id),

  original_clock_in_at timestamptz not null,
  original_clock_out_at timestamptz,

  requested_clock_in_at timestamptz,
  requested_clock_out_at timestamptz,

  reason text not null,

  status text not null default 'pending'
    check (status in ('pending','approved','declined','cancelled')),

  reviewed_by uuid
    references public.employee_profiles(id) on delete set null,

  review_note text,

  created_at timestamptz not null default now(),
  reviewed_at timestamptz,

  check (
    requested_clock_out_at is null
    or requested_clock_in_at is null
    or requested_clock_out_at >= requested_clock_in_at
  )
);

create index if not exists attendance_corrections_employee_idx
on public.attendance_corrections(employee_id, created_at desc);

create index if not exists attendance_corrections_pending_idx
on public.attendance_corrections(status, created_at)
where status = 'pending';

-- ============================================================
-- OVERTIME APPROVAL
-- ============================================================

create table if not exists public.attendance_overtime_requests (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.attendance_sessions(id) on delete cascade,

  employee_id uuid not null
    references public.employee_profiles(id) on delete cascade,

  requested_minutes integer not null
    check (requested_minutes between 1 and 720),

  approved_minutes integer
    check (
      approved_minutes is null
      or approved_minutes between 0 and 720
    ),

  reason text not null,

  status text not null default 'pending'
    check (status in ('pending','approved','declined','cancelled')),

  requested_by uuid not null
    references public.employee_profiles(id),

  reviewed_by uuid
    references public.employee_profiles(id) on delete set null,

  review_note text,

  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists attendance_overtime_employee_idx
on public.attendance_overtime_requests(employee_id, created_at desc);

create index if not exists attendance_overtime_pending_idx
on public.attendance_overtime_requests(status, created_at)
where status = 'pending';

-- ============================================================
-- IMMUTABLE ATTENDANCE EVENT HISTORY
-- ============================================================

create table if not exists public.attendance_event_log (
  id uuid primary key default gen_random_uuid(),

  actor_id uuid
    references public.employee_profiles(id) on delete set null,

  employee_id uuid not null
    references public.employee_profiles(id) on delete cascade,

  session_id uuid
    references public.attendance_sessions(id) on delete cascade,

  event_type text not null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists attendance_event_employee_idx
on public.attendance_event_log(employee_id, created_at desc);

create index if not exists attendance_event_session_idx
on public.attendance_event_log(session_id, created_at);

-- ============================================================
-- ACCESS HELPER
-- ============================================================

create or replace function public.can_view_employee_attendance(
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() = p_employee_id
    or public.current_workspace_role() in ('hr','admin')
    or (
      public.current_workspace_role() = 'manager'
      and exists (
        select 1
        from public.employee_profiles p
        where p.id = p_employee_id
          and p.manager_id = auth.uid()
      )
    );
$$;

revoke all
on function public.can_view_employee_attendance(uuid)
from public, anon;

grant execute
on function public.can_view_employee_attendance(uuid)
to authenticated;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.work_schedules enable row level security;
alter table public.company_holidays enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_breaks enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.attendance_overtime_requests enable row level security;
alter table public.attendance_event_log enable row level security;

drop policy if exists "work schedules authenticated read"
on public.work_schedules;

create policy "work schedules authenticated read"
on public.work_schedules
for select
to authenticated
using (true);

drop policy if exists "work schedules admin manage"
on public.work_schedules;

create policy "work schedules admin manage"
on public.work_schedules
for all
to authenticated
using (public.current_workspace_role() = 'admin')
with check (public.current_workspace_role() = 'admin');

drop policy if exists "company holidays authenticated read"
on public.company_holidays;

create policy "company holidays authenticated read"
on public.company_holidays
for select
to authenticated
using (true);

drop policy if exists "company holidays admin manage"
on public.company_holidays;

create policy "company holidays admin manage"
on public.company_holidays
for all
to authenticated
using (public.current_workspace_role() = 'admin')
with check (public.current_workspace_role() = 'admin');

drop policy if exists "attendance sessions scoped read"
on public.attendance_sessions;

create policy "attendance sessions scoped read"
on public.attendance_sessions
for select
to authenticated
using (
  public.can_view_employee_attendance(employee_id)
);

drop policy if exists "attendance breaks scoped read"
on public.attendance_breaks;

create policy "attendance breaks scoped read"
on public.attendance_breaks
for select
to authenticated
using (
  exists (
    select 1
    from public.attendance_sessions s
    where s.id = session_id
      and public.can_view_employee_attendance(s.employee_id)
  )
);

drop policy if exists "attendance corrections scoped read"
on public.attendance_corrections;

create policy "attendance corrections scoped read"
on public.attendance_corrections
for select
to authenticated
using (
  public.can_view_employee_attendance(employee_id)
);

drop policy if exists "attendance overtime scoped read"
on public.attendance_overtime_requests;

create policy "attendance overtime scoped read"
on public.attendance_overtime_requests
for select
to authenticated
using (
  public.can_view_employee_attendance(employee_id)
);

drop policy if exists "attendance event scoped read"
on public.attendance_event_log;

create policy "attendance event scoped read"
on public.attendance_event_log
for select
to authenticated
using (
  public.can_view_employee_attendance(employee_id)
);

-- Direct attendance writes are intentionally blocked.
-- Clock events must go through server-authoritative RPC functions.

revoke all on public.attendance_sessions
from anon, authenticated;

revoke all on public.attendance_breaks
from anon, authenticated;

revoke all on public.attendance_corrections
from anon, authenticated;

revoke all on public.attendance_overtime_requests
from anon, authenticated;

revoke all on public.attendance_event_log
from anon, authenticated;

grant select on public.attendance_sessions
to authenticated;

grant select on public.attendance_breaks
to authenticated;

grant select on public.attendance_corrections
to authenticated;

grant select on public.attendance_overtime_requests
to authenticated;

grant select on public.attendance_event_log
to authenticated;

grant select, insert, update, delete
on public.work_schedules
to authenticated;

grant select, insert, update, delete
on public.company_holidays
to authenticated;

-- ============================================================
-- CLOCK IN
-- ============================================================

create or replace function public.attendance_clock_in()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_schedule public.work_schedules%rowtype;
  v_date date;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.employee_profiles p
    where p.id = v_user
      and p.active = true
  ) then
    raise exception 'Active employee profile required';
  end if;

  select *
  into v_schedule
  from public.work_schedules
  where active = true
    and is_default = true
  order by created_at
  limit 1;

  if not found then
    raise exception 'No active default work schedule configured';
  end if;

  v_date := (now() at time zone v_schedule.timezone)::date;

  if exists (
    select 1
    from public.attendance_sessions
    where employee_id = v_user
      and work_date = v_date
  ) then
    raise exception 'Attendance has already been started for today';
  end if;

  insert into public.attendance_sessions (
    employee_id,
    work_date,
    schedule_id,
    timezone,
    scheduled_start_time,
    scheduled_end_time,
    clock_in_at,
    clock_in_source,
    status
  )
  values (
    v_user,
    v_date,
    v_schedule.id,
    v_schedule.timezone,
    v_schedule.start_time,
    v_schedule.end_time,
    now(),
    'workspace',
    'open'
  )
  returning id into v_id;

  insert into public.attendance_event_log (
    actor_id,
    employee_id,
    session_id,
    event_type
  )
  values (
    v_user,
    v_user,
    v_id,
    'clock_in'
  );

  return v_id;
end;
$$;

-- ============================================================
-- START BREAK
-- ============================================================

create or replace function public.attendance_start_break()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid;
  v_break uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select id
  into v_session
  from public.attendance_sessions
  where employee_id = v_user
    and status = 'open'
    and clock_out_at is null
  order by work_date desc
  limit 1;

  if v_session is null then
    raise exception 'No open attendance session';
  end if;

  if exists (
    select 1
    from public.attendance_breaks
    where session_id = v_session
      and ended_at is null
  ) then
    raise exception 'A break is already active';
  end if;

  insert into public.attendance_breaks (
    session_id,
    started_at
  )
  values (
    v_session,
    now()
  )
  returning id into v_break;

  insert into public.attendance_event_log (
    actor_id,
    employee_id,
    session_id,
    event_type,
    metadata
  )
  values (
    v_user,
    v_user,
    v_session,
    'break_start',
    jsonb_build_object('break_id', v_break)
  );

  return v_break;
end;
$$;

-- ============================================================
-- END BREAK
-- ============================================================

create or replace function public.attendance_end_break()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid;
  v_break uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select id
  into v_session
  from public.attendance_sessions
  where employee_id = v_user
    and status = 'open'
    and clock_out_at is null
  order by work_date desc
  limit 1;

  if v_session is null then
    raise exception 'No open attendance session';
  end if;

  select id
  into v_break
  from public.attendance_breaks
  where session_id = v_session
    and ended_at is null
  order by started_at desc
  limit 1;

  if v_break is null then
    raise exception 'No active break';
  end if;

  update public.attendance_breaks
  set ended_at = now()
  where id = v_break;

  insert into public.attendance_event_log (
    actor_id,
    employee_id,
    session_id,
    event_type,
    metadata
  )
  values (
    v_user,
    v_user,
    v_session,
    'break_end',
    jsonb_build_object('break_id', v_break)
  );
end;
$$;

-- ============================================================
-- CLOCK OUT
-- ============================================================

create or replace function public.attendance_clock_out()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select id
  into v_session
  from public.attendance_sessions
  where employee_id = v_user
    and status = 'open'
    and clock_out_at is null
  order by work_date desc
  limit 1;

  if v_session is null then
    raise exception 'No open attendance session';
  end if;

  if exists (
    select 1
    from public.attendance_breaks
    where session_id = v_session
      and ended_at is null
  ) then
    raise exception 'End the active break before clocking out';
  end if;

  update public.attendance_sessions
  set
    clock_out_at = now(),
    clock_out_source = 'workspace',
    status = 'closed',
    updated_at = now()
  where id = v_session;

  insert into public.attendance_event_log (
    actor_id,
    employee_id,
    session_id,
    event_type
  )
  values (
    v_user,
    v_user,
    v_session,
    'clock_out'
  );
end;
$$;

-- ============================================================
-- CORRECTION REQUEST
-- ============================================================

create or replace function public.request_attendance_correction(
  p_session_id uuid,
  p_clock_in_at timestamptz default null,
  p_clock_out_at timestamptz default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_session public.attendance_sessions%rowtype;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception 'Correction reason is required';
  end if;

  select *
  into v_session
  from public.attendance_sessions
  where id = p_session_id
    and employee_id = v_user;

  if not found then
    raise exception 'Attendance session not found';
  end if;

  if exists (
    select 1
    from public.attendance_corrections
    where session_id = p_session_id
      and status = 'pending'
  ) then
    raise exception 'A correction request is already pending';
  end if;

  insert into public.attendance_corrections (
    session_id,
    employee_id,
    requested_by,
    original_clock_in_at,
    original_clock_out_at,
    requested_clock_in_at,
    requested_clock_out_at,
    reason
  )
  values (
    v_session.id,
    v_user,
    v_user,
    v_session.clock_in_at,
    v_session.clock_out_at,
    p_clock_in_at,
    p_clock_out_at,
    btrim(p_reason)
  )
  returning id into v_id;

  insert into public.attendance_event_log (
    actor_id,
    employee_id,
    session_id,
    event_type,
    metadata
  )
  values (
    v_user,
    v_user,
    v_session.id,
    'correction_requested',
    jsonb_build_object('correction_id', v_id)
  );

  return v_id;
end;
$$;

-- ============================================================
-- CORRECTION REVIEW
-- ============================================================

create or replace function public.review_attendance_correction(
  p_correction_id uuid,
  p_decision text,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_request public.attendance_corrections%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  v_role := public.current_workspace_role();

  select *
  into v_request
  from public.attendance_corrections
  where id = p_correction_id
    and status = 'pending';

  if not found then
    raise exception 'Pending correction request not found';
  end if;

  if not (
    v_role in ('hr','admin')
    or (
      v_role = 'manager'
      and exists (
        select 1
        from public.employee_profiles p
        where p.id = v_request.employee_id
          and p.manager_id = v_actor
      )
    )
  ) then
    raise exception 'Attendance review access denied';
  end if;

  if p_decision not in ('approved','declined') then
    raise exception 'Decision must be approved or declined';
  end if;

  update public.attendance_corrections
  set
    status = p_decision,
    reviewed_by = v_actor,
    review_note = nullif(btrim(coalesce(p_review_note,'')), ''),
    reviewed_at = now()
  where id = p_correction_id;

  if p_decision = 'approved' then
    update public.attendance_sessions
    set
      clock_in_at = coalesce(
        v_request.requested_clock_in_at,
        clock_in_at
      ),
      clock_out_at = coalesce(
        v_request.requested_clock_out_at,
        clock_out_at
      ),
      status = case
        when coalesce(
          v_request.requested_clock_out_at,
          clock_out_at
        ) is null
        then 'open'
        else 'corrected'
      end,
      updated_at = now()
    where id = v_request.session_id;
  end if;

  insert into public.attendance_event_log (
    actor_id,
    employee_id,
    session_id,
    event_type,
    metadata
  )
  values (
    v_actor,
    v_request.employee_id,
    v_request.session_id,
    'correction_' || p_decision,
    jsonb_build_object(
      'correction_id', p_correction_id,
      'review_note', p_review_note
    )
  );

  insert into public.admin_audit_log (
    actor_id,
    target_employee_id,
    action,
    entity_type,
    entity_id,
    source,
    metadata
  )
  values (
    v_actor,
    v_request.employee_id,
    'attendance.correction.' || p_decision,
    'attendance_correction',
    p_correction_id::text,
    'attendance',
    jsonb_build_object(
      'session_id', v_request.session_id,
      'review_note', p_review_note
    )
  );
end;
$$;

-- ============================================================
-- OVERTIME REQUEST
-- ============================================================

create or replace function public.request_attendance_overtime(
  p_session_id uuid,
  p_minutes integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if p_minutes is null or p_minutes < 1 or p_minutes > 720 then
    raise exception 'Requested overtime minutes are invalid';
  end if;

  if nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception 'Overtime reason is required';
  end if;

  if not exists (
    select 1
    from public.attendance_sessions
    where id = p_session_id
      and employee_id = v_user
  ) then
    raise exception 'Attendance session not found';
  end if;

  insert into public.attendance_overtime_requests (
    session_id,
    employee_id,
    requested_minutes,
    reason,
    requested_by
  )
  values (
    p_session_id,
    v_user,
    p_minutes,
    btrim(p_reason),
    v_user
  )
  returning id into v_id;

  insert into public.attendance_event_log (
    actor_id,
    employee_id,
    session_id,
    event_type,
    metadata
  )
  values (
    v_user,
    v_user,
    p_session_id,
    'overtime_requested',
    jsonb_build_object(
      'overtime_id', v_id,
      'requested_minutes', p_minutes
    )
  );

  return v_id;
end;
$$;

-- ============================================================
-- OVERTIME REVIEW
-- ============================================================

create or replace function public.review_attendance_overtime(
  p_request_id uuid,
  p_decision text,
  p_approved_minutes integer default null,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_request public.attendance_overtime_requests%rowtype;
  v_minutes integer;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  v_role := public.current_workspace_role();

  select *
  into v_request
  from public.attendance_overtime_requests
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'Pending overtime request not found';
  end if;

  if not (
    v_role in ('hr','admin')
    or (
      v_role = 'manager'
      and exists (
        select 1
        from public.employee_profiles p
        where p.id = v_request.employee_id
          and p.manager_id = v_actor
      )
    )
  ) then
    raise exception 'Overtime review access denied';
  end if;

  if p_decision not in ('approved','declined') then
    raise exception 'Decision must be approved or declined';
  end if;

  if p_decision = 'approved' then
    v_minutes := coalesce(
      p_approved_minutes,
      v_request.requested_minutes
    );

    if v_minutes < 0
       or v_minutes > v_request.requested_minutes then
      raise exception 'Approved overtime exceeds requested overtime';
    end if;
  else
    v_minutes := 0;
  end if;

  update public.attendance_overtime_requests
  set
    status = p_decision,
    approved_minutes = v_minutes,
    reviewed_by = v_actor,
    review_note = nullif(btrim(coalesce(p_review_note,'')), ''),
    reviewed_at = now()
  where id = p_request_id;

  insert into public.attendance_event_log (
    actor_id,
    employee_id,
    session_id,
    event_type,
    metadata
  )
  values (
    v_actor,
    v_request.employee_id,
    v_request.session_id,
    'overtime_' || p_decision,
    jsonb_build_object(
      'overtime_id', p_request_id,
      'approved_minutes', v_minutes
    )
  );

  insert into public.admin_audit_log (
    actor_id,
    target_employee_id,
    action,
    entity_type,
    entity_id,
    source,
    metadata
  )
  values (
    v_actor,
    v_request.employee_id,
    'attendance.overtime.' || p_decision,
    'attendance_overtime',
    p_request_id::text,
    'attendance',
    jsonb_build_object(
      'session_id', v_request.session_id,
      'approved_minutes', v_minutes,
      'review_note', p_review_note
    )
  );
end;
$$;

-- ============================================================
-- DAILY METRICS VIEW
-- ============================================================

create or replace view public.attendance_daily_metrics
with (security_invoker = true)
as
select
  s.id,
  s.employee_id,
  s.work_date,
  s.schedule_id,
  s.timezone,
  s.scheduled_start_time,
  s.scheduled_end_time,
  s.clock_in_at,
  s.clock_out_at,
  s.status,

  extract(
    epoch from
    (
      (s.work_date + s.scheduled_end_time)
      -
      (s.work_date + s.scheduled_start_time)
    )
  ) / 60.0 as scheduled_minutes,

  coalesce(
    (
      select sum(
        extract(
          epoch from
          (
            coalesce(b.ended_at, now()) - b.started_at
          )
        ) / 60.0
      )
      from public.attendance_breaks b
      where b.session_id = s.id
    ),
    0
  ) as break_minutes,

  greatest(
    0,
    extract(
      epoch from
      (
        s.clock_in_at
        -
        (
          (s.work_date + s.scheduled_start_time)
          at time zone s.timezone
        )
      )
    ) / 60.0
  ) as late_minutes,

  case
    when s.clock_out_at is null then null
    else greatest(
      0,
      extract(
        epoch from
        (
          (
            (s.work_date + s.scheduled_end_time)
            at time zone s.timezone
          )
          -
          s.clock_out_at
        )
      ) / 60.0
    )
  end as early_departure_minutes,

  greatest(
    0,
    (
      extract(
        epoch from
        (
          coalesce(s.clock_out_at, now()) - s.clock_in_at
        )
      ) / 60.0
    )
    -
    coalesce(
      (
        select sum(
          extract(
            epoch from
            (
              coalesce(b.ended_at, now()) - b.started_at
            )
          ) / 60.0
        )
        from public.attendance_breaks b
        where b.session_id = s.id
      ),
      0
    )
  ) as net_worked_minutes,

  coalesce(
    (
      select sum(o.approved_minutes)
      from public.attendance_overtime_requests o
      where o.session_id = s.id
        and o.status = 'approved'
    ),
    0
  ) as approved_overtime_minutes

from public.attendance_sessions s;

grant select
on public.attendance_daily_metrics
to authenticated;

-- ============================================================
-- RPC PERMISSIONS
-- ============================================================

revoke all on function public.attendance_clock_in()
from public, anon;

grant execute on function public.attendance_clock_in()
to authenticated;

revoke all on function public.attendance_start_break()
from public, anon;

grant execute on function public.attendance_start_break()
to authenticated;

revoke all on function public.attendance_end_break()
from public, anon;

grant execute on function public.attendance_end_break()
to authenticated;

revoke all on function public.attendance_clock_out()
from public, anon;

grant execute on function public.attendance_clock_out()
to authenticated;

revoke all on function public.request_attendance_correction(
  uuid,timestamptz,timestamptz,text
)
from public, anon;

grant execute on function public.request_attendance_correction(
  uuid,timestamptz,timestamptz,text
)
to authenticated;

revoke all on function public.review_attendance_correction(
  uuid,text,text
)
from public, anon;

grant execute on function public.review_attendance_correction(
  uuid,text,text
)
to authenticated;

revoke all on function public.request_attendance_overtime(
  uuid,integer,text
)
from public, anon;

grant execute on function public.request_attendance_overtime(
  uuid,integer,text
)
to authenticated;

revoke all on function public.review_attendance_overtime(
  uuid,text,integer,text
)
from public, anon;

grant execute on function public.review_attendance_overtime(
  uuid,text,integer,text
)
to authenticated;

commit;
