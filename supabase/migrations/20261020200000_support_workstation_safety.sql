-- PArAsYtE | RA-Workspace support module
-- Support Workstation brief, built on the existing Command Centre:
--   * Watcher / Agent / Supervisor role kinds, ticket watchers
--   * Rider and driver identity codes (exact lookup, rate limited, audited, masked by role)
--   * Short-lived, case-linked, audited location sessions with optional supervisor approval
--   * SOS incidents: idempotent ingest, immutable original event, acknowledgement,
--     escalation, reassignment, documented resolution, append-only timeline
--   * Safety settings, audit search, operational report summary
-- Additive and idempotent. Does not touch the main RideArrivo tables: riders,
-- drivers, trips and live GPS stay where they are and are referenced by id only.

begin;

-- ---------------------------------------------------------------------------
-- 1. Role kinds
-- ---------------------------------------------------------------------------

alter table public.support_agents add column if not exists role_kind text not null default 'agent';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_agents_role_kind_chk') then
    alter table public.support_agents add constraint support_agents_role_kind_chk
      check (role_kind in ('watcher','agent','supervisor'));
  end if;
end $$;

update public.support_agents set role_kind = 'supervisor' where is_supervisor and role_kind = 'agent';

create or replace function public.support_agents_role_guard()
returns trigger
language plpgsql
as $$
begin
  if new.role_kind = 'watcher' then
    -- A watcher sees queues but never receives work or calls.
    new.voice_enabled := false;
    new.voice_capacity := 0;
    new.messaging_capacity := 0;
    new.is_supervisor := false;
  elsif tg_op = 'UPDATE' and old.is_supervisor and not new.is_supervisor and new.role_kind = 'supervisor' and old.role_kind = 'supervisor' then
    new.role_kind := 'agent';                    -- demoted by clearing the flag
  elsif new.role_kind = 'supervisor' or new.is_supervisor then
    new.role_kind := 'supervisor';
    new.is_supervisor := true;
  end if;
  return new;
end;
$$;

drop trigger if exists support_agents_role_guard on public.support_agents;
create trigger support_agents_role_guard before insert or update on public.support_agents
  for each row execute function public.support_agents_role_guard();

create or replace function public.support_agents_role_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role_kind is distinct from old.role_kind or new.is_supervisor is distinct from old.is_supervisor or new.enabled is distinct from old.enabled then
    perform public.support_write_audit(auth.uid(), 'support_role_changed', 'support_agent', new.employee_id::text,
      jsonb_build_object('role_from', old.role_kind, 'role_to', new.role_kind,
                         'enabled_from', old.enabled, 'enabled_to', new.enabled));
  end if;
  return new;
end;
$$;

drop trigger if exists support_agents_role_audit on public.support_agents;
create trigger support_agents_role_audit after update on public.support_agents
  for each row execute function public.support_agents_role_audit();

