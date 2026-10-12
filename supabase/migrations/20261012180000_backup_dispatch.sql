-- Database-driven backup trigger.
--
-- GitHub's own cron is best effort. It drops and delays scheduled runs, so a
-- "daily at 02:00" backup could simply not start, and Backup Now could wait
-- for hours. The database already knows when work is due, so it starts the
-- GitHub Actions workflow itself, once per need, instead of GitHub polling
-- every few minutes for nothing.
--
-- Every minute (pg_cron) this function:
--   1. queues the scheduled slot if one is due,
--   2. does nothing if a runner is already working or nothing is waiting,
--   3. otherwise calls the GitHub "workflow_dispatch" API through pg_net.
--
-- It needs two things set up once, by an admin, in the SQL editor:
--   extensions pg_net and pg_cron enabled, and the access token stored in
--   Vault under the name 'admin_backup_github_token'. See
--   scripts/admin-backup/README.md. The token never appears in this file,
--   in the log table or in any notification.
--
-- Safe to run more than once.

begin;

create table if not exists public.admin_backup_dispatches (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  request_id bigint,
  reason text not null
);

create index if not exists admin_backup_dispatches_requested_at_idx
  on public.admin_backup_dispatches (requested_at desc);

alter table public.admin_backup_dispatches enable row level security;
revoke all on table public.admin_backup_dispatches from public, anon, authenticated;

