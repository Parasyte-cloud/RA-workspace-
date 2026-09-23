-- ============================================================
-- RideArrivo Workspace: notify Support by email when a new
-- booking/ride comes in on the public site.
--
-- Site bookings do not flow through Supabase at all -- they are
-- created directly against the separate Render backend
-- (arrivo-backend-g1ku.onrender.com via /api/rides), and Support
-- only ever sees them by live, on-demand read through the
-- ridearrivo-support edge function ("Bookings & Rides" tab).
-- Nothing in Supabase is ever written to when a new booking is
-- made, so there is no table or row to hang a trigger off, the
-- way notify_support_case_assignment or
-- notify_intake_submission_routed do.
--
-- Instead: a scheduled edge function (ridearrivo-bookings-poll)
-- polls the same Render backend, using the same service-account
-- credentials the existing ridearrivo-support function already
-- uses (RIDEARRIVO_BACKEND_URL / RIDEARRIVO_SUPPORT_EMAIL /
-- RIDEARRIVO_SUPPORT_PASSWORD -- already configured, no new
-- secrets needed), and calls notify_ridearrivo_booking() below
-- for every ride it sees. That function is the dedupe boundary:
-- it claims the ride ID in ridearrivo_ride_notifications, and
-- only inserts into public.notifications (and so only emails
-- Support) the first time a given ride ID is ever claimed.
-- ============================================================

begin;

create table if not exists public.ridearrivo_ride_notifications (
  ride_id text primary key,
  notified_at timestamptz not null default now()
);

alter table public.ridearrivo_ride_notifications
  enable row level security;

revoke all
on public.ridearrivo_ride_notifications
from anon, authenticated;

grant all
on public.ridearrivo_ride_notifications
to service_role;

-- ------------------------------------------------------------
-- DEDUPE + FAN-OUT
--
-- Atomically claims a ride ID (INSERT ... ON CONFLICT DO
-- NOTHING) and only notifies active Support workstation staff
-- if this is genuinely the first time that ride ID has been
-- seen. Returns whether it was newly claimed, so the polling
-- function can report accurate counts.
-- ------------------------------------------------------------

create or replace function public.notify_ridearrivo_booking(
  p_ride_id text,
  p_title text,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new boolean;
begin
  if p_ride_id is null or btrim(p_ride_id) = '' then
    return false;
  end if;

  insert into public.ridearrivo_ride_notifications(ride_id)
  values (p_ride_id)
  on conflict (ride_id) do nothing;

  v_new := found;

  if v_new then
    insert into public.notifications(
      user_id, type, title, body, entity_type
    )
    select
      a.employee_id,
      'ridearrivo_booking_received',
      p_title,
      p_body,
      'ridearrivo_ride'
    from public.workspace_workstation_assignments a
    join public.employee_profiles p
      on p.id = a.employee_id
    where a.workstation = 'support'
      and a.active = true
      and p.active = true;
  end if;

  return v_new;
end;
$$;

revoke all
on function public.notify_ridearrivo_booking(text, text, text)
from public, anon, authenticated;

grant execute
on function public.notify_ridearrivo_booking(text, text, text)
to service_role;

-- ------------------------------------------------------------
-- SCHEDULED POLL
--
-- Every 5 minutes, ask the edge function to check recent rides
-- and notify Support about any new ones. Reuses the same
-- system_config-based dispatch secret already set up for the
-- notification email dispatcher -- no new secret required.
-- ------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (
    select 1 from cron.job
    where jobname = 'ridearrivo-poll-bookings'
  ) then
    perform cron.unschedule('ridearrivo-poll-bookings');
  end if;
end
$$;

select cron.schedule(
  'ridearrivo-poll-bookings',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select value from public.system_config
      where key = 'functions_base_url'
    ) || '/ridearrivo-bookings-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select value from public.system_config
        where key = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

commit;
