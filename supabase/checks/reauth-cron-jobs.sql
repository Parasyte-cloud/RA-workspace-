-- Run this once, in the SQL editor, AFTER creating the Vault secret:
--   select vault.create_secret('<CRON_DISPATCH_SECRET value>', 'cron_dispatch_secret');
-- It is the same step the bug-sweep migration runs, which cannot re-run by itself
-- once applied. Jobs that no longer reference service_role_key are left alone.

do $$
declare
  j record;
  v_cmd text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'cron/vault not available, skipping cron re-authentication.';
    return;
  end if;

  for j in
    select jobname, schedule, command
    from cron.job
    where jobname in ('ridearrivo-dispatch-notification-emails', 'ridearrivo-poll-bookings')
      and command like '%service_role_key%'
  loop
    if not exists (select 1 from vault.decrypted_secrets where name = 'cron_dispatch_secret') then
      raise notice 'Job % still uses the old key. Create the Vault secret cron_dispatch_secret, then run this migration step again.', j.jobname;
      continue;
    end if;

    v_cmd := format($cmd$
      select net.http_post(
        url := (select value from public.system_config where key = 'functions_base_url') || '/%s',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_dispatch_secret' limit 1)
        ),
        body := '{}'::jsonb
      );
    $cmd$, case j.jobname when 'ridearrivo-poll-bookings' then 'ridearrivo-bookings-poll' else 'notifications-email-dispatch' end);

    perform cron.unschedule(j.jobname);
    perform cron.schedule(j.jobname, j.schedule, v_cmd);
  end loop;
exception when others then
  raise notice 'Cron re-authentication skipped: %', sqlerrm;
end $$;
