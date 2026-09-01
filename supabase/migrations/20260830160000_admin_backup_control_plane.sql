-- RideArrivo Administration backup control plane
-- Stage 1: persistence, scheduling metadata and access control.

create table public.admin_backup_schedules (
  id text primary key
    default 'primary'
    check (id = 'primary'),

  enabled boolean not null default true,

  frequency text not null default 'daily'
    check (
      frequency in (
        'daily',
        'weekly',
        'monthly'
      )
    ),

  run_time time without time zone
    not null default '02:00',

  day_of_week smallint
    check (
      day_of_week is null
      or day_of_week between 0 and 6
    ),

  day_of_month smallint
    check (
      day_of_month is null
      or day_of_month between 1 and 28
    ),

  timezone text not null default 'Africa/Lagos',

  retention_days integer not null default 30
    check (
      retention_days between 7 and 3650
    ),

  created_by uuid
    references public.employee_profiles(id)
    on delete set null,

  updated_by uuid
    references public.employee_profiles(id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint admin_backup_schedule_frequency_fields_check
  check (
    (
      frequency = 'daily'
      and day_of_week is null
      and day_of_month is null
    )
    or
    (
      frequency = 'weekly'
      and day_of_week is not null
      and day_of_month is null
    )
    or
    (
      frequency = 'monthly'
      and day_of_week is null
      and day_of_month is not null
    )
  )
);

create table public.admin_backup_jobs (
  id uuid primary key default gen_random_uuid(),

  trigger_source text not null
    check (
      trigger_source in (
        'manual',
        'schedule'
      )
    ),

  status text not null default 'queued'
    check (
      status in (
        'queued',
        'running',
        'succeeded',
        'failed',
        'cancelled'
      )
    ),

  requested_by uuid
    references public.employee_profiles(id)
    on delete set null,

  schedule_id text
    references public.admin_backup_schedules(id)
    on delete set null,

  scheduled_for timestamptz,

  coverage jsonb not null default
    '{
      "database": true,
      "auth": true,
      "storage": true,
      "repository": true,
      "configuration_manifest": true
    }'::jsonb,

  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,

  artifact_path text,

  artifact_bytes bigint
    check (
      artifact_bytes is null
      or artifact_bytes >= 0
    ),

  checksum_sha256 text,

  manifest jsonb not null default '{}'::jsonb,

  restore_status text not null default 'unverified'
    check (
      restore_status in (
        'unverified',
        'verified',
        'failed'
      )
    ),

  restore_verified_at timestamptz,
  restore_notes text,
  error_message text,
  runner_id text
);

create index admin_backup_jobs_requested_idx
on public.admin_backup_jobs (
  requested_at desc
);

create index admin_backup_jobs_status_idx
on public.admin_backup_jobs (
  status,
  requested_at
);

create unique index admin_backup_jobs_schedule_slot_unique
on public.admin_backup_jobs (
  schedule_id,
  scheduled_for
)
where
  schedule_id is not null
  and scheduled_for is not null;

insert into public.admin_backup_schedules (
  id,
  enabled,
  frequency,
  run_time,
  timezone,
  retention_days
)
values (
  'primary',
  true,
  'daily',
  '02:00',
  'Africa/Lagos',
  30
);

alter table public.admin_backup_schedules
enable row level security;

alter table public.admin_backup_jobs
enable row level security;

create policy "admin backup schedules admin read"
on public.admin_backup_schedules
for select
to authenticated
using (
  public.current_workspace_role() = 'admin'
);

create policy "admin backup jobs admin read"
on public.admin_backup_jobs
for select
to authenticated
using (
  public.current_workspace_role() = 'admin'
);

revoke all
on public.admin_backup_schedules
from anon, authenticated;

revoke all
on public.admin_backup_jobs
from anon, authenticated;

grant select
on public.admin_backup_schedules
to authenticated;

grant select
on public.admin_backup_jobs
to authenticated;

-- ============================================================
-- Stage 2: administrator-controlled backup requests
-- ============================================================

create or replace function public.admin_request_backup()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_job_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication is required';
  end if;

  if public.current_workspace_role() <> 'admin' then
    raise exception 'Administrator access is required';
  end if;

  insert into public.admin_backup_jobs (
    trigger_source,
    status,
    requested_by,
    coverage
  )
  values (
    'manual',
    'queued',
    v_actor,
    '{
      "database": true,
      "auth": true,
      "storage": true,
      "repository": true,
      "configuration_manifest": true
    }'::jsonb
  )
  returning id into v_job_id;

  perform public.record_admin_audit(
    'backup.request',
    'admin_backup_job',
    v_job_id::text,
    null,
    jsonb_build_object(
      'trigger_source', 'manual',
      'coverage', 'full'
    ),
    'backup-control-plane'
  );

  return v_job_id;
end;
$$;

revoke all
on function public.admin_request_backup()
from public, anon;

grant execute
on function public.admin_request_backup()
to authenticated;


