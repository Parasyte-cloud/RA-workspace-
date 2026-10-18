-- Daily data delivery for remote staff.
--
-- Everyone works from their own location on their own MTN line, so allowances are delivered by
-- buying each person's daily bundle straight into their own number (through a data reseller API)
-- instead of metering traffic at an office gateway. This migration adds:
--   * each person's MTN number on their plan,
--   * the reseller bundle (variation code and price) behind each of the five tiers,
--   * a delivery ledger with exactly one row per person per Lagos day,
--   * a master switch (off by default) and a daily spend cap,
--   * service-only functions the data-topup Edge Function calls, and admin screens' functions.
--
-- Safety rules this file enforces in the database, not just in the app:
--   * nothing is bought unless an administrator has switched delivery on and set a spend cap,
--   * one delivery per person per day, never bought again while the outcome is unknown,
--   * the pool and the daily cap are checked while rows are claimed, under a lock, so two
--     overlapping runs cannot overspend.

begin;

alter table public.data_tiers
  add column if not exists provider_variation text not null default '' check (provider_variation ~ '^[A-Za-z0-9._-]{0,80}$'),
  add column if not exists price_ngn numeric(12,2) check (price_ngn is null or price_ngn >= 0);

alter table public.data_plans
  add column if not exists msisdn text check (msisdn is null or msisdn ~ '^0[789][01][0-9]{8}$');
create unique index if not exists data_plans_msisdn_uq on public.data_plans (msisdn) where msisdn is not null;

alter table public.data_settings
  add column if not exists topup_enabled boolean not null default false,
  add column if not exists daily_spend_cap_ngn numeric(14,2) not null default 0 check (daily_spend_cap_ngn >= 0);

create table if not exists public.data_topups (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  day date not null,
  tier_code text not null references public.data_tiers(code),
  bytes bigint not null check (bytes > 0),
  msisdn text not null,
  variation text not null,
  price_ngn numeric(12,2) not null default 0,
  request_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_ref text,
  amount_ngn numeric(12,2),
  message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, day)
);
create index if not exists data_topups_day_idx on public.data_topups (day, status);

alter table public.data_topups enable row level security;
revoke all on public.data_topups from anon, authenticated;
drop policy if exists "data topups admin read" on public.data_topups;
create policy "data topups admin read" on public.data_topups for select to authenticated
  using (public.is_workspace_admin());
grant select on public.data_topups to authenticated;

-- ---------------------------------------------------------------------------
-- Service functions (called by the data-topup Edge Function only)
-- ---------------------------------------------------------------------------