-- Watchers see queues and activity, not people's private details or locations.
create or replace function public.support_can_see_sensitive(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.support_is_staff(p_user)
     and not exists (
       select 1 from public.support_agents a
        where a.employee_id = p_user and a.enabled and a.role_kind = 'watcher'
     );
$$;

-- ---------------------------------------------------------------------------
-- 2. Safety settings (one row, policy not code)
-- ---------------------------------------------------------------------------

create table if not exists public.support_safety_settings (
  id boolean primary key default true check (id),
  location_session_minutes integer not null default 15 check (location_session_minutes between 1 and 120),
  location_requires_approval boolean not null default false,
  location_max_active_per_officer integer not null default 3 check (location_max_active_per_officer between 1 and 20),
  location_fresh_seconds integer not null default 45 check (location_fresh_seconds between 5 and 3600),
  location_log_retention_days integer not null default 30 check (location_log_retention_days between 1 and 3650),
  identity_lookups_per_10min integer not null default 20 check (identity_lookups_per_10min between 1 and 500),
  identity_failed_per_10min integer not null default 6 check (identity_failed_per_10min between 1 and 100),
  incident_ack_seconds integer not null default 60 check (incident_ack_seconds between 10 and 3600),
  incident_escalate_seconds integer not null default 120 check (incident_escalate_seconds between 10 and 3600),
  incident_followup_seconds integer not null default 900 check (incident_followup_seconds between 60 and 86400),
  incident_max_level integer not null default 3 check (incident_max_level between 1 and 5),
  updated_at timestamptz not null default now()
);
insert into public.support_safety_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Ticket watchers
-- ---------------------------------------------------------------------------

create table if not exists public.support_ticket_watchers (
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  added_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (ticket_id, employee_id)
);

create or replace function public.support_watch_ticket(p_ticket uuid, p_employee uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_target uuid := coalesce(p_employee, auth.uid());
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  if v_target <> auth.uid() and not public.support_is_supervisor(auth.uid()) then
    raise exception 'only supervisors can add other watchers';
  end if;
  if not public.support_is_staff(v_target) then raise exception 'that person does not have support access'; end if;
  if not exists (select 1 from public.support_tickets where id = p_ticket) then raise exception 'ticket not found'; end if;
  insert into public.support_ticket_watchers (ticket_id, employee_id, added_by)
  values (p_ticket, v_target, auth.uid()) on conflict do nothing;
  if found then
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (p_ticket, auth.uid(), 'watcher_added', jsonb_build_object('employee_id', v_target));
  end if;
end;
$$;

create or replace function public.support_unwatch_ticket(p_ticket uuid, p_employee uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_target uuid := coalesce(p_employee, auth.uid());
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  if v_target <> auth.uid() and not public.support_is_supervisor(auth.uid()) then
    raise exception 'only supervisors can remove other watchers';
  end if;
  delete from public.support_ticket_watchers where ticket_id = p_ticket and employee_id = v_target;
  if found then
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (p_ticket, auth.uid(), 'watcher_removed', jsonb_build_object('employee_id', v_target));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Identity codes
-- ---------------------------------------------------------------------------

create table if not exists public.support_identity_codes (
  code text primary key check (code ~ '^RA[RD]-[A-Z0-9]{5}-[A-Z0-9]{5}$'),
  subject_type text not null check (subject_type in ('rider','driver')),
  subject_ref uuid not null,
  customer_id uuid references public.support_customers(id) on delete set null,
  status text not null default 'active' check (status in ('active','revoked')),
  issued_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (subject_type, subject_ref)
);

-- Lookups are logged so abuse is visible and rate limits hold. Failed input is
-- never stored: only that a lookup happened and whether it found someone.
create table if not exists public.support_identity_lookups (
  id bigint generated always as identity primary key,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  found boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists support_identity_lookups_actor_idx on public.support_identity_lookups (actor_id, created_at desc);

-- 10 characters from a 30 symbol alphabet with no look-alikes (no 0/O, 1/I/L).
-- Skips uuid bytes 6 and 8, whose bits are fixed by the uuid version.
create or replace function public.support_generate_identity_code(p_type text)
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  idx constant int[] := array[0,1,2,3,4,5,9,10,11,12];
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  out text := '';
  i int;
begin
  foreach i in array idx loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 30) + 1, 1);
  end loop;
  return (case p_type when 'driver' then 'RAD-' else 'RAR-' end) || substr(out, 1, 5) || '-' || substr(out, 6, 5);
end;
$$;

-- Called by the RideArrivo backend or a supervisor action. Idempotent: one
-- stable code per rider or driver, and it never changes when the phone does.
create or replace function public.support_issue_identity_code(p_type text, p_subject_ref uuid, p_customer uuid default null, p_actor uuid default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_code text; v_customer uuid := p_customer; n int := 0;
begin
  if p_type not in ('rider','driver') then raise exception 'type must be rider or driver'; end if;
  if p_subject_ref is null then raise exception 'subject reference is required'; end if;
  select code into v_code from public.support_identity_codes where subject_type = p_type and subject_ref = p_subject_ref;
  if found then return v_code; end if;
  if v_customer is null and p_type = 'rider' then
    select id into v_customer from public.support_customers where rider_id = p_subject_ref limit 1;
  end if;
  loop
    n := n + 1;
    v_code := public.support_generate_identity_code(p_type);
    begin
      insert into public.support_identity_codes (code, subject_type, subject_ref, customer_id, issued_by)
      values (v_code, p_type, p_subject_ref, v_customer, p_actor);
      perform public.support_write_audit(p_actor, 'identity_code_issued', 'identity_code', v_code, jsonb_build_object('subject_type', p_type));
      return v_code;
    exception when unique_violation then
      select code into v_code from public.support_identity_codes where subject_type = p_type and subject_ref = p_subject_ref;
      if found then return v_code; end if;     -- a concurrent call issued it
      if n >= 5 then raise exception 'could not allocate an identity code'; end if;
    end;
  end loop;
end;
$$;

create or replace function public.support_mask_phone(p text)
returns text language sql immutable as $$
  select case when p is null or length(p) < 7 then null else left(p, 4) || '****' || right(p, 2) end
$$;

create or replace function public.support_mask_email(p text)
returns text language sql immutable as $$
  select case when p is null or position('@' in p) < 2 then null else left(p, 1) || '***' || substr(p, position('@' in p)) end
$$;

-- Exact match only. Returns a status object instead of raising, so that failed
-- and blocked attempts are still recorded (an exception would roll them back).
create or replace function public.support_lookup_identity(p_code text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_set public.support_safety_settings%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_rec public.support_identity_codes%rowtype;
  v_cust public.support_customers%rowtype;
  v_total int; v_failed int; v_full boolean := false; v_tickets jsonb := '[]'::jsonb;
begin
  if not public.support_can_see_sensitive(auth.uid()) then raise exception 'identity lookup is not permitted for your role'; end if;
  select * into v_set from public.support_safety_settings limit 1;
  select count(*), count(*) filter (where not l.found) into v_total, v_failed
    from public.support_identity_lookups l
   where l.actor_id = auth.uid() and l.created_at > now() - interval '10 minutes';
  if v_total >= v_set.identity_lookups_per_10min or v_failed >= v_set.identity_failed_per_10min then
    perform public.support_write_audit(auth.uid(), 'identity_lookup_blocked', 'identity_code', null,
      jsonb_build_object('lookups_10min', v_total, 'failed_10min', v_failed));
    return jsonb_build_object('status', 'rate_limited');
  end if;

  if v_code ~ '^RA[RD]-[A-Z0-9]{5}-[A-Z0-9]{5}$' then
    select * into v_rec from public.support_identity_codes where code = v_code and status = 'active';
  end if;
  if v_rec.code is null then
    insert into public.support_identity_lookups (actor_id, found) values (auth.uid(), false);
    return jsonb_build_object('status', 'not_found');
  end if;
  insert into public.support_identity_lookups (actor_id, found) values (auth.uid(), true);

  if v_rec.customer_id is not null then
    select * into v_cust from public.support_customers where id = v_rec.customer_id;
    v_full := public.support_is_supervisor(auth.uid())
      or exists (select 1 from public.support_tickets t
                  where t.customer_id = v_rec.customer_id and t.assigned_agent_id = auth.uid()
                    and t.status not in ('resolved','closed'));
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'public_id', x.public_id, 'subject', x.subject,
                                                 'status', x.status, 'priority', x.priority) order by x.created_at desc), '[]'::jsonb)
      into v_tickets
      from (select * from public.support_tickets where customer_id = v_rec.customer_id order by created_at desc limit 5) x;
  end if;

  perform public.support_write_audit(auth.uid(), 'identity_lookup', 'identity_code', v_rec.code,
    jsonb_build_object('subject_type', v_rec.subject_type, 'reason', nullif(left(btrim(coalesce(p_reason, '')), 200), '')));

  return jsonb_build_object(
    'status', 'found',
    'code', v_rec.code,
    'subject_type', v_rec.subject_type,
    'customer_id', v_rec.customer_id,
    'display_name', v_cust.display_name,
    'phone', case when v_full then v_cust.primary_phone else public.support_mask_phone(v_cust.primary_phone) end,
    'email', case when v_full then v_cust.primary_email else public.support_mask_email(v_cust.primary_email) end,
    'full_details', v_full,
    'tickets', v_tickets
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Incidents (SOS)
-- ---------------------------------------------------------------------------

create sequence if not exists public.support_incident_number_seq;

create table if not exists public.support_incidents (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique
    default ('SOS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.support_incident_number_seq')::text, 6, '0')),
  source_event_id text not null unique,
  subject_type text not null check (subject_type in ('rider','driver')),
  subject_ref uuid not null,
  identity_code text,
  trip_ref text,
  booking_ref text,
  vehicle_ref text,
  activated_at timestamptz not null,
  received_at timestamptz not null default now(),
  last_activation_at timestamptz not null default now(),
  original_payload jsonb not null,
  last_location jsonb,
  duplicate_count integer not null default 0,
  status text not null default 'triggered' check (status in ('triggered','acknowledged','escalated','resolved')),
  assigned_to uuid references public.employee_profiles(id) on delete set null,
  acknowledged_by uuid references public.employee_profiles(id) on delete set null,
  acknowledged_at timestamptz,
  escalation_level integer not null default 0,
  next_escalation_at timestamptz,
  resolved_by uuid references public.employee_profiles(id) on delete set null,
  resolved_at timestamptz,
  outcome text check (outcome is null or outcome in ('false_alarm','assisted_on_scene','emergency_services_contacted','unreachable','other')),
  resolution_notes text,
  updated_at timestamptz not null default now()
);
create index if not exists support_incidents_open_idx on public.support_incidents (status, next_escalation_at) where status <> 'resolved';
create index if not exists support_incidents_subject_idx on public.support_incidents (subject_ref, activated_at desc);

create table if not exists public.support_incident_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.support_incidents(id),
  actor_id uuid references public.employee_profiles(id) on delete set null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_incident_events_incident_idx on public.support_incident_events (incident_id, created_at);

-- The original event and its timeline cannot be rewritten after the fact.
create or replace function public.support_incident_protect()
returns trigger
language plpgsql
as $$
begin
  if new.source_event_id is distinct from old.source_event_id
     or new.public_id is distinct from old.public_id
     or new.subject_type is distinct from old.subject_type
     or new.subject_ref is distinct from old.subject_ref
     or new.activated_at is distinct from old.activated_at
     or new.received_at is distinct from old.received_at
     or new.original_payload is distinct from old.original_payload then
    raise exception 'the original SOS event cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists support_incident_protect on public.support_incidents;
create trigger support_incident_protect before update on public.support_incidents
  for each row execute function public.support_incident_protect();

create or replace function public.support_incident_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'incident events are append-only';
end;
$$;
drop trigger if exists support_incident_events_append_only on public.support_incident_events;
create trigger support_incident_events_append_only before update or delete on public.support_incident_events
  for each row execute function public.support_incident_events_append_only();