create or replace function public.admin_update_backup_schedule(
  p_enabled boolean,
  p_frequency text,
  p_run_time time without time zone,
  p_day_of_week integer default null,
  p_day_of_month integer default null,
  p_timezone text default 'Africa/Lagos',
  p_retention_days integer default 30
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication is required';
  end if;

  if public.current_workspace_role() <> 'admin' then
    raise exception 'Administrator access is required';
  end if;

  if p_frequency is null
     or p_frequency not in (
       'daily',
       'weekly',
       'monthly'
     )
  then
    raise exception 'Invalid backup frequency';
  end if;

  if p_run_time is null then
    raise exception 'Backup time is required';
  end if;

  if p_retention_days is null
     or p_retention_days < 7
     or p_retention_days > 3650
  then
    raise exception
      'Retention must be between 7 and 3650 days';
  end if;

  if p_timezone is null
     or not exists (
       select 1
       from pg_timezone_names
       where name = p_timezone
     )
  then
    raise exception 'Invalid backup timezone';
  end if;

  if p_frequency = 'daily'
     and (
       p_day_of_week is not null
       or p_day_of_month is not null
     )
  then
    raise exception
      'Daily backups must not specify a day';
  end if;

  if p_frequency = 'weekly'
     and (
       p_day_of_week is null
       or p_day_of_week < 0
       or p_day_of_week > 6
       or p_day_of_month is not null
     )
  then
    raise exception
      'Weekly backups require a valid day of week';
  end if;

  if p_frequency = 'monthly'
     and (
       p_day_of_month is null
       or p_day_of_month < 1
       or p_day_of_month > 28
       or p_day_of_week is not null
     )
  then
    raise exception
      'Monthly backups require a day between 1 and 28';
  end if;

  insert into public.admin_backup_schedules (
    id,
    enabled,
    frequency,
    run_time,
    day_of_week,
    day_of_month,
    timezone,
    retention_days,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  values (
    'primary',
    coalesce(p_enabled, true),
    p_frequency,
    p_run_time,
    p_day_of_week,
    p_day_of_month,
    p_timezone,
    p_retention_days,
    v_actor,
    v_actor,
    now(),
    now()
  )
  on conflict (id)
  do update set
    enabled = excluded.enabled,
    frequency = excluded.frequency,
    run_time = excluded.run_time,
    day_of_week = excluded.day_of_week,
    day_of_month = excluded.day_of_month,
    timezone = excluded.timezone,
    retention_days = excluded.retention_days,
    updated_by = v_actor,
    updated_at = now();

  perform public.record_admin_audit(
    'backup.schedule_update',
    'admin_backup_schedule',
    'primary',
    null,
    jsonb_build_object(
      'enabled', coalesce(p_enabled, true),
      'frequency', p_frequency,
      'run_time', p_run_time,
      'day_of_week', p_day_of_week,
      'day_of_month', p_day_of_month,
      'timezone', p_timezone,
      'retention_days', p_retention_days
    ),
    'backup-control-plane'
  );
end;
$$;

revoke all
on function public.admin_update_backup_schedule(
  boolean,
  text,
  time without time zone,
  integer,
  integer,
  text,
  integer
)
from public, anon;

grant execute
on function public.admin_update_backup_schedule(
  boolean,
  text,
  time without time zone,
  integer,
  integer,
  text,
  integer
)
to authenticated;

-- ============================================================
-- Stage 3A-1: backup runner lease metadata
-- ============================================================

alter table public.admin_backup_jobs
add column attempt_count integer not null default 0
check (attempt_count between 0 and 20);

alter table public.admin_backup_jobs
add column heartbeat_at timestamptz;

alter table public.admin_backup_jobs
add column lease_expires_at timestamptz;

alter table public.admin_backup_jobs
add column retention_until timestamptz;



-- ============================================================
-- Stage 3A-2: scheduled backup enqueue
-- ============================================================

create or replace function public.enqueue_due_admin_backup(
  p_now timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.admin_backup_schedules%rowtype;
  v_local_now timestamp without time zone;
  v_candidate timestamp without time zone;
  v_previous_month date;
  v_days_back integer;
  v_scheduled_for timestamptz;
  v_job_id uuid;
begin
  select *
  into s
  from public.admin_backup_schedules
  where id = 'primary'
    and enabled = true;

  if not found then
    return null;
  end if;

  v_local_now :=
    p_now at time zone s.timezone;

  if s.frequency = 'daily' then

    v_candidate :=
      v_local_now::date + s.run_time;

    if v_candidate > v_local_now then
      v_candidate :=
        v_candidate - interval '1 day';
    end if;

  elsif s.frequency = 'weekly' then

    v_days_back :=
      (
        extract(dow from v_local_now)::integer
        - s.day_of_week
        + 7
      ) % 7;

    v_candidate :=
      (
        v_local_now::date - v_days_back
      ) + s.run_time;

    if v_candidate > v_local_now then
      v_candidate :=
        v_candidate - interval '7 days';
    end if;

  elsif s.frequency = 'monthly' then

    v_candidate :=
      make_date(
        extract(year from v_local_now)::integer,
        extract(month from v_local_now)::integer,
        s.day_of_month
      ) + s.run_time;

    if v_candidate > v_local_now then

      v_previous_month :=
        (
          date_trunc(
            'month',
            v_local_now
          ) - interval '1 month'
        )::date;

      v_candidate :=
        make_date(
          extract(year from v_previous_month)::integer,
          extract(month from v_previous_month)::integer,
          s.day_of_month
        ) + s.run_time;

    end if;

  else
    raise exception 'Unsupported backup frequency';
  end if;

  v_scheduled_for :=
    v_candidate at time zone s.timezone;

  -- A newly created or changed schedule must not manufacture
  -- historical jobs for slots that pre-date the configuration.
  if v_scheduled_for < s.updated_at then
    return null;
  end if;

  insert into public.admin_backup_jobs (
    trigger_source,
    status,
    schedule_id,
    scheduled_for,
    coverage,
    requested_at
  )
  values (
    'schedule',
    'queued',
    s.id,
    v_scheduled_for,
    '{
      "database": true,
      "auth": true,
      "storage": true,
      "repository": true,
      "configuration_manifest": true
    }'::jsonb,
    p_now
  )
  on conflict do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select id
    into v_job_id
    from public.admin_backup_jobs
    where schedule_id = s.id
      and scheduled_for = v_scheduled_for
    limit 1;
  end if;

  return v_job_id;
end;
$$;

revoke all
on function public.enqueue_due_admin_backup(
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.enqueue_due_admin_backup(
  timestamptz
)
to service_role;

-- ============================================================
-- Stage 3A-3: atomic backup job claiming
-- ============================================================

create or replace function public.claim_admin_backup_job(
  p_runner_id text,
  p_now timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runner_id text;
  v_job_id uuid;
begin
  v_runner_id :=
    nullif(
      btrim(p_runner_id),
      ''
    );

  if v_runner_id is null then
    raise exception 'Runner identifier is required';
  end if;

  -- Ensure any currently-due scheduled slot is queued first.
  perform public.enqueue_due_admin_backup(
    p_now
  );

  with candidate as (
    select id
    from public.admin_backup_jobs
    where status = 'queued'
    order by
      requested_at asc,
      id asc
    for update skip locked
    limit 1
  )
  update public.admin_backup_jobs as job
  set
    status = 'running',
    started_at = p_now,
    heartbeat_at = p_now,
    lease_expires_at =
      p_now + interval '90 minutes',
    runner_id = v_runner_id,
    attempt_count =
      job.attempt_count + 1,
    error_message = null
  from candidate
  where job.id = candidate.id
  returning job.id
  into v_job_id;

  return v_job_id;
end;
$$;

revoke all
on function public.claim_admin_backup_job(
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.claim_admin_backup_job(
  text,
  timestamptz
)
to service_role;

-- ============================================================
-- Stage 3B-1: runner heartbeat and expired lease recovery
-- ============================================================

create or replace function public.heartbeat_admin_backup_job(
  p_job_id uuid,
  p_runner_id text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runner_id text;
  v_updated integer;
begin
  v_runner_id :=
    nullif(
      btrim(p_runner_id),
      ''
    );

  if p_job_id is null then
    raise exception 'Backup job identifier is required';
  end if;

  if v_runner_id is null then
    raise exception 'Runner identifier is required';
  end if;

  update public.admin_backup_jobs
  set
    heartbeat_at = p_now,
    lease_expires_at =
      p_now + interval '90 minutes'
  where id = p_job_id
    and status = 'running'
    and runner_id = v_runner_id
    and lease_expires_at > p_now;

  get diagnostics v_updated = row_count;

  return v_updated = 1;
end;
$$;

revoke all
on function public.heartbeat_admin_backup_job(
  uuid,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.heartbeat_admin_backup_job(
  uuid,
  text,
  timestamptz
)
to service_role;


create or replace function public.recover_expired_admin_backup_jobs(
  p_now timestamptz default now(),
  p_max_attempts integer default 3
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job record;
  v_recovered integer := 0;
begin
  if p_max_attempts < 1
     or p_max_attempts > 20
  then
    raise exception
      'Maximum attempts must be between 1 and 20';
  end if;

  for v_job in
    select
      id,
      attempt_count
    from public.admin_backup_jobs
    where status = 'running'
      and lease_expires_at is not null
      and lease_expires_at <= p_now
    order by lease_expires_at asc
    for update skip locked
  loop

    if v_job.attempt_count >= p_max_attempts then

      update public.admin_backup_jobs
      set
        status = 'failed',
        completed_at = p_now,
        heartbeat_at = null,
        lease_expires_at = null,
        runner_id = null,
        error_message =
          'Backup runner lease expired after maximum attempts.'
      where id = v_job.id
        and status = 'running';

      perform public.record_admin_audit(
        'backup.runner_expired_failed',
        'admin_backup_job',
        v_job.id::text,
        null,
        jsonb_build_object(
          'attempt_count',
          v_job.attempt_count,
          'max_attempts',
          p_max_attempts
        ),
        'backup-runner'
      );

    else

      update public.admin_backup_jobs
      set
        status = 'queued',
        started_at = null,
        completed_at = null,
        heartbeat_at = null,
        lease_expires_at = null,
        runner_id = null,
        error_message =
          'Previous backup runner lease expired; job requeued.'
      where id = v_job.id
        and status = 'running';

      perform public.record_admin_audit(
        'backup.runner_expired_requeued',
        'admin_backup_job',
        v_job.id::text,
        null,
        jsonb_build_object(
          'attempt_count',
          v_job.attempt_count,
          'max_attempts',
          p_max_attempts
        ),
        'backup-runner'
      );

    end if;

    v_recovered := v_recovered + 1;

  end loop;

  return v_recovered;
end;
$$;

revoke all
on function public.recover_expired_admin_backup_jobs(
  timestamptz,
  integer
)
from public, anon, authenticated;

grant execute
on function public.recover_expired_admin_backup_jobs(
  timestamptz,
  integer
)
to service_role;


-- Replace the claim function so expired workers are recovered
-- before a new job is claimed.

create or replace function public.claim_admin_backup_job(
  p_runner_id text,
  p_now timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runner_id text;
  v_job_id uuid;
begin
  v_runner_id :=
    nullif(
      btrim(p_runner_id),
      ''
    );

  if v_runner_id is null then
    raise exception 'Runner identifier is required';
  end if;

  perform public.recover_expired_admin_backup_jobs(
    p_now,
    3
  );

  perform public.enqueue_due_admin_backup(
    p_now
  );

  with candidate as (
    select id
    from public.admin_backup_jobs
    where status = 'queued'
    order by
      requested_at asc,
      id asc
    for update skip locked
    limit 1
  )
  update public.admin_backup_jobs as job
  set
    status = 'running',
    started_at = p_now,
    heartbeat_at = p_now,
    lease_expires_at =
      p_now + interval '90 minutes',
    runner_id = v_runner_id,
    attempt_count =
      job.attempt_count + 1,
    error_message = null
  from candidate
  where job.id = candidate.id
  returning job.id
  into v_job_id;

  return v_job_id;
end;
$$;

-- ============================================================
-- Stage 3B-2A: strict successful backup completion
-- ============================================================

alter table public.admin_backup_jobs
add constraint admin_backup_jobs_running_integrity_check
check (
  status <> 'running'
  or (
    started_at is not null
    and heartbeat_at is not null
    and lease_expires_at is not null
    and runner_id is not null
    and btrim(runner_id) <> ''
  )
);

alter table public.admin_backup_jobs
add constraint admin_backup_jobs_success_integrity_check
check (
  status <> 'succeeded'
  or (
    completed_at is not null
    and artifact_path is not null
    and btrim(artifact_path) <> ''
    and artifact_bytes is not null
    and artifact_bytes > 0
    and checksum_sha256 is not null
    and checksum_sha256 ~ '^[0-9a-f]{64}$'
    and retention_until is not null
  )
);


create or replace function public.complete_admin_backup_job(
  p_job_id uuid,
  p_runner_id text,
  p_artifact_path text,
  p_artifact_bytes bigint,
  p_checksum_sha256 text,
  p_manifest jsonb,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runner_id text;
  v_artifact_path text;
  v_checksum text;
  v_retention_days integer;
begin
  if p_job_id is null then
    raise exception 'Backup job identifier is required';
  end if;

  if p_now is null then
    raise exception 'Completion time is required';
  end if;

  v_runner_id :=
    nullif(
      btrim(p_runner_id),
      ''
    );

  if v_runner_id is null then
    raise exception 'Runner identifier is required';
  end if;

  v_artifact_path :=
    nullif(
      btrim(p_artifact_path),
      ''
    );

  if v_artifact_path is null then
    raise exception 'Backup artifact path is required';
  end if;

  if p_artifact_bytes is null
     or p_artifact_bytes <= 0
  then
    raise exception
      'Backup artifact size must be greater than zero';
  end if;

  v_checksum :=
    lower(
      nullif(
        btrim(p_checksum_sha256),
        ''
      )
    );

  if v_checksum is null
     or v_checksum !~ '^[0-9a-f]{64}$'
  then
    raise exception
      'A valid SHA-256 checksum is required';
  end if;

  if p_manifest is null
     or jsonb_typeof(p_manifest) <> 'object'
  then
    raise exception
      'Backup manifest must be a JSON object';
  end if;

  if not (
    p_manifest @>
    '{
      "coverage": {
        "database": true,
        "auth": true,
        "storage": true,
        "repository": true,
        "configuration_manifest": true
      }
    }'::jsonb
  )
  then
    raise exception
      'Backup manifest does not confirm full recovery coverage';
  end if;

  select
    coalesce(
      job_schedule.retention_days,
      primary_schedule.retention_days,
      30
    )
  into v_retention_days
  from public.admin_backup_jobs job
  left join public.admin_backup_schedules job_schedule
    on job_schedule.id = job.schedule_id
  left join public.admin_backup_schedules primary_schedule
    on primary_schedule.id = 'primary'
  where job.id = p_job_id
    and job.status = 'running'
    and job.runner_id = v_runner_id
    and job.lease_expires_at > p_now
  for update of job;

  if not found then
    raise exception
      'Active backup lease was not found for this runner';
  end if;

  update public.admin_backup_jobs
  set
    status = 'succeeded',
    completed_at = p_now,
    artifact_path = v_artifact_path,
    artifact_bytes = p_artifact_bytes,
    checksum_sha256 = v_checksum,
    manifest = p_manifest,
    retention_until =
      p_now
      + make_interval(
          days => v_retention_days
        ),
    heartbeat_at = p_now,
    lease_expires_at = null,
    error_message = null,
    restore_status = 'unverified',
    restore_verified_at = null,
    restore_notes = null
  where id = p_job_id;

  perform public.record_admin_audit(
    'backup.complete',
    'admin_backup_job',
    p_job_id::text,
    null,
    jsonb_build_object(
      'runner_id',
      v_runner_id,
      'artifact_bytes',
      p_artifact_bytes,
      'checksum_sha256',
      v_checksum,
      'retention_days',
      v_retention_days
    ),
    'backup-runner'
  );

  return true;
end;
$$;

revoke all
on function public.complete_admin_backup_job(
  uuid,
  text,
  text,
  bigint,
  text,
  jsonb,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.complete_admin_backup_job(
  uuid,
  text,
  text,
  bigint,
  text,
  jsonb,
  timestamptz
)
to service_role;

-- ============================================================
-- Stage 3B-2B: strict backup failure transition
-- ============================================================

alter table public.admin_backup_jobs
add constraint admin_backup_jobs_failed_integrity_check
check (
  status <> 'failed'
  or (
    completed_at is not null
    and error_message is not null
    and btrim(error_message) <> ''
  )
);


create or replace function public.fail_admin_backup_job(
  p_job_id uuid,
  p_runner_id text,
  p_error_message text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runner_id text;
  v_error_message text;
begin
  if p_job_id is null then
    raise exception
      'Backup job identifier is required';
  end if;

  if p_now is null then
    raise exception
      'Failure time is required';
  end if;

  v_runner_id :=
    nullif(
      btrim(p_runner_id),
      ''
    );

  if v_runner_id is null then
    raise exception
      'Runner identifier is required';
  end if;

  v_error_message :=
    nullif(
      btrim(p_error_message),
      ''
    );

  if v_error_message is null then
    raise exception
      'Backup failure reason is required';
  end if;

  if char_length(v_error_message) > 4000 then
    raise exception
      'Backup failure reason exceeds 4000 characters';
  end if;

  perform 1
  from public.admin_backup_jobs
  where id = p_job_id
    and status = 'running'
    and runner_id = v_runner_id
    and started_at is not null
    and p_now >= started_at
    and lease_expires_at > p_now
  for update;

  if not found then
    raise exception
      'Active backup lease was not found for this runner';
  end if;

  update public.admin_backup_jobs
  set
    status = 'failed',
    completed_at = p_now,
    heartbeat_at = p_now,
    lease_expires_at = null,
    error_message = v_error_message
  where id = p_job_id;

  perform public.record_admin_audit(
    'backup.failed',
    'admin_backup_job',
    p_job_id::text,
    null,
    jsonb_build_object(
      'runner_id',
      v_runner_id,
      'attempt_count',
      (
        select attempt_count
        from public.admin_backup_jobs
        where id = p_job_id
      ),
      'reason',
      v_error_message
    ),
    'backup-runner'
  );

  return true;
end;
$$;

revoke all
on function public.fail_admin_backup_job(
  uuid,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.fail_admin_backup_job(
  uuid,
  text,
  text,
  timestamptz
)
to service_role;

-- ============================================================
-- Stage 3B-3A: restore verification
-- ============================================================

alter table public.admin_backup_jobs
add column restore_verifier_id text;

alter table public.admin_backup_jobs
add column restore_verification jsonb
not null
default '{}'::jsonb;

alter table public.admin_backup_jobs
add constraint admin_backup_jobs_restore_integrity_check
check (
  (
    restore_status = 'unverified'
    and restore_verified_at is null
  )
  or
  (
    restore_status in ('verified', 'failed')
    and restore_verified_at is not null
    and restore_verifier_id is not null
    and btrim(restore_verifier_id) <> ''
  )
);


create or replace function public.verify_admin_backup_restore(
  p_job_id uuid,
  p_verifier_id text,
  p_verified boolean,
  p_verification jsonb,
  p_notes text default null,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verifier_id text;
  v_notes text;
  v_restore_status text;
begin
  if p_job_id is null then
    raise exception
      'Backup job identifier is required';
  end if;

  if p_verified is null then
    raise exception
      'Restore verification result is required';
  end if;

  if p_now is null then
    raise exception
      'Restore verification time is required';
  end if;

  v_verifier_id :=
    nullif(
      btrim(p_verifier_id),
      ''
    );

  if v_verifier_id is null then
    raise exception
      'Restore verifier identifier is required';
  end if;

  v_notes :=
    nullif(
      btrim(p_notes),
      ''
    );

  if v_notes is not null
     and char_length(v_notes) > 4000
  then
    raise exception
      'Restore verification notes exceed 4000 characters';
  end if;

  if p_verification is null
     or jsonb_typeof(p_verification) <> 'object'
  then
    raise exception
      'Restore verification evidence must be a JSON object';
  end if;

  if p_verified then

    if not (
      p_verification @>
      '{
        "checksum_verified": true,
        "decryption_verified": true,
        "database_restore": true,
        "auth_restore": true,
        "storage_restore": true,
        "repository_available": true,
        "configuration_manifest_valid": true
      }'::jsonb
    )
    then
      raise exception
        'Restore verification does not confirm all required recovery checks';
    end if;

    v_restore_status := 'verified';

  else

    v_restore_status := 'failed';

    if v_notes is null then
      raise exception
        'Failed restore verification requires notes';
    end if;

  end if;

  perform 1
  from public.admin_backup_jobs
  where id = p_job_id
    and status = 'succeeded'
    and artifact_path is not null
    and artifact_bytes > 0
    and checksum_sha256 ~ '^[0-9a-f]{64}$'
  for update;

  if not found then
    raise exception
      'Only a successfully completed backup can be restore-verified';
  end if;

  update public.admin_backup_jobs
  set
    restore_status = v_restore_status,
    restore_verified_at = p_now,
    restore_verifier_id = v_verifier_id,
    restore_verification = p_verification,
    restore_notes = v_notes
  where id = p_job_id;

  perform public.record_admin_audit(
    case
      when p_verified
        then 'backup.restore_verified'
      else 'backup.restore_failed'
    end,
    'admin_backup_job',
    p_job_id::text,
    null,
    jsonb_build_object(
      'verifier_id',
      v_verifier_id,
      'restore_status',
      v_restore_status
    ),
    'backup-verifier'
  );

  return true;
end;
$$;

revoke all
on function public.verify_admin_backup_restore(
  uuid,
  text,
  boolean,
  jsonb,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.verify_admin_backup_restore(
  uuid,
  text,
  boolean,
  jsonb,
  text,
  timestamptz
)
to service_role;

-- ============================================================
-- Stage 3B-3B: lifecycle invariant hardening
-- ============================================================

-- A queued job must not already belong to a worker or contain
-- final backup artifact state.
alter table public.admin_backup_jobs
add constraint admin_backup_jobs_queued_integrity_check
check (
  status <> 'queued'
  or (
    started_at is null
    and heartbeat_at is null
    and lease_expires_at is null
    and runner_id is null
    and completed_at is null
    and artifact_path is null
    and artifact_bytes is null
    and checksum_sha256 is null
    and retention_until is null
  )
);


-- Manual jobs never belong to a schedule slot.
-- Scheduled jobs must always retain both schedule provenance
-- fields so the unique-slot guarantee remains meaningful.
alter table public.admin_backup_jobs
add constraint admin_backup_jobs_trigger_schedule_integrity_check
check (
  (
    trigger_source = 'manual'
    and schedule_id is null
    and scheduled_for is null
  )
  or
  (
    trigger_source = 'schedule'
    and schedule_id is not null
    and scheduled_for is not null
  )
);


-- A successful backup cannot simultaneously carry a failure.
alter table public.admin_backup_jobs
add constraint admin_backup_jobs_success_error_integrity_check
check (
  status <> 'succeeded'
  or error_message is null
);


-- Restore state must be canonical and self-consistent.
--
-- unverified:
--   no verifier or previous verification evidence
--
-- verified:
--   backup itself succeeded and every mandatory recovery
--   verification check passed
--
-- failed:
--   backup itself succeeded, verification was attempted,
--   and a failure explanation exists
alter table public.admin_backup_jobs
add constraint admin_backup_jobs_restore_state_integrity_check
check (
  (
    restore_status = 'unverified'
    and restore_verified_at is null
    and restore_verifier_id is null
    and restore_verification = '{}'::jsonb
    and restore_notes is null
  )
  or
  (
    restore_status = 'verified'
    and status = 'succeeded'
    and restore_verified_at is not null
    and restore_verifier_id is not null
    and btrim(restore_verifier_id) <> ''
    and jsonb_typeof(restore_verification) = 'object'
    and restore_verification @>
      '{
        "checksum_verified": true,
        "decryption_verified": true,
        "database_restore": true,
        "auth_restore": true,
        "storage_restore": true,
        "repository_available": true,
        "configuration_manifest_valid": true
      }'::jsonb
  )
  or
  (
    restore_status = 'failed'
    and status = 'succeeded'
    and restore_verified_at is not null
    and restore_verifier_id is not null
    and btrim(restore_verifier_id) <> ''
    and jsonb_typeof(restore_verification) = 'object'
    and restore_notes is not null
    and btrim(restore_notes) <> ''
  )
);


-- ============================================================
-- Stage 3C: restore verifier atomic claim and lease
-- ============================================================
--
-- Restore verification remains a three-state lifecycle:
--
--   unverified
--   verified
--   failed
--
-- A verifier claim is deliberately represented by separate
-- lease fields rather than a fourth restore_status value.
--
-- This preserves the existing canonical restore-state contract
-- while preventing multiple verifier workers from processing
-- or overwriting the same completed backup concurrently.
-- ============================================================

alter table public.admin_backup_jobs
add column restore_claimed_by text;

alter table public.admin_backup_jobs
add column restore_claimed_at timestamptz;

alter table public.admin_backup_jobs
add column restore_heartbeat_at timestamptz;

alter table public.admin_backup_jobs
add column restore_lease_expires_at timestamptz;

alter table public.admin_backup_jobs
add column restore_attempt_count integer
not null
default 0;

alter table public.admin_backup_jobs
add constraint admin_backup_jobs_restore_attempt_count_check
check (
  restore_attempt_count >= 0
);


alter table public.admin_backup_jobs
add constraint admin_backup_jobs_restore_claim_integrity_check
check (
  (
    restore_claimed_by is null
    and restore_claimed_at is null
    and restore_heartbeat_at is null
    and restore_lease_expires_at is null
  )
  or
  (
    status = 'succeeded'
    and restore_status = 'unverified'
    and restore_claimed_by is not null
    and btrim(restore_claimed_by) <> ''
    and restore_claimed_at is not null
    and restore_heartbeat_at is not null
    and restore_lease_expires_at is not null
    and restore_heartbeat_at >= restore_claimed_at
    and restore_lease_expires_at > restore_heartbeat_at
    and restore_verified_at is null
    and restore_verifier_id is null
    and restore_verification = '{}'::jsonb
    and restore_notes is null
  )
);


create or replace function public.claim_admin_backup_restore(
  p_verifier_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verifier_id text;
  v_claim jsonb;
begin
  if p_now is null then
    raise exception
      'Restore verifier claim time is required';
  end if;

  v_verifier_id :=
    nullif(
      btrim(p_verifier_id),
      ''
    );

  if v_verifier_id is null then
    raise exception
      'Restore verifier identifier is required';
  end if;

  if char_length(v_verifier_id) > 128 then
    raise exception
      'Restore verifier identifier exceeds 128 characters';
  end if;

  -- Expired verification leases return to the unclaimed pool.
  --
  -- No terminal restore result is fabricated here. A verifier
  -- that dies or loses its lease simply allows a later verifier
  -- to retry the independent recovery proof.
  update public.admin_backup_jobs
  set
    restore_claimed_by = null,
    restore_claimed_at = null,
    restore_heartbeat_at = null,
    restore_lease_expires_at = null
  where status = 'succeeded'
    and restore_status = 'unverified'
    and restore_claimed_by is not null
    and restore_lease_expires_at is not null
    and restore_lease_expires_at <= p_now;

  with candidate as (
    select id
    from public.admin_backup_jobs
    where status = 'succeeded'
      and restore_status = 'unverified'
      and restore_claimed_by is null
      and restore_claimed_at is null
      and restore_heartbeat_at is null
      and restore_lease_expires_at is null
      and artifact_path is not null
      and btrim(artifact_path) <> ''
      and artifact_bytes is not null
      and artifact_bytes > 0
      and checksum_sha256 is not null
      and checksum_sha256 ~ '^[0-9a-f]{64}$'
      and retention_until is not null
      and retention_until > p_now
    order by
      completed_at asc,
      id asc
    for update skip locked
    limit 1
  )
  update public.admin_backup_jobs as job
  set
    restore_claimed_by = v_verifier_id,
    restore_claimed_at = p_now,
    restore_heartbeat_at = p_now,
    restore_lease_expires_at =
      p_now + interval '90 minutes',
    restore_attempt_count =
      job.restore_attempt_count + 1
  from candidate
  where job.id = candidate.id
  returning
    jsonb_build_object(
      'job_id',
      job.id,
      'artifact_path',
      job.artifact_path,
      'artifact_bytes',
      job.artifact_bytes,
      'checksum_sha256',
      job.checksum_sha256,
      'retention_until',
      job.retention_until,
      'restore_attempt_count',
      job.restore_attempt_count
    )
  into v_claim;

  if v_claim is not null then
    perform public.record_admin_audit(
      'backup.restore_claimed',
      'admin_backup_job',
      v_claim ->> 'job_id',
      null,
      jsonb_build_object(
        'verifier_id',
        v_verifier_id,
        'restore_attempt_count',
        v_claim -> 'restore_attempt_count'
      ),
      'backup-verifier'
    );
  end if;

  return v_claim;
end;
$$;

revoke all
on function public.claim_admin_backup_restore(
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.claim_admin_backup_restore(
  text,
  timestamptz
)
to service_role;


create or replace function public.heartbeat_admin_backup_restore(
  p_job_id uuid,
  p_verifier_id text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verifier_id text;
  v_updated integer;
begin
  if p_job_id is null then
    raise exception
      'Backup job identifier is required';
  end if;

  if p_now is null then
    raise exception
      'Restore heartbeat time is required';
  end if;

  v_verifier_id :=
    nullif(
      btrim(p_verifier_id),
      ''
    );

  if v_verifier_id is null then
    raise exception
      'Restore verifier identifier is required';
  end if;

  update public.admin_backup_jobs
  set
    restore_heartbeat_at = p_now,
    restore_lease_expires_at =
      p_now + interval '90 minutes'
  where id = p_job_id
    and status = 'succeeded'
    and restore_status = 'unverified'
    and restore_claimed_by = v_verifier_id
    and restore_lease_expires_at > p_now;

  get diagnostics v_updated = row_count;

  return v_updated = 1;
end;
$$;

revoke all
on function public.heartbeat_admin_backup_restore(
  uuid,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.heartbeat_admin_backup_restore(
  uuid,
  text,
  timestamptz
)
to service_role;


create or replace function public.release_admin_backup_restore(
  p_job_id uuid,
  p_verifier_id text,
  p_reason text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verifier_id text;
  v_reason text;
  v_updated integer;
begin
  if p_job_id is null then
    raise exception
      'Backup job identifier is required';
  end if;

  if p_now is null then
    raise exception
      'Restore release time is required';
  end if;

  v_verifier_id :=
    nullif(
      btrim(p_verifier_id),
      ''
    );

  if v_verifier_id is null then
    raise exception
      'Restore verifier identifier is required';
  end if;

  v_reason :=
    nullif(
      btrim(p_reason),
      ''
    );

  if v_reason is null then
    raise exception
      'Restore release reason is required';
  end if;

  if char_length(v_reason) > 1000 then
    raise exception
      'Restore release reason exceeds 1000 characters';
  end if;

  update public.admin_backup_jobs
  set
    restore_claimed_by = null,
    restore_claimed_at = null,
    restore_heartbeat_at = null,
    restore_lease_expires_at = null
  where id = p_job_id
    and status = 'succeeded'
    and restore_status = 'unverified'
    and restore_claimed_by = v_verifier_id;

  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    perform public.record_admin_audit(
      'backup.restore_released',
      'admin_backup_job',
      p_job_id::text,
      null,
      jsonb_build_object(
        'verifier_id',
        v_verifier_id,
        'reason',
        v_reason
      ),
      'backup-verifier'
    );
  end if;

  return v_updated = 1;
end;
$$;

revoke all
on function public.release_admin_backup_restore(
  uuid,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.release_admin_backup_restore(
  uuid,
  text,
  text,
  timestamptz
)
to service_role;


-- Replace the original finalisation RPC.
--
-- A terminal restore result now requires ownership of a live
-- verifier lease. This prevents a second verifier from
-- overwriting an already verified or failed restore result.
create or replace function public.verify_admin_backup_restore(
  p_job_id uuid,
  p_verifier_id text,
  p_verified boolean,
  p_verification jsonb,
  p_notes text default null,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verifier_id text;
  v_notes text;
  v_restore_status text;
begin
  if p_job_id is null then
    raise exception
      'Backup job identifier is required';
  end if;

  if p_verified is null then
    raise exception
      'Restore verification result is required';
  end if;

  if p_now is null then
    raise exception
      'Restore verification time is required';
  end if;

  v_verifier_id :=
    nullif(
      btrim(p_verifier_id),
      ''
    );

  if v_verifier_id is null then
    raise exception
      'Restore verifier identifier is required';
  end if;

  v_notes :=
    nullif(
      btrim(p_notes),
      ''
    );

  if v_notes is not null
     and char_length(v_notes) > 4000
  then
    raise exception
      'Restore verification notes exceed 4000 characters';
  end if;

  if p_verification is null
     or jsonb_typeof(p_verification) <> 'object'
  then
    raise exception
      'Restore verification evidence must be a JSON object';
  end if;

  if p_verified then

    if not (
      p_verification @>
      '{
        "checksum_verified": true,
        "decryption_verified": true,
        "database_restore": true,
        "auth_restore": true,
        "storage_restore": true,
        "repository_available": true,
        "configuration_manifest_valid": true
      }'::jsonb
    )
    then
      raise exception
        'Restore verification does not confirm all required recovery checks';
    end if;

    v_restore_status := 'verified';

  else

    v_restore_status := 'failed';

    if v_notes is null then
      raise exception
        'Failed restore verification requires notes';
    end if;

  end if;

  perform 1
  from public.admin_backup_jobs
  where id = p_job_id
    and status = 'succeeded'
    and restore_status = 'unverified'
    and restore_claimed_by = v_verifier_id
    and restore_claimed_at is not null
    and restore_heartbeat_at is not null
    and restore_lease_expires_at > p_now
    and artifact_path is not null
    and artifact_bytes > 0
    and checksum_sha256 ~ '^[0-9a-f]{64}$'
  for update;

  if not found then
    raise exception
      'Active restore-verifier lease was not found for this backup';
  end if;

  update public.admin_backup_jobs
  set
    restore_status = v_restore_status,
    restore_verified_at = p_now,
    restore_verifier_id = v_verifier_id,
    restore_verification = p_verification,
    restore_notes = v_notes,
    restore_claimed_by = null,
    restore_claimed_at = null,
    restore_heartbeat_at = null,
    restore_lease_expires_at = null
  where id = p_job_id;

  perform public.record_admin_audit(
    case
      when p_verified
        then 'backup.restore_verified'
      else 'backup.restore_failed'
    end,
    'admin_backup_job',
    p_job_id::text,
    null,
    jsonb_build_object(
      'verifier_id',
      v_verifier_id,
      'restore_status',
      v_restore_status
    ),
    'backup-verifier'
  );

  return true;
end;
$$;

revoke all
on function public.verify_admin_backup_restore(
  uuid,
  text,
  boolean,
  jsonb,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.verify_admin_backup_restore(
  uuid,
  text,
  boolean,
  jsonb,
  text,
  timestamptz
)
to service_role;


-- ============================================================
-- Stage 3D: writer retry and idempotent completion hardening
-- ============================================================

-- Return both the claimed job identifier and the incremented
-- attempt number so every execution attempt can own a distinct,
-- immutable off-site artifact key.

create or replace function public.claim_admin_backup_job_detail(
  p_runner_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runner_id text;
  v_claim jsonb;
begin
  if p_now is null then
    raise exception 'Claim time is required';
  end if;

  v_runner_id :=
    nullif(
      btrim(p_runner_id),
      ''
    );

  if v_runner_id is null then
    raise exception 'Runner identifier is required';
  end if;

  perform public.recover_expired_admin_backup_jobs(
    p_now,
    3
  );

  perform public.enqueue_due_admin_backup(
    p_now
  );

  with candidate as (
    select id
    from public.admin_backup_jobs
    where status = 'queued'
    order by
      requested_at asc,
      id asc
    for update skip locked
    limit 1
  )
  update public.admin_backup_jobs as job
  set
    status = 'running',
    started_at = p_now,
    heartbeat_at = p_now,
    lease_expires_at =
      p_now + interval '90 minutes',
    runner_id = v_runner_id,
    attempt_count =
      job.attempt_count + 1,
    error_message = null
  from candidate
  where job.id = candidate.id
  returning
    jsonb_build_object(
      'job_id',
      job.id::text,
      'attempt_count',
      job.attempt_count
    )
  into v_claim;

  return v_claim;
end;
$$;

revoke all
on function public.claim_admin_backup_job_detail(
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.claim_admin_backup_job_detail(
  text,
  timestamptz
)
to service_role;


-- Replace successful completion with an idempotent contract.
--
-- A retry of the exact completion request for an already-succeeded
-- job returns true without changing the original completion record.
-- Any conflicting completion metadata is rejected.

create or replace function public.complete_admin_backup_job(
  p_job_id uuid,
  p_runner_id text,
  p_artifact_path text,
  p_artifact_bytes bigint,
  p_checksum_sha256 text,
  p_manifest jsonb,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runner_id text;
  v_artifact_path text;
  v_checksum text;
  v_retention_days integer;
  v_job public.admin_backup_jobs%rowtype;
begin
  if p_job_id is null then
    raise exception 'Backup job identifier is required';
  end if;

  if p_now is null then
    raise exception 'Completion time is required';
  end if;

  v_runner_id :=
    nullif(
      btrim(p_runner_id),
      ''
    );

  if v_runner_id is null then
    raise exception 'Runner identifier is required';
  end if;

  v_artifact_path :=
    nullif(
      btrim(p_artifact_path),
      ''
    );

  if v_artifact_path is null then
    raise exception 'Backup artifact path is required';
  end if;

  if p_artifact_bytes is null
     or p_artifact_bytes <= 0
  then
    raise exception
      'Backup artifact size must be greater than zero';
  end if;

  v_checksum :=
    lower(
      nullif(
        btrim(p_checksum_sha256),
        ''
      )
    );

  if v_checksum is null
     or v_checksum !~ '^[0-9a-f]{64}$'
  then
    raise exception
      'A valid SHA-256 checksum is required';
  end if;

  if p_manifest is null
     or jsonb_typeof(p_manifest) <> 'object'
  then
    raise exception
      'Backup manifest must be a JSON object';
  end if;

  if not (
    p_manifest @>
    '{
      "coverage": {
        "database": true,
        "auth": true,
        "storage": true,
        "repository": true,
        "configuration_manifest": true
      }
    }'::jsonb
  )
  then
    raise exception
      'Backup manifest does not confirm full recovery coverage';
  end if;

  select *
  into v_job
  from public.admin_backup_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Backup job was not found';
  end if;

  -- Exact retry after an ambiguous HTTP response.
  --
  -- The first request may already have committed even if the runner
  -- did not receive the response. Treat only the exact same successful
  -- result from the same runner as idempotent success.
  if v_job.status = 'succeeded' then

    if v_job.runner_id = v_runner_id
       and v_job.artifact_path = v_artifact_path
       and v_job.artifact_bytes = p_artifact_bytes
       and v_job.checksum_sha256 = v_checksum
       and v_job.manifest = p_manifest
    then
      return true;
    end if;

    raise exception
      'Backup job already succeeded with different completion metadata';
  end if;

  if v_job.status <> 'running'
     or v_job.runner_id is distinct from v_runner_id
     or v_job.started_at is null
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at <= p_now
  then
    raise exception
      'Active backup lease was not found for this runner';
  end if;

  select
    coalesce(
      job_schedule.retention_days,
      primary_schedule.retention_days,
      30
    )
  into v_retention_days
  from public.admin_backup_jobs job
  left join public.admin_backup_schedules job_schedule
    on job_schedule.id = job.schedule_id
  left join public.admin_backup_schedules primary_schedule
    on primary_schedule.id = 'primary'
  where job.id = p_job_id;

  update public.admin_backup_jobs
  set
    status = 'succeeded',
    completed_at = p_now,
    artifact_path = v_artifact_path,
    artifact_bytes = p_artifact_bytes,
    checksum_sha256 = v_checksum,
    manifest = p_manifest,
    retention_until =
      p_now
      + make_interval(
          days => v_retention_days
        ),
    heartbeat_at = p_now,
    lease_expires_at = null,
    error_message = null,
    restore_status = 'unverified',
    restore_verified_at = null,
    restore_notes = null
  where id = p_job_id;

  perform public.record_admin_audit(
    'backup.complete',
    'admin_backup_job',
    p_job_id::text,
    null,
    jsonb_build_object(
      'runner_id',
      v_runner_id,
      'attempt_count',
      v_job.attempt_count,
      'artifact_path',
      v_artifact_path,
      'artifact_bytes',
      p_artifact_bytes,
      'checksum_sha256',
      v_checksum,
      'retention_days',
      v_retention_days
    ),
    'backup-runner'
  );

  return true;
end;
$$;

revoke all
on function public.complete_admin_backup_job(
  uuid,
  text,
  text,
  bigint,
  text,
  jsonb,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.complete_admin_backup_job(
  uuid,
  text,
  text,
  bigint,
  text,
  jsonb,
  timestamptz
)
to service_role;