-- Picks who still needs today's bundle and reserves them. Returns a jsonb array.
create or replace function public.topup_claim_batch(p_stamp text, p_limit integer default 40)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := public.data_today();
  v_enabled boolean;
  v_cap numeric;
  v_committed numeric;
  v_pool bigint;
  r record;
  v_attempt integer;
  v_id uuid;
  v_rid text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_stamp is null or p_stamp !~ '^[0-9]{12}$' then
    raise exception 'Request stamp must be 12 digits (YYYYMMDDHHII)';
  end if;

  -- One claimer at a time, so overlapping runs cannot both spend the same budget.
  perform pg_advisory_xact_lock(hashtext('data-topup-claim'));

  select s.topup_enabled, s.daily_spend_cap_ngn into v_enabled, v_cap from public.data_settings s where s.id;
  if not coalesce(v_enabled, false) or coalesce(v_cap, 0) <= 0 then
    return v_out;
  end if;

  select coalesce(sum(case when t.status = 'delivered' then coalesce(t.amount_ngn, t.price_ngn)
                           when t.status = 'pending' then t.price_ngn else 0 end), 0)
  into v_committed
  from public.data_topups t where t.day = v_day;

  v_pool := public.data_pool_remaining()
          - coalesce((select sum(t.bytes) from public.data_topups t where t.day = v_day and t.status = 'pending'), 0);

  for r in
    select p.employee_id as emp, p.msisdn as phone, p.tier_code as tier,
           t.daily_bytes as bytes, t.provider_variation as variation, t.price_ngn as price
    from public.data_plans p
    join public.data_tiers t on t.code = p.tier_code
    join public.employee_profiles e on e.id = p.employee_id and e.active
    where p.status = 'active'
      and p.msisdn is not null
      and t.provider_variation <> ''
      and coalesce(t.price_ngn, 0) > 0
      and not exists (
        select 1 from public.data_topups x
        where x.employee_id = p.employee_id and x.day = v_day
          and (x.status in ('delivered', 'pending') or (x.status = 'failed' and x.attempts >= 3))
      )
    order by e.full_name, p.employee_id
    limit greatest(1, least(coalesce(p_limit, 40), 200))
  loop
    if v_pool < r.bytes then continue; end if;
    if v_committed + r.price > v_cap then continue; end if;

    select coalesce(x.attempts, 0) + 1 into v_attempt
    from (select 1) d left join public.data_topups x on x.employee_id = r.emp and x.day = v_day;
    v_id := coalesce((select x.id from public.data_topups x where x.employee_id = r.emp and x.day = v_day), gen_random_uuid());
    v_rid := p_stamp || 'ra' || substr(replace(v_id::text, '-', ''), 1, 12) || 'a' || v_attempt;

    insert into public.data_topups (id, employee_id, day, tier_code, bytes, msisdn, variation, price_ngn, request_id, status, attempts)
    values (v_id, r.emp, v_day, r.tier, r.bytes, r.phone, r.variation, r.price, v_rid, 'pending', v_attempt)
    on conflict (employee_id, day) do update
      set tier_code = excluded.tier_code, bytes = excluded.bytes, msisdn = excluded.msisdn,
          variation = excluded.variation, price_ngn = excluded.price_ngn, request_id = excluded.request_id,
          status = 'pending', attempts = excluded.attempts, message = '', updated_at = now();

    v_pool := v_pool - r.bytes;
    v_committed := v_committed + r.price;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'employee_id', r.emp, 'msisdn', r.phone, 'variation', r.variation,
      'request_id', v_rid, 'tier_code', r.tier, 'bytes', r.bytes, 'price_ngn', r.price));
  end loop;

  return v_out;
end;
$$;

-- Deliveries still waiting for an answer, to be asked about again before anything new is bought.
create or replace function public.topup_pending(p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'request_id', t.request_id,
           'age_minutes', floor(extract(epoch from (now() - t.updated_at)) / 60)::int
         ) order by t.updated_at), '[]'::jsonb)
  from (select * from public.data_topups where status = 'pending' order by updated_at limit greatest(1, least(coalesce(p_limit, 100), 500))) t
$$;

