-- PArAsYtE | RA-Workspace support module
-- RA Support Command Centre: voice, TaskRouter bookkeeping, callbacks,
-- outbound dialling policy and supervisor KPIs. Idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.support_calls (
  id uuid primary key default gen_random_uuid(),
  interaction_id uuid unique references public.support_interactions(id) on delete cascade,
  ticket_id uuid references public.support_tickets(id) on delete set null,
  provider_call_id text unique,
  direction text check (direction is null or direction in ('inbound','outbound')),
  from_number text,
  to_number text,
  status text not null default 'queued',
  assigned_agent_id uuid references public.support_agents(employee_id) on delete set null,
  ringing_agent_id uuid references public.support_agents(employee_id) on delete set null,
  ring_started_at timestamptz,
  provider_task_id text,
  queue_name text,
  ivr_choice text,
  caller_hidden boolean not null default false,
  abandoned boolean not null default false,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  wait_seconds integer check (wait_seconds is null or wait_seconds >= 0),
  disposition text,
  recording_sid text,
  recording_path text,
  transcript_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.support_calls add column if not exists direction text;
alter table public.support_calls add column if not exists ringing_agent_id uuid references public.support_agents(employee_id) on delete set null;
alter table public.support_calls add column if not exists ring_started_at timestamptz;
alter table public.support_calls add column if not exists provider_task_id text;
alter table public.support_calls add column if not exists queue_name text;
alter table public.support_calls add column if not exists ivr_choice text;
alter table public.support_calls add column if not exists caller_hidden boolean not null default false;
alter table public.support_calls add column if not exists abandoned boolean not null default false;
alter table public.support_calls add column if not exists duration_seconds integer;
alter table public.support_calls add column if not exists wait_seconds integer;
alter table public.support_calls add column if not exists disposition text;
alter table public.support_calls add column if not exists recording_sid text;
alter table public.support_calls add column if not exists updated_at timestamptz not null default now();
create index if not exists support_calls_provider_task_idx on public.support_calls (provider_task_id);
create index if not exists support_calls_status_created_idx on public.support_calls (status, created_at desc);
create index if not exists support_calls_ringing_idx on public.support_calls (ringing_agent_id, ring_started_at desc) where ringing_agent_id is not null;

create table if not exists public.support_call_events (
  id bigint generated always as identity primary key,
  call_id uuid references public.support_calls(id) on delete cascade,
  provider_call_id text,
  provider_event_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider_event_id)
);
create index if not exists support_call_events_call_idx on public.support_call_events (call_id, occurred_at);

create table if not exists public.support_provider_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_key text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (provider, event_key)
);
alter table public.support_provider_events add column if not exists attempts integer not null default 0;
create index if not exists support_provider_events_unprocessed_idx
  on public.support_provider_events (provider, received_at) where processed_at is null;

