-- Data allocation (Administration > Data).
--
-- RideArrivo buys mobile data in bulk (for example 1.5 TB on MTN) and gives each
-- employee a DAILY allowance picked from five tiers: 500 MB, 1 GB, 2 GB, 3 GB, 5 GB.
-- This migration is the ledger and the rule engine. A FreeRADIUS server in front of the
-- office gateway calls the radius_* functions (through the data-radius Edge Function) to
-- decide who may connect and to debit usage; the Administration screen manages the rest.
--
-- Design rules that matter:
--   * The day is the Africa/Lagos calendar day. Nothing needs a cron job: a new day simply
--     starts a new data_usage_daily row, so the allowance resets at 00:00 Lagos time.
--   * Unused allowance does not roll over. The pool is only debited by real usage.
--   * 1 GB = 1024^3 bytes everywhere (same as MTN's own counters).
--   * Network passwords are stored as bcrypt hashes and are shown once, on creation.
--     data_credentials has no RLS policy on purpose: only the SECURITY DEFINER functions
--     below can touch it.
--   * radius_* functions are callable by service_role only.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.data_tiers (
  code text primary key,
  label text not null,
  daily_bytes bigint not null check (daily_bytes > 0),
  sort_order smallint not null,
  active boolean not null default true
);

insert into public.data_tiers (code, label, daily_bytes, sort_order) values
  ('mb500', '500 MB', 524288000,  1),
  ('gb1',   '1 GB',   1073741824, 2),
  ('gb2',   '2 GB',   2147483648, 3),
  ('gb3',   '3 GB',   3221225472, 4),
  ('gb5',   '5 GB',   5368709120, 5)
on conflict (code) do nothing;

create table if not exists public.data_pool_purchases (
  id uuid primary key default gen_random_uuid(),
  bytes bigint not null check (bytes > 0),
  label text not null default '',
  cost_ngn numeric(14,2) check (cost_ngn is null or cost_ngn >= 0),
  purchased_on date not null default ((now() at time zone 'Africa/Lagos')::date),
  note text not null default '',
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.data_plans (
  employee_id uuid primary key references public.employee_profiles(id) on delete cascade,
  tier_code text not null references public.data_tiers(code),
  status text not null default 'active' check (status in ('active', 'suspended')),
  updated_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_credentials (
  employee_id uuid primary key references public.employee_profiles(id) on delete cascade,
  password_hash text not null,
  rotated_at timestamptz not null default now(),
  failed_count integer not null default 0,
  locked_until timestamptz
);

create table if not exists public.data_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  day date not null,
  bytes bigint not null check (bytes <> 0),
  reason text not null check (length(btrim(reason)) between 3 and 300),
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists data_adjustments_employee_day_idx on public.data_adjustments (employee_id, day);

create table if not exists public.data_usage_daily (
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  day date not null,
  allowance_bytes bigint not null default 0 check (allowance_bytes >= 0),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  bytes_in bigint not null default 0 check (bytes_in >= 0),
  bytes_out bigint not null default 0 check (bytes_out >= 0),
  manual_bytes bigint not null default 0 check (manual_bytes >= 0),
  updated_at timestamptz not null default now(),
  primary key (employee_id, day)
);
create index if not exists data_usage_daily_day_idx on public.data_usage_daily (day);

create table if not exists public.data_sessions (
  session_id text not null,
  nas_ip text not null default '',
  nas_identifier text not null default '',
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  username text not null,
  framed_ip text not null default '',
  calling_station text not null default '',
  started_at timestamptz not null default now(),
  last_update_at timestamptz not null default now(),
  last_in bigint not null default 0,
  last_out bigint not null default 0,
  ended_at timestamptz,
  primary key (session_id, nas_ip)
);
create index if not exists data_sessions_open_idx on public.data_sessions (last_update_at desc) where ended_at is null;
create index if not exists data_sessions_employee_idx on public.data_sessions (employee_id, last_update_at desc);

create table if not exists public.data_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) between 1 and 80),
  msisdn text not null default '',
  imei text not null default '',
  employee_id uuid references public.employee_profiles(id) on delete set null,
  note text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_settings (
  id boolean primary key default true check (id),
  low_pool_percent integer not null default 15 check (low_pool_percent between 1 and 90),
  updated_at timestamptz not null default now()
);
insert into public.data_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security: read-only from the app, all writes go through functions.
-- ---------------------------------------------------------------------------

alter table public.data_tiers enable row level security;
alter table public.data_pool_purchases enable row level security;
alter table public.data_plans enable row level security;
alter table public.data_credentials enable row level security;
alter table public.data_adjustments enable row level security;
alter table public.data_usage_daily enable row level security;
alter table public.data_sessions enable row level security;
alter table public.data_devices enable row level security;
alter table public.data_settings enable row level security;

revoke all on public.data_tiers, public.data_pool_purchases, public.data_plans, public.data_credentials,
  public.data_adjustments, public.data_usage_daily, public.data_sessions, public.data_devices,
  public.data_settings from anon, authenticated;

drop policy if exists "data tiers read" on public.data_tiers;
create policy "data tiers read" on public.data_tiers for select to authenticated using (true);
grant select on public.data_tiers to authenticated;

drop policy if exists "data purchases admin read" on public.data_pool_purchases;
create policy "data purchases admin read" on public.data_pool_purchases for select to authenticated
  using (public.is_workspace_admin());
grant select on public.data_pool_purchases to authenticated;

drop policy if exists "data plans read" on public.data_plans;
create policy "data plans read" on public.data_plans for select to authenticated
  using (public.is_workspace_admin() or employee_id = auth.uid());
grant select on public.data_plans to authenticated;

drop policy if exists "data usage read" on public.data_usage_daily;
create policy "data usage read" on public.data_usage_daily for select to authenticated
  using (public.is_workspace_admin() or employee_id = auth.uid());
grant select on public.data_usage_daily to authenticated;

drop policy if exists "data adjustments admin read" on public.data_adjustments;
create policy "data adjustments admin read" on public.data_adjustments for select to authenticated
  using (public.is_workspace_admin());
grant select on public.data_adjustments to authenticated;

drop policy if exists "data sessions admin read" on public.data_sessions;
create policy "data sessions admin read" on public.data_sessions for select to authenticated
  using (public.is_workspace_admin());
grant select on public.data_sessions to authenticated;

drop policy if exists "data devices admin read" on public.data_devices;
create policy "data devices admin read" on public.data_devices for select to authenticated
  using (public.is_workspace_admin());
grant select on public.data_devices to authenticated;

drop policy if exists "data settings admin read" on public.data_settings;
create policy "data settings admin read" on public.data_settings for select to authenticated
  using (public.is_workspace_admin());
grant select on public.data_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable from the app)
-- ---------------------------------------------------------------------------