create or replace function public.support_incident_event(p_incident uuid, p_actor uuid, p_type text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.support_incident_events (incident_id, actor_id, event_type, detail)
  values (p_incident, p_actor, p_type, coalesce(p_detail, '{}'::jsonb));
$$;

-- Who should own a new emergency: available, on shift, fresh heartbeat, and
-- the fewest open emergencies (weighted) plus open cases. Never a watcher.
create or replace function public.support_pick_responder(p_exclude uuid default null)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.employee_id
    from public.support_agents a
    join public.employee_profiles ep on ep.id = a.employee_id and ep.active
    join public.support_agent_presence p on p.employee_id = a.employee_id
   where a.enabled and a.role_kind <> 'watcher'
     and (p_exclude is null or a.employee_id <> p_exclude)
     and p.state = 'available'
     and p.last_seen_at > now() - interval '120 seconds'
     and public.support_is_employee_on_shift(a.employee_id, now())
   order by
     (select count(*) from public.support_incidents i where i.assigned_to = a.employee_id and i.status <> 'resolved') * 3
       + (select count(*) from public.support_tickets t where t.assigned_agent_id = a.employee_id
            and t.status in ('assigned','in_progress','escalated','waiting_internal')),
     a.last_assigned_at nulls first,
     a.employee_id
   limit 1;
$$;

-- Ingest. Safe to call any number of times with the same event id.
create or replace function public.support_sos_ingest(
  p_source_event_id text, p_subject_type text, p_subject_ref uuid, p_identity_code text,
  p_trip_ref text, p_booking_ref text, p_vehicle_ref text, p_activated_at timestamptz,
  p_location jsonb, p_payload jsonb
)
returns table (incident_id uuid, incident_ref text, is_duplicate boolean, responder_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_set public.support_safety_settings%rowtype;
  v_event text := left(btrim(coalesce(p_source_event_id, '')), 200);
  v_inc public.support_incidents%rowtype;
  v_loc jsonb := null;
  v_code text;
  v_act timestamptz;
  v_resp uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if v_event = '' then raise exception 'source_event_id is required'; end if;
  if p_subject_type is null or p_subject_type not in ('rider','driver') then raise exception 'subject_type must be rider or driver'; end if;
  if p_subject_ref is null then raise exception 'subject_ref is required'; end if;
  if octet_length(v_payload::text) > 65536 then raise exception 'payload too large'; end if;
  select * into v_set from public.support_safety_settings limit 1;
  v_act := least(coalesce(p_activated_at, now()), now());

  begin
    if p_location is not null and jsonb_typeof(p_location) = 'object'
       and (p_location->>'lat')::numeric between -90 and 90
       and (p_location->>'lng')::numeric between -180 and 180 then
      v_loc := jsonb_strip_nulls(jsonb_build_object(
        'lat', (p_location->>'lat')::numeric,
        'lng', (p_location->>'lng')::numeric,
        'accuracy_m', (p_location->>'accuracy_m')::numeric,
        'heading', (p_location->>'heading')::numeric,
        'recorded_at', least(coalesce((p_location->>'recorded_at')::timestamptz, v_act), now())));
    end if;
  exception when others then
    v_loc := null;                       -- bad coordinates are kept in the raw payload only
  end;

  -- Same event delivered again: count it, keep the newest position, change nothing else.
  select * into v_inc from public.support_incidents where source_event_id = v_event for update;
  if found then
    update public.support_incidents i
       set duplicate_count = i.duplicate_count + 1,
           last_location = case when v_loc is not null
                                 and (i.last_location is null or (v_loc->>'recorded_at')::timestamptz > (i.last_location->>'recorded_at')::timestamptz)
                                then v_loc else i.last_location end
     where i.id = v_inc.id;
    return query select v_inc.id, v_inc.public_id, true, v_inc.assigned_to;
    return;
  end if;

  -- Panic pressed again for someone with a live emergency: one incident, a new timeline entry.
  select * into v_inc from public.support_incidents
   where subject_ref = p_subject_ref and status <> 'resolved' and activated_at > now() - interval '30 minutes'
   order by activated_at desc limit 1 for update;
  if found then
    if not exists (select 1 from public.support_incident_events e where e.incident_id = v_inc.id and e.detail->>'source_event_id' = v_event) then
      update public.support_incidents i
         set duplicate_count = i.duplicate_count + 1,
             last_activation_at = now(),
             last_location = case when v_loc is not null
                                   and (i.last_location is null or (v_loc->>'recorded_at')::timestamptz > (i.last_location->>'recorded_at')::timestamptz)
                                  then v_loc else i.last_location end
       where i.id = v_inc.id;
      perform public.support_incident_event(v_inc.id, null, 'repeat_activation',
        jsonb_build_object('source_event_id', v_event, 'activated_at', v_act, 'location', v_loc));
    end if;
    return query select v_inc.id, v_inc.public_id, true, v_inc.assigned_to;
    return;
  end if;

  v_code := nullif(upper(btrim(coalesce(p_identity_code, ''))), '');
  if v_code is not null and not exists (
       select 1 from public.support_identity_codes c where c.code = v_code and c.subject_ref = p_subject_ref) then
    v_code := null;                      -- a code that does not belong to this person is ignored
  end if;
  if v_code is null then
    v_code := public.support_issue_identity_code(p_subject_type, p_subject_ref);
  end if;

  v_resp := public.support_pick_responder(null);

  begin
    insert into public.support_incidents (
      source_event_id, subject_type, subject_ref, identity_code, trip_ref, booking_ref, vehicle_ref,
      activated_at, last_location, original_payload, assigned_to, next_escalation_at)
    values (
      v_event, p_subject_type, p_subject_ref, v_code, left(p_trip_ref, 100), left(p_booking_ref, 100), left(p_vehicle_ref, 100),
      v_act, v_loc, v_payload, v_resp, now() + make_interval(secs => v_set.incident_ack_seconds))
    returning * into v_inc;
  exception when unique_violation then
    select * into v_inc from public.support_incidents where source_event_id = v_event;
    return query select v_inc.id, v_inc.public_id, true, v_inc.assigned_to;
    return;
  end;

  perform public.support_incident_event(v_inc.id, null, 'triggered',
    jsonb_build_object('activated_at', v_act, 'received_at', v_inc.received_at, 'location_present', v_loc is not null));
  if v_resp is not null then
    update public.support_agents set last_assigned_at = now() where employee_id = v_resp;
    perform public.support_incident_event(v_inc.id, null, 'assigned', jsonb_build_object('to', v_resp, 'method', 'auto'));
  else
    perform public.support_incident_event(v_inc.id, null, 'no_responder_available', '{}'::jsonb);
  end if;
  perform public.support_write_audit(null, 'sos_received', 'incident', v_inc.public_id,
    jsonb_build_object('subject_type', p_subject_type, 'auto_assigned', v_resp is not null));

  return query select v_inc.id, v_inc.public_id, false, v_resp;
end;
$$;

create or replace function public.support_incident_actor_check(p_incident uuid)
returns public.support_incidents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_inc public.support_incidents%rowtype;
begin
  if not public.support_can_see_sensitive(auth.uid()) then raise exception 'your role cannot work emergencies'; end if;
  if not public.support_is_supervisor(auth.uid())
     and not exists (select 1 from public.support_agents a where a.employee_id = auth.uid() and a.enabled) then
    raise exception 'only provisioned officers can work emergencies';
  end if;
  select * into v_inc from public.support_incidents where id = p_incident for update;
  if not found then raise exception 'incident not found'; end if;
  return v_inc;
end;
$$;

create or replace function public.support_incident_acknowledge(p_incident uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_inc public.support_incidents%rowtype; v_set public.support_safety_settings%rowtype;
begin
  v_inc := public.support_incident_actor_check(p_incident);
  if v_inc.status = 'resolved' then raise exception 'incident is already resolved'; end if;
  if v_inc.acknowledged_at is not null then return; end if;          -- double click is harmless
  select * into v_set from public.support_safety_settings limit 1;
  update public.support_incidents
     set acknowledged_by = auth.uid(), acknowledged_at = now(), status = 'acknowledged',
         assigned_to = auth.uid(),
         next_escalation_at = now() + make_interval(secs => v_set.incident_followup_seconds)
   where id = p_incident;
  perform public.support_incident_event(p_incident, auth.uid(), 'acknowledged',
    jsonb_build_object('seconds_to_acknowledge', round(extract(epoch from (now() - v_inc.received_at)))::int));
  if v_inc.assigned_to is distinct from auth.uid() then
    perform public.support_incident_event(p_incident, auth.uid(), 'assigned',
      jsonb_build_object('from', v_inc.assigned_to, 'to', auth.uid(), 'method', 'acknowledged'));
  end if;
  perform public.support_write_audit(auth.uid(), 'sos_acknowledged', 'incident', v_inc.public_id, '{}'::jsonb);
end;
$$;

-- Staff-documented actions. "Emergency services contacted" is only ever recorded
-- because a person says they did it, and needs a note saying how.
create or replace function public.support_incident_log(p_incident uuid, p_kind text, p_text text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_inc public.support_incidents%rowtype; v_text text := btrim(coalesce(p_text, ''));
begin
  v_inc := public.support_incident_actor_check(p_incident);
  if p_kind not in ('note','contacted_subject','contacted_driver','contacted_emergency_services','dispatched_help') then
    raise exception 'unknown action kind';
  end if;
  if p_kind <> 'note' and length(v_text) < 10 then raise exception 'describe what was done (at least 10 characters)'; end if;
  if p_kind = 'note' and length(v_text) < 1 then raise exception 'write a note first'; end if;
  perform public.support_incident_event(p_incident, auth.uid(), p_kind, jsonb_build_object('text', left(v_text, 2000)));
  perform public.support_write_audit(auth.uid(), 'sos_' || p_kind, 'incident', v_inc.public_id, '{}'::jsonb);
end;
$$;

create or replace function public.support_incident_reassign(p_incident uuid, p_to uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_inc public.support_incidents%rowtype;
begin
  v_inc := public.support_incident_actor_check(p_incident);
  if v_inc.status = 'resolved' then raise exception 'incident is already resolved'; end if;
  if not public.support_is_supervisor(auth.uid()) and v_inc.assigned_to is distinct from auth.uid() then
    raise exception 'only the responder or a supervisor can reassign';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required'; end if;
  if not exists (select 1 from public.support_agents a where a.employee_id = p_to and a.enabled and a.role_kind <> 'watcher') then
    raise exception 'that person cannot take emergencies';
  end if;
  update public.support_incidents set assigned_to = p_to where id = p_incident;
  perform public.support_incident_event(p_incident, auth.uid(), 'assigned',
    jsonb_build_object('from', v_inc.assigned_to, 'to', p_to, 'method', 'manual', 'reason', left(btrim(p_reason), 300)));
  perform public.support_write_audit(auth.uid(), 'sos_reassigned', 'incident', v_inc.public_id, jsonb_build_object('to', p_to));
end;
$$;

create or replace function public.support_incident_resolve(p_incident uuid, p_outcome text, p_notes text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_inc public.support_incidents%rowtype;
begin
  v_inc := public.support_incident_actor_check(p_incident);
  if v_inc.status = 'resolved' then raise exception 'incident is already resolved'; end if;
  if v_inc.acknowledged_at is null then raise exception 'acknowledge the incident before resolving it'; end if;
  if not public.support_is_supervisor(auth.uid()) and v_inc.assigned_to is distinct from auth.uid() then
    raise exception 'only the responder or a supervisor can resolve';
  end if;
  if p_outcome is null or p_outcome not in ('false_alarm','assisted_on_scene','emergency_services_contacted','unreachable','other') then
    raise exception 'choose an outcome';
  end if;
  if length(btrim(coalesce(p_notes, ''))) < 10 then raise exception 'closure notes are required (at least 10 characters)'; end if;
  if p_outcome = 'emergency_services_contacted' and not exists (
       select 1 from public.support_incident_events e where e.incident_id = p_incident and e.event_type = 'contacted_emergency_services') then
    raise exception 'log the emergency services contact before choosing this outcome';
  end if;
  update public.support_incidents
     set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
         outcome = p_outcome, resolution_notes = left(btrim(p_notes), 4000), next_escalation_at = null
   where id = p_incident;
  perform public.support_incident_event(p_incident, auth.uid(), 'resolved',
    jsonb_build_object('outcome', p_outcome, 'minutes_open', round(extract(epoch from (now() - v_inc.received_at)) / 60.0, 1)));
  perform public.support_write_audit(auth.uid(), 'sos_resolved', 'incident', v_inc.public_id, jsonb_build_object('outcome', p_outcome));
end;
$$;

create or replace function public.support_incident_reopen(p_incident uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_inc public.support_incidents%rowtype; v_set public.support_safety_settings%rowtype;
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  select * into v_inc from public.support_incidents where id = p_incident for update;
  if not found then raise exception 'incident not found'; end if;
  if v_inc.status <> 'resolved' then raise exception 'incident is not resolved'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'a reason is required (at least 10 characters)'; end if;
  select * into v_set from public.support_safety_settings limit 1;
  update public.support_incidents
     set status = 'acknowledged', resolved_by = null, resolved_at = null, outcome = null, resolution_notes = null,
         next_escalation_at = now() + make_interval(secs => v_set.incident_followup_seconds)
   where id = p_incident;
  perform public.support_incident_event(p_incident, auth.uid(), 'reopened', jsonb_build_object('reason', left(btrim(p_reason), 500)));
  perform public.support_write_audit(auth.uid(), 'sos_reopened', 'incident', v_inc.public_id, '{}'::jsonb);
end;
$$;

-- Run every minute from support-maintenance.
--   unacknowledged past the threshold -> level up, try another responder
--   acknowledged but still open       -> periodic follow-up flag
--   responder went away               -> hand to someone available, or bring the next level forward
create or replace function public.support_incident_escalate_due()
returns table (incident_id uuid, incident_ref text, level integer, action text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  r public.support_incidents%rowtype;
  v_set public.support_safety_settings%rowtype;
  v_new int; v_alt uuid;
begin
  select * into v_set from public.support_safety_settings limit 1;

  -- Responder unavailable: reassign or pull the next escalation forward.
  for r in
    select i.* from public.support_incidents i
     where i.status <> 'resolved' and i.assigned_to is not null
       and not exists (
         select 1 from public.support_agent_presence p
          where p.employee_id = i.assigned_to
            and p.state in ('available','busy','on_call','wrap_up')
            and p.last_seen_at > now() - interval '120 seconds')
     for update skip locked
  loop
    v_alt := public.support_pick_responder(r.assigned_to);
    if v_alt is not null then
      update public.support_incidents set assigned_to = v_alt where id = r.id;
      update public.support_agents set last_assigned_at = now() where employee_id = v_alt;
      perform public.support_incident_event(r.id, null, 'assigned',
        jsonb_build_object('from', r.assigned_to, 'to', v_alt, 'method', 'auto', 'reason', 'responder_unavailable'));
      return query select r.id, r.public_id, r.escalation_level, 'reassigned'::text;
    elsif r.escalation_level < v_set.incident_max_level and (r.next_escalation_at is null or r.next_escalation_at > now()) then
      update public.support_incidents set next_escalation_at = now() where id = r.id;
    end if;
  end loop;

  for r in
    select i.* from public.support_incidents i
     where i.status <> 'resolved' and i.next_escalation_at is not null and i.next_escalation_at <= now()
     for update skip locked
  loop
    v_new := least(r.escalation_level + 1, v_set.incident_max_level);
    if r.acknowledged_at is null then
      v_alt := public.support_pick_responder(r.assigned_to);
      update public.support_incidents
         set escalation_level = v_new, status = 'escalated',
             assigned_to = coalesce(v_alt, r.assigned_to),
             next_escalation_at = case when v_new < v_set.incident_max_level
                                       then now() + make_interval(secs => v_set.incident_escalate_seconds) else null end
       where id = r.id;
      perform public.support_incident_event(r.id, null, 'escalated',
        jsonb_build_object('from_level', r.escalation_level, 'to_level', v_new, 'reason', 'not_acknowledged',
                           'at_max', v_new >= v_set.incident_max_level));
      if v_alt is not null and v_alt is distinct from r.assigned_to then
        perform public.support_incident_event(r.id, null, 'assigned',
          jsonb_build_object('from', r.assigned_to, 'to', v_alt, 'method', 'auto', 'reason', 'escalation'));
      end if;
      return query select r.id, r.public_id, v_new, 'escalated'::text;
    else
      update public.support_incidents
         set escalation_level = v_new,
             next_escalation_at = now() + make_interval(secs => v_set.incident_followup_seconds)
       where id = r.id;
      perform public.support_incident_event(r.id, null, 'followup_due',
        jsonb_build_object('to_level', v_new, 'reason', 'acknowledged_but_open'));
      return query select r.id, r.public_id, v_new, 'followup'::text;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Location sessions
-- ---------------------------------------------------------------------------

create table if not exists public.support_location_sessions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  incident_id uuid references public.support_incidents(id),
  subject_type text not null check (subject_type in ('rider','driver')),
  subject_ref uuid not null,
  identity_code text,
  requested_by uuid not null references public.employee_profiles(id),
  reason text not null check (length(btrim(reason)) >= 10),
  status text not null default 'active' check (status in ('pending_approval','active','denied','ended','expired')),
  approved_by uuid references public.employee_profiles(id) on delete set null,
  approved_at timestamptz,
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  check ((ticket_id is not null) or (incident_id is not null))
);
create index if not exists support_location_sessions_actor_idx on public.support_location_sessions (requested_by, status);
create index if not exists support_location_sessions_case_idx on public.support_location_sessions (ticket_id, incident_id);

create table if not exists public.support_location_access_log (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.support_location_sessions(id) on delete cascade,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  outcome text not null check (outcome in ('served','stale','unavailable','not_configured','denied')),
  age_seconds integer,
  created_at timestamptz not null default now()
);
create index if not exists support_location_access_log_session_idx on public.support_location_access_log (session_id, created_at desc);
create index if not exists support_location_access_log_time_idx on public.support_location_access_log (created_at);

create or replace function public.support_request_location(p_ticket uuid, p_incident uuid, p_identity_code text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_set public.support_safety_settings%rowtype;
  v_sup boolean; v_inc public.support_incidents%rowtype; v_ticket public.support_tickets%rowtype;
  v_rec public.support_identity_codes%rowtype;
  v_type text; v_ref uuid; v_code text; v_existing public.support_location_sessions%rowtype;
  v_pending boolean; v_id uuid; v_exp timestamptz; v_open int;
begin
  if not public.support_can_see_sensitive(auth.uid()) then raise exception 'location access is not permitted for your role'; end if;
  if (p_ticket is null) = (p_incident is null) then raise exception 'link exactly one case or one emergency'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'a reason of at least 10 characters is required'; end if;
  v_sup := public.support_is_supervisor(auth.uid());
  if not v_sup and not exists (select 1 from public.support_agents a where a.employee_id = auth.uid() and a.enabled) then
    raise exception 'only provisioned officers can open location sessions';
  end if;
  select * into v_set from public.support_safety_settings limit 1;

  if p_incident is not null then
    select * into v_inc from public.support_incidents where id = p_incident;
    if not found then raise exception 'incident not found'; end if;
    if v_inc.status = 'resolved' then raise exception 'incident is already resolved'; end if;
    v_type := v_inc.subject_type; v_ref := v_inc.subject_ref; v_code := v_inc.identity_code;
  else
    select * into v_ticket from public.support_tickets where id = p_ticket;
    if not found then raise exception 'ticket not found'; end if;
    if v_ticket.status in ('resolved','closed') then raise exception 'the case is closed'; end if;
    if not v_sup and v_ticket.assigned_agent_id is distinct from auth.uid() then
      raise exception 'only the officer handling this case, or a supervisor, can open a location session';
    end if;
    select * into v_rec from public.support_identity_codes where code = upper(btrim(coalesce(p_identity_code, ''))) and status = 'active';
    if not found then raise exception 'a valid identity code is required'; end if;
    v_type := v_rec.subject_type; v_ref := v_rec.subject_ref; v_code := v_rec.code;
  end if;

  select * into v_existing from public.support_location_sessions s
   where s.requested_by = auth.uid() and s.subject_ref = v_ref
     and s.status in ('active','pending_approval') and s.expires_at > now()
     and s.ticket_id is not distinct from p_ticket and s.incident_id is not distinct from p_incident
   limit 1;
  if found then
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'expires_at', v_existing.expires_at, 'existing', true);
  end if;

  select count(*) into v_open from public.support_location_sessions s
   where s.requested_by = auth.uid() and s.status in ('active','pending_approval') and s.expires_at > now();
  if v_open >= v_set.location_max_active_per_officer then
    raise exception 'too many open location sessions, end one first';
  end if;

  -- Emergencies are never held up by approval. Ordinary cases may be, by policy.
  v_pending := p_incident is null and v_set.location_requires_approval and not v_sup;
  v_exp := now() + make_interval(mins => case when v_pending then 15 else v_set.location_session_minutes end);

  insert into public.support_location_sessions (ticket_id, incident_id, subject_type, subject_ref, identity_code, requested_by,
                                                 reason, status, approved_by, approved_at, expires_at)
  values (p_ticket, p_incident, v_type, v_ref, v_code, auth.uid(), btrim(p_reason),
          case when v_pending then 'pending_approval' else 'active' end,
          case when v_pending then null else auth.uid() end, case when v_pending then null else now() end, v_exp)
  returning id into v_id;

  perform public.support_write_audit(auth.uid(), 'location_session_requested', 'location_session', v_id::text,
    jsonb_build_object('ticket_id', p_ticket, 'incident_id', p_incident, 'subject_type', v_type,
                       'needs_approval', v_pending, 'reason', left(btrim(p_reason), 300)));
  return jsonb_build_object('id', v_id, 'status', case when v_pending then 'pending_approval' else 'active' end, 'expires_at', v_exp);
end;
$$;

create or replace function public.support_decide_location(p_session uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_s public.support_location_sessions%rowtype; v_set public.support_safety_settings%rowtype;
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  select * into v_s from public.support_location_sessions where id = p_session for update;
  if not found then raise exception 'session not found'; end if;
  if v_s.status <> 'pending_approval' then raise exception 'this request is no longer waiting for approval'; end if;
  if v_s.requested_by = auth.uid() then raise exception 'you cannot approve your own request'; end if;
  if v_s.expires_at <= now() then raise exception 'this request has expired, ask the officer to request again'; end if;
  select * into v_set from public.support_safety_settings limit 1;
  if p_approve then
    update public.support_location_sessions
       set status = 'active', approved_by = auth.uid(), approved_at = now(),
           expires_at = now() + make_interval(mins => v_set.location_session_minutes)
     where id = p_session;
  else
    update public.support_location_sessions
       set status = 'denied', ended_at = now(), end_reason = left(btrim(coalesce(p_note, 'denied')), 200)
     where id = p_session;
  end if;
  perform public.support_write_audit(auth.uid(), case when p_approve then 'location_session_approved' else 'location_session_denied' end,
    'location_session', p_session::text, jsonb_build_object('requested_by', v_s.requested_by));
end;
$$;

create or replace function public.support_end_location(p_session uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_s public.support_location_sessions%rowtype;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select * into v_s from public.support_location_sessions where id = p_session for update;
  if not found then raise exception 'session not found'; end if;
  if v_s.requested_by <> auth.uid() and not public.support_is_supervisor(auth.uid()) then
    raise exception 'only the requester or a supervisor can end this session';
  end if;
  if v_s.status not in ('active','pending_approval') then return; end if;
  update public.support_location_sessions
     set status = 'ended', ended_at = now(),
         end_reason = left(coalesce(nullif(btrim(p_reason), ''), case when v_s.requested_by = auth.uid() then 'ended by officer' else 'revoked by supervisor' end), 200)
   where id = p_session;
  perform public.support_write_audit(auth.uid(), 'location_session_ended', 'location_session', p_session::text,
    jsonb_build_object('revoked', v_s.requested_by <> auth.uid()));
end;
$$;

-- Called by the support-location function on every fetch. Returns a verdict
-- instead of raising so the caller can log the refusal.
create or replace function public.support_location_gate(p_session uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_s public.support_location_sessions%rowtype; v_set public.support_safety_settings%rowtype; v_recent int; v_open boolean;
begin
  select * into v_s from public.support_location_sessions where id = p_session for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_s.requested_by is distinct from p_actor then return jsonb_build_object('ok', false, 'reason', 'not_your_session'); end if;
  if not public.support_can_see_sensitive(p_actor) then return jsonb_build_object('ok', false, 'reason', 'role_not_permitted'); end if;
  if v_s.status = 'pending_approval' then return jsonb_build_object('ok', false, 'reason', 'awaiting_approval'); end if;
  if v_s.status <> 'active' then return jsonb_build_object('ok', false, 'reason', v_s.status); end if;
  if v_s.expires_at <= now() then
    update public.support_location_sessions set status = 'expired', ended_at = now(), end_reason = 'time limit reached' where id = p_session;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_s.incident_id is not null then
    select status <> 'resolved' into v_open from public.support_incidents where id = v_s.incident_id;
  else
    select status not in ('resolved','closed') into v_open from public.support_tickets where id = v_s.ticket_id;
  end if;
  if v_open is not true then
    update public.support_location_sessions set status = 'ended', ended_at = now(), end_reason = 'case closed' where id = p_session;
    return jsonb_build_object('ok', false, 'reason', 'case_closed');
  end if;
  select count(*) into v_recent from public.support_location_access_log where session_id = p_session and created_at > now() - interval '60 seconds';
  if v_recent >= 30 then return jsonb_build_object('ok', false, 'reason', 'rate_limited'); end if;
  select * into v_set from public.support_safety_settings limit 1;
  return jsonb_build_object('ok', true, 'subject_type', v_s.subject_type, 'subject_ref', v_s.subject_ref,
                            'ticket_id', v_s.ticket_id, 'incident_id', v_s.incident_id,
                            'expires_at', v_s.expires_at, 'fresh_seconds', v_set.location_fresh_seconds);
end;
$$;

create or replace function public.support_location_log(p_session uuid, p_actor uuid, p_outcome text, p_age integer default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare first_view boolean;
begin
  if p_outcome not in ('served','stale','unavailable','not_configured','denied') then raise exception 'bad outcome'; end if;
  if not exists (select 1 from public.support_location_sessions where id = p_session) then return; end if;
  first_view := p_outcome in ('served','stale')
    and not exists (select 1 from public.support_location_access_log where session_id = p_session and outcome in ('served','stale'));
  insert into public.support_location_access_log (session_id, actor_id, outcome, age_seconds)
  values (p_session, p_actor, p_outcome, p_age);
  if first_view or p_outcome = 'denied' then
    perform public.support_write_audit(p_actor, case when p_outcome = 'denied' then 'location_denied' else 'location_viewed' end,
      'location_session', p_session::text, jsonb_build_object('outcome', p_outcome));
  end if;
end;
$$;

-- Expire stale sessions, drop old access logs. Called from support-maintenance.
create or replace function public.support_location_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_set public.support_safety_settings%rowtype; v_exp int; v_purged int;
begin
  select * into v_set from public.support_safety_settings limit 1;
  update public.support_location_sessions
     set status = 'expired', ended_at = now(), end_reason = 'time limit reached'
   where status in ('active','pending_approval') and expires_at <= now();
  get diagnostics v_exp = row_count;
  delete from public.support_location_access_log where created_at < now() - make_interval(days => v_set.location_log_retention_days);
  get diagnostics v_purged = row_count;
  return jsonb_build_object('expired', v_exp, 'access_rows_purged', v_purged);
end;
$$;

-- Access ends when the case ends.
create or replace function public.support_close_location_on_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('resolved','closed') and old.status is distinct from new.status then
    update public.support_location_sessions
       set status = 'ended', ended_at = now(), end_reason = 'case closed'
     where ticket_id = new.id and status in ('active','pending_approval');
  end if;
  return new;
end;
$$;
drop trigger if exists support_close_location_on_ticket on public.support_tickets;
create trigger support_close_location_on_ticket after update of status on public.support_tickets
  for each row execute function public.support_close_location_on_ticket();

create or replace function public.support_close_location_on_incident()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'resolved' and old.status is distinct from new.status then
    update public.support_location_sessions
       set status = 'ended', ended_at = now(), end_reason = 'incident resolved'
     where incident_id = new.id and status in ('active','pending_approval');
  end if;
  return new;
end;
$$;
drop trigger if exists support_close_location_on_incident on public.support_incidents;
create trigger support_close_location_on_incident after update of status on public.support_incidents
  for each row execute function public.support_close_location_on_incident();

-- ---------------------------------------------------------------------------
-- 7. Incident views and detail
-- ---------------------------------------------------------------------------

drop view if exists public.support_incident_board_view;
create view public.support_incident_board_view as
select
  i.id, i.public_id, i.status, i.subject_type, i.activated_at, i.received_at, i.last_activation_at,
  i.escalation_level, i.next_escalation_at, i.acknowledged_at, i.resolved_at, i.outcome, i.duplicate_count,
  i.assigned_to, ap.full_name as assigned_name,
  i.acknowledged_by, kp.full_name as acknowledged_name,
  s.ok as detail_visible,
  case when s.ok then i.identity_code end as identity_code,
  case when s.ok then i.trip_ref end as trip_ref,
  case when s.ok then i.booking_ref end as booking_ref,
  case when s.ok then i.vehicle_ref end as vehicle_ref,
  case when s.ok then i.last_location end as last_location,
  case when s.ok and i.last_location is not null
       then round(extract(epoch from (now() - (i.last_location->>'recorded_at')::timestamptz)))::int end as location_age_seconds,
  (select location_fresh_seconds from public.support_safety_settings limit 1) as location_fresh_seconds
from public.support_incidents i
cross join lateral (select public.support_can_see_sensitive(auth.uid()) as ok) s
left join public.employee_profiles ap on ap.id = i.assigned_to
left join public.employee_profiles kp on kp.id = i.acknowledged_by
where public.support_is_staff(auth.uid());

create or replace function public.support_incident_detail(p_incident uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_inc public.support_incidents%rowtype; v_out jsonb;
begin
  if not public.support_can_see_sensitive(auth.uid()) then raise exception 'your role cannot open emergencies'; end if;
  select * into v_inc from public.support_incidents where id = p_incident;
  if not found then return null; end if;
  select jsonb_build_object(
    'incident', to_jsonb(v_inc) - 'original_payload' - 'source_event_id',
    'original_payload', case when public.support_is_supervisor(auth.uid()) then v_inc.original_payload end,
    'assigned_name', (select full_name from public.employee_profiles where id = v_inc.assigned_to),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'detail', e.detail,
                                         'actor_name', ep.full_name, 'created_at', e.created_at) order by e.created_at, e.id), '[]'::jsonb)
                 from public.support_incident_events e left join public.employee_profiles ep on ep.id = e.actor_id
                where e.incident_id = p_incident),
    'location_sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'expires_at', s.expires_at,
                                         'requested_by', s.requested_by, 'requester_name', sp.full_name) order by s.created_at desc), '[]'::jsonb)
                 from public.support_location_sessions s join public.employee_profiles sp on sp.id = s.requested_by
                where s.incident_id = p_incident and s.status in ('active','pending_approval') and s.expires_at > now()
                  and (s.requested_by = auth.uid() or public.support_is_supervisor(auth.uid())))
  ) into v_out;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Settings, audit search, exports, reports
-- ---------------------------------------------------------------------------

create or replace function public.support_update_safety_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.support_safety_settings%rowtype;
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'send an object of settings'; end if;
  update public.support_safety_settings set
    location_session_minutes = coalesce((p_patch->>'location_session_minutes')::int, location_session_minutes),
    location_requires_approval = coalesce((p_patch->>'location_requires_approval')::boolean, location_requires_approval),
    location_max_active_per_officer = coalesce((p_patch->>'location_max_active_per_officer')::int, location_max_active_per_officer),
    location_fresh_seconds = coalesce((p_patch->>'location_fresh_seconds')::int, location_fresh_seconds),
    location_log_retention_days = coalesce((p_patch->>'location_log_retention_days')::int, location_log_retention_days),
    identity_lookups_per_10min = coalesce((p_patch->>'identity_lookups_per_10min')::int, identity_lookups_per_10min),
    identity_failed_per_10min = coalesce((p_patch->>'identity_failed_per_10min')::int, identity_failed_per_10min),
    incident_ack_seconds = coalesce((p_patch->>'incident_ack_seconds')::int, incident_ack_seconds),
    incident_escalate_seconds = coalesce((p_patch->>'incident_escalate_seconds')::int, incident_escalate_seconds),
    incident_followup_seconds = coalesce((p_patch->>'incident_followup_seconds')::int, incident_followup_seconds),
    incident_max_level = coalesce((p_patch->>'incident_max_level')::int, incident_max_level),
    updated_at = now()
  returning * into v_row;
  perform public.support_write_audit(auth.uid(), 'safety_settings_updated', 'safety_settings', 'singleton', p_patch);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.support_audit_search(
  p_action text default null, p_actor uuid default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 200
)
returns table (id bigint, created_at timestamptz, actor_id uuid, actor_name text, action text, entity_type text, entity_id text, payload jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  return query
    select a.id, a.created_at, a.actor_id, ep.full_name, a.action, a.entity_type, a.entity_id, a.payload
      from public.support_audit_log a
      left join public.employee_profiles ep on ep.id = a.actor_id
     where (p_action is null or p_action = '' or a.action ilike '%' || p_action || '%')
       and (p_actor is null or a.actor_id = p_actor)
       and (p_from is null or a.created_at >= p_from)
       and (p_to is null or a.created_at < p_to)
     order by a.created_at desc, a.id desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

create or replace function public.support_log_export(p_kind text, p_rows integer default 0)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  perform public.support_write_audit(auth.uid(), 'export', 'export', left(coalesce(p_kind, 'unknown'), 60),
    jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)));
end;
$$;

create or replace function public.support_report_summary(
  p_from timestamptz default null, p_to timestamptz default null, p_agent uuid default null, p_category text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_from timestamptz; v_to timestamptz; v_out jsonb;
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  v_to := coalesce(p_to, now());
  v_from := coalesce(p_from, v_to - interval '7 days');
  if v_from >= v_to then raise exception 'the start of the range must be before the end'; end if;
  if v_to - v_from > interval '366 days' then raise exception 'ranges longer than 366 days are not supported'; end if;

  with t as (
    select x.* from public.support_tickets x
     where x.created_at >= v_from and x.created_at < v_to
       and (p_agent is null or x.assigned_agent_id = p_agent)
       and (p_category is null or p_category = '' or x.category = p_category)
  ), sc as (
    select e.ticket_id, e.created_at, e.payload->>'to' as to_status,
           lead(e.created_at) over (partition by e.ticket_id order by e.created_at, e.id) as next_at
      from public.support_ticket_events e join t on t.id = e.ticket_id
     where e.event_type = 'status_changed'
  ), wait as (
    select sc.ticket_id,
           sum(extract(epoch from (coalesce(sc.next_at, coalesce(t.resolved_at, now())) - sc.created_at))) as secs
      from sc join t on t.id = sc.ticket_id
     where sc.to_status = 'waiting_customer'
     group by sc.ticket_id
  ), esc as (
    select distinct e.ticket_id from public.support_ticket_events e join t on t.id = e.ticket_id
     where e.event_type = 'status_changed' and e.payload->>'to' = 'escalated'
  ), inc as (
    select * from public.support_incidents where activated_at >= v_from and activated_at < v_to
  ), loc as (
    select l.outcome from public.support_location_access_log l where l.created_at >= v_from and l.created_at < v_to
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'cases', jsonb_build_object(
      'total', (select count(*) from t),
      'open', (select count(*) from t where status not in ('resolved','closed')),
      'resolved', (select count(*) from t where status in ('resolved','closed')),
      'reopened', (select count(*) from t where reopen_count > 0),
      'escalated', (select count(*) from esc),
      'avg_first_response_minutes', (select round(avg(extract(epoch from (first_responded_at - created_at))) / 60.0, 1) from t where first_responded_at is not null),
      'avg_resolution_minutes', (select round(avg(extract(epoch from (resolved_at - created_at))) / 60.0, 1) from t where resolved_at is not null),
      'avg_waiting_minutes', (select round(avg(w.secs) / 60.0, 1) from wait w join t on t.id = w.ticket_id where t.resolved_at is not null),
      'avg_active_minutes', (select round(avg(extract(epoch from (t.resolved_at - t.created_at)) - coalesce(w.secs, 0)) / 60.0, 1)
                               from t left join wait w on w.ticket_id = t.id where t.resolved_at is not null),
      'first_response_sla_pct', (select round(100.0 * count(*) filter (where first_responded_at is not null and first_responded_at <= first_response_due_at)
                                              / nullif(count(*) filter (where first_response_due_at is not null and (first_responded_at is not null or first_response_due_at < now())), 0), 1) from t),
      'resolution_sla_pct', (select round(100.0 * count(*) filter (where resolved_at is not null and resolved_at <= resolution_due_at)
                                          / nullif(count(*) filter (where resolution_due_at is not null and (resolved_at is not null or resolution_due_at < now())), 0), 1) from t)
    ),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'total', c.total, 'open', c.open_n, 'resolved', c.res_n) order by c.total desc), '[]'::jsonb)
                      from (select category, count(*) as total,
                                   count(*) filter (where status not in ('resolved','closed')) as open_n,
                                   count(*) filter (where status in ('resolved','closed')) as res_n
                              from t group by category) c),
    'by_priority', (select coalesce(jsonb_agg(jsonb_build_object('priority', c.priority, 'total', c.total) order by c.priority), '[]'::jsonb)
                      from (select priority, count(*) as total from t group by priority) c),
    'by_agent', (select coalesce(jsonb_agg(jsonb_build_object('employee_id', c.employee_id, 'name', c.name, 'handled', c.handled,
                                                               'resolved', c.resolved_n, 'avg_resolution_minutes', c.avg_res) order by c.handled desc), '[]'::jsonb)
                   from (select t.assigned_agent_id as employee_id, ep.full_name as name, count(*) as handled,
                                count(*) filter (where t.resolved_at is not null) as resolved_n,
                                round(avg(extract(epoch from (t.resolved_at - t.created_at))) filter (where t.resolved_at is not null) / 60.0, 1) as avg_res
                           from t join public.employee_profiles ep on ep.id = t.assigned_agent_id
                          group by t.assigned_agent_id, ep.full_name) c),
    'queue_aging_now', (select jsonb_build_object('unassigned', count(*),
                               'oldest_minutes', coalesce(round(max(extract(epoch from (now() - created_at))) / 60.0), 0))
                          from public.support_tickets where assigned_agent_id is null and status not in ('resolved','closed')),
    'emergencies', jsonb_build_object(
      'total', (select count(*) from inc),
      'unresolved', (select count(*) from inc where status <> 'resolved'),
      'escalated', (select count(*) from inc where escalation_level > 0),
      'avg_seconds_to_acknowledge', (select round(avg(extract(epoch from (acknowledged_at - received_at)))) from inc where acknowledged_at is not null),
      'max_seconds_to_acknowledge', (select round(max(extract(epoch from (acknowledged_at - received_at)))) from inc where acknowledged_at is not null),
      'avg_minutes_to_resolve', (select round(avg(extract(epoch from (resolved_at - received_at))) / 60.0, 1) from inc where resolved_at is not null)),
    'location', jsonb_build_object(
      'sessions', (select count(*) from public.support_location_sessions where created_at >= v_from and created_at < v_to),
      'fetches', (select count(*) from loc),
      'served', (select count(*) from loc where outcome = 'served'),
      'stale', (select count(*) from loc where outcome = 'stale'),
      'unavailable', (select count(*) from loc where outcome in ('unavailable','not_configured')),
      'availability_pct', (select round(100.0 * count(*) filter (where outcome in ('served','stale')) / nullif(count(*) filter (where outcome <> 'denied'), 0), 1) from loc))
  ) into v_out;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Row level security, grants, realtime
