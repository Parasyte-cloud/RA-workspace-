-- PArAsYtE | RA-Workspace support module
-- Alerts outside the screen: web push, SMS, WhatsApp and phone calls, plus an in-app
-- notification centre. Until now an escalation only changed what was on screen, so someone
-- had to be looking.
--
-- How it works
--   * Database triggers watch the incident timeline, new location requests and urgent
--     ticket assignments. They call support_notify(), which writes one in-app notification
--     per person and one queued delivery per channel, following the rules in support_alert_rules.
--   * A dispatcher (Edge Function code in _shared/supportNotify.ts) claims queued deliveries,
--     sends them, and records the result. Failures retry, then show up in the delivery report.
--   * Acknowledging or resolving an emergency cancels the calls and texts still waiting,
--     so nobody is rung about something already handled.
--   * Notification code can NEVER block an emergency: every trigger swallows its own
--     errors (and audits them) so the SOS itself is always recorded.
-- Additive and idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.support_staff_contacts (
  employee_id uuid primary key references public.employee_profiles(id) on delete cascade,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  allow_sms boolean not null default true,
  allow_whatsapp boolean not null default true,
  allow_voice boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employee_profiles(id) on delete set null
);

create table if not exists public.support_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  revoked_at timestamptz
);
create index if not exists support_push_subscriptions_employee_idx on public.support_push_subscriptions (employee_id) where revoked_at is null;

create table if not exists public.support_alert_rules (
  id integer generated always as identity primary key,
  kind text not null,
  audience text not null check (audience in ('responder','supervisors','on_duty')),
  channel text not null check (channel in ('push','sms','whatsapp','voice')),
  enabled boolean not null default true,
  min_level integer not null default 0 check (min_level between 0 and 10),
  delay_seconds integer not null default 0 check (delay_seconds between 0 and 3600),
  unique (kind, audience, channel)
);

create table if not exists public.support_notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.employee_profiles(id) on delete cascade,
  kind text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  title text not null,
  body text not null default '',
  entity_type text,
  entity_id text,
  level integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists support_notifications_recipient_idx on public.support_notifications (recipient_id, created_at desc);
create index if not exists support_notifications_entity_idx on public.support_notifications (entity_type, entity_id);

create table if not exists public.support_notification_deliveries (
  id bigint generated always as identity primary key,
  notification_id bigint not null references public.support_notifications(id) on delete cascade,
  recipient_id uuid not null references public.employee_profiles(id) on delete cascade,
  channel text not null check (channel in ('push','sms','whatsapp','voice')),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (notification_id, channel)
);
create index if not exists support_deliveries_due_idx on public.support_notification_deliveries (next_attempt_at) where status = 'queued';
create index if not exists support_deliveries_created_idx on public.support_notification_deliveries (created_at);

-- Default rules. An administrator can change or switch off any of them.
insert into public.support_alert_rules (kind, audience, channel, min_level, delay_seconds) values
  ('sos_new',         'responder',   'push',      0, 0),
  ('sos_new',         'responder',   'sms',       0, 0),
  ('sos_new',         'responder',   'voice',     0, 60),
  ('sos_new',         'supervisors', 'push',      0, 0),
  ('sos_new',         'supervisors', 'sms',       0, 30),
  ('sos_unassigned',  'supervisors', 'push',      0, 0),
  ('sos_unassigned',  'supervisors', 'sms',       0, 0),
  ('sos_unassigned',  'supervisors', 'voice',     0, 0),
  ('sos_unassigned',  'on_duty',     'push',      0, 0),
  ('sos_unassigned',  'on_duty',     'sms',       0, 0),
  ('sos_escalated',   'responder',   'push',      0, 0),
  ('sos_escalated',   'responder',   'sms',       0, 0),
  ('sos_escalated',   'responder',   'voice',     0, 0),
  ('sos_escalated',   'supervisors', 'push',      0, 0),
  ('sos_escalated',   'supervisors', 'sms',       0, 0),
  ('sos_escalated',   'supervisors', 'whatsapp',  0, 0),
  ('sos_escalated',   'supervisors', 'voice',     2, 0),
  ('sos_escalated',   'on_duty',     'push',      2, 0),
  ('sos_reassigned',  'responder',   'push',      0, 0),
  ('sos_reassigned',  'responder',   'sms',       0, 0),
  ('sos_followup',    'responder',   'push',      0, 0),
  ('sos_followup',    'responder',   'sms',       0, 0),
  ('sos_followup',    'supervisors', 'push',      0, 0),
  ('sos_repeat',      'responder',   'push',      0, 0),
  ('location_pending','supervisors', 'push',      0, 0),
  ('ticket_urgent',   'responder',   'push',      0, 0)