create or replace function public.data_today()
returns date
language sql
stable
set search_path = public, pg_temp
as $$ select (now() at time zone 'Africa/Lagos')::date $$;

-- Seconds until the next 00:00 Lagos time, never less than 60 so a NAS never gets 0.
create or replace function public.data_seconds_to_reset()
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select greatest(60, ceil(extract(epoch from
    (((public.data_today() + 1)::timestamp at time zone 'Africa/Lagos') - now())))::integer)
$$;

create or replace function public.data_new_password()
returns text
language plpgsql
volatile
set search_path = public, extensions, pg_temp
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 54 chars, no look-alikes
  out_text text := '';
  b integer;
begin
  while length(out_text) < 12 loop
    b := get_byte(gen_random_bytes(1), 0);
    -- 216 = 4 * 54: reject the top of the byte range so every letter is equally likely
    if b < 216 then
      out_text := out_text || substr(alphabet, (b % 54) + 1, 1);
    end if;
  end loop;
  return substr(out_text, 1, 4) || '-' || substr(out_text, 5, 4) || '-' || substr(out_text, 9, 4);
end;
$$;

-- Makes sure today's row exists, with the allowance the person's tier and any
-- adjustments for today add up to.
create or replace function public.data_ensure_day(p_employee uuid)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_day date := public.data_today();
  v_base bigint;
  v_adj bigint;
begin
  select coalesce(t.daily_bytes, 0) into v_base
  from public.data_plans p
  join public.data_tiers t on t.code = p.tier_code
  where p.employee_id = p_employee and p.status = 'active';

  select coalesce(sum(bytes), 0) into v_adj
  from public.data_adjustments where employee_id = p_employee and day = v_day;

  insert into public.data_usage_daily (employee_id, day, allowance_bytes)
  values (p_employee, v_day, greatest(0, coalesce(v_base, 0) + v_adj))
  on conflict (employee_id, day) do nothing;
end;
$$;

-- Recomputes today's allowance after a tier change or an adjustment.
create or replace function public.data_refresh_today(p_employee uuid)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_day date := public.data_today();
  v_base bigint;
  v_adj bigint;