-- ---------------------------------------------------------------------------

do $$
declare n text;
begin
  foreach n in array array[
    'support_safety_settings','support_ticket_watchers','support_identity_codes','support_identity_lookups',
    'support_incidents','support_incident_events','support_location_sessions','support_location_access_log'
  ] loop
    execute format('alter table public.%I enable row level security', n);
    execute format('revoke all on table public.%I from public, anon, authenticated', n);
    execute format('grant all on table public.%I to service_role', n);
  end loop;
end $$;

drop policy if exists support_staff_read on public.support_safety_settings;
create policy support_staff_read on public.support_safety_settings for select to authenticated using (public.support_is_staff(auth.uid()));
grant select on public.support_safety_settings to authenticated;

drop policy if exists support_staff_read on public.support_ticket_watchers;
create policy support_staff_read on public.support_ticket_watchers for select to authenticated using (public.support_is_staff(auth.uid()));
grant select on public.support_ticket_watchers to authenticated;

drop policy if exists support_supervisor_read on public.support_identity_lookups;
create policy support_supervisor_read on public.support_identity_lookups for select to authenticated using (public.support_is_supervisor(auth.uid()));
grant select on public.support_identity_lookups to authenticated;

drop policy if exists support_sensitive_read on public.support_incidents;
create policy support_sensitive_read on public.support_incidents for select to authenticated using (public.support_can_see_sensitive(auth.uid()));
grant select on public.support_incidents to authenticated;

