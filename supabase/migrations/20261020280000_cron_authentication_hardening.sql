-- Phase 2B: harden production cron authentication diagnostics and repair.
--
-- Governed jobs must authenticate with the Vault-backed cron_dispatch_secret.
-- This migration never creates, rotates, prints, or embeds secret values.

begin;

create or replace function public.cron_authentication_status()
returns table (jobname text, state text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_jobname text;
  v_command text;
  has_cron boolean := false;
  has_vault boolean := false;
  has_secret boolean := false;
begin
  has_cron := exists (select 1 from pg_namespace where nspname = 'cron');
  has_vault := exists (select 1 from pg_namespace where nspname = 'vault');

  if has_vault then
    begin
      execute 'select exists (select 1 from vault.decrypted_secrets where name = ''cron_dispatch_secret'')'
        into has_secret;
    exception when others then
      has_secret := false;
    end;
  end if;

  for v_jobname in
    select expected.jobname
    from (values
      ('ridearrivo-dispatch-notification-emails'::text),
      ('ridearrivo-poll-bookings'::text)
    ) as expected(jobname)
    order by expected.jobname
  loop
    jobname := v_jobname;
    v_command := null;

    if not has_cron then
      state := 'misconfigured';
      return next;
      continue;
    end if;

    begin
      execute 'select command::text from cron.job where jobname = $1 limit 1'
        into v_command
        using v_jobname;
    exception when others then
      v_command := null;
    end;

    if v_command is null then
      state := 'misconfigured';
    elsif position('service_role_key' in v_command) > 0 then
      state := 'legacy_service_role';
    elsif position('cron_dispatch_secret' in v_command) > 0
      and position('vault.decrypted_secrets' in v_command) > 0
      and position('Authorization' in v_command) > 0 then
      if not has_secret then
        state := 'missing_secret';
      else
        state := 'ok';
      end if;
    else
      state := 'misconfigured';
    end if;

    return next;
  end loop;
end;
$$;

create or replace function public.repair_cron_authentication()
returns table (jobname text, result text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_jobname text;
  v_command text;
  v_schedule text;
  v_endpoint text;
  v_cmd text;
  has_cron boolean := false;
  has_vault boolean := false;
  has_secret boolean := false;
begin
  has_cron := exists (select 1 from pg_namespace where nspname = 'cron');
  has_vault := exists (select 1 from pg_namespace where nspname = 'vault');

  if has_vault then
    begin
      execute 'select exists (select 1 from vault.decrypted_secrets where name = ''cron_dispatch_secret'')'
        into has_secret;
    exception when others then
      has_secret := false;
    end;
  end if;

  for v_jobname in
    select expected.jobname
    from (values
      ('ridearrivo-dispatch-notification-emails'::text),
      ('ridearrivo-poll-bookings'::text)
    ) as expected(jobname)
    order by expected.jobname
  loop
    jobname := v_jobname;
    v_command := null;
    v_schedule := null;

    if not has_cron then
      result := 'misconfigured';
      return next;
      continue;
    end if;

    begin
      execute 'select command::text, schedule::text from cron.job where jobname = $1 limit 1'
        into v_command, v_schedule
        using v_jobname;
    exception when others then
      v_command := null;
      v_schedule := null;
    end;

    if v_command is null or v_schedule is null then
      result := 'misconfigured';
      return next;
      continue;
    end if;

    if position('service_role_key' in v_command) > 0 then
      if not has_secret then
        result := 'missing_secret';
        return next;
        continue;
      end if;

      v_endpoint := case v_jobname
        when 'ridearrivo-poll-bookings' then 'ridearrivo-bookings-poll'
        when 'ridearrivo-dispatch-notification-emails' then 'notifications-email-dispatch'
      end;

      if v_endpoint is null then
        result := 'misconfigured';
        return next;
        continue;
      end if;

      v_cmd := format($cmd$
        select net.http_post(
          url := (select value from public.system_config where key = 'functions_base_url') || '/%s',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'cron_dispatch_secret'
              limit 1
            )
          ),
          body := '{}'::jsonb
        );
      $cmd$, v_endpoint);

      perform cron.unschedule(v_jobname);
      perform cron.schedule(v_jobname, v_schedule, v_cmd);
      result := 'repaired';
    elsif position('cron_dispatch_secret' in v_command) > 0
      and position('vault.decrypted_secrets' in v_command) > 0
      and position('Authorization' in v_command) > 0 then
      if not has_secret then
        result := 'missing_secret';
      else
        result := 'already_ok';
      end if;
    else
      result := 'misconfigured';
    end if;

    return next;
  end loop;
end;
$$;

revoke all on function public.cron_authentication_status() from public, anon, authenticated;
revoke all on function public.repair_cron_authentication() from public, anon, authenticated;
grant execute on function public.cron_authentication_status() to service_role;
grant execute on function public.repair_cron_authentication() to service_role;

commit;