create table if not exists public.support_agent_voice_devices (
  employee_id uuid primary key references public.support_agents(employee_id) on delete cascade,
  provider text not null default 'twilio',
  client_identity text not null unique,
  registered boolean not null default false,
  last_registered_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.support_voice_settings (
  id boolean primary key default true check (id),
  provider text not null default 'twilio',
  caller_id text,
  recording_enabled boolean not null default false,
  recording_consent_mode text not null default 'announcement'
    check (recording_consent_mode in ('announcement','agent_confirm','disabled')),
  callback_enabled boolean not null default true,
  callback_offer_after_seconds integer not null default 180
    check (callback_offer_after_seconds between 0 and 3600),
  max_queue_wait_seconds integer not null default 1800
    check (max_queue_wait_seconds between 30 and 7200),
  ivr_enabled boolean not null default false,
  greeting_text text not null default 'Thank you for calling RideArrivo Support.',
  hold_message_text text not null default 'All of our support officers are helping other customers. Please stay on the line and we will be with you shortly.',
  wrap_up_seconds integer not null default 30 check (wrap_up_seconds between 0 and 600),
  outbound_limit_per_10min integer not null default 30 check (outbound_limit_per_10min between 1 and 500),
  updated_at timestamptz not null default now()
);
alter table public.support_voice_settings add column if not exists ivr_enabled boolean not null default false;
alter table public.support_voice_settings add column if not exists greeting_text text not null default 'Thank you for calling RideArrivo Support.';
alter table public.support_voice_settings add column if not exists hold_message_text text not null default 'All of our support officers are helping other customers. Please stay on the line and we will be with you shortly.';
alter table public.support_voice_settings add column if not exists wrap_up_seconds integer not null default 30;
alter table public.support_voice_settings add column if not exists outbound_limit_per_10min integer not null default 30;
insert into public.support_voice_settings (id) values (true) on conflict (id) do nothing;

-- Outbound dialling policy. Longest matching prefix wins. No match means deny.
-- This is the control that stops a compromised account, or a mistyped number,
-- from running up premium-rate or high-fraud destinations.
create table if not exists public.support_dial_rules (
  prefix text primary key check (prefix ~ '^\+[0-9]{1,8}$'),
  action text not null check (action in ('allow','deny')),
  note text,
  updated_at timestamptz not null default now()
);
insert into public.support_dial_rules (prefix, action, note) values
  ('+234','allow','Nigeria'),
  ('+233','allow','Ghana'),
  ('+27','allow','South Africa'),
  ('+254','allow','Kenya'),
  ('+44','allow','United Kingdom'),
  ('+353','allow','Ireland'),
  ('+1','allow','United States and Canada'),
  ('+971','allow','United Arab Emirates'),
  ('+49','allow','Germany'),
  ('+33','allow','France'),
  ('+31','allow','Netherlands'),
  ('+449','deny','UK premium rate 09'),
  ('+44870','deny','UK non-geographic 0870'),
  ('+44871','deny','UK non-geographic 0871'),
  ('+44872','deny','UK non-geographic 0872'),
  ('+44873','deny','UK non-geographic 0873'),
  ('+4470','deny','UK personal numbering 070'),
  ('+1900','deny','US premium rate'),
  ('+1976','deny','US premium rate'),
  ('+1809','deny','Caribbean fraud-prone'),
  ('+1829','deny','Caribbean fraud-prone'),
  ('+1849','deny','Caribbean fraud-prone'),
  ('+1876','deny','Caribbean fraud-prone')
on conflict (prefix) do nothing;

create table if not exists public.support_callbacks (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  call_id uuid references public.support_calls(id) on delete set null,
  phone_number text not null,
  origin text not null default 'agent' check (origin in ('agent','missed_call','queue_offer')),
  requested_at timestamptz not null default now(),
  not_before timestamptz,
  status text not null default 'queued'
    check (status in ('scheduled','queued','reserved','calling','completed','failed','cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  last_error text,
  assigned_agent_id uuid references public.support_agents(employee_id) on delete set null,
  provider_task_id text,
  completed_at timestamptz
);
alter table public.support_callbacks add column if not exists call_id uuid references public.support_calls(id) on delete set null;
alter table public.support_callbacks add column if not exists origin text not null default 'agent';
alter table public.support_callbacks add column if not exists attempts integer not null default 0;
alter table public.support_callbacks add column if not exists max_attempts integer not null default 3;
alter table public.support_callbacks add column if not exists last_error text;
alter table public.support_callbacks drop constraint if exists support_callbacks_status_check;
alter table public.support_callbacks add constraint support_callbacks_status_check
  check (status in ('scheduled','queued','reserved','calling','completed','failed','cancelled'));
create index if not exists support_callbacks_queue_idx on public.support_callbacks (status, requested_at);
create index if not exists support_callbacks_phone_idx on public.support_callbacks (phone_number, requested_at desc);

-- ---------------------------------------------------------------------------
-- 2. Service-only functions
-- ---------------------------------------------------------------------------

create or replace function public.support_check_dial(p_employee uuid, p_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_num text := public.support_normalize_phone(p_number);
  v_rule public.support_dial_rules%rowtype;
  v_limit integer;
  v_recent integer;
begin
  if v_num is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_number');
  end if;
  select * into v_rule
    from public.support_dial_rules r
   where v_num like r.prefix || '%'
   order by length(r.prefix) desc limit 1;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'destination_not_allowed', 'number', v_num);
  end if;
  if v_rule.action = 'deny' then
    return jsonb_build_object('allowed', false, 'reason', 'destination_blocked', 'rule', v_rule.prefix, 'number', v_num);
  end if;
  select outbound_limit_per_10min into v_limit from public.support_voice_settings where id;
  select count(*) into v_recent
    from public.support_calls c
   where c.direction = 'outbound' and c.assigned_agent_id = p_employee
     and c.created_at > now() - interval '10 minutes';
  if v_recent >= coalesce(v_limit, 30) then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited', 'number', v_num);
  end if;
  return jsonb_build_object('allowed', true, 'number', v_num, 'rule', v_rule.prefix);
end;
$$;

create or replace function public.support_voice_start_inbound(
  p_call_sid text,
  p_from text,
  p_to text,
  p_hidden boolean default false,
  p_priority text default null,
  p_category text default null,
  p_ivr text default null
) returns table (
  ticket_id uuid, call_id uuid, public_id text, customer_id uuid,
  preferred_agent uuid, caller_phone text, duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.support_calls%rowtype;
  v_phone text := public.support_normalize_phone(p_from);
  v_res record;
  v_call uuid;
  v_pref uuid;
  v_hidden boolean := coalesce(p_hidden, false) or v_phone is null;
begin
  if p_call_sid is null or btrim(p_call_sid) = '' then raise exception 'call sid is required'; end if;

  select * into v_existing from public.support_calls where provider_call_id = p_call_sid;
  if found then
    select t.public_id, t.customer_id, t.assigned_agent_id into public_id, customer_id, preferred_agent
      from public.support_tickets t where t.id = v_existing.ticket_id;
    ticket_id := v_existing.ticket_id; call_id := v_existing.id;
    caller_phone := case when v_existing.caller_hidden then null else v_existing.from_number end;
    duplicate := true;
    return next; return;
  end if;

  select * into v_res from public.support_ingest_interaction(
    'voice', 'inbound', 'twilio', p_call_sid,
    case when v_hidden then 'external' else 'phone' end,
    case when v_hidden then 'anon:' || p_call_sid else v_phone end,
    null, 'Incoming support call', null,
    jsonb_build_object('from', case when v_hidden then null else v_phone end, 'to', p_to, 'ivr', p_ivr),
    null, p_priority, p_category
  );

  insert into public.support_calls
    (interaction_id, ticket_id, provider_call_id, direction, from_number, to_number, status,
     caller_hidden, ivr_choice, started_at)
  values
    (v_res.interaction_id, v_res.ticket_id, p_call_sid, 'inbound',
     case when v_hidden then null else v_phone end, p_to, 'queued', v_hidden, p_ivr, now())
  returning id into v_call;

  -- Sticky routing: if this customer already has an officer on an open ticket,
  -- hand that officer back so the workflow can try them first.
  select t.assigned_agent_id into v_pref
    from public.support_tickets t
    join public.support_agents a on a.employee_id = t.assigned_agent_id and a.enabled
   where t.id = v_res.ticket_id and t.status not in ('resolved','closed');

  ticket_id := v_res.ticket_id; call_id := v_call; public_id := v_res.public_id;
  customer_id := v_res.customer_id; preferred_agent := v_pref;
  caller_phone := case when v_hidden then null else v_phone end;
  duplicate := false;
  return next;
end;
$$;

create or replace function public.support_voice_start_outbound(
  p_call_sid text, p_agent uuid, p_to text, p_from text, p_ticket uuid default null
) returns table (ticket_id uuid, call_id uuid, public_id text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.support_calls%rowtype;
  v_phone text := public.support_normalize_phone(p_to);
  v_ticket public.support_tickets%rowtype;
  v_interaction uuid;
  v_call uuid;
  v_res record;
begin
  if v_phone is null then raise exception 'invalid destination'; end if;

  select * into v_existing from public.support_calls where provider_call_id = p_call_sid;
  if found then
    select t.public_id into public_id from public.support_tickets t where t.id = v_existing.ticket_id;
    ticket_id := v_existing.ticket_id; call_id := v_existing.id;
    return next; return;
  end if;

  if p_ticket is not null then
    select * into v_ticket from public.support_tickets where id = p_ticket;
    if not found then raise exception 'ticket not found'; end if;
    insert into public.support_interactions (ticket_id, customer_id, channel, direction, provider, provider_interaction_id, metadata)
    values (v_ticket.id, v_ticket.customer_id, 'voice', 'outbound', 'twilio', p_call_sid,
            jsonb_build_object('from', p_from, 'to', v_phone, 'agent', p_agent))
    returning id into v_interaction;
    ticket_id := v_ticket.id; public_id := v_ticket.public_id;
  else
    select * into v_res from public.support_ingest_interaction(
      'voice', 'outbound', 'twilio', p_call_sid, 'phone', v_phone, null,
      'Outbound support call', null,
      jsonb_build_object('from', p_from, 'to', v_phone, 'agent', p_agent)
    );
    v_interaction := v_res.interaction_id; ticket_id := v_res.ticket_id; public_id := v_res.public_id;
  end if;

  insert into public.support_calls
    (interaction_id, ticket_id, provider_call_id, direction, from_number, to_number, status,
     assigned_agent_id, started_at)
  values (v_interaction, ticket_id, p_call_sid, 'outbound', p_from, v_phone, 'initiated', p_agent, now())
  returning id into v_call;

  update public.support_tickets
     set assigned_agent_id = coalesce(assigned_agent_id, p_agent),
         status = case when status in ('new','queued') then 'assigned' else status end
   where id = ticket_id;

  call_id := v_call;
  return next;
end;
$$;

-- Number-level status callback for either leg. Never moves a call backwards.
create or replace function public.support_call_apply_status(
  p_call_sid text, p_status text, p_duration integer default null, p_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_call public.support_calls%rowtype;
  v_terminal boolean := p_status in ('completed','busy','failed','no-answer','canceled');
begin
  select * into v_call from public.support_calls where provider_call_id = p_call_sid for update;
  if not found then return null; end if;

  if v_call.ended_at is not null and not v_terminal then return v_call.ticket_id; end if;

  -- An outbound call is "answered" when the far end picks up.
  if v_call.direction = 'outbound' and p_status = 'in-progress' and v_call.answered_at is null then
    update public.support_calls
       set answered_at = p_at, status = 'in-progress',
           wait_seconds = greatest(0, extract(epoch from (p_at - created_at))::int), updated_at = now()
     where id = v_call.id;
    update public.support_tickets
       set first_responded_at = coalesce(first_responded_at, p_at),
           status = case when status in ('new','queued','assigned') then 'in_progress' else status end
     where id = v_call.ticket_id;
    return v_call.ticket_id;
  end if;

  if v_terminal then
    update public.support_calls
       set status = case when abandoned then 'abandoned' else p_status end,
           ended_at = coalesce(ended_at, p_at),
           duration_seconds = coalesce(p_duration, duration_seconds,
             case when answered_at is not null then greatest(0, extract(epoch from (p_at - answered_at))::int) end),
           updated_at = now()
     where id = v_call.id;
  elsif v_call.direction = 'outbound' then
    update public.support_calls set status = p_status, updated_at = now() where id = v_call.id;
  end if;
  return v_call.ticket_id;
end;
$$;

create or replace function public.support_call_mark_ringing(p_call_id uuid, p_task_sid text, p_agent uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.support_calls
     set ringing_agent_id = p_agent, ring_started_at = now(), provider_task_id = coalesce(p_task_sid, provider_task_id),
         status = 'ringing', updated_at = now()
   where id = p_call_id and ended_at is null;
$$;

-- The officer actually picked up (TaskRouter reservation.accepted).
create or replace function public.support_call_mark_answered(p_task_sid text, p_agent uuid, p_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_call public.support_calls%rowtype;
begin
  select * into v_call from public.support_calls
   where provider_task_id = p_task_sid order by created_at desc limit 1 for update;
  if not found then return null; end if;
  if v_call.answered_at is null then
    update public.support_calls
       set answered_at = p_at, assigned_agent_id = p_agent, status = 'in-progress',
           wait_seconds = greatest(0, extract(epoch from (p_at - created_at))::int), updated_at = now()
     where id = v_call.id;
  end if;
  update public.support_tickets
     set assigned_agent_id = p_agent,
         first_responded_at = coalesce(first_responded_at, p_at),
         status = case when status in ('new','queued','assigned') then 'in_progress' else status end
   where id = v_call.ticket_id;
  return v_call.ticket_id;
end;
$$;

-- Caller left the queue without an officer. Optionally turn it into a callback.
create or replace function public.support_call_abandon(
  p_call_sid text, p_wait_seconds integer, p_create_callback boolean default true
) returns table (callback_id uuid, ticket_id uuid, phone text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_call public.support_calls%rowtype;
  v_cb uuid;
begin
  select * into v_call from public.support_calls where provider_call_id = p_call_sid for update;
  if not found or v_call.answered_at is not null then return; end if;

  update public.support_calls
     set abandoned = true, status = 'abandoned', ended_at = coalesce(ended_at, now()),
         wait_seconds = coalesce(p_wait_seconds, wait_seconds), disposition = 'abandoned', updated_at = now()
   where id = v_call.id;

  update public.support_tickets
     set priority = case when priority > 'P2' then 'P2' else priority end,
         subject = case when subject = 'Incoming support call' then 'Missed call: customer needs a call back' else subject end
   where id = v_call.ticket_id;
  insert into public.support_ticket_events (ticket_id, event_type, payload)
  values (v_call.ticket_id, 'call_abandoned', jsonb_build_object('wait_seconds', p_wait_seconds));

  if p_create_callback and not v_call.caller_hidden and v_call.from_number is not null then
    v_cb := public.support_callback_create(v_call.ticket_id, v_call.from_number, 'missed_call', null, null, v_call.id);
    callback_id := v_cb; ticket_id := v_call.ticket_id; phone := v_call.from_number;
    return next;
  end if;
end;
$$;

create or replace function public.support_callback_create(
  p_ticket uuid, p_phone text, p_origin text default 'agent',
  p_actor uuid default null, p_not_before timestamptz default null, p_call uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := public.support_normalize_phone(p_phone);
  v_id uuid;
begin
  if v_phone is null then raise exception 'invalid phone number'; end if;
  if p_origin not in ('agent','missed_call','queue_offer') then raise exception 'invalid origin'; end if;
  if not exists (select 1 from public.support_tickets where id = p_ticket) then raise exception 'ticket not found'; end if;

  -- One live callback per number. Customers redial; we should not call them back four times.
  select id into v_id from public.support_callbacks
   where phone_number = v_phone and status in ('scheduled','queued','reserved','calling')
   order by requested_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.support_callbacks (ticket_id, call_id, phone_number, origin, not_before, status)
  values (p_ticket, p_call, v_phone, p_origin, p_not_before,
          case when p_not_before is not null and p_not_before > now() then 'scheduled' else 'queued' end)
  returning id into v_id;

  insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
  values (p_ticket, p_actor, 'callback_requested', jsonb_build_object('callback_id', v_id, 'origin', p_origin));
  return v_id;
end;
$$;

-- Outcome of one callback attempt. Retries with growing delay, then gives up.
create or replace function public.support_callback_result(p_callback uuid, p_ok boolean, p_error text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cb public.support_callbacks%rowtype;
begin
  select * into v_cb from public.support_callbacks where id = p_callback for update;
  if not found then return null; end if;
  if v_cb.status in ('completed','failed','cancelled') then return v_cb.status; end if;

  if p_ok then
    update public.support_callbacks set status = 'completed', completed_at = now(), attempts = attempts + 1, last_error = null
     where id = p_callback;
    insert into public.support_ticket_events (ticket_id, event_type, payload)
    values (v_cb.ticket_id, 'callback_completed', jsonb_build_object('callback_id', p_callback));
    return 'completed';
  end if;

  if v_cb.attempts + 1 >= v_cb.max_attempts then
    update public.support_callbacks set status = 'failed', attempts = attempts + 1, last_error = p_error, provider_task_id = null
     where id = p_callback;
    insert into public.support_ticket_events (ticket_id, event_type, payload)
    values (v_cb.ticket_id, 'callback_failed', jsonb_build_object('callback_id', p_callback, 'error', p_error));
    return 'failed';
  end if;

  update public.support_callbacks
     set status = 'scheduled', attempts = attempts + 1, last_error = p_error,
         not_before = now() + make_interval(mins => 10 * (v_cb.attempts + 1)),
         provider_task_id = null, assigned_agent_id = null
   where id = p_callback;
  return 'scheduled';
end;
$$;

-- Callbacks that are due and have no TaskRouter task yet.
create or replace function public.support_callbacks_due(p_limit integer default 50)
returns table (id uuid, ticket_id uuid, phone_number text, priority text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.support_callbacks c
     set status = 'queued'
   where c.status = 'scheduled' and coalesce(c.not_before, now()) <= now();
  return query
    select c.id, c.ticket_id, c.phone_number, t.priority
      from public.support_callbacks c
      join public.support_tickets t on t.id = c.ticket_id
     where c.status = 'queued' and c.provider_task_id is null and coalesce(c.not_before, now()) <= now()
     order by t.priority, c.requested_at
     limit greatest(1, p_limit);
end;
$$;

-- Presence hygiene. Called by support-maintenance on a schedule.
--   * browser vanished (no heartbeat)        -> offline
--   * shift ended while still Available       -> offline
--   * stuck in wrap-up for a long time        -> away
create or replace function public.support_maintenance_presence(p_stale_seconds integer default 90)
returns table (employee_id uuid, previous_state text, new_state text, reason text, provider_worker_id text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with changed as (
    update public.support_agent_presence p
       set state = x.new_state, state_reason = x.reason, state_changed_at = now(),
           voice_active = 0, updated_at = now()
      from (
        select pr.employee_id as eid, pr.state as old_state,
          case
            when pr.state = 'available' and coalesce(pr.last_seen_at, 'epoch'::timestamptz) < now() - make_interval(secs => p_stale_seconds) then 'offline'
            when pr.state = 'available' and not public.support_is_employee_on_shift(pr.employee_id, now()) then 'offline'
            when pr.state = 'wrap_up' and pr.state_changed_at < now() - interval '15 minutes' then 'away'
          end as new_state,
          case
            when pr.state = 'available' and coalesce(pr.last_seen_at, 'epoch'::timestamptz) < now() - make_interval(secs => p_stale_seconds) then 'stale_heartbeat'
            when pr.state = 'available' and not public.support_is_employee_on_shift(pr.employee_id, now()) then 'shift_ended'
            when pr.state = 'wrap_up' and pr.state_changed_at < now() - interval '15 minutes' then 'wrap_up_timeout'
          end as reason
        from public.support_agent_presence pr
        where pr.state in ('available','wrap_up')
      ) x
     where p.employee_id = x.eid and x.new_state is not null
    returning p.employee_id, x.old_state, p.state, p.state_reason
  )
  select c.employee_id, c.old_state, c.state, c.state_reason, a.provider_worker_id
    from changed c join public.support_agents a on a.employee_id = c.employee_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Read model for the UI
-- ---------------------------------------------------------------------------

drop view if exists public.support_active_calls_view;
create view public.support_active_calls_view as
select
  c.id, c.ticket_id, t.public_id, c.direction, c.status, c.from_number, c.to_number,
  c.queue_name, c.assigned_agent_id, ep.full_name as assigned_agent_name,
  c.ringing_agent_id, c.ring_started_at, c.abandoned,
  c.started_at, c.answered_at, c.ended_at, c.duration_seconds, c.wait_seconds, c.created_at,
  sc.display_name as customer_name, sc.primary_phone as customer_phone,
  t.subject, t.priority, t.category
from public.support_calls c
left join public.support_tickets t on t.id = c.ticket_id
left join public.support_customers sc on sc.id = t.customer_id
left join public.employee_profiles ep on ep.id = c.assigned_agent_id
where public.support_is_staff(auth.uid())
  and (c.ended_at is null or c.created_at > now() - interval '24 hours');

drop view if exists public.support_callbacks_view;
create view public.support_callbacks_view as
select
  cb.id, cb.ticket_id, t.public_id, t.subject, t.priority, cb.phone_number, cb.origin, cb.status,
  cb.attempts, cb.max_attempts, cb.last_error, cb.requested_at, cb.not_before, cb.completed_at,
  cb.assigned_agent_id, ep.full_name as assigned_agent_name,
  c.display_name as customer_name
from public.support_callbacks cb
join public.support_tickets t on t.id = cb.ticket_id
left join public.support_customers c on c.id = t.customer_id
left join public.employee_profiles ep on ep.id = cb.assigned_agent_id
where public.support_is_staff(auth.uid())
  and (cb.status in ('scheduled','queued','reserved','calling') or cb.requested_at > now() - interval '24 hours');

-- Today (company time) for the Head of Support.
drop view if exists public.support_kpi_today_view;
create view public.support_kpi_today_view as
with b as (
  select (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') as day_start
), calls as (
  select c.* from public.support_calls c, b where c.created_at >= b.day_start and c.direction = 'inbound'
), tix as (
  select t.* from public.support_tickets t, b where t.created_at >= b.day_start
)
select
  (select count(*) from calls)::int as calls_offered,
  (select count(*) from calls where answered_at is not null)::int as calls_answered,
  (select count(*) from calls where abandoned)::int as calls_abandoned,
  (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where answered_at is not null) / count(*), 1) end from calls) as answer_rate,
  (select avg(wait_seconds)::int from calls where answered_at is not null) as avg_wait_seconds,
  (select avg(duration_seconds)::int from calls where answered_at is not null and duration_seconds is not null) as avg_handle_seconds,
  (select count(*) from public.support_tickets where status not in ('resolved','closed'))::int as open_tickets,
  (select count(*) from public.support_tickets where status in ('new','queued'))::int as unassigned_tickets,
  (select count(*) from tix)::int as tickets_today,
  (select count(*) from public.support_tickets, b where resolved_at >= b.day_start)::int as resolved_today,
  (select count(*) from public.support_tickets where status not in ('resolved','closed')
     and ((first_responded_at is null and first_response_due_at < now()) or resolution_due_at < now()))::int as sla_breached,
  (select count(*) from public.support_tickets where status not in ('resolved','closed')
     and first_responded_at is null and first_response_due_at >= now() and first_response_due_at < now() + interval '10 minutes')::int as sla_at_risk,
  (select count(*) from public.support_callbacks where status in ('scheduled','queued','reserved','calling'))::int as callbacks_pending
where public.support_is_supervisor(auth.uid());

drop view if exists public.support_channel_stats_view;
create view public.support_channel_stats_view as
select
  ch.channel,
  count(t.id) filter (where t.status not in ('resolved','closed'))::int as open_tickets,
  count(t.id) filter (where t.status in ('new','queued'))::int as waiting,
  count(t.id) filter (where t.created_at >= (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'))::int as created_today
from (values ('voice'),('whatsapp'),('web_chat'),('email'),('sms'),('form')) as ch(channel)
left join public.support_tickets t on t.channel = ch.channel
where public.support_is_staff(auth.uid())
group by ch.channel;

-- ---------------------------------------------------------------------------
-- 4. RLS and grants
-- ---------------------------------------------------------------------------

do $$
declare n text;
begin
  foreach n in array array[
    'support_calls','support_call_events','support_provider_events','support_agent_voice_devices',
    'support_voice_settings','support_dial_rules','support_callbacks'
  ] loop
    execute format('alter table public.%I enable row level security', n);
    execute format('revoke all on table public.%I from public, anon, authenticated', n);
    execute format('grant all on table public.%I to service_role', n);
  end loop;

  foreach n in array array['support_calls','support_call_events','support_callbacks'] loop
    execute format('drop policy if exists support_staff_read on public.%I', n);
    execute format('create policy support_staff_read on public.%I for select to authenticated using (public.support_is_staff(auth.uid()))', n);
    execute format('grant select on table public.%I to authenticated', n);
  end loop;

  foreach n in array array['support_provider_events','support_voice_settings','support_dial_rules'] loop
    execute format('drop policy if exists support_supervisor_read on public.%I', n);
    execute format('create policy support_supervisor_read on public.%I for select to authenticated using (public.support_is_supervisor(auth.uid()))', n);
    execute format('grant select on table public.%I to authenticated', n);
  end loop;
end $$;

drop policy if exists support_voice_devices_read on public.support_agent_voice_devices;
create policy support_voice_devices_read on public.support_agent_voice_devices
  for select to authenticated
  using (employee_id = auth.uid() or public.support_is_supervisor(auth.uid()));
grant select on public.support_agent_voice_devices to authenticated;

revoke all on public.support_active_calls_view, public.support_callbacks_view,
              public.support_kpi_today_view, public.support_channel_stats_view
  from public, anon, authenticated;
grant select on public.support_active_calls_view, public.support_callbacks_view,
                public.support_kpi_today_view, public.support_channel_stats_view
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Function privileges
-- ---------------------------------------------------------------------------

revoke all on function public.support_check_dial(uuid,text) from public, anon, authenticated;
revoke all on function public.support_voice_start_inbound(text,text,text,boolean,text,text,text) from public, anon, authenticated;
revoke all on function public.support_voice_start_outbound(text,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.support_call_apply_status(text,text,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.support_call_mark_ringing(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.support_call_mark_answered(text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.support_call_abandon(text,integer,boolean) from public, anon, authenticated;
revoke all on function public.support_callback_create(uuid,text,text,uuid,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.support_callback_result(uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.support_callbacks_due(integer) from public, anon, authenticated;
revoke all on function public.support_maintenance_presence(integer) from public, anon, authenticated;

grant execute on function public.support_check_dial(uuid,text) to service_role;
grant execute on function public.support_voice_start_inbound(text,text,text,boolean,text,text,text) to service_role;
grant execute on function public.support_voice_start_outbound(text,uuid,text,text,uuid) to service_role;
grant execute on function public.support_call_apply_status(text,text,integer,timestamptz) to service_role;
grant execute on function public.support_call_mark_ringing(uuid,text,uuid) to service_role;
grant execute on function public.support_call_mark_answered(text,uuid,timestamptz) to service_role;
grant execute on function public.support_call_abandon(text,integer,boolean) to service_role;
grant execute on function public.support_callback_create(uuid,text,text,uuid,timestamptz,uuid) to service_role;
grant execute on function public.support_callback_result(uuid,boolean,text) to service_role;
grant execute on function public.support_callbacks_due(integer) to service_role;
grant execute on function public.support_maintenance_presence(integer) to service_role;

commit;
