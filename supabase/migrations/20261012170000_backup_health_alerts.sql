-- Backup health alerts.
--
-- The backup runner is a GitHub Actions job. If it is switched off, loses a
-- secret or cannot reach the database, the Control Centre only shows jobs
-- sitting in "queued" and nobody is told. This check runs inside the database
-- (pg_cron), so it keeps working when the runner does not, and it tells every
-- active admin in the bell and, through the existing dispatcher, by email.
--
-- Safe to run more than once.

begin;

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
  v_reasons text[] := '{}';
  v_body text;
  v_sent integer := 0;
begin
  select * into s from public.admin_backup_schedules where id = 'primary';
  v_has_schedule := found;

  -- Requests nobody has even tried to run.
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

  -- A failure only counts while it is recent and nothing good has come since.
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

  -- Healthy again: clear the alert from every bell.
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
    where jobname = 'ridearrivo-backup-health';

    -- Every hour at :41. The 24 hour de-duplication above keeps this to
    -- one message a day per admin until the problem is fixed.
    perform cron.schedule(
      'ridearrivo-backup-health',
      '41 * * * *',
      'select public.check_admin_backup_health();'
    );
  else
    raise notice 'pg_cron is not enabled: run select public.check_admin_backup_health() hourly instead.';
  end if;
end;
$$;

commit;
