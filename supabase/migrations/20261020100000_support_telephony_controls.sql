-- PArAsYtE | RA-Workspace support module
-- Telephony controls from the platform research and engineering briefs:
-- business hours and closures, voicemail, number registry and caller ID
-- selection, do-not-contact list, call quality samples, fraud and spend
-- guards, recording consent and retention. Additive and idempotent.

begin;

-- ---------------------------------------------------------------------------
-- 1. Settings and call columns
-- ---------------------------------------------------------------------------

alter table public.support_voice_settings add column if not exists timezone text not null default 'Africa/Lagos';
alter table public.support_voice_settings add column if not exists hours_enforced boolean not null default false;
alter table public.support_voice_settings add column if not exists closed_message_text text not null default 'Our support line is closed right now.';
alter table public.support_voice_settings add column if not exists voicemail_enabled boolean not null default true;
alter table public.support_voice_settings add column if not exists voicemail_prompt_text text not null default 'Please leave your name, number and a short message after the tone. We will call you back.';
alter table public.support_voice_settings add column if not exists voicemail_max_seconds integer not null default 120;
alter table public.support_voice_settings add column if not exists recording_retention_days integer not null default 90;
alter table public.support_voice_settings add column if not exists voicemail_retention_days integer not null default 90;
alter table public.support_voice_settings add column if not exists byoc_fallback_to_pstn boolean not null default true;
alter table public.support_voice_settings add column if not exists dnc_enforced boolean not null default true;
alter table public.support_voice_settings add column if not exists spend_alert_daily numeric(12,2);
alter table public.support_voice_settings add column if not exists spend_cap_daily numeric(12,2);
alter table public.support_voice_settings add column if not exists fraud_calls_per_hour integer not null default 60;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_voice_settings_controls_chk') then
    alter table public.support_voice_settings add constraint support_voice_settings_controls_chk check (
      voicemail_max_seconds between 10 and 600
      and recording_retention_days between 1 and 3650
      and voicemail_retention_days between 1 and 3650
      and fraud_calls_per_hour between 5 and 5000
      and (spend_alert_daily is null or spend_alert_daily >= 0)
      and (spend_cap_daily is null or spend_cap_daily >= 0)
    );
  end if;
end $$;

alter table public.support_calls add column if not exists price numeric(12,5);
alter table public.support_calls add column if not exists price_unit text;
alter table public.support_calls add column if not exists priced_at timestamptz;
alter table public.support_calls add column if not exists carrier_route text;
alter table public.support_calls add column if not exists number_used text;
alter table public.support_calls add column if not exists recording_consent text;
alter table public.support_calls add column if not exists is_voicemail boolean not null default false;
alter table public.support_calls add column if not exists recording_deleted_at timestamptz;
create index if not exists support_calls_unpriced_idx on public.support_calls (ended_at) where price is null and ended_at is not null;
create index if not exists support_calls_recording_idx on public.support_calls (ended_at) where recording_sid is not null and recording_deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.support_business_hours (
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  opens_at time not null,
  closes_at time not null,
  primary key (weekday, opens_at),
  check (closes_at > opens_at)
);
insert into public.support_business_hours (weekday, opens_at, closes_at)
select d, time '08:00', time '18:00' from generate_series(1,5) d
where not exists (select 1 from public.support_business_hours);

create table if not exists public.support_closures (
  closes_on date primary key,
  name text not null
);

create table if not exists public.support_numbers (
  id uuid primary key default gen_random_uuid(),
  e164 text not null unique check (e164 ~ '^\+[0-9]{6,15}$'),
  label text not null,
  dial_prefix text check (dial_prefix is null or dial_prefix ~ '^\+[0-9]{1,8}$'),
  kind text not null default 'both' check (kind in ('inbound','outbound','both')),
  route text not null default 'pstn' check (route in ('pstn','byoc')),
  is_default_outbound boolean not null default false,
  active boolean not null default true,
  note text,
  updated_at timestamptz not null default now()
);
create unique index if not exists support_numbers_one_default on public.support_numbers (is_default_outbound) where is_default_outbound;