-- Records the outcome. A delivered row is final: nothing can move it back.
create or replace function public.topup_complete(
  p_id uuid,
  p_status text,
  p_ref text default null,
  p_amount numeric default null,
  p_message text default ''
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  t public.data_topups%rowtype;
begin
  if p_status not in ('delivered', 'failed', 'pending', 'skipped') then
    raise exception 'Unknown delivery status';
  end if;

  select * into t from public.data_topups where id = p_id for update;
  if not found then
    raise exception 'Delivery not found';
  end if;
  if t.status = 'delivered' then
    return; -- final
  end if;

  if p_status = 'delivered' then
    update public.data_topups
    set status = 'delivered', provider_ref = left(coalesce(p_ref, ''), 120),
        amount_ngn = p_amount, message = left(coalesce(p_message, ''), 300), updated_at = now()
    where id = p_id;
    -- A delivered bundle is spent from the pool for that day.
    insert into public.data_usage_daily (employee_id, day, allowance_bytes, used_bytes)
    values (t.employee_id, t.day, t.bytes, t.bytes)
    on conflict (employee_id, day) do update
      set used_bytes = greatest(public.data_usage_daily.used_bytes, excluded.used_bytes), updated_at = now();
  elsif p_status = 'skipped' then
    update public.data_topups
    set status = 'skipped', attempts = greatest(attempts - 1, 0), message = left(coalesce(p_message, ''), 300), updated_at = now()
    where id = p_id;
  else
    update public.data_topups
    set status = p_status, message = left(coalesce(p_message, ''), 300),
        provider_ref = coalesce(nullif(left(coalesce(p_ref, ''), 120), ''), provider_ref), updated_at = now()
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.topup_claim_batch(text, integer) from public, anon, authenticated;
revoke all on function public.topup_pending(integer) from public, anon, authenticated;
revoke all on function public.topup_complete(uuid, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.topup_claim_batch(text, integer) to service_role;
grant execute on function public.topup_pending(integer) to service_role;
grant execute on function public.topup_complete(uuid, text, text, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- Administrator functions
-- ---------------------------------------------------------------------------

create or replace function public.data_clean_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g');
begin
  if v = '' then return null; end if;
  if v like '+234%' then v := '0' || substr(v, 5);
  elsif v like '234%' and length(v) = 13 then v := '0' || substr(v, 4);
  end if;
  if v !~ '^0[789][01][0-9]{8}$' then
    raise exception 'Phone number must be a Nigerian mobile number such as 0803 123 4567';
  end if;
  return v;
end;
$$;

create or replace function public.data_mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_phone is null then null else substr(p_phone, 1, 4) || ' *** ' || right(p_phone, 4) end
$$;

create or replace function public.admin_data_set_phone(p_employee uuid, p_phone text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  perform public.data_require_admin();
  v := public.data_clean_phone(p_phone);
  if not exists (select 1 from public.data_plans where employee_id = p_employee) then
    raise exception 'Give this person a daily plan before adding their number';
  end if;
  if v is not null and exists (select 1 from public.data_plans where msisdn = v and employee_id <> p_employee) then
    raise exception 'That number is already assigned to someone else';
  end if;
  update public.data_plans set msisdn = v, updated_by = auth.uid(), updated_at = now() where employee_id = p_employee;
  perform public.record_admin_audit('data.phone.set', 'data_plan', p_employee::text, p_employee,
    jsonb_build_object('phone', public.data_mask_phone(v)), 'data-allocation');
end;
$$;

-- Bulk import: [{"email": "...", "phone": "..."}]. Reports problems per row instead of failing the lot.
create or replace function public.admin_data_import_phones(p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  v_emp uuid;
  v_phone text;
  v_updated integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  perform public.data_require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Send a list of at most 500 rows';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      select e.id into v_emp from public.employee_profiles e
      where e.active and lower(e.email) = lower(trim(coalesce(r->>'email', '')));
      if v_emp is null then raise exception 'No active person with that email'; end if;
      if not exists (select 1 from public.data_plans where employee_id = v_emp) then
        raise exception 'No daily plan yet';
      end if;
      v_phone := public.data_clean_phone(r->>'phone');
      if v_phone is not null and exists (select 1 from public.data_plans where msisdn = v_phone and employee_id <> v_emp) then
        raise exception 'Number already assigned to someone else';
      end if;
      update public.data_plans set msisdn = v_phone, updated_by = auth.uid(), updated_at = now() where employee_id = v_emp;
      v_updated := v_updated + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('email', r->>'email', 'error', sqlerrm));
    end;
  end loop;

  perform public.record_admin_audit('data.phone.import', 'data_plan', null, null,
    jsonb_build_object('updated', v_updated, 'errors', jsonb_array_length(v_errors)), 'data-allocation');
  return jsonb_build_object('updated', v_updated, 'errors', v_errors);
end;
$$;

create or replace function public.admin_data_set_tier_bundle(p_tier_code text, p_variation text, p_price numeric)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v text := trim(coalesce(p_variation, ''));
begin
  perform public.data_require_admin();
  if not exists (select 1 from public.data_tiers where code = p_tier_code) then
    raise exception 'Unknown data tier';
  end if;
  if v <> '' and (p_price is null or p_price <= 0) then
    raise exception 'Enter the bundle price in naira';
  end if;
  if v !~ '^[A-Za-z0-9._-]{0,80}$' then
    raise exception 'Bundle code can only contain letters, numbers, dot, dash and underscore';
  end if;
  update public.data_tiers
  set provider_variation = v, price_ngn = case when v = '' then null else p_price end
  where code = p_tier_code;
  perform public.record_admin_audit('data.tier.bundle', 'data_tier', p_tier_code, null,
    jsonb_build_object('variation', v, 'price_ngn', case when v = '' then null else p_price end), 'data-allocation');
end;
$$;

create or replace function public.admin_data_set_topup(p_enabled boolean, p_cap numeric)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.data_require_admin();
  if p_enabled then
    if p_cap is null or p_cap <= 0 then
      raise exception 'Set a daily spending limit in naira before turning delivery on';
    end if;
    if not exists (select 1 from public.data_tiers where provider_variation <> '' and coalesce(price_ngn, 0) > 0) then
      raise exception 'Choose the bundle for at least one plan before turning delivery on';
    end if;
  end if;
  update public.data_settings
  set topup_enabled = coalesce(p_enabled, false), daily_spend_cap_ngn = greatest(coalesce(p_cap, 0), 0), updated_at = now()
  where id;
  perform public.record_admin_audit('data.topup.settings', 'data_settings', 'topup', null,
    jsonb_build_object('enabled', coalesce(p_enabled, false), 'cap_ngn', p_cap), 'data-allocation');
end;
$$;

create or replace function public.admin_data_topup_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := public.data_today();
begin
  perform public.data_require_admin();
  return jsonb_build_object(
    'enabled', (select s.topup_enabled from public.data_settings s where s.id),
    'cap_ngn', (select s.daily_spend_cap_ngn from public.data_settings s where s.id),
    'spent_today_ngn', (select coalesce(sum(coalesce(t.amount_ngn, t.price_ngn)), 0) from public.data_topups t where t.day = v_day and t.status = 'delivered'),
    'delivered_today', (select count(*) from public.data_topups t where t.day = v_day and t.status = 'delivered'),
    'pending_today', (select count(*) from public.data_topups t where t.day = v_day and t.status = 'pending'),
    'failed_today', (select count(*) from public.data_topups t where t.day = v_day and t.status = 'failed'),
    'people_planned', (select count(*) from public.data_plans p join public.employee_profiles e on e.id = p.employee_id and e.active where p.status = 'active'),
    'people_ready', (select count(*) from public.data_plans p
                     join public.employee_profiles e on e.id = p.employee_id and e.active
                     join public.data_tiers t on t.code = p.tier_code
                     where p.status = 'active' and p.msisdn is not null and t.provider_variation <> '' and coalesce(t.price_ngn, 0) > 0),
    'people_missing_phone', (select count(*) from public.data_plans p join public.employee_profiles e on e.id = p.employee_id and e.active
                             where p.status = 'active' and p.msisdn is null),
    'last_activity', (select max(t.updated_at) from public.data_topups t),
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', t.code, 'label', t.label, 'daily_bytes', t.daily_bytes,
                'provider_variation', t.provider_variation, 'price_ngn', t.price_ngn) order by t.sort_order), '[]'::jsonb)
              from public.data_tiers t where t.active),
    'resets_in_seconds', public.data_seconds_to_reset()
  );