drop policy if exists support_sensitive_read on public.support_incident_events;
create policy support_sensitive_read on public.support_incident_events for select to authenticated using (public.support_can_see_sensitive(auth.uid()));
grant select on public.support_incident_events to authenticated;

drop policy if exists support_own_or_supervisor_read on public.support_location_sessions;
create policy support_own_or_supervisor_read on public.support_location_sessions for select to authenticated
  using (requested_by = auth.uid() or public.support_is_supervisor(auth.uid()));
grant select on public.support_location_sessions to authenticated;

drop policy if exists support_supervisor_read on public.support_location_access_log;
create policy support_supervisor_read on public.support_location_access_log for select to authenticated using (public.support_is_supervisor(auth.uid()));
grant select on public.support_location_access_log to authenticated;

revoke all on public.support_incident_board_view from public, anon, authenticated;
grant select on public.support_incident_board_view to authenticated, service_role;

revoke all on sequence public.support_incident_number_seq from public, anon, authenticated;
grant usage, select on sequence public.support_incident_number_seq to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_incidents') then
    alter publication supabase_realtime add table public.support_incidents;
  end if;
end $$;

-- Functions the signed-in browser may call (each checks the caller itself).
revoke all on function public.support_can_see_sensitive(uuid) from public, anon;
revoke all on function public.support_watch_ticket(uuid,uuid) from public, anon;
revoke all on function public.support_unwatch_ticket(uuid,uuid) from public, anon;
revoke all on function public.support_lookup_identity(text,text) from public, anon;
revoke all on function public.support_incident_acknowledge(uuid) from public, anon;
revoke all on function public.support_incident_log(uuid,text,text) from public, anon;
revoke all on function public.support_incident_reassign(uuid,uuid,text) from public, anon;
revoke all on function public.support_incident_resolve(uuid,text,text) from public, anon;
revoke all on function public.support_incident_reopen(uuid,text) from public, anon;
revoke all on function public.support_incident_detail(uuid) from public, anon;
revoke all on function public.support_request_location(uuid,uuid,text,text) from public, anon;
revoke all on function public.support_decide_location(uuid,boolean,text) from public, anon;
revoke all on function public.support_end_location(uuid,text) from public, anon;
revoke all on function public.support_update_safety_settings(jsonb) from public, anon;
revoke all on function public.support_audit_search(text,uuid,timestamptz,timestamptz,integer) from public, anon;
revoke all on function public.support_log_export(text,integer) from public, anon;
revoke all on function public.support_report_summary(timestamptz,timestamptz,uuid,text) from public, anon;