begin
  perform public.data_ensure_day(p_employee);

  select coalesce(t.daily_bytes, 0) into v_base
  from public.data_plans p
  join public.data_tiers t on t.code = p.tier_code
  where p.employee_id = p_employee and p.status = 'active';

  select coalesce(sum(bytes), 0) into v_adj
  from public.data_adjustments where employee_id = p_employee and day = v_day;

  update public.data_usage_daily
  set allowance_bytes = greatest(0, coalesce(v_base, 0) + v_adj), updated_at = now()
  where employee_id = p_employee and day = v_day;
end;
$$;

create or replace function public.data_pool_remaining()
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((select sum(bytes) from public.data_pool_purchases), 0)
       - coalesce((select sum(used_bytes) from public.data_usage_daily), 0)
$$;

create or replace function public.data_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_workspace_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.data_today() from public, anon, authenticated;
revoke all on function public.data_seconds_to_reset() from public, anon, authenticated;
revoke all on function public.data_new_password() from public, anon, authenticated;
revoke all on function public.data_ensure_day(uuid) from public, anon, authenticated;
revoke all on function public.data_refresh_today(uuid) from public, anon, authenticated;
revoke all on function public.data_pool_remaining() from public, anon, authenticated;
revoke all on function public.data_require_admin() from public, anon, authenticated;
grant execute on function public.data_today(), public.data_seconds_to_reset(), public.data_new_password(),
  public.data_ensure_day(uuid), public.data_refresh_today(uuid), public.data_pool_remaining(),
  public.data_require_admin() to service_role;

-- ---------------------------------------------------------------------------
-- Administrator functions
-- ---------------------------------------------------------------------------

create or replace function public.admin_data_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public.data_today();
  v_purchased bigint;
  v_consumed bigint;
  v_commit bigint;
  v_today_used bigint;
  v_avg bigint;
  v_low integer;
  v_remaining bigint;
begin
  perform public.data_require_admin();

  select coalesce(sum(bytes), 0) into v_purchased from public.data_pool_purchases;
  select coalesce(sum(used_bytes), 0) into v_consumed from public.data_usage_daily;
  v_remaining := v_purchased - v_consumed;

  select coalesce(sum(t.daily_bytes), 0) into v_commit
  from public.data_plans p
  join public.data_tiers t on t.code = p.tier_code
  join public.employee_profiles e on e.id = p.employee_id and e.active
  where p.status = 'active';

  select coalesce(sum(used_bytes), 0) into v_today_used from public.data_usage_daily where day = v_today;
  select coalesce(sum(used_bytes), 0) / 7 into v_avg
  from public.data_usage_daily where day > v_today - 7;
  select low_pool_percent into v_low from public.data_settings where id;

  return jsonb_build_object(
    'purchased_bytes', v_purchased,
    'consumed_bytes', v_consumed,
    'remaining_bytes', v_remaining,
    'daily_commitment_bytes', v_commit,
    'used_today_bytes', v_today_used,
    'avg_daily_burn_bytes', v_avg,
    'runway_days_commitment', case when v_commit > 0 then round((greatest(v_remaining, 0))::numeric / v_commit, 1) end,
    'runway_days_actual', case when v_avg > 0 then round((greatest(v_remaining, 0))::numeric / v_avg, 1) end,
    'low_pool_percent', v_low,
    'pool_low', v_purchased > 0 and v_remaining * 100 < v_purchased * v_low,
    'pool_exhausted', v_purchased > 0 and v_remaining <= 0,
    'users_planned', (select count(*) from public.data_plans p join public.employee_profiles e on e.id = p.employee_id and e.active),
    'users_unplanned', (select count(*) from public.employee_profiles e where e.active
                        and not exists (select 1 from public.data_plans p where p.employee_id = e.id)),
    'users_out_today', (select count(*) from public.data_usage_daily u
                        where u.day = v_today and u.allowance_bytes > 0 and u.used_bytes >= u.allowance_bytes),
    'gateway_last_seen', (select max(last_update_at) from public.data_sessions),
    'gateway_active_sessions', (select count(*) from public.data_sessions
                                where ended_at is null and last_update_at > now() - interval '15 minutes'),
    'resets_in_seconds', public.data_seconds_to_reset()
  );
end;
$$;

