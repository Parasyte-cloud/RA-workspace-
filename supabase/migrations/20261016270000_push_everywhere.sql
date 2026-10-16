-- Alerts that reach every device, for chat, calls, email and Room 7.
--
-- What this adds:
--   1. notification_preferences: what a person wants pushed (chat, calls,
--      email, Room 7, everything else), whether previews show, and quiet hours.
--   2. push_delivery_log: one row per attempt, so a failed alert can be traced.
--   3. send_test_push(): the "Send a test alert" button in Settings.
--   4. Room 7: a host is told when a guest is waiting to be let in.
--   5. mail_watch_state: remembers how far each person's inbox was checked, so
--      the mail-notify-poll edge function only alerts on new mail.
--   6. A two-minute schedule for mail-notify-poll (needs pg_cron and the Vault
--      secret named below; skipped quietly if either is missing).
--
-- Nothing here can stop the thing that caused an alert: every trigger swallows
-- its own errors. Safe to run more than once.

begin;

-- 1. Preferences ------------------------------------------------
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.employee_profiles(id) on delete cascade,
  push_chat boolean not null default true,
  push_calls boolean not null default true,
  push_mail boolean not null default true,
  push_room boolean not null default true,
  push_other boolean not null default true,
  show_previews boolean not null default true,
  quiet_enabled boolean not null default false,
  quiet_start time not null default '22:00',
  quiet_end time not null default '07:00',
  quiet_allow_calls boolean not null default true,
  timezone text not null default 'Africa/Lagos' check (char_length(timezone) between 1 and 64),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon;
grant select, insert, update on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

drop policy if exists notification_preferences_own_select on public.notification_preferences;
create policy notification_preferences_own_select on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notification_preferences_own_insert on public.notification_preferences;
create policy notification_preferences_own_insert on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists notification_preferences_own_update on public.notification_preferences;
create policy notification_preferences_own_update on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. Delivery log -----------------------------------------------
create table if not exists public.push_delivery_log (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  subscription_id uuid,
  outcome text not null check (outcome in ('sent','failed','gone','skipped_preference','skipped_quiet_hours')),
  http_status integer,
  created_at timestamptz not null default now()
);

create index if not exists push_delivery_log_user_idx
  on public.push_delivery_log(user_id, created_at desc);

alter table public.push_delivery_log enable row level security;
revoke all on public.push_delivery_log from public, anon;
grant select on public.push_delivery_log to authenticated;
grant all on public.push_delivery_log to service_role;

drop policy if exists push_delivery_log_own_select on public.push_delivery_log;
create policy push_delivery_log_own_select on public.push_delivery_log
  for select to authenticated using (user_id = auth.uid());

-- 3. Test alert -------------------------------------------------
create or replace function public.send_test_push()
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if exists (
    select 1 from public.notifications
    where user_id = me and type = 'push_test' and created_at > now() - interval '10 seconds'
  ) then
    raise exception 'Please wait a few seconds between tests';
  end if;

  -- email_status 'skipped': these are phone and bell alerts only, never emailed.
  insert into public.notifications(user_id, type, title, body, email_status)
  values (me, 'push_test', 'Test alert', 'If you can read this, alerts reach this device.', 'skipped');
end;
$$;

revoke all on function public.send_test_push() from public, anon;
grant execute on function public.send_test_push() to authenticated;

-- 4. Room 7: a guest is waiting ----------------------------------
create or replace function public.notify_room7_join_request()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_host uuid;
  v_title text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select created_by, title into v_host, v_title
  from public.workspace_rooms
  where id = new.room_id and status = 'active';

  if v_host is null then
    return new;
  end if;

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  values (
    v_host,
    'room_join_request',
    left(new.display_name, 80) || ' is waiting to join',
    left(coalesce(v_title, 'ROOM 7'), 120),
    'workspace_room',
    new.room_id,
    'skipped'
  );
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.notify_room7_join_request() from public, anon, authenticated;

drop trigger if exists room7_join_request_notify on public.room7_join_requests;
create trigger room7_join_request_notify
  after insert on public.room7_join_requests
  for each row execute function public.notify_room7_join_request();

-- 5. Mail watch state -------------------------------------------
create table if not exists public.mail_watch_state (
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  mailbox_id uuid not null,
  last_seen_ms bigint not null default 0,
  checked_at timestamptz not null default now(),
  primary key (employee_id, mailbox_id)
);

alter table public.mail_watch_state enable row level security;
revoke all on public.mail_watch_state from public, anon, authenticated;
grant all on public.mail_watch_state to service_role;

-- 6. Check mail every two minutes ---------------------------------
-- Needs, once (SQL editor):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/mail-notify-poll', 'mail_notify_url');
-- It reuses the existing push_dispatch_secret as its password.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ridearrivo-mail-notify-poll';
    perform cron.schedule(
      'ridearrivo-mail-notify-poll',
      '*/2 * * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'mail_notify_url' limit 1),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1)
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 20000
        )
        where exists (select 1 from vault.decrypted_secrets where name = 'mail_notify_url');
      $job$
    );
  end if;
exception when others then
  raise notice 'Mail poll schedule skipped: %', sqlerrm;
end;
$$;

commit;