grant execute on function public.support_can_see_sensitive(uuid) to authenticated, service_role;
grant execute on function public.support_watch_ticket(uuid,uuid) to authenticated;
grant execute on function public.support_unwatch_ticket(uuid,uuid) to authenticated;
grant execute on function public.support_lookup_identity(text,text) to authenticated;
grant execute on function public.support_incident_acknowledge(uuid) to authenticated;
grant execute on function public.support_incident_log(uuid,text,text) to authenticated;
grant execute on function public.support_incident_reassign(uuid,uuid,text) to authenticated;
grant execute on function public.support_incident_resolve(uuid,text,text) to authenticated;
grant execute on function public.support_incident_reopen(uuid,text) to authenticated;
grant execute on function public.support_incident_detail(uuid) to authenticated;
grant execute on function public.support_request_location(uuid,uuid,text,text) to authenticated;
grant execute on function public.support_decide_location(uuid,boolean,text) to authenticated;
grant execute on function public.support_end_location(uuid,text) to authenticated;
grant execute on function public.support_update_safety_settings(jsonb) to authenticated;
grant execute on function public.support_audit_search(text,uuid,timestamptz,timestamptz,integer) to authenticated;
grant execute on function public.support_log_export(text,integer) to authenticated;
grant execute on function public.support_report_summary(timestamptz,timestamptz,uuid,text) to authenticated;