create or replace function public.admin_data_users()
returns table (
  employee_id uuid,
  full_name text,
  email text,
  department text,
  tier_code text,
  plan_status text,
  daily_bytes bigint,
  allowance_bytes bigint,
  used_bytes bigint,
  last_seen timestamptz,
  has_credential boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.data_require_admin();

  return query
  select e.id, e.full_name, e.email, e.department,
         p.tier_code, p.status, t.daily_bytes,
         coalesce(u.allowance_bytes, case when p.status = 'active' then coalesce(t.daily_bytes, 0) else 0 end),
         coalesce(u.used_bytes, 0),
         (select max(s.last_update_at) from public.data_sessions s where s.employee_id = e.id),
         exists (select 1 from public.data_credentials c where c.employee_id = e.id)
  from public.employee_profiles e
  left join public.data_plans p on p.employee_id = e.id
  left join public.data_tiers t on t.code = p.tier_code
  left join public.data_usage_daily u on u.employee_id = e.id and u.day = public.data_today()
  where e.active
  order by e.full_name, e.email;
end;
$$;

create or replace function public.admin_data_history(p_days integer default 14)
returns table (day date, used_bytes bigint, allowance_bytes bigint, active_users integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  perform public.data_require_admin();

  return query
  select (public.data_today() - (v_days - 1) + g.i)::date,
         coalesce(sum(u.used_bytes), 0)::bigint,
         coalesce(sum(u.allowance_bytes), 0)::bigint,
         count(u.employee_id) filter (where u.used_bytes > 0)::integer
  from generate_series(0, v_days - 1) as g(i)
  left join public.data_usage_daily u on u.day = (public.data_today() - (v_days - 1) + g.i)
  group by g.i
  order by g.i;
end;
$$;

create or replace function public.admin_data_add_purchase(
  p_bytes bigint,
  p_label text default '',
  p_cost_ngn numeric default null,
  p_note text default '',
  p_purchased_on date default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.data_require_admin();

  if p_bytes is null or p_bytes <= 0 then
    raise exception 'Purchase size must be greater than zero';
  end if;
  -- 1 PB ceiling: catches a unit mistake (bytes typed where GB was meant)
  if p_bytes > 1125899906842624 then
    raise exception 'Purchase size is unrealistically large';
  end if;

  insert into public.data_pool_purchases (bytes, label, cost_ngn, note, purchased_on, created_by)
  values (p_bytes, coalesce(btrim(p_label), ''), p_cost_ngn, coalesce(btrim(p_note), ''),
          coalesce(p_purchased_on, public.data_today()), auth.uid())
  returning id into v_id;

  perform public.record_admin_audit('data.purchase.add', 'data_pool_purchase', v_id::text, null,
    jsonb_build_object('bytes', p_bytes, 'label', p_label, 'cost_ngn', p_cost_ngn), 'data-allocation');
  return v_id;
end;
$$;

create or replace function public.admin_data_set_plan(
  p_employee uuid,
  p_tier_code text,
  p_status text default 'active'
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := coalesce(p_status, 'active');
begin
  perform public.data_require_admin();

  if not exists (select 1 from public.employee_profiles where id = p_employee and active) then
    raise exception 'Employee not found or not active';
  end if;
  if v_status not in ('active', 'suspended') then
    raise exception 'Status must be active or suspended';
  end if;

  if p_tier_code is null then
    delete from public.data_plans where employee_id = p_employee;
  else
    if not exists (select 1 from public.data_tiers where code = p_tier_code and active) then
      raise exception 'Unknown data tier';
    end if;
    insert into public.data_plans (employee_id, tier_code, status, updated_by)
    values (p_employee, p_tier_code, v_status, auth.uid())
    on conflict (employee_id) do update
      set tier_code = excluded.tier_code, status = excluded.status,
          updated_by = excluded.updated_by, updated_at = now();
  end if;

  -- Only touch today's row when there is something to reflect, so removing a plan
  -- from someone who never used data does not create an empty row.
  if exists (select 1 from public.data_usage_daily where employee_id = p_employee and day = public.data_today())
     or p_tier_code is not null then
    perform public.data_refresh_today(p_employee);
  end if;

  perform public.record_admin_audit('data.plan.set', 'data_plan', p_employee::text, p_employee,
    jsonb_build_object('tier', p_tier_code, 'status', v_status), 'data-allocation');
end;
$$;

create or replace function public.admin_data_bulk_set_plan(p_employees uuid[], p_tier_code text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  perform public.data_require_admin();

  if p_employees is null or cardinality(p_employees) = 0 then
    raise exception 'Choose at least one employee';
  end if;
  if cardinality(p_employees) > 500 then
    raise exception 'Too many employees in one request';
  end if;

  foreach v_id in array p_employees loop
    perform public.admin_data_set_plan(
      v_id, p_tier_code,
      coalesce((select status from public.data_plans where employee_id = v_id), 'active'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.admin_data_adjust(p_employee uuid, p_bytes bigint, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := public.data_today();
  v_allowance bigint;
begin
  perform public.data_require_admin();

  if p_bytes is null or p_bytes = 0 then
    raise exception 'Adjustment cannot be zero';
  end if;
  if abs(p_bytes) > 107374182400 then
    raise exception 'Adjustment is unrealistically large';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required';
  end if;
  if not exists (select 1 from public.employee_profiles where id = p_employee and active) then
    raise exception 'Employee not found or not active';
  end if;

  perform public.data_ensure_day(p_employee);
  select allowance_bytes into v_allowance from public.data_usage_daily
    where employee_id = p_employee and day = v_day for update;
  if v_allowance + p_bytes < 0 then
    raise exception 'That would take today''s allowance below zero';
  end if;

  insert into public.data_adjustments (employee_id, day, bytes, reason, created_by)
  values (p_employee, v_day, p_bytes, btrim(p_reason), auth.uid());
  perform public.data_refresh_today(p_employee);

  perform public.record_admin_audit('data.adjust', 'data_adjustment', p_employee::text, p_employee,
    jsonb_build_object('bytes', p_bytes, 'reason', btrim(p_reason), 'day', v_day), 'data-allocation');
end;
$$;

-- For people whose data is NOT metered by the gateway (for example a personal MiFi on
-- its own SIM): the administrator records what the SIM actually used.
create or replace function public.admin_data_record_usage(p_employee uuid, p_bytes bigint, p_note text default '')
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.data_require_admin();

  if p_bytes is null or p_bytes <= 0 then
    raise exception 'Usage must be greater than zero';
  end if;
  if p_bytes > 107374182400 then
    raise exception 'Usage is unrealistically large';
  end if;
  if not exists (select 1 from public.employee_profiles where id = p_employee and active) then
    raise exception 'Employee not found or not active';
  end if;

  perform public.data_ensure_day(p_employee);
  update public.data_usage_daily
  set used_bytes = used_bytes + p_bytes, manual_bytes = manual_bytes + p_bytes, updated_at = now()
  where employee_id = p_employee and day = public.data_today();

  perform public.record_admin_audit('data.usage.manual', 'data_usage', p_employee::text, p_employee,
    jsonb_build_object('bytes', p_bytes, 'note', coalesce(btrim(p_note), '')), 'data-allocation');
end;
$$;

create or replace function public.admin_data_reset_password(p_employee uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_password text;
begin
  perform public.data_require_admin();

  if not exists (select 1 from public.employee_profiles where id = p_employee and active) then
    raise exception 'Employee not found or not active';
  end if;

  v_password := public.data_new_password();
  insert into public.data_credentials (employee_id, password_hash)
  values (p_employee, crypt(v_password, gen_salt('bf', 10)))
  on conflict (employee_id) do update
    set password_hash = excluded.password_hash, rotated_at = now(), failed_count = 0, locked_until = null;

  -- The password itself is never written to the audit log.
  perform public.record_admin_audit('data.password.reset', 'data_credential', p_employee::text, p_employee,
    '{}'::jsonb, 'data-allocation');
  return v_password;
end;
$$;

create or replace function public.admin_data_set_alert(p_percent integer)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.data_require_admin();
  if p_percent is null or p_percent < 1 or p_percent > 90 then
    raise exception 'Alert level must be between 1 and 90 percent';
  end if;
  update public.data_settings set low_pool_percent = p_percent, updated_at = now() where id;
  perform public.record_admin_audit('data.alert.set', 'data_settings', 'low_pool_percent', null,
    jsonb_build_object('percent', p_percent), 'data-allocation');
end;
$$;

create or replace function public.admin_data_save_device(
  p_id uuid,
  p_label text,
  p_msisdn text default '',
  p_imei text default '',
  p_employee uuid default null,
  p_note text default '',
  p_active boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
begin
  perform public.data_require_admin();

  if p_label is null or length(btrim(p_label)) = 0 then
    raise exception 'Give the device a label';
  end if;
  if coalesce(p_msisdn, '') !~ '^[0-9+ ]{0,20}$' then
    raise exception 'Phone number can only contain digits, spaces and +';
  end if;
  if coalesce(p_imei, '') !~ '^[0-9]{0,17}$' then
    raise exception 'IMEI can only contain digits';
  end if;

  if v_id is null then
    insert into public.data_devices (label, msisdn, imei, employee_id, note, active)
    values (btrim(p_label), coalesce(btrim(p_msisdn), ''), coalesce(btrim(p_imei), ''), p_employee,
            coalesce(btrim(p_note), ''), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.data_devices
    set label = btrim(p_label), msisdn = coalesce(btrim(p_msisdn), ''), imei = coalesce(btrim(p_imei), ''),
        employee_id = p_employee, note = coalesce(btrim(p_note), ''), active = coalesce(p_active, true),
        updated_at = now()
    where id = v_id;
    if not found then raise exception 'Device not found'; end if;
  end if;

  perform public.record_admin_audit('data.device.save', 'data_device', v_id::text, p_employee,
    jsonb_build_object('label', p_label), 'data-allocation');
  return v_id;
end;
$$;

create or replace function public.admin_data_delete_device(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.data_require_admin();
  delete from public.data_devices where id = p_id;
  perform public.record_admin_audit('data.device.delete', 'data_device', p_id::text, null, '{}'::jsonb, 'data-allocation');
end;
$$;

-- ---------------------------------------------------------------------------
-- Employee functions
-- ---------------------------------------------------------------------------

create or replace function public.my_data_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_plan record;
  v_row record;
  v_email text;
  v_pool bigint := public.data_pool_remaining();
  v_allow bigint;
  v_used bigint;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select email into v_email from public.employee_profiles where id = v_uid;
  select p.status, t.label, t.daily_bytes into v_plan
  from public.data_plans p join public.data_tiers t on t.code = p.tier_code
  where p.employee_id = v_uid;

  if not found then
    return jsonb_build_object('has_plan', false);
  end if;

  select allowance_bytes, used_bytes into v_row from public.data_usage_daily
  where employee_id = v_uid and day = public.data_today();
  v_allow := coalesce(v_row.allowance_bytes, case when v_plan.status = 'active' then v_plan.daily_bytes else 0 end);
  v_used := coalesce(v_row.used_bytes, 0);

  return jsonb_build_object(
    'has_plan', true,
    'status', v_plan.status,
    'tier_label', v_plan.label,
    'daily_bytes', v_plan.daily_bytes,
    'allowance_bytes', v_allow,
    'used_bytes', v_used,
    'remaining_bytes', greatest(0, v_allow - v_used),
    'resets_in_seconds', public.data_seconds_to_reset(),
    'username', v_email,
    'has_password', exists (select 1 from public.data_credentials where employee_id = v_uid),
    'pool_exhausted', v_pool <= 0
  );
end;
$$;

create or replace function public.my_data_rotate_password()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_password text;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employee_profiles where id = v_uid and active) then
    raise exception 'Your account is not active';
  end if;
  if not exists (select 1 from public.data_plans where employee_id = v_uid) then
    raise exception 'No data plan is assigned to you yet. Ask Administration.';
  end if;

  v_password := public.data_new_password();
  insert into public.data_credentials (employee_id, password_hash)
  values (v_uid, crypt(v_password, gen_salt('bf', 10)))
  on conflict (employee_id) do update
    set password_hash = excluded.password_hash, rotated_at = now(), failed_count = 0, locked_until = null;
  return v_password;
end;
$$;

-- ---------------------------------------------------------------------------
-- RADIUS-facing functions (service_role only, called by the data-radius Edge Function)
-- ---------------------------------------------------------------------------

-- Decides whether a person may connect right now. The password is checked FIRST so a
-- wrong password never reveals whether the account has a plan or is out of data.
create or replace function public.radius_verify(p_username text, p_password text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_emp record;
  v_cred record;
  v_plan record;
  v_row record;
  v_user_left bigint;
  v_pool bigint;
begin
  select id, email into v_emp from public.employee_profiles
  where lower(email) = lower(btrim(coalesce(p_username, ''))) and active;

  if not found then
    -- spend the same time as a real check so usernames cannot be probed by timing
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'reason', 'unknown_user');
  end if;

  select * into v_cred from public.data_credentials where employee_id = v_emp.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_credential', 'employee_id', v_emp.id);
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'employee_id', v_emp.id);
  end if;

  if coalesce(p_password, '') = '' or v_cred.password_hash <> crypt(p_password, v_cred.password_hash) then
    update public.data_credentials
    set failed_count = failed_count + 1,
        locked_until = case when failed_count + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where employee_id = v_emp.id;
    return jsonb_build_object('ok', false, 'reason', 'bad_password', 'employee_id', v_emp.id);
  end if;

  update public.data_credentials set failed_count = 0, locked_until = null where employee_id = v_emp.id;

  select p.status, t.daily_bytes into v_plan
  from public.data_plans p join public.data_tiers t on t.code = p.tier_code
  where p.employee_id = v_emp.id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_plan', 'employee_id', v_emp.id);
  end if;
  if v_plan.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'suspended', 'employee_id', v_emp.id);
  end if;

  perform public.data_ensure_day(v_emp.id);
  select allowance_bytes, used_bytes into v_row from public.data_usage_daily
  where employee_id = v_emp.id and day = public.data_today();
  v_user_left := v_row.allowance_bytes - v_row.used_bytes;
  v_pool := public.data_pool_remaining();

  if v_pool <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'pool_exhausted', 'employee_id', v_emp.id);
  end if;
  if v_user_left <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'quota_exhausted', 'employee_id', v_emp.id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'remaining_bytes', least(v_user_left, v_pool),
    'daily_bytes', v_plan.daily_bytes,
    'session_timeout', public.data_seconds_to_reset()
  );
end;
$$;

-- Debits usage from a NAS accounting packet. Counters in RADIUS are cumulative per
-- session, so only the growth since the previous packet is charged. A counter that goes
-- backwards (NAS rebooted and reused the session id) is treated as a fresh counter.
-- Retransmitted packets carry the same totals and therefore charge nothing twice.
create or replace function public.radius_account(
  p_username text,
  p_status text,
  p_session_id text,
  p_input_octets bigint,
  p_output_octets bigint,
  p_nas_ip text default '',
  p_nas_identifier text default '',
  p_framed_ip text default '',
  p_calling_station text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp uuid;
  v_nas text := coalesce(p_nas_ip, '');
  v_found boolean;
  v_last_in bigint := 0;
  v_last_out bigint := 0;
  v_in bigint := greatest(coalesce(p_input_octets, 0), 0);
  v_out bigint := greatest(coalesce(p_output_octets, 0), 0);
  v_d_in bigint;
  v_d_out bigint;
  v_row record;
begin
  if p_status in ('Accounting-On', 'Accounting-Off') then
    update public.data_sessions set ended_at = now()
    where nas_ip = v_nas and ended_at is null;
    return jsonb_build_object('ok', true, 'closed_sessions', true);
  end if;

  if p_status not in ('Start', 'Interim-Update', 'Stop') or coalesce(p_session_id, '') = '' then
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;

  select id into v_emp from public.employee_profiles where lower(email) = lower(btrim(coalesce(p_username, '')));
  if v_emp is null then
    -- always acknowledge, otherwise the NAS retries the same packet forever
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;

  select last_in, last_out into v_last_in, v_last_out
  from public.data_sessions where session_id = p_session_id and nas_ip = v_nas for update;
  v_found := found;

  if not v_found then
    insert into public.data_sessions (session_id, nas_ip, nas_identifier, employee_id, username, framed_ip, calling_station,
                                      last_in, last_out, ended_at)
    values (p_session_id, v_nas, coalesce(p_nas_identifier, ''), v_emp, lower(btrim(p_username)),
            coalesce(p_framed_ip, ''), coalesce(p_calling_station, ''), 0, 0, null);
    v_last_in := 0;
    v_last_out := 0;
  end if;

  v_d_in := case when v_in >= v_last_in then v_in - v_last_in else v_in end;
  v_d_out := case when v_out >= v_last_out then v_out - v_last_out else v_out end;

  update public.data_sessions
  set last_in = v_in, last_out = v_out, last_update_at = now(),
      framed_ip = case when coalesce(p_framed_ip, '') <> '' then p_framed_ip else framed_ip end,
      calling_station = case when coalesce(p_calling_station, '') <> '' then p_calling_station else calling_station end,
      ended_at = case when p_status = 'Stop' then now() else null end
  where session_id = p_session_id and nas_ip = v_nas;

  perform public.data_ensure_day(v_emp);
  update public.data_usage_daily
  set used_bytes = used_bytes + v_d_in + v_d_out,
      bytes_in = bytes_in + v_d_in,
      bytes_out = bytes_out + v_d_out,
      updated_at = now()
  where employee_id = v_emp and day = public.data_today()
  returning allowance_bytes, used_bytes into v_row;

  return jsonb_build_object(
    'ok', true,
    'charged_bytes', v_d_in + v_d_out,
    'remaining_bytes', greatest(0, v_row.allowance_bytes - v_row.used_bytes),
    'over_quota', v_row.used_bytes >= v_row.allowance_bytes or public.data_pool_remaining() <= 0
  );
end;
$$;

-- Open sessions that should be cut now: out of data, plan suspended or removed, the
-- employee deactivated, or the whole pool empty. The enforcer script on the RADIUS
-- server sends a Disconnect-Request for each row.
create or replace function public.radius_over_quota()
returns table (session_id text, username text, nas_ip text, nas_identifier text, framed_ip text, calling_station text, reason text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.session_id, s.username, s.nas_ip, s.nas_identifier, s.framed_ip, s.calling_station,
         case
           when not e.active then 'employee_inactive'
           when p.employee_id is null then 'no_plan'
           when p.status <> 'active' then 'suspended'
           when public.data_pool_remaining() <= 0 then 'pool_exhausted'
           else 'quota_exhausted'
         end
  from public.data_sessions s
  join public.employee_profiles e on e.id = s.employee_id
  left join public.data_plans p on p.employee_id = s.employee_id
  left join public.data_usage_daily u on u.employee_id = s.employee_id and u.day = public.data_today()
  where s.ended_at is null
    and s.last_update_at > now() - interval '30 minutes'
    and (
      not e.active
      or p.employee_id is null
      or p.status <> 'active'
      or public.data_pool_remaining() <= 0
      or (u.employee_id is not null and u.used_bytes >= u.allowance_bytes)
    )
$$;

-- Sessions that stopped reporting (NAS lost power, link dropped) would otherwise look
-- open forever and keep the "connected" indicator green.
create or replace function public.radius_close_stale_sessions()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.data_sessions set ended_at = now()
  where ended_at is null and last_update_at < now() - interval '6 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Grants ---------------------------------------------------------------------

revoke all on function public.admin_data_overview() from public, anon;
revoke all on function public.admin_data_users() from public, anon;
revoke all on function public.admin_data_history(integer) from public, anon;
revoke all on function public.admin_data_add_purchase(bigint, text, numeric, text, date) from public, anon;
revoke all on function public.admin_data_set_plan(uuid, text, text) from public, anon;
revoke all on function public.admin_data_bulk_set_plan(uuid[], text) from public, anon;
revoke all on function public.admin_data_adjust(uuid, bigint, text) from public, anon;
revoke all on function public.admin_data_record_usage(uuid, bigint, text) from public, anon;
revoke all on function public.admin_data_reset_password(uuid) from public, anon;
revoke all on function public.admin_data_set_alert(integer) from public, anon;
revoke all on function public.admin_data_save_device(uuid, text, text, text, uuid, text, boolean) from public, anon;
revoke all on function public.admin_data_delete_device(uuid) from public, anon;
revoke all on function public.my_data_status() from public, anon;
revoke all on function public.my_data_rotate_password() from public, anon;

grant execute on function public.admin_data_overview() to authenticated;
grant execute on function public.admin_data_users() to authenticated;
grant execute on function public.admin_data_history(integer) to authenticated;
grant execute on function public.admin_data_add_purchase(bigint, text, numeric, text, date) to authenticated;
grant execute on function public.admin_data_set_plan(uuid, text, text) to authenticated;
grant execute on function public.admin_data_bulk_set_plan(uuid[], text) to authenticated;
grant execute on function public.admin_data_adjust(uuid, bigint, text) to authenticated;
grant execute on function public.admin_data_record_usage(uuid, bigint, text) to authenticated;
grant execute on function public.admin_data_reset_password(uuid) to authenticated;
grant execute on function public.admin_data_set_alert(integer) to authenticated;
grant execute on function public.admin_data_save_device(uuid, text, text, text, uuid, text, boolean) to authenticated;
grant execute on function public.admin_data_delete_device(uuid) to authenticated;
grant execute on function public.my_data_status() to authenticated;
grant execute on function public.my_data_rotate_password() to authenticated;

revoke all on function public.radius_verify(text, text) from public, anon, authenticated;
revoke all on function public.radius_account(text, text, text, bigint, bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.radius_over_quota() from public, anon, authenticated;
revoke all on function public.radius_close_stale_sessions() from public, anon, authenticated;
grant execute on function public.radius_verify(text, text) to service_role;
grant execute on function public.radius_account(text, text, text, bigint, bigint, text, text, text, text) to service_role;
grant execute on function public.radius_over_quota() to service_role;
grant execute on function public.radius_close_stale_sessions() to service_role;