end;
$$;

create or replace function public.admin_data_phones()
returns table (employee_id uuid, msisdn text, today_status text, today_message text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.data_require_admin();
  return query
  select p.employee_id, p.msisdn, x.status, x.message
  from public.data_plans p
  left join public.data_topups x on x.employee_id = p.employee_id and x.day = public.data_today();
end;
$$;

create or replace function public.admin_data_topups(p_days integer default 3)
returns table (
  id uuid, day date, employee_id uuid, full_name text, msisdn_masked text, tier_code text,
  status text, attempts integer, amount_ngn numeric, message text, request_id text, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.data_require_admin();
  return query
  select t.id, t.day, t.employee_id, coalesce(nullif(e.full_name, ''), e.email), public.data_mask_phone(t.msisdn),
         t.tier_code, t.status, t.attempts, coalesce(t.amount_ngn, t.price_ngn), t.message, t.request_id, t.updated_at
  from public.data_topups t
  join public.employee_profiles e on e.id = t.employee_id
  where t.day > public.data_today() - least(greatest(coalesce(p_days, 3), 1), 31)
  order by t.day desc, t.updated_at desc
  limit 400;
end;
$$;

-- For a delivery whose outcome stayed unknown: the administrator checks the reseller dashboard
-- and says what happened. Delivered is final. Failed lets the next run try again.
create or replace function public.admin_data_topup_resolve(p_id uuid, p_delivered boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  t public.data_topups%rowtype;
begin
  perform public.data_require_admin();
  select * into t from public.data_topups where id = p_id;
  if not found then raise exception 'Delivery not found'; end if;
  if t.status <> 'pending' then raise exception 'Only a waiting delivery can be resolved'; end if;
  perform public.topup_complete(
    p_id,
    case when p_delivered then 'delivered' else 'failed' end,
    null, null,
    case when p_delivered then 'Confirmed by an administrator' else 'Marked as not delivered by an administrator' end);
  perform public.record_admin_audit('data.topup.resolve', 'data_topup', p_id::text, t.employee_id,
    jsonb_build_object('delivered', p_delivered, 'day', t.day), 'data-allocation');
end;
$$;

-- What the signed-in person sees about their own delivery.
create or replace function public.my_data_delivery()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_plan record;
  v_today record;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  select p.status, p.msisdn, t.label, t.daily_bytes into v_plan
  from public.data_plans p join public.data_tiers t on t.code = p.tier_code
  where p.employee_id = v_uid;
  if not found then
    return jsonb_build_object('has_plan', false);
  end if;
  select x.status, x.message, x.updated_at into v_today
  from public.data_topups x where x.employee_id = v_uid and x.day = public.data_today();
  return jsonb_build_object(
    'has_plan', true,
    'status', v_plan.status,
    'tier_label', v_plan.label,
    'daily_bytes', v_plan.daily_bytes,
    'has_phone', v_plan.msisdn is not null,
    'phone_masked', public.data_mask_phone(v_plan.msisdn),
    'delivery_enabled', (select s.topup_enabled from public.data_settings s where s.id),
    'today_status', v_today.status,
    'today_message', v_today.message,
    'today_at', v_today.updated_at,
    'resets_in_seconds', public.data_seconds_to_reset()
  );
end;
$$;

revoke all on function public.data_clean_phone(text) from public, anon, authenticated;
revoke all on function public.data_mask_phone(text) from public, anon, authenticated;
revoke all on function public.admin_data_set_phone(uuid, text) from public, anon;
revoke all on function public.admin_data_import_phones(jsonb) from public, anon;
revoke all on function public.admin_data_set_tier_bundle(text, text, numeric) from public, anon;
revoke all on function public.admin_data_set_topup(boolean, numeric) from public, anon;
revoke all on function public.admin_data_topup_overview() from public, anon;
revoke all on function public.admin_data_phones() from public, anon;
revoke all on function public.admin_data_topups(integer) from public, anon;
revoke all on function public.admin_data_topup_resolve(uuid, boolean) from public, anon;
revoke all on function public.my_data_delivery() from public, anon;
grant execute on function public.data_clean_phone(text), public.data_mask_phone(text) to service_role;
grant execute on function public.admin_data_set_phone(uuid, text) to authenticated;
grant execute on function public.admin_data_import_phones(jsonb) to authenticated;
grant execute on function public.admin_data_set_tier_bundle(text, text, numeric) to authenticated;
grant execute on function public.admin_data_set_topup(boolean, numeric) to authenticated;
grant execute on function public.admin_data_topup_overview() to authenticated;
grant execute on function public.admin_data_phones() to authenticated;
grant execute on function public.admin_data_topups(integer) to authenticated;
grant execute on function public.admin_data_topup_resolve(uuid, boolean) to authenticated;
grant execute on function public.my_data_delivery() to authenticated;

-- ---------------------------------------------------------------------------
-- Schedule: 05:00, 06:00 and 08:00 Lagos time (04:00, 05:00 and 07:00 UTC). The later runs
-- only retry people who failed and re-check deliveries that were still waiting. Safe to repeat.
-- Skipped quietly when pg_cron, pg_net or the cron secret are not set up; the Run now button
-- on the Data Allocation screen works either way.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from pg_namespace where nspname = 'net')
     and exists (select 1 from pg_namespace where nspname = 'vault') then
    if exists (select 1 from cron.job where jobname = 'ridearrivo-data-topup') then
      perform cron.unschedule('ridearrivo-data-topup');
    end if;
    perform cron.schedule(
      'ridearrivo-data-topup',
      '0 4,5,7 * * *',
      $cmd$
      select net.http_post(
        url := (select value from public.system_config where key = 'functions_base_url') || '/data-topup',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_dispatch_secret' limit 1)
        ),
        body := '{"action":"run"}'::jsonb
      );
      $cmd$
    );
  else
    raise notice 'data-topup schedule skipped: pg_cron, pg_net or vault is not available';
  end if;
exception when others then
  raise notice 'data-topup schedule skipped: %', sqlerrm;
end;
$$;

commit;
