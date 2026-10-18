-- Behaviour check for 20261018000000_data_allocation.sql.
-- Needs a scratch Postgres with these stubs (see scripts/data-allocation.test.mjs for the
-- exact prelude): auth.uid() reading current_setting('test.uid'), roles anon/authenticated/
-- service_role, public.employee_profiles, is_workspace_admin(), record_admin_audit(),
-- current_workspace_role(), admin_audit_log, pgcrypto.
-- Run as a superuser. Prints "data allocation checks passed: N" or raises.

create or replace function pg_temp.expect_fail(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED FAILURE but it succeeded: %', p_label;
exception
  when raise_exception or insufficient_privilege or check_violation or others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
end $$;

create or replace function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('test.uid', p_uid, false)
$$;

delete from public.data_sessions;
delete from public.data_usage_daily;
delete from public.data_adjustments;
delete from public.data_credentials;
delete from public.data_plans;
delete from public.data_pool_purchases;
delete from public.data_devices;
delete from public.employee_profiles;

insert into public.employee_profiles (id, full_name, email, role, active) values
  ('00000000-0000-0000-0000-0000000000a0', 'Admin',  'admin@x.test', 'admin',    true),
  ('00000000-0000-0000-0000-0000000000a1', 'Alice',  'alice@x.test', 'employee', true),
  ('00000000-0000-0000-0000-0000000000a2', 'Bob',    'bob@x.test',   'employee', true),
  ('00000000-0000-0000-0000-0000000000a3', 'Gone',   'gone@x.test',  'employee', false);

do $$
declare
  ok integer := 0;
  admin_id constant text := '00000000-0000-0000-0000-0000000000a0';
  alice constant uuid := '00000000-0000-0000-0000-0000000000a1';
  bob constant uuid := '00000000-0000-0000-0000-0000000000a2';
  gone constant uuid := '00000000-0000-0000-0000-0000000000a3';
  gb constant bigint := 1073741824;
  mb constant bigint := 1048576;
  ov jsonb;
  pw text;
  pw2 text;
  r jsonb;
  n integer;
begin
  -- 1. five tiers exist with the exact sizes ------------------------------------------------
  if (select string_agg(label || '=' || daily_bytes, ',' order by sort_order) from public.data_tiers)
     = '500 MB=524288000,1 GB=1073741824,2 GB=2147483648,3 GB=3221225472,5 GB=5368709120' then ok := ok + 1;
  else raise exception 'FAIL tiers'; end if;

  -- 2. non-admins cannot use admin functions ---------------------------------------------
  perform pg_temp.as_user(alice::text);
  perform pg_temp.expect_fail('select public.admin_data_overview()', 'non-admin overview');
  perform pg_temp.expect_fail($q$select public.admin_data_add_purchase(1000)$q$, 'non-admin purchase');
  perform pg_temp.expect_fail($q$select public.admin_data_set_plan('00000000-0000-0000-0000-0000000000a1','gb5')$q$, 'self-upgrade');
  perform pg_temp.expect_fail($q$select public.admin_data_reset_password('00000000-0000-0000-0000-0000000000a2')$q$, 'non-admin reset');
  ok := ok + 1;

  -- 3. purchase 1.5 TB, assign tiers, check the overview ---------------------------------
  perform pg_temp.as_user(admin_id);
  perform public.admin_data_add_purchase(1500 * gb, 'MTN 1.5TB', 450000, 'first bulk', null);
  perform pg_temp.expect_fail('select public.admin_data_add_purchase(0)', 'zero purchase');
  perform pg_temp.expect_fail('select public.admin_data_add_purchase(-5)', 'negative purchase');
  perform public.admin_data_set_plan(alice, 'gb1');
  perform public.admin_data_set_plan(bob, 'gb5');
  perform pg_temp.expect_fail($q$select public.admin_data_set_plan('00000000-0000-0000-0000-0000000000a3','gb1')$q$, 'inactive employee plan');
  perform pg_temp.expect_fail($q$select public.admin_data_set_plan('00000000-0000-0000-0000-0000000000a1','gb9')$q$, 'unknown tier');
  ov := public.admin_data_overview();
  if (ov->>'purchased_bytes')::bigint = 1500 * gb
     and (ov->>'daily_commitment_bytes')::bigint = 6 * gb
     and (ov->>'remaining_bytes')::bigint = 1500 * gb
     and (ov->>'runway_days_commitment')::numeric = 250.0
     and (ov->>'users_planned')::int = 2 and (ov->>'users_unplanned')::int = 1 then ok := ok + 1;
  else raise exception 'FAIL overview %', ov; end if;

  -- 4. passwords: shown once, stored hashed, verify works --------------------------------
  pw := public.admin_data_reset_password(alice);
  if pw ~ '^[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}$' then ok := ok + 1;
  else raise exception 'FAIL password shape %', pw; end if;
  if (select password_hash from public.data_credentials where employee_id = alice) like '$2a$%'
     and (select password_hash from public.data_credentials where employee_id = alice) <> pw then ok := ok + 1;
  else raise exception 'FAIL password not hashed'; end if;
  if not exists (select 1 from public.admin_audit_log where action = 'data.password.reset' and metadata::text like '%' || pw || '%')
     and exists (select 1 from public.admin_audit_log where action = 'data.password.reset') then ok := ok + 1;
  else raise exception 'FAIL audit leaks password or missing'; end if;

  r := public.radius_verify('Alice@X.test', pw);   -- case-insensitive username
  if (r->>'ok')::boolean and (r->>'remaining_bytes')::bigint = gb
     and (r->>'session_timeout')::int between 60 and 86400 then ok := ok + 1;
  else raise exception 'FAIL verify ok %', r; end if;

  -- 5. wrong password, unknown user, no credential, lockout -----------------------------------
  if (public.radius_verify('alice@x.test', 'nope')->>'reason') = 'bad_password'
     and (public.radius_verify('nobody@x.test', 'x')->>'reason') = 'unknown_user'
     and (public.radius_verify('gone@x.test', 'x')->>'reason') = 'unknown_user'
     and (public.radius_verify('bob@x.test', 'x')->>'reason') = 'no_credential' then ok := ok + 1;
  else raise exception 'FAIL reject reasons'; end if;
  for i in 1..4 loop perform public.radius_verify('alice@x.test', 'bad' || i); end loop;
  r := public.radius_verify('alice@x.test', pw);
  if r->>'reason' = 'locked' then ok := ok + 1;
  else raise exception 'FAIL lockout after 5 failures %', r; end if;
  pw := public.admin_data_reset_password(alice);   -- reset clears the lock
  if (public.radius_verify('alice@x.test', pw)->>'ok')::boolean then ok := ok + 1;
  else raise exception 'FAIL reset did not unlock'; end if;

  -- 6. accounting: deltas, retransmits, counter reset -------------------------------------
  r := public.radius_account('alice@x.test', 'Start', 's1', 0, 0, '10.0.0.1', 'gw', '10.9.0.5', 'aa:bb');
  if (r->>'charged_bytes')::bigint = 0 and (r->>'remaining_bytes')::bigint = gb then ok := ok + 1;
  else raise exception 'FAIL start %', r; end if;
  r := public.radius_account('alice@x.test', 'Interim-Update', 's1', 100 * mb, 300 * mb, '10.0.0.1', 'gw', '', '');
  if (r->>'charged_bytes')::bigint = 400 * mb and (r->>'remaining_bytes')::bigint = gb - 400 * mb
     and not (r->>'over_quota')::boolean then ok := ok + 1;
  else raise exception 'FAIL interim 1 %', r; end if;
  r := public.radius_account('alice@x.test', 'Interim-Update', 's1', 100 * mb, 300 * mb, '10.0.0.1', 'gw', '', '');
  if (r->>'charged_bytes')::bigint = 0 then ok := ok + 1;                       -- retransmit
  else raise exception 'FAIL retransmit double charge %', r; end if;
  r := public.radius_account('alice@x.test', 'Interim-Update', 's1', 200 * mb, 500 * mb, '10.0.0.1', 'gw', '', '');
  if (r->>'charged_bytes')::bigint = 300 * mb then ok := ok + 1;
  else raise exception 'FAIL interim 2 %', r; end if;
  -- the same session id on another NAS is a different session
  r := public.radius_account('alice@x.test', 'Start', 's1', 5 * mb, 5 * mb, '10.0.0.2', 'gw2', '', '');
  if (r->>'charged_bytes')::bigint = 10 * mb then ok := ok + 1;
  else raise exception 'FAIL per-NAS sessions %', r; end if;
  -- NAS reboot: counters go backwards, so the new smaller value is charged as fresh usage
  r := public.radius_account('alice@x.test', 'Interim-Update', 's1', 1 * mb, 1 * mb, '10.0.0.1', 'gw', '', '');
  if (r->>'charged_bytes')::bigint = 2 * mb then ok := ok + 1;
  else raise exception 'FAIL counter reset %', r; end if;
  -- unknown user is acknowledged, never an error
  r := public.radius_account('ghost@x.test', 'Interim-Update', 'g1', 5, 5, '10.0.0.1', '', '', '');
  if (r->>'ok')::boolean and (r->>'ignored')::boolean then ok := ok + 1;
  else raise exception 'FAIL unknown user accounting %', r; end if;
  -- junk packet types are ignored
  if (public.radius_account('alice@x.test', 'Weird', 's9', 5, 5)->>'ignored')::boolean then ok := ok + 1;
  else raise exception 'FAIL junk status'; end if;

  -- 7. out of data: flagged for disconnect, cannot reconnect -----------------------------
  r := public.radius_account('alice@x.test', 'Interim-Update', 's1', 700 * mb, 600 * mb, '10.0.0.1', 'gw', '', '');
  if (r->>'over_quota')::boolean and (r->>'remaining_bytes')::bigint = 0 then ok := ok + 1;
  else raise exception 'FAIL over quota flag %', r; end if;
  if exists (select 1 from public.radius_over_quota() where username = 'alice@x.test' and reason = 'quota_exhausted' and session_id = 's1') then ok := ok + 1;
  else raise exception 'FAIL over-quota list'; end if;
  if (public.radius_verify('alice@x.test', pw)->>'reason') = 'quota_exhausted' then ok := ok + 1;
  else raise exception 'FAIL reconnect should be refused'; end if;

  -- 8. adjustments -----------------------------------------------------------------------
  perform pg_temp.as_user(admin_id);
  perform pg_temp.expect_fail($q$select public.admin_data_adjust('00000000-0000-0000-0000-0000000000a1', 0, 'zero')$q$, 'zero adjust');
  perform pg_temp.expect_fail($q$select public.admin_data_adjust('00000000-0000-0000-0000-0000000000a1', 1048576, '')$q$, 'no reason');
  perform pg_temp.expect_fail($q$select public.admin_data_adjust('00000000-0000-0000-0000-0000000000a1', -999999999999, 'too much')$q$, 'below zero');
  perform public.admin_data_adjust(alice, 1 * gb, 'Client call all afternoon');
  r := public.radius_verify('alice@x.test', pw);
  -- charged so far: 400 + 300 + 10 (other NAS) + 2 (reboot) + 1298 (jump after reboot) = 2010 MB
  if (r->>'ok')::boolean and (r->>'remaining_bytes')::bigint = 2 * gb - 2010 * mb
     and (select used_bytes from public.data_usage_daily where employee_id = alice and day = public.data_today()) = 2010 * mb then ok := ok + 1;
  else raise exception 'FAIL adjust restores access %', r; end if;
  if not exists (select 1 from public.radius_over_quota() where username = 'alice@x.test') then ok := ok + 1;
  else raise exception 'FAIL adjust should clear over-quota'; end if;

  -- 9. tier change mid-day keeps the adjustment -----------------------------------------
  perform public.admin_data_set_plan(alice, 'gb3');
  if (select allowance_bytes from public.data_usage_daily where employee_id = alice and day = public.data_today()) = 4 * gb then ok := ok + 1;
  else raise exception 'FAIL tier change allowance'; end if;

  -- 10. suspend / remove / deactivate cut access and open sessions -----------------------
  perform public.admin_data_set_plan(alice, 'gb3', 'suspended');
  if (public.radius_verify('alice@x.test', pw)->>'reason') = 'suspended'
     and exists (select 1 from public.radius_over_quota() where username = 'alice@x.test' and reason = 'suspended') then ok := ok + 1;
  else raise exception 'FAIL suspend'; end if;
  perform public.admin_data_set_plan(alice, null);
  if (public.radius_verify('alice@x.test', pw)->>'reason') = 'no_plan'
     and exists (select 1 from public.radius_over_quota() where username = 'alice@x.test' and reason = 'no_plan') then ok := ok + 1;
  else raise exception 'FAIL plan removal'; end if;
  perform public.admin_data_set_plan(alice, 'gb2');
  update public.employee_profiles set active = false where id = alice;
  if exists (select 1 from public.radius_over_quota() where username = 'alice@x.test' and reason = 'employee_inactive')
     and (public.radius_verify('alice@x.test', pw)->>'reason') = 'unknown_user' then ok := ok + 1;
  else raise exception 'FAIL offboarding does not cut access'; end if;
  update public.employee_profiles set active = true where id = alice;

  -- 11. allowance resets on a new Lagos day with nothing carried over ------------------------
  update public.data_usage_daily set day = day - 1 where employee_id = alice;   -- pretend today's row is yesterday's
  update public.data_adjustments set day = day - 1 where employee_id = alice;
  perform public.data_ensure_day(alice);
  if (select used_bytes from public.data_usage_daily where employee_id = alice and day = public.data_today()) = 0
     and (select allowance_bytes from public.data_usage_daily where employee_id = alice and day = public.data_today()) = 2 * gb then ok := ok + 1;
  else raise exception 'FAIL daily reset'; end if;
  r := public.radius_verify('alice@x.test', pw);
  if (r->>'ok')::boolean and (r->>'remaining_bytes')::bigint = 2 * gb then ok := ok + 1;
  else raise exception 'FAIL reconnect after reset %', r; end if;
  -- tidy: put yesterday's rows back as today's so later steps see the original numbers
  delete from public.data_usage_daily where employee_id = alice and day = public.data_today();
  update public.data_usage_daily set day = day + 1 where employee_id = alice;
  update public.data_adjustments set day = day + 1 where employee_id = alice;

  -- 12. manual usage (SIMs the gateway cannot meter) -------------------------------------------
  perform public.admin_data_record_usage(bob, 250 * mb, 'MTN portal reading');
  perform pg_temp.expect_fail($q$select public.admin_data_record_usage('00000000-0000-0000-0000-0000000000a2', 0)$q$, 'zero usage');
  if (select used_bytes = 250 * mb and manual_bytes = 250 * mb from public.data_usage_daily where employee_id = bob and day = public.data_today()) then ok := ok + 1;
  else raise exception 'FAIL manual usage'; end if;

  -- 13. the pool: exhaustion stops everyone, a new purchase restores service -------------------
  pw2 := public.admin_data_reset_password(bob);
  if (public.radius_verify('bob@x.test', pw2)->>'ok')::boolean then ok := ok + 1; else raise exception 'FAIL bob verify'; end if;
  for i in 1..15 loop perform public.admin_data_record_usage(bob, 100 * gb, 'burn'); end loop;  -- 1500 GB gone
  ov := public.admin_data_overview();
  if (ov->>'pool_exhausted')::boolean and (ov->>'pool_low')::boolean then ok := ok + 1;
  else raise exception 'FAIL pool flags %', ov; end if;
  if (public.radius_verify('bob@x.test', pw2)->>'reason') = 'pool_exhausted'
     and (public.radius_verify('alice@x.test', pw)->>'reason') = 'pool_exhausted' then ok := ok + 1;
  else raise exception 'FAIL pool exhaustion'; end if;
  perform public.admin_data_add_purchase(500 * gb, 'top up');
  if (public.radius_verify('alice@x.test', pw)->>'ok')::boolean then ok := ok + 1;
  else raise exception 'FAIL top-up should restore alice'; end if;

  -- 14. history ------------------------------------------------------------------------------
  select count(*) into n from public.admin_data_history(14);
  if n = 14 then ok := ok + 1; else raise exception 'FAIL history rows %', n; end if;

  -- 15. self service -------------------------------------------------------------------------
  perform pg_temp.as_user(alice::text);
  r := public.my_data_status();
  if (r->>'has_plan')::boolean and r->>'tier_label' = '2 GB' and r->>'username' = 'alice@x.test' and (r->>'has_password')::boolean then ok := ok + 1;
  else raise exception 'FAIL my status %', r; end if;
  pw2 := public.my_data_rotate_password();
  if (public.radius_verify('alice@x.test', pw2)->>'ok')::boolean and not (public.radius_verify('alice@x.test', pw)->>'ok')::boolean then ok := ok + 1;
  else raise exception 'FAIL rotate invalidates old password'; end if;
  perform pg_temp.as_user(admin_id);
  perform public.admin_data_set_plan(bob, null);
  perform pg_temp.as_user(bob::text);
  perform pg_temp.expect_fail('select public.my_data_rotate_password()', 'rotate without plan');
  if not (public.my_data_status()->>'has_plan')::boolean then ok := ok + 1; else raise exception 'FAIL bob has_plan'; end if;
  perform pg_temp.as_user(admin_id);
  perform public.admin_data_set_plan(bob, 'gb5');

  -- 16. devices ---------------------------------------------------------------------------------
  perform pg_temp.expect_fail($q$select public.admin_data_save_device(null, 'x', 'abc')$q$, 'bad msisdn');
  perform pg_temp.expect_fail($q$select public.admin_data_save_device(null, 'x', '0803', '12ab')$q$, 'bad imei');
  perform pg_temp.expect_fail($q$select public.admin_data_save_device(null, '')$q$, 'blank label');
  perform public.admin_data_save_device(null, 'MiFi 01', '+2348031234567', '356938035643809', alice, 'blue', true);
  if (select count(*) from public.data_devices) = 1 then ok := ok + 1; else raise exception 'FAIL device save'; end if;
  perform public.admin_data_delete_device((select id from public.data_devices limit 1));

  -- 17. bulk plan -----------------------------------------------------------------------------------
  n := public.admin_data_bulk_set_plan(array[alice, bob], 'gb1');
  if n = 2 and (select count(*) from public.data_plans where tier_code = 'gb1') = 2 then ok := ok + 1;
  else raise exception 'FAIL bulk (% changed)', n; end if;

  raise notice 'data allocation checks passed (logic): %', ok;
end $$;

-- Privileges ----------------------------------------------------------------------------------------
do $$
declare ok integer := 0; seen integer;
begin
  -- authenticated users cannot call the RADIUS functions
  begin
    set local role authenticated;
    perform public.radius_verify('alice@x.test', 'x');
    reset role;
    raise exception 'FAIL authenticated could call radius_verify';
  exception when insufficient_privilege then reset role; ok := ok + 1; end;
  begin
    set local role anon;
    perform public.admin_data_overview();
    reset role;
    raise exception 'FAIL anon could call admin_data_overview';
  exception when insufficient_privilege then reset role; ok := ok + 1; end;
  -- credentials are unreadable from the app, even for an administrator
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a0', false);
  begin
    set local role authenticated;
    perform count(*) from public.data_credentials;
    reset role;
    raise exception 'FAIL authenticated could read data_credentials';
  exception when insufficient_privilege then reset role; ok := ok + 1; end;
  -- an employee only sees their own plan and usage; an admin sees everyone
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
  set local role authenticated;
  select count(*) into seen from public.data_plans;
  reset role;
  if seen = 1 then ok := ok + 1; else raise exception 'FAIL employee sees % plans', seen; end if;
  set local role authenticated;
  select count(*) into seen from public.data_pool_purchases;
  reset role;
  if seen = 0 then ok := ok + 1; else raise exception 'FAIL employee sees pool purchases'; end if;
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a0', false);
  set local role authenticated;
  select count(*) into seen from public.data_plans;
  reset role;
  if seen = 2 then ok := ok + 1; else raise exception 'FAIL admin sees % plans', seen; end if;
  -- no direct writes from the app
  begin
    set local role authenticated;
    insert into public.data_plans (employee_id, tier_code) values ('00000000-0000-0000-0000-0000000000a3', 'gb5');
    reset role;
    raise exception 'FAIL direct insert allowed';
  exception when insufficient_privilege then reset role; ok := ok + 1; end;
  raise notice 'data allocation checks passed (privileges): %', ok;
end $$;