create table if not exists public.support_do_not_contact (
  phone text primary key check (phone ~ '^\+[0-9]{6,15}$'),
  reason text,
  source text not null default 'agent' check (source in ('agent','customer_request','import','regulator')),
  added_by uuid references public.support_agents(employee_id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.support_fraud_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('call_burst','many_countries','short_call_burst','spend_alert','spend_cap')),
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  agent_id uuid references public.support_agents(employee_id) on delete set null,
  dedupe_key text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create unique index if not exists support_fraud_open_dedupe on public.support_fraud_alerts (kind, dedupe_key) where resolved_at is null;
create index if not exists support_fraud_created_idx on public.support_fraud_alerts (created_at desc);

create table if not exists public.support_call_quality (
  id bigint generated always as identity primary key,
  call_id uuid references public.support_calls(id) on delete cascade,
  provider_call_id text,
  employee_id uuid references public.support_agents(employee_id) on delete set null,
  sampled_at timestamptz not null default now(),
  rtt_ms numeric(8,1) check (rtt_ms is null or rtt_ms >= 0),
  jitter_ms numeric(8,1) check (jitter_ms is null or jitter_ms >= 0),
  loss_pct numeric(5,2) check (loss_pct is null or loss_pct between 0 and 100),
  mos numeric(3,2) check (mos is null or mos between 1 and 5)
);
create index if not exists support_call_quality_time_idx on public.support_call_quality (sampled_at desc);
create index if not exists support_call_quality_call_idx on public.support_call_quality (call_id);

-- ---------------------------------------------------------------------------
-- 3. Business hours
-- ---------------------------------------------------------------------------

-- Is the line open at p_at? Fails open: enforcement off, or no hours rows at
-- all, means open, so a half-configured system never silences the line.
create or replace function public.support_line_status(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.support_voice_settings%rowtype;
  v_local timestamp;
  v_name text;
begin
  select * into s from public.support_voice_settings where id;
  if not found or not s.hours_enforced then
    return jsonb_build_object('open', true, 'reason', 'not_enforced');
  end if;
  if not exists (select 1 from public.support_business_hours) then
    return jsonb_build_object('open', true, 'reason', 'no_hours_configured');
  end if;
  v_local := p_at at time zone s.timezone;
  select name into v_name from public.support_closures where closes_on = v_local::date;
  if found then
    return jsonb_build_object('open', false, 'reason', 'closure', 'closure', v_name, 'next_open', public.support_next_open(p_at));
  end if;
  if exists (
    select 1 from public.support_business_hours h
     where h.weekday = extract(dow from v_local)::int
       and v_local::time >= h.opens_at and v_local::time < h.closes_at
  ) then
    return jsonb_build_object('open', true, 'reason', 'open');
  end if;
  return jsonb_build_object('open', false, 'reason', 'closed_hours', 'next_open', public.support_next_open(p_at));
end;
$$;

-- Next instant the line opens, looking up to 21 days ahead. Null if none.
create or replace function public.support_next_open(p_at timestamptz default now())
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_local timestamp;
  v_day date;
  i integer;
  v_open time;
begin
  select timezone into v_tz from public.support_voice_settings where id;
  v_tz := coalesce(v_tz, 'Africa/Lagos');
  v_local := p_at at time zone v_tz;
  for i in 0..21 loop
    v_day := v_local::date + i;
    continue when exists (select 1 from public.support_closures where closes_on = v_day);
    select min(h.opens_at) into v_open
      from public.support_business_hours h
     where h.weekday = extract(dow from v_day)::int
       and (i > 0 or h.opens_at > v_local::time);
    if v_open is not null then
      return ((v_day + v_open) at time zone v_tz);
    end if;
  end loop;
  return null;
end;
$$;

-- What the webhook should do with a new inbound call.
create or replace function public.support_voice_route(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  st jsonb := public.support_line_status(p_at);
  s public.support_voice_settings%rowtype;
begin
  select * into s from public.support_voice_settings where id;
  if (st->>'open')::boolean then
    return jsonb_build_object('action', 'queue') || st;
  end if;
  return jsonb_build_object(
    'action', case when coalesce(s.voicemail_enabled, true) then 'voicemail' else 'closed' end,
    'closed_message', s.closed_message_text,
    'voicemail_prompt', s.voicemail_prompt_text,
    'voicemail_max_seconds', s.voicemail_max_seconds
  ) || st;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Voicemail
-- ---------------------------------------------------------------------------

create or replace function public.support_voice_mark_after_hours(p_call_sid text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.support_calls
     set status = 'after_hours', disposition = coalesce(disposition, 'after_hours'), updated_at = now()
   where provider_call_id = p_call_sid and status in ('queued','initiated');
$$;

-- Store the voicemail reference, note the ticket and book a callback for the
-- next opening. Safe to run twice for the same recording.
create or replace function public.support_voicemail_received(
  p_call_sid text, p_recording_sid text, p_duration integer default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.support_calls%rowtype;
  v_cb uuid;
  v_next timestamptz;
begin
  select * into c from public.support_calls where provider_call_id = p_call_sid for update;
  if not found then raise exception 'call not found'; end if;
  if c.recording_sid = p_recording_sid and c.is_voicemail then return null; end if;

  update public.support_calls
     set recording_sid = p_recording_sid, is_voicemail = true, disposition = 'voicemail',
         status = 'voicemail', duration_seconds = coalesce(p_duration, duration_seconds), updated_at = now()
   where id = c.id;

  if c.ticket_id is not null then
    insert into public.support_ticket_events (ticket_id, event_type, payload)
    values (c.ticket_id, 'voicemail_received', jsonb_build_object('seconds', p_duration, 'call_id', c.id));
    if not c.caller_hidden and c.from_number is not null then
      v_next := public.support_next_open(now());
      select public.support_callback_create(c.ticket_id, c.from_number, 'missed_call', null, v_next, c.id) into v_cb;
    end if;
  end if;
  return v_cb;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Number registry, caller ID, per-call metadata
-- ---------------------------------------------------------------------------

-- Caller ID and carrier route for an outbound destination. Same-country number
-- first (best answer rate), then the default outbound number, then the single
-- caller ID in settings. Returns null number if nothing is configured.
create or replace function public.support_pick_caller_id(p_to text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_to text := public.support_normalize_phone(p_to);
  n public.support_numbers%rowtype;
  v_caller text;
begin
  select * into n from public.support_numbers
   where active and kind in ('outbound','both') and dial_prefix is not null and v_to like dial_prefix || '%'
   order by length(dial_prefix) desc, is_default_outbound desc limit 1;
  if not found then
    select * into n from public.support_numbers
     where active and kind in ('outbound','both') and is_default_outbound limit 1;
  end if;
  if found then
    return jsonb_build_object('number', n.e164, 'route', n.route, 'source', 'registry');
  end if;
  select caller_id into v_caller from public.support_voice_settings where id;
  return jsonb_build_object('number', v_caller, 'route', null, 'source', 'settings');
end;
$$;

create or replace function public.support_call_set_meta(
  p_call_sid text, p_carrier_route text default null, p_number_used text default null, p_consent text default null
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.support_calls
     set carrier_route = coalesce(p_carrier_route, carrier_route),
         number_used = coalesce(p_number_used, number_used),
         recording_consent = coalesce(p_consent, recording_consent),
         updated_at = now()
   where provider_call_id = p_call_sid;
$$;

-- ---------------------------------------------------------------------------
-- 6. Dial policy: add do-not-contact and the daily spend cap
-- ---------------------------------------------------------------------------

create or replace function public.support_spend_today()
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(abs(c.price)), 0)
    from public.support_calls c
   where c.price is not null
     and c.created_at >= (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos');
$$;

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
  s public.support_voice_settings%rowtype;
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
  select * into s from public.support_voice_settings where id;
  if coalesce(s.dnc_enforced, true) and exists (select 1 from public.support_do_not_contact where phone = v_num) then
    return jsonb_build_object('allowed', false, 'reason', 'do_not_contact', 'number', v_num);
  end if;
  if s.spend_cap_daily is not null and public.support_spend_today() >= s.spend_cap_daily then
    return jsonb_build_object('allowed', false, 'reason', 'spend_cap_reached', 'number', v_num);
  end if;
  v_limit := s.outbound_limit_per_10min;
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

-- ---------------------------------------------------------------------------
-- 7. Call quality
-- ---------------------------------------------------------------------------

-- Simplified ITU-T G.107 E-model: R from delay, jitter and loss, then MOS.
create or replace function public.support_estimate_mos(p_rtt numeric, p_jitter numeric, p_loss numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  d numeric := coalesce(p_rtt, 0) / 2 + coalesce(p_jitter, 0) * 2 + 10;  -- effective one-way delay, ms
  r numeric;
  mos numeric;
begin
  r := 93.2 - (case when d < 177.3 then 0.024 * d else 0.024 * d + 0.11 * (d - 177.3) end)
       - 2.5 * coalesce(p_loss, 0);
  r := greatest(0, least(100, r));
  mos := 1 + 0.035 * r + r * (r - 60) * (100 - r) * 0.000007;
  return round(greatest(1, least(4.5, mos)), 2);
end;
$$;

create or replace function public.support_record_call_quality(
  p_call_sid text, p_employee uuid, p_rtt numeric, p_jitter numeric, p_loss numeric, p_mos numeric default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_call uuid;
begin
  select id into v_call from public.support_calls where provider_call_id = p_call_sid;
  insert into public.support_call_quality (call_id, provider_call_id, employee_id, rtt_ms, jitter_ms, loss_pct, mos)
  values (v_call, p_call_sid, p_employee,
          least(p_rtt, 99999), least(p_jitter, 99999), least(greatest(p_loss, 0), 100),
          coalesce(p_mos, public.support_estimate_mos(p_rtt, p_jitter, p_loss)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Fraud scan, price backfill, retention
-- ---------------------------------------------------------------------------

create or replace function public.support_fraud_scan()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.support_voice_settings%rowtype;
  r record;
  v_n integer := 0;
  v_rows integer;
  v_spend numeric;
  v_hour text := to_char(date_trunc('hour', now()), 'YYYYMMDDHH24');
  v_day text := to_char(now() at time zone 'Africa/Lagos', 'YYYYMMDD');
begin
  select * into s from public.support_voice_settings where id;

  for r in
    select assigned_agent_id as agent, count(*) as n
      from public.support_calls
     where direction = 'outbound' and assigned_agent_id is not null and created_at > now() - interval '1 hour'
     group by 1 having count(*) >= s.fraud_calls_per_hour
  loop
    insert into public.support_fraud_alerts (kind, severity, agent_id, dedupe_key, detail)
    values ('call_burst', 'critical', r.agent, r.agent::text || ':' || v_hour, jsonb_build_object('calls_last_hour', r.n, 'limit', s.fraud_calls_per_hour))
    on conflict (kind, dedupe_key) where resolved_at is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  end loop;

  for r in
    select assigned_agent_id as agent, count(distinct d.prefix) as countries
      from public.support_calls c
      join lateral (
        select prefix from public.support_dial_rules where c.to_number like prefix || '%' order by length(prefix) desc limit 1
      ) d on true
     where c.direction = 'outbound' and c.assigned_agent_id is not null and c.created_at > now() - interval '24 hours'
     group by 1 having count(distinct d.prefix) >= 4
  loop
    insert into public.support_fraud_alerts (kind, severity, agent_id, dedupe_key, detail)
    values ('many_countries', 'warning', r.agent, r.agent::text || ':' || v_day, jsonb_build_object('destinations_24h', r.countries))
    on conflict (kind, dedupe_key) where resolved_at is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  end loop;

  for r in
    select assigned_agent_id as agent, count(*) as n
      from public.support_calls
     where direction = 'outbound' and assigned_agent_id is not null
       and created_at > now() - interval '10 minutes'
       and (duration_seconds is not null and duration_seconds < 6)
     group by 1 having count(*) >= 10
  loop
    insert into public.support_fraud_alerts (kind, severity, agent_id, dedupe_key, detail)
    values ('short_call_burst', 'critical', r.agent, r.agent::text || ':' || v_hour, jsonb_build_object('short_calls_10min', r.n))
    on conflict (kind, dedupe_key) where resolved_at is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  end loop;

  v_spend := public.support_spend_today();
  if s.spend_cap_daily is not null and v_spend >= s.spend_cap_daily then
    insert into public.support_fraud_alerts (kind, severity, dedupe_key, detail)
    values ('spend_cap', 'critical', v_day, jsonb_build_object('spend', v_spend, 'cap', s.spend_cap_daily))
    on conflict (kind, dedupe_key) where resolved_at is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  elsif s.spend_alert_daily is not null and v_spend >= s.spend_alert_daily then
    insert into public.support_fraud_alerts (kind, severity, dedupe_key, detail)
    values ('spend_alert', 'warning', v_day, jsonb_build_object('spend', v_spend, 'alert_at', s.spend_alert_daily))
    on conflict (kind, dedupe_key) where resolved_at is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  end if;
  return v_n;
end;
$$;

-- Calls that ended at least 10 minutes ago and have no price yet.
create or replace function public.support_calls_needing_price(p_limit integer default 25)
returns table (call_id uuid, provider_call_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, provider_call_id from public.support_calls
   where price is null and provider_call_id is not null and ended_at is not null
     and ended_at < now() - interval '10 minutes' and ended_at > now() - interval '3 days'
   order by ended_at limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

create or replace function public.support_call_set_price(p_call uuid, p_price numeric, p_unit text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.support_calls
     set price = p_price, price_unit = p_unit, priced_at = now(), updated_at = now()
   where id = p_call;
$$;

-- Recordings past retention. The edge function deletes them at the provider,
-- then calls support_recording_purged for each.
create or replace function public.support_recordings_expired(p_limit integer default 25)
returns table (call_id uuid, recording_sid text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare s public.support_voice_settings%rowtype;
begin
  select * into s from public.support_voice_settings where id;
  return query
    select c.id, c.recording_sid from public.support_calls c
     where c.recording_sid is not null and c.recording_deleted_at is null
       and c.ended_at is not null
       and c.ended_at < now() - make_interval(days => case when c.is_voicemail then s.voicemail_retention_days else s.recording_retention_days end)
     order by c.ended_at limit greatest(1, least(coalesce(p_limit, 25), 100));
end;
$$;

create or replace function public.support_recording_purged(p_call uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.support_calls
     set recording_deleted_at = now(), recording_path = null, transcript_path = null, updated_at = now()
   where id = p_call and recording_sid is not null;
  perform public.support_write_audit(null, 'recording_purged', 'call', p_call::text, '{}'::jsonb);
end;
$$;

create or replace function public.support_purge_quality_samples(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v integer;
begin
  delete from public.support_call_quality where sampled_at < now() - make_interval(days => greatest(7, coalesce(p_keep_days, 90)));
  get diagnostics v = row_count;
  return v;
end;
$$;

-- Role-based, audited access to a recording. Supervisors, or the officer who
-- handled the call. Every successful lookup writes an audit row.
create or replace function public.support_recording_ref(p_call uuid, p_actor uuid)
returns table (recording_sid text, is_voicemail boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare c public.support_calls%rowtype;
begin
  select * into c from public.support_calls where id = p_call;
  if not found or c.recording_sid is null or c.recording_deleted_at is not null then
    raise exception 'recording not available' using errcode = 'P0002';
  end if;
  if not (public.support_is_supervisor(p_actor) or (public.support_is_staff(p_actor) and c.assigned_agent_id = p_actor)) then
    raise exception 'not allowed to play this recording' using errcode = '42501';
  end if;
  perform public.support_write_audit(p_actor, 'recording_played', 'call', p_call::text,
    jsonb_build_object('voicemail', c.is_voicemail, 'consent', c.recording_consent));
  recording_sid := c.recording_sid; is_voicemail := c.is_voicemail;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Supervisor views
-- ---------------------------------------------------------------------------

drop view if exists public.support_telephony_health_view;
create view public.support_telephony_health_view as
with q as (
  select * from public.support_call_quality where sampled_at > now() - interval '24 hours'
), o as (
  select * from public.support_calls
   where direction = 'outbound' and created_at > now() - interval '24 hours'
)
select
  (select count(*) from q)::int as samples_24h,
  (select round(avg(mos), 2) from q) as avg_mos,
  (select round(avg(jitter_ms), 1) from q) as avg_jitter_ms,
  (select round(avg(rtt_ms), 1) from q) as avg_rtt_ms,
  (select round(avg(loss_pct), 2) from q) as avg_loss_pct,
  (select count(*) from q where mos < 3.6)::int as poor_samples_24h,
  (select count(*) from o)::int as outbound_24h,
  (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where answered_at is not null) / count(*), 1) end from o) as outbound_asr,
  (select avg(duration_seconds)::int from o where answered_at is not null and duration_seconds is not null) as outbound_acd_seconds,
  public.support_spend_today() as spend_today,
  (select spend_cap_daily from public.support_voice_settings where id) as spend_cap_daily,
  (select spend_alert_daily from public.support_voice_settings where id) as spend_alert_daily,
  (select count(*) from public.support_fraud_alerts where resolved_at is null)::int as open_fraud_alerts,
  (select count(*) from public.support_calls where is_voicemail and created_at > now() - interval '3 days'
      and not exists (select 1 from public.support_callbacks b where b.call_id = support_calls.id and b.status = 'completed'))::int as voicemails_open
where public.support_is_supervisor(auth.uid());

-- ---------------------------------------------------------------------------
-- 10. RLS and grants
-- ---------------------------------------------------------------------------

do $$
declare n text;
begin
  foreach n in array array[
    'support_business_hours','support_closures','support_numbers','support_do_not_contact',
    'support_fraud_alerts','support_call_quality'
  ] loop
    execute format('alter table public.%I enable row level security', n);
    execute format('revoke all on table public.%I from public, anon, authenticated', n);
    execute format('grant all on table public.%I to service_role', n);
    execute format('drop policy if exists support_supervisor_read on public.%I', n);
    execute format('create policy support_supervisor_read on public.%I for select to authenticated using (public.support_is_supervisor(auth.uid()))', n);
    execute format('grant select on table public.%I to authenticated', n);
  end loop;
end $$;

-- Officers need to see the hours and closures to explain a closed line.
drop policy if exists support_staff_read on public.support_business_hours;
create policy support_staff_read on public.support_business_hours for select to authenticated using (public.support_is_staff(auth.uid()));
drop policy if exists support_staff_read on public.support_closures;
create policy support_staff_read on public.support_closures for select to authenticated using (public.support_is_staff(auth.uid()));

grant usage, select on sequence public.support_call_quality_id_seq to service_role;

revoke all on public.support_telephony_health_view from public, anon, authenticated;
grant select on public.support_telephony_health_view to authenticated, service_role;

revoke all on function public.support_line_status(timestamptz) from public, anon, authenticated;
revoke all on function public.support_next_open(timestamptz) from public, anon, authenticated;
revoke all on function public.support_voice_route(timestamptz) from public, anon, authenticated;
revoke all on function public.support_voice_mark_after_hours(text) from public, anon, authenticated;
revoke all on function public.support_voicemail_received(text,text,integer) from public, anon, authenticated;
revoke all on function public.support_pick_caller_id(text) from public, anon, authenticated;
revoke all on function public.support_call_set_meta(text,text,text,text) from public, anon, authenticated;
revoke all on function public.support_spend_today() from public, anon, authenticated;
revoke all on function public.support_check_dial(uuid,text) from public, anon, authenticated;
revoke all on function public.support_estimate_mos(numeric,numeric,numeric) from public, anon, authenticated;
revoke all on function public.support_record_call_quality(text,uuid,numeric,numeric,numeric,numeric) from public, anon, authenticated;
revoke all on function public.support_fraud_scan() from public, anon, authenticated;
revoke all on function public.support_calls_needing_price(integer) from public, anon, authenticated;
revoke all on function public.support_call_set_price(uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.support_recordings_expired(integer) from public, anon, authenticated;
revoke all on function public.support_recording_purged(uuid) from public, anon, authenticated;
revoke all on function public.support_purge_quality_samples(integer) from public, anon, authenticated;
revoke all on function public.support_recording_ref(uuid,uuid) from public, anon, authenticated;

grant execute on function public.support_line_status(timestamptz) to service_role;
grant execute on function public.support_next_open(timestamptz) to service_role;
grant execute on function public.support_voice_route(timestamptz) to service_role;
grant execute on function public.support_voice_mark_after_hours(text) to service_role;
grant execute on function public.support_voicemail_received(text,text,integer) to service_role;
grant execute on function public.support_pick_caller_id(text) to service_role;
grant execute on function public.support_call_set_meta(text,text,text,text) to service_role;
grant execute on function public.support_spend_today() to service_role;
grant execute on function public.support_check_dial(uuid,text) to service_role;
grant execute on function public.support_estimate_mos(numeric,numeric,numeric) to service_role;
grant execute on function public.support_record_call_quality(text,uuid,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.support_fraud_scan() to service_role;
grant execute on function public.support_calls_needing_price(integer) to service_role;
grant execute on function public.support_call_set_price(uuid,numeric,text) to service_role;
grant execute on function public.support_recordings_expired(integer) to service_role;
grant execute on function public.support_recording_purged(uuid) to service_role;
grant execute on function public.support_purge_quality_samples(integer) to service_role;
grant execute on function public.support_recording_ref(uuid,uuid) to service_role;

commit;