create or replace function public.dispatch_admin_backup_runner(
  p_repo text default 'Parasyte-cloud/RA-workspace-',
  p_workflow text default 'admin-backup-writer.yml',
  p_ref text default 'main'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_request bigint;
  v_last timestamptz;
  v_recent integer;
  v_gap interval;
begin
  -- A due scheduled slot becomes a queued job. Idempotent per slot.
  begin
    perform public.enqueue_due_admin_backup();
  exception when others then
    raise notice 'enqueue_due_admin_backup failed: %', sqlerrm;
  end;

  -- A runner that is alive already has the work.
  if exists (
    select 1 from public.admin_backup_jobs
    where status = 'running' and lease_expires_at > now()
  ) then
    return 'busy';
  end if;

  -- Nothing waiting, and no runner that died holding a lease.
  if not exists (
    select 1 from public.admin_backup_jobs
    where status = 'queued'
       or (status = 'running' and lease_expires_at <= now())
  ) then
    return 'idle';
  end if;

  -- Do not start a run every minute. If runs keep starting and the job is
  -- still not picked up, something is wrong that more runs will not fix, so
  -- back off to one an hour and let the health alert tell the admins.
  select max(requested_at) into v_last from public.admin_backup_dispatches
  where reason = 'dispatched';

  select count(*) into v_recent from public.admin_backup_dispatches
  where reason = 'dispatched' and requested_at > now() - interval '1 hour';

  v_gap := case when v_recent >= 3 then interval '1 hour' else interval '10 minutes' end;

  if v_last is not null and v_last > now() - v_gap then
    return 'waiting';
  end if;

  begin
    select decrypted_secret into v_token
    from vault.decrypted_secrets
    where name = 'admin_backup_github_token'
    limit 1;

    if v_token is null or v_token = '' then
      raise notice 'admin_backup_github_token is not stored in Vault';
      return 'no-token';
    end if;

    select net.http_post(
      url := 'https://api.github.com/repos/' || p_repo || '/actions/workflows/' || p_workflow || '/dispatches',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_token,
        'Accept', 'application/vnd.github+json',
        'X-GitHub-Api-Version', '2022-11-28',
        'User-Agent', 'ridearrivo-backup-dispatch',
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('ref', p_ref),
      timeout_milliseconds := 10000
    ) into v_request;
  exception when others then
    raise notice 'backup dispatch failed: %', sqlerrm;
    return 'error';
  end;

  insert into public.admin_backup_dispatches(request_id, reason)
  values (v_request, 'dispatched');

  return 'dispatched';
end;
$$;

revoke all on function public.dispatch_admin_backup_runner(text, text, text)
  from public, anon, authenticated;

-- Health check, extended: if GitHub refused the last dispatch (expired or
-- revoked token, wrong repository), say so. Otherwise as before.
create or replace function public.check_admin_backup_health()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.admin_backup_schedules%rowtype;
  v_has_schedule boolean;
  v_stuck integer;
  v_stuck_since timestamptz;
  v_last_good timestamptz;
  v_last_failed_at timestamptz;
  v_limit interval;
  v_http integer;
  v_reasons text[] := '{}';
  v_body text;
  v_sent integer := 0;
begin
  select * into s from public.admin_backup_schedules where id = 'primary';
  v_has_schedule := found;

  select count(*), min(requested_at)
    into v_stuck, v_stuck_since
  from public.admin_backup_jobs
  where status = 'queued'
    and attempt_count = 0
    and requested_at < now() - interval '3 hours';

  select max(coalesce(completed_at, requested_at))
    into v_last_good
  from public.admin_backup_jobs
  where status = 'succeeded';

  select max(coalesce(completed_at, requested_at))
    into v_last_failed_at
  from public.admin_backup_jobs
  where status = 'failed'
    and coalesce(completed_at, requested_at) > now() - interval '3 days';

  if v_stuck > 0 then
    v_reasons := array_append(v_reasons, format(
      '%s backup request(s) have waited since %s with no attempt. The backup runner is not running.',
      v_stuck,
      to_char(v_stuck_since at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI')
    ));
  end if;

  -- Did GitHub accept the last request to start the runner? pg_net keeps
  -- responses for a few hours, so an old one may no longer be there.
  begin
    select r.status_code into v_http
    from public.admin_backup_dispatches d
    join net._http_response r on r.id = d.request_id
    where d.reason = 'dispatched'
    order by d.id desc
    limit 1;

    if found and (v_http is null or v_http < 200 or v_http > 299) then
      v_reasons := array_append(v_reasons, format(
        'GitHub refused the request to start the backup runner (HTTP %s). The access token may have expired or been revoked.',
        coalesce(v_http::text, 'no response')
      ));
    end if;
  exception when others then
    null;
  end;

  if v_has_schedule and s.enabled then
    v_limit := case s.frequency
      when 'weekly'  then interval '8 days 12 hours'
      when 'monthly' then interval '32 days'
      else interval '36 hours'
    end;

    if v_last_good is null then
      v_reasons := array_append(v_reasons, 'Backups are scheduled but none has ever completed.'::text);
    elsif v_last_good < now() - v_limit then
      v_reasons := array_append(v_reasons, format(
        'The last successful backup was on %s.',
        to_char(v_last_good at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI')
      ));
    end if;
  end if;

  if v_last_failed_at is not null
     and (v_last_good is null or v_last_failed_at > v_last_good) then
    v_reasons := array_append(v_reasons, 'The most recent backup failed.'::text);
  end if;

  if coalesce(array_length(v_reasons, 1), 0) = 0 then
    update public.notifications
    set read_at = now()
    where type = 'backup_alert'
      and read_at is null;
    return 0;
  end if;

  v_body := left(array_to_string(v_reasons, ' '), 900);

  insert into public.notifications(
    user_id, type, title, body, entity_type, email_status
  )
  select p.id,
         'backup_alert',
         'Backups need attention',
         v_body,
         'backup_health',
         'pending'
  from public.employee_profiles p
  where p.active = true
    and lower(p.role) = 'admin'
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = p.id
        and n.type = 'backup_alert'
        and n.created_at > now() - interval '24 hours'
    );

  get diagnostics v_sent = row_count;
  return v_sent;
end;
$$;

revoke all on function public.check_admin_backup_health() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'ridearrivo-backup-dispatch';

    perform cron.schedule(
      'ridearrivo-backup-dispatch',
      '* * * * *',
      'select public.dispatch_admin_backup_runner();'
    );
  else
    raise notice 'pg_cron is not enabled: run select public.dispatch_admin_backup_runner() every minute instead.';
  end if;
end;
$$;

commit;