-- Internal or service-only: nothing a browser can reach.
revoke all on function public.support_agents_role_guard() from public, anon, authenticated;
revoke all on function public.support_agents_role_audit() from public, anon, authenticated;
revoke all on function public.support_generate_identity_code(text) from public, anon, authenticated;
revoke all on function public.support_issue_identity_code(text,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.support_mask_phone(text) from public, anon, authenticated;
revoke all on function public.support_mask_email(text) from public, anon, authenticated;
revoke all on function public.support_incident_protect() from public, anon, authenticated;
revoke all on function public.support_incident_events_append_only() from public, anon, authenticated;
revoke all on function public.support_incident_event(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.support_pick_responder(uuid) from public, anon, authenticated;
revoke all on function public.support_sos_ingest(text,text,uuid,text,text,text,text,timestamptz,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.support_incident_actor_check(uuid) from public, anon, authenticated;
revoke all on function public.support_incident_escalate_due() from public, anon, authenticated;
revoke all on function public.support_location_gate(uuid,uuid) from public, anon, authenticated;
revoke all on function public.support_location_log(uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.support_location_sweep() from public, anon, authenticated;
revoke all on function public.support_close_location_on_ticket() from public, anon, authenticated;
revoke all on function public.support_close_location_on_incident() from public, anon, authenticated;

grant execute on function public.support_issue_identity_code(text,uuid,uuid,uuid) to service_role;
grant execute on function public.support_pick_responder(uuid) to service_role;
grant execute on function public.support_sos_ingest(text,text,uuid,text,text,text,text,timestamptz,jsonb,jsonb) to service_role;
grant execute on function public.support_incident_escalate_due() to service_role;
grant execute on function public.support_location_gate(uuid,uuid) to service_role;
grant execute on function public.support_location_log(uuid,uuid,text,integer) to service_role;
grant execute on function public.support_location_sweep() to service_role;

commit;
