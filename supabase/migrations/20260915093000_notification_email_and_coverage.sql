-- ============================================================
-- RideArrivo Workspace: Email delivery for notifications, plus
-- notification coverage for attention-needing items that did
-- not already raise one (support cases, HR requests, leave
-- requests, incidents). Work items and approvals already
-- notify in-app as of earlier migrations; this closes the gap
-- Wuraola Awotungase (Head of Operations) reported: no email,
-- and several assignment types had no alert at all.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- EMAIL DELIVERY STATE ON NOTIFICATIONS
-- A background job (below) sweeps 'pending' rows and calls the
-- notifications-email-dispatch edge function, which flips this
-- to 'sent' or 'failed'. In-app delivery is unaffected either
-- way — it already works via Supabase Realtime on this table.
-- ------------------------------------------------------------

alter table public.notifications
  add column if not exists email_status text
    not null default 'pending'
    check (email_status in ('pending','sent','failed','skipped')),
  add column if not exists email_error text,
  add column if not exists email_sent_at timestamptz;

create index if not exists
  idx_notifications_email_pending
on public.notifications(email_status, created_at)
where email_status = 'pending';

-- ------------------------------------------------------------
-- SUPPORT CASE ASSIGNMENT
-- ------------------------------------------------------------

create or replace function
public.notify_support_case_assignment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.owner_id is not null
    and (
      tg_op = 'INSERT'
      or new.owner_id is distinct from old.owner_id
    )
  then
    insert into public.notifications(
      user_id, type, title, body, entity_type, entity_id
    )
    values(
      new.owner_id,
      'support_case_assigned',
      'Support case assigned to you',
      coalesce(new.subject, new.reference),
      'support_case',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists
  notify_support_case_assignment
on public.support_cases;

create trigger
  notify_support_case_assignment
after insert or update of owner_id
on public.support_cases
for each row
execute function public.notify_support_case_assignment();

-- ------------------------------------------------------------
-- HR REQUEST ASSIGNMENT
-- ------------------------------------------------------------

create or replace function
public.notify_hr_request_assignment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.owner_id is not null
    and (
      tg_op = 'INSERT'
      or new.owner_id is distinct from old.owner_id
    )
  then
    insert into public.notifications(
      user_id, type, title, body, entity_type, entity_id
    )
    values(
      new.owner_id,
      'hr_request_assigned',
      'HR request needs your attention',
      new.subject,
      'hr_request',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists
  notify_hr_request_assignment
on public.hr_requests;

create trigger
  notify_hr_request_assignment
after insert or update of owner_id
on public.hr_requests
for each row
execute function public.notify_hr_request_assignment();

-- ------------------------------------------------------------
-- INCIDENT ASSIGNMENT
-- ------------------------------------------------------------

create or replace function
public.notify_incident_assignment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.owner_id is not null
    and (
      tg_op = 'INSERT'
      or new.owner_id is distinct from old.owner_id
    )
  then
    insert into public.notifications(
      user_id, type, title, body, entity_type, entity_id
    )
    values(
      new.owner_id,
      'incident_assigned',
      'Incident assigned to you',
      coalesce(new.summary, new.reference),
      'incident',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists
  notify_incident_assignment
on public.incidents;

create trigger
  notify_incident_assignment
after insert or update of owner_id
on public.incidents
for each row
execute function public.notify_incident_assignment();

-- ------------------------------------------------------------
-- LEAVE REQUESTS
-- Notify the approver when a request needs a decision, and
-- notify the employee when it's decided.
-- ------------------------------------------------------------

create or replace function
public.notify_leave_request_events()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op = 'INSERT'
    and new.approver_id is not null
  then
    insert into public.notifications(
      user_id, type, title, body, entity_type, entity_id
    )
    values(
      new.approver_id,
      'leave_request_pending',
      'Leave request needs your decision',
      new.leave_type || ' (' || new.start_date || ' to ' || new.end_date || ')',
      'leave_request',
      new.id
    );
  end if;

  if tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and new.status in ('approved','declined')
  then
    insert into public.notifications(
      user_id, type, title, body, entity_type, entity_id
    )
    values(
      new.employee_id,
      'leave_request_decided',
      'Your leave request was ' || new.status,
      new.leave_type || ' (' || new.start_date || ' to ' || new.end_date || ')',
      'leave_request',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists
  notify_leave_request_events
on public.leave_requests;

create trigger
  notify_leave_request_events
after insert or update of status
on public.leave_requests
for each row
execute function public.notify_leave_request_events();

-- ------------------------------------------------------------
-- CONFIG FOR THE CRON -> EDGE FUNCTION CALL
-- Populated once, manually, by an admin in the SQL editor —
-- this migration cannot know your project's function URL or
-- service role key. See the deployment note shipped alongside
-- this migration.
-- ------------------------------------------------------------

create table if not exists public.system_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.system_config
  enable row level security;

revoke all
on public.system_config
from anon, authenticated;

grant all
on public.system_config
to service_role;

insert into public.system_config(key, value)
values
  ('functions_base_url', 'REPLACE_ME'),
  ('service_role_key', 'REPLACE_ME')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- SCHEDULED DISPATCH
-- Every 2 minutes, ask the edge function to send email for any
-- pending notification. Idempotent: the function claims rows
-- by flipping email_status away from 'pending' before sending,
-- so a slow run and the next tick can't double-send.
-- ------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (
    select 1 from cron.job
    where jobname = 'ridearrivo-dispatch-notification-emails'
  ) then
    perform cron.unschedule('ridearrivo-dispatch-notification-emails');
  end if;
end
$$;

select cron.schedule(
  'ridearrivo-dispatch-notification-emails',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := (
      select value from public.system_config
      where key = 'functions_base_url'
    ) || '/notifications-email-dispatch',
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

do $$
begin
  begin
    alter publication supabase_realtime
      add table public.notifications;
  exception
    when duplicate_object then null;
  end;
end
$$;

commit;