on conflict (kind, audience, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The notifier
-- ---------------------------------------------------------------------------

-- Who is in an audience. Watchers never receive alerts: they have no access to case detail.
create or replace function public.support_alert_audience(p_audience text, p_responder uuid, p_supervisor_of uuid)
returns table (employee_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.employee_id
    from public.support_agents a
    join public.employee_profiles ep on ep.id = a.employee_id and ep.active
   where a.enabled and a.role_kind <> 'watcher'
     and case p_audience
           when 'responder' then a.employee_id = p_responder
           when 'supervisors' then a.is_supervisor and (p_supervisor_of is null or public.support_supervises(a.employee_id, p_supervisor_of))
           when 'on_duty' then exists (
             select 1 from public.support_agent_presence p
              where p.employee_id = a.employee_id
                and p.state in ('available','busy','on_call','wrap_up')
                and p.last_seen_at > now() - interval '120 seconds')
           else false end;
$$;

create or replace function public.support_notify(
  p_kind text, p_severity text, p_title text, p_body text,
  p_entity_type text, p_entity_id text, p_level integer,
  p_responder uuid, p_supervisor_of uuid default null, p_data jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_person record; v_rule record; v_note bigint; v_n integer := 0;
  v_ok boolean; v_why text;
begin
  for v_person in
    select distinct aud.employee_id
      from public.support_alert_rules r
      cross join lateral public.support_alert_audience(r.audience, p_responder, p_supervisor_of) aud
     where r.kind = p_kind and r.enabled and r.min_level <= coalesce(p_level, 0)
  loop
    insert into public.support_notifications (recipient_id, kind, severity, title, body, entity_type, entity_id, level, data)
    values (v_person.employee_id, p_kind, coalesce(p_severity, 'info'), left(p_title, 200), left(coalesce(p_body, ''), 600),
            p_entity_type, p_entity_id, coalesce(p_level, 0), coalesce(p_data, '{}'::jsonb))
    returning id into v_note;
    v_n := v_n + 1;

    -- One delivery per channel, using the earliest delay any applicable rule asks for.
    for v_rule in
      select r.channel, min(r.delay_seconds) as delay_seconds
        from public.support_alert_rules r
       where r.kind = p_kind and r.enabled and r.min_level <= coalesce(p_level, 0)
         and exists (select 1 from public.support_alert_audience(r.audience, p_responder, p_supervisor_of) x where x.employee_id = v_person.employee_id)
       group by r.channel
    loop
      v_ok := true; v_why := null;
      if v_rule.channel = 'push' then
        if not exists (select 1 from public.support_push_subscriptions s where s.employee_id = v_person.employee_id and s.revoked_at is null) then
          v_ok := false; v_why := 'no device registered for push';
        end if;
      else
        if not exists (
          select 1 from public.support_staff_contacts c
           where c.employee_id = v_person.employee_id and c.phone is not null
             and case v_rule.channel when 'sms' then c.allow_sms when 'whatsapp' then c.allow_whatsapp else c.allow_voice end
        ) then
          v_ok := false; v_why := 'no phone number on file or channel switched off';
        end if;
      end if;
      insert into public.support_notification_deliveries (notification_id, recipient_id, channel, status, next_attempt_at, last_error)
      values (v_note, v_person.employee_id, v_rule.channel, case when v_ok then 'queued' else 'skipped' end,
              now() + make_interval(secs => v_rule.delay_seconds), v_why)
      on conflict (notification_id, channel) do nothing;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- Stop calls and texts that have not gone out yet. Pushes already went immediately.
create or replace function public.support_notify_cancel_incident(p_incident uuid, p_reason text, p_all boolean default false)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with c as (
    update public.support_notification_deliveries d
       set status = 'skipped', last_error = left(p_reason, 100)
      from public.support_notifications n
     where d.notification_id = n.id and d.status = 'queued'
       and n.entity_type = 'incident' and n.entity_id = p_incident::text
       and n.kind in ('sos_new','sos_unassigned','sos_escalated','sos_reassigned','sos_followup','sos_repeat')
       and (p_all or d.channel in ('sms','whatsapp','voice'))
    returning d.id)
  select count(*)::integer from c;
$$;

create or replace function public.support_notify_incident_event(p_event bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.support_incident_events%rowtype;
  i public.support_incidents%rowtype;
  v_kind text; v_resp uuid; v_level integer; v_title text; v_body text; v_sev text := 'critical';
  v_who text;
begin
  select * into e from public.support_incident_events where id = p_event;
  select * into i from public.support_incidents where id = e.incident_id;
  if e.id is null or i.id is null then return; end if;

  if e.event_type = 'acknowledged' then
    perform public.support_notify_cancel_incident(i.id, 'acknowledged');
    return;
  elsif e.event_type = 'resolved' then
    perform public.support_notify_cancel_incident(i.id, 'resolved', true);
    return;
  end if;

  v_who := case i.subject_type when 'driver' then 'driver' else 'rider' end;
  v_level := i.escalation_level;
  v_resp := i.assigned_to;
  v_body := 'Open the Support workspace now. Emergency tab.';

  if e.event_type = 'triggered' then
    v_kind := 'sos_new'; v_title := format('SOS %s from a %s', i.public_id, v_who);
  elsif e.event_type = 'no_responder_available' then
    v_kind := 'sos_unassigned'; v_resp := null;
    v_title := format('SOS %s has NO responder', i.public_id);
    v_body := 'Nobody is available to take it. Open the Support workspace and take it now.';
  elsif e.event_type = 'assigned' then
    if coalesce(e.detail->>'reason', '') in ('responder_unavailable', 'escalation') or e.detail->>'method' = 'manual' then
      v_kind := 'sos_reassigned'; v_resp := nullif(e.detail->>'to', '')::uuid;
      v_title := format('SOS %s is now yours', i.public_id);
    else
      return;
    end if;
  elsif e.event_type = 'escalated' then
    v_kind := 'sos_escalated'; v_level := coalesce((e.detail->>'to_level')::integer, i.escalation_level);
    v_title := format('ESCALATED: SOS %s not acknowledged (level %s)', i.public_id, v_level);
  elsif e.event_type = 'followup_due' then
    v_kind := 'sos_followup'; v_level := coalesce((e.detail->>'to_level')::integer, i.escalation_level); v_sev := 'warning';
    v_title := format('Follow-up due on SOS %s', i.public_id);
    v_body := 'The emergency is still open. Update the timeline or resolve it.';
  elsif e.event_type = 'repeat_activation' then
    -- A panicking person may press again and again. One nudge a minute is enough.
    if exists (select 1 from public.support_notifications n
                where n.kind = 'sos_repeat' and n.entity_id = i.id::text and n.created_at > now() - interval '60 seconds') then
      return;
    end if;
    v_kind := 'sos_repeat'; v_title := format('SOS %s pressed again', i.public_id); v_sev := 'warning';
  else
    return;
  end if;

  perform public.support_notify(v_kind, v_sev, v_title, v_body, 'incident', i.id::text, v_level, v_resp, null,
    jsonb_build_object('incident_ref', i.public_id, 'tab', 'emergency'));
end;
$$;

-- Triggers. Each one is written so that a failure here can never roll back or block the thing
-- being notified about.
create or replace function public.support_incident_events_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.support_notify_incident_event(new.id);
  exception when others then
    begin
      perform public.support_write_audit(null, 'notify_failed', 'incident_event', new.id::text, jsonb_build_object('error', left(sqlerrm, 200)));
    exception when others then null;
    end;
  end;
  return null;
end;
$$;
drop trigger if exists support_incident_events_notify on public.support_incident_events;
create trigger support_incident_events_notify after insert on public.support_incident_events
  for each row execute function public.support_incident_events_notify();

create or replace function public.support_location_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text;
begin
  begin
    if new.status = 'pending_approval' then
      select full_name into v_name from public.employee_profiles where id = new.requested_by;
      perform public.support_notify('location_pending', 'warning',
        format('%s needs approval to see a live location', coalesce(v_name, 'An officer')),
        left(coalesce(new.reason, ''), 200), 'location_session', new.id::text, 0, null, new.requested_by,
        jsonb_build_object('tab', 'emergency'));
    end if;
  exception when others then
    begin
      perform public.support_write_audit(null, 'notify_failed', 'location_session', new.id::text, jsonb_build_object('error', left(sqlerrm, 200)));
    exception when others then null;
    end;
  end;
  return null;
end;
$$;
drop trigger if exists support_location_notify on public.support_location_sessions;
create trigger support_location_notify after insert on public.support_location_sessions
  for each row execute function public.support_location_notify();

create or replace function public.support_ticket_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.assigned_agent_id is not null and new.priority in ('P0','P1')
       and (tg_op = 'INSERT' or old.assigned_agent_id is distinct from new.assigned_agent_id) then
      perform public.support_notify('ticket_urgent', case when new.priority = 'P0' then 'critical' else 'warning' end,
        format('%s ticket %s assigned to you', new.priority, new.public_id), left(coalesce(new.subject, ''), 200),
        'ticket', new.id::text, 0, new.assigned_agent_id, null, jsonb_build_object('tab', 'mine'));
    end if;
  exception when others then
    begin
      perform public.support_write_audit(null, 'notify_failed', 'ticket', new.id::text, jsonb_build_object('error', left(sqlerrm, 200)));
    exception when others then null;
    end;
  end;
  return null;
end;
$$;
drop trigger if exists support_ticket_notify on public.support_tickets;
create trigger support_ticket_notify after insert or update of assigned_agent_id on public.support_tickets
  for each row execute function public.support_ticket_notify();

-- ---------------------------------------------------------------------------
-- 3. Dispatcher interface (service role only)
-- ---------------------------------------------------------------------------

create or replace function public.support_claim_deliveries(p_limit integer default 25)
returns table (
  delivery_id bigint, channel text, attempts integer, recipient_id uuid, recipient_name text, phone text,
  kind text, severity text, title text, body text, entity_type text, entity_id text, data jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select d.id from public.support_notification_deliveries d
     where d.status = 'queued' and d.next_attempt_at <= now()
     order by (select case n.severity when 'critical' then 0 else 1 end from public.support_notifications n where n.id = d.notification_id), d.next_attempt_at
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
     for update skip locked
  ), claimed as (
    update public.support_notification_deliveries d
       set status = 'sending', claimed_at = now(), attempts = d.attempts + 1
      from due where d.id = due.id
    returning d.*
  )
  select c.id, c.channel, c.attempts, c.recipient_id, ep.full_name, sc.phone,
         n.kind, n.severity, n.title, n.body, n.entity_type, n.entity_id, n.data
    from claimed c
    join public.support_notifications n on n.id = c.notification_id
    join public.employee_profiles ep on ep.id = c.recipient_id
    left join public.support_staff_contacts sc on sc.employee_id = c.recipient_id;
end;
$$;

create or replace function public.support_delivery_result(p_id bigint, p_ok boolean, p_provider text default null, p_error text default null, p_retry boolean default true)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare d public.support_notification_deliveries%rowtype;
begin
  select * into d from public.support_notification_deliveries where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update public.support_notification_deliveries set status = 'sent', sent_at = now(), provider_id = left(p_provider, 100), last_error = null where id = p_id;
  elsif p_retry and d.attempts < 3 then
    update public.support_notification_deliveries
       set status = 'queued', next_attempt_at = now() + make_interval(secs => 15 * d.attempts), last_error = left(p_error, 200) where id = p_id;
  else
    update public.support_notification_deliveries set status = 'failed', last_error = left(p_error, 200) where id = p_id;
  end if;
end;
$$;

-- Push endpoints the browser vendor says are gone, or that keep failing, are retired.
create or replace function public.support_push_result(p_employee uuid, p_endpoint text, p_ok boolean, p_gone boolean)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.support_push_subscriptions s
     set last_success_at = case when p_ok then now() else s.last_success_at end,
         failure_count = case when p_ok then 0 else s.failure_count + 1 end,
         revoked_at = case when p_gone or (not p_ok and s.failure_count + 1 >= 5) then now() else s.revoked_at end
   where s.employee_id = p_employee and s.endpoint = p_endpoint;
$$;

create or replace function public.support_push_targets(p_employee uuid)
returns table (endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.endpoint, s.p256dh, s.auth from public.support_push_subscriptions s where s.employee_id = p_employee and s.revoked_at is null;
$$;

-- Housekeeping, called every minute by support-maintenance.
create or replace function public.support_notifications_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_stuck integer; v_old integer; v_stale integer;
begin
  -- A dispatcher that died mid-send leaves rows in 'sending'. Give them back once.
  with s as (
    update public.support_notification_deliveries
       set status = case when attempts >= 3 then 'failed' else 'queued' end,
           last_error = coalesce(last_error, 'dispatcher stopped while sending'), next_attempt_at = now()
     where status = 'sending' and claimed_at < now() - interval '3 minutes'
    returning 1)
  select count(*) into v_stuck from s;
  -- A queued text for an emergency that has since been handled is stale; never send it late.
  with s as (
    update public.support_notification_deliveries d
       set status = 'skipped', last_error = 'too old to send'
      from public.support_notifications n
     where d.notification_id = n.id and d.status = 'queued' and d.next_attempt_at < now() - interval '15 minutes'
    returning 1)
  select count(*) into v_stale from s;
  with s as (delete from public.support_notifications where created_at < now() - interval '90 days' returning 1)
  select count(*) into v_old from s;
  delete from public.support_push_subscriptions where revoked_at < now() - interval '30 days';
  return jsonb_build_object('reclaimed', v_stuck, 'expired', v_stale, 'purged', v_old);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Browser-facing functions
-- ---------------------------------------------------------------------------

create or replace function public.support_notifications_mark_read(p_ids bigint[] default null)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with u as (
    update public.support_notifications n set read_at = now()
     where n.recipient_id = auth.uid() and n.read_at is null and (p_ids is null or n.id = any(p_ids))
    returning 1)
  select count(*)::integer from u;
$$;

create or replace function public.support_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(coalesce(p_p256dh, '')) < 40 or length(coalesce(p_auth, '')) < 8 then
    raise exception 'that does not look like a push subscription';
  end if;
  insert into public.support_push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set employee_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
        revoked_at = null, failure_count = 0;
end;
$$;

create or replace function public.support_push_unsubscribe(p_endpoint text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.support_push_subscriptions set revoked_at = now() where endpoint = p_endpoint and employee_id = auth.uid();
$$;

create or replace function public.support_my_push_devices()
returns table (id uuid, user_agent text, created_at timestamptz, last_success_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.user_agent, s.created_at, s.last_success_at
    from public.support_push_subscriptions s where s.employee_id = auth.uid() and s.revoked_at is null order by s.created_at desc;
$$;

create or replace function public.support_set_my_contact(p_phone text, p_sms boolean, p_whatsapp boolean, p_voice boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required' using errcode = '42501'; end if;
  if v_phone is not null then
    v_phone := nullif(public.support_normalize_phone(v_phone), '');
    if v_phone is null then raise exception 'that phone number is not valid. Use the international form, like +2348012345678'; end if;
  end if;
  insert into public.support_staff_contacts (employee_id, phone, allow_sms, allow_whatsapp, allow_voice, updated_by)
  values (auth.uid(), v_phone, coalesce(p_sms, true), coalesce(p_whatsapp, true), coalesce(p_voice, true), auth.uid())
  on conflict (employee_id) do update
    set phone = excluded.phone, allow_sms = excluded.allow_sms, allow_whatsapp = excluded.allow_whatsapp,
        allow_voice = excluded.allow_voice, updated_at = now(), updated_by = auth.uid();
  perform public.support_write_audit(auth.uid(), 'alert_contact_updated', 'employee', auth.uid()::text,
    jsonb_build_object('phone', public.support_mask_phone(v_phone)));
end;
$$;

-- Lets a person prove their own path works: one test alert to themselves on one channel.
create or replace function public.support_send_test_alert(p_channel text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_note bigint; v_ok boolean := true; v_why text;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required' using errcode = '42501'; end if;
  if p_channel not in ('push','sms','whatsapp','voice') then raise exception 'unknown channel'; end if;
  if (select count(*) from public.support_notifications where recipient_id = auth.uid() and kind = 'test' and created_at > now() - interval '5 minutes') >= 5 then
    raise exception 'that is enough test alerts for now. Wait a few minutes';
  end if;
  insert into public.support_notifications (recipient_id, kind, severity, title, body, data)
  values (auth.uid(), 'test', 'info', 'Test alert from RideArrivo Support', 'If you can read this, this channel works.', '{}'::jsonb)
  returning id into v_note;
  if p_channel = 'push' then
    v_ok := exists (select 1 from public.support_push_subscriptions s where s.employee_id = auth.uid() and s.revoked_at is null);
    v_why := 'no device registered for push';
  else
    v_ok := exists (select 1 from public.support_staff_contacts c where c.employee_id = auth.uid() and c.phone is not null
                     and case p_channel when 'sms' then c.allow_sms when 'whatsapp' then c.allow_whatsapp else c.allow_voice end);
    v_why := 'no phone number on file or channel switched off';
  end if;
  insert into public.support_notification_deliveries (notification_id, recipient_id, channel, status, last_error)
  values (v_note, auth.uid(), p_channel, case when v_ok then 'queued' else 'skipped' end, case when v_ok then null else v_why end);
  if not v_ok then raise exception '%', v_why; end if;
  return v_note;
end;
$$;

-- Supervisors: how alerts are actually going out.
create or replace function public.support_delivery_report(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_from timestamptz := coalesce(p_from, now() - interval '7 days'); v_to timestamptz := coalesce(p_to, now()); v_out jsonb;
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'by_channel', (select coalesce(jsonb_agg(jsonb_build_object('channel', c.channel, 'sent', c.sent, 'failed', c.failed, 'skipped', c.skipped, 'queued', c.queued)
                                              order by c.channel), '[]'::jsonb)
                    from (select channel,
                                 count(*) filter (where status = 'sent') as sent,
                                 count(*) filter (where status = 'failed') as failed,
                                 count(*) filter (where status = 'skipped') as skipped,
                                 count(*) filter (where status in ('queued','sending')) as queued
                            from public.support_notification_deliveries where created_at >= v_from and created_at <= v_to group by channel) c),
    'oldest_queued_seconds', (select round(extract(epoch from (now() - min(next_attempt_at)))) from public.support_notification_deliveries where status = 'queued' and next_attempt_at <= now()),
    'recent_problems', (select coalesce(jsonb_agg(p order by p->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('at', d.created_at, 'channel', d.channel, 'status', d.status, 'error', d.last_error,
                                  'kind', n.kind, 'title', n.title, 'recipient', ep.full_name) as p
          from public.support_notification_deliveries d
          join public.support_notifications n on n.id = d.notification_id
          join public.employee_profiles ep on ep.id = d.recipient_id
         where d.status in ('failed','skipped') and d.created_at >= v_from and d.created_at <= v_to and n.kind <> 'test'
         order by d.created_at desc limit 30) x),
    'staff_without_path', (select coalesce(jsonb_agg(jsonb_build_object('employee_id', a.employee_id, 'name', ep.full_name,
                                  'push', exists (select 1 from public.support_push_subscriptions s where s.employee_id = a.employee_id and s.revoked_at is null),
                                  'phone', exists (select 1 from public.support_staff_contacts c where c.employee_id = a.employee_id and c.phone is not null))
                                  order by ep.full_name), '[]'::jsonb)
                    from public.support_agents a join public.employee_profiles ep on ep.id = a.employee_id and ep.active
                   where a.enabled and a.role_kind <> 'watcher'
                     and not exists (select 1 from public.support_push_subscriptions s where s.employee_id = a.employee_id and s.revoked_at is null)
                     and not exists (select 1 from public.support_staff_contacts c where c.employee_id = a.employee_id and c.phone is not null))
  ) into v_out;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS and grants
-- ---------------------------------------------------------------------------

do $$
declare n text;
begin
  foreach n in array array['support_staff_contacts','support_push_subscriptions','support_alert_rules','support_notifications','support_notification_deliveries'] loop
    execute format('alter table public.%I enable row level security', n);
    execute format('revoke all on table public.%I from public, anon, authenticated', n);
    execute format('grant all on table public.%I to service_role', n);
  end loop;
end $$;

-- Push keys are never readable from the browser; contacts only by the owner and their supervisor.
drop policy if exists support_own_or_supervisor_read on public.support_staff_contacts;
create policy support_own_or_supervisor_read on public.support_staff_contacts for select to authenticated
  using (employee_id = auth.uid() or public.support_supervises(auth.uid(), employee_id));
grant select on public.support_staff_contacts to authenticated;

drop policy if exists support_supervisor_read on public.support_alert_rules;
create policy support_supervisor_read on public.support_alert_rules for select to authenticated using (public.support_is_supervisor(auth.uid()));
grant select on public.support_alert_rules to authenticated;

drop policy if exists support_own_read on public.support_notifications;
create policy support_own_read on public.support_notifications for select to authenticated using (recipient_id = auth.uid());
grant select on public.support_notifications to authenticated;

drop policy if exists support_own_read on public.support_notification_deliveries;
create policy support_own_read on public.support_notification_deliveries for select to authenticated using (recipient_id = auth.uid());
grant select on public.support_notification_deliveries to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_notifications') then
    alter publication supabase_realtime add table public.support_notifications;
  end if;
end $$;

revoke all on function public.support_alert_audience(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.support_notify(text,text,text,text,text,text,integer,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.support_notify_cancel_incident(uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.support_notify_incident_event(bigint) from public, anon, authenticated;
revoke all on function public.support_incident_events_notify() from public, anon, authenticated;
revoke all on function public.support_location_notify() from public, anon, authenticated;
revoke all on function public.support_ticket_notify() from public, anon, authenticated;
revoke all on function public.support_claim_deliveries(integer) from public, anon, authenticated;
revoke all on function public.support_delivery_result(bigint,boolean,text,text,boolean) from public, anon, authenticated;
revoke all on function public.support_push_result(uuid,text,boolean,boolean) from public, anon, authenticated;
revoke all on function public.support_push_targets(uuid) from public, anon, authenticated;
revoke all on function public.support_notifications_sweep() from public, anon, authenticated;
revoke all on function public.support_notifications_mark_read(bigint[]) from public, anon;
revoke all on function public.support_push_subscribe(text,text,text,text) from public, anon;
revoke all on function public.support_push_unsubscribe(text) from public, anon;
revoke all on function public.support_my_push_devices() from public, anon;
revoke all on function public.support_set_my_contact(text,boolean,boolean,boolean) from public, anon;
revoke all on function public.support_send_test_alert(text) from public, anon;
revoke all on function public.support_delivery_report(timestamptz,timestamptz) from public, anon;

grant execute on function public.support_alert_audience(text,uuid,uuid) to service_role;
grant execute on function public.support_notify(text,text,text,text,text,text,integer,uuid,uuid,jsonb) to service_role;
grant execute on function public.support_notify_cancel_incident(uuid,text,boolean) to service_role;
grant execute on function public.support_notify_incident_event(bigint) to service_role;
grant execute on function public.support_claim_deliveries(integer) to service_role;
grant execute on function public.support_delivery_result(bigint,boolean,text,text,boolean) to service_role;
grant execute on function public.support_push_result(uuid,text,boolean,boolean) to service_role;
grant execute on function public.support_push_targets(uuid) to service_role;
grant execute on function public.support_notifications_sweep() to service_role;
grant execute on function public.support_notifications_mark_read(bigint[]) to authenticated, service_role;
grant execute on function public.support_push_subscribe(text,text,text,text) to authenticated, service_role;
grant execute on function public.support_push_unsubscribe(text) to authenticated, service_role;
grant execute on function public.support_my_push_devices() to authenticated, service_role;
grant execute on function public.support_set_my_contact(text,boolean,boolean,boolean) to authenticated, service_role;
grant execute on function public.support_send_test_alert(text) to authenticated, service_role;
grant execute on function public.support_delivery_report(timestamptz,timestamptz) to authenticated, service_role;

commit;
