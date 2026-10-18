-- Behaviour check for 20261018010000_data_topups.sql (run after data_allocation.sql and the
-- same stub prelude, as a superuser, on a scratch Postgres). Prints the number of checks passed.

create or replace function pg_temp.expect_fail(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED FAILURE but it succeeded: %', p_label;
exception
  when raise_exception or insufficient_privilege or check_violation or unique_violation or others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
end $$;

create or replace function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('test.uid', p_uid, false)
$$;

delete from public.data_topups;
delete from public.data_usage_daily;
delete from public.data_plans;
delete from public.data_pool_purchases;
delete from public.employee_profiles;
update public.data_tiers set provider_variation = '', price_ngn = null;
update public.data_settings set topup_enabled = false, daily_spend_cap_ngn = 0;

insert into public.employee_profiles (id, full_name, email, role, active) values
  ('00000000-0000-0000-0000-0000000000a0', 'Admin', 'admin@x.test', 'admin',    true),
  ('00000000-0000-0000-0000-0000000000a1', 'Alice', 'alice@x.test', 'employee', true),
  ('00000000-0000-0000-0000-0000000000a2', 'Bob',   'bob@x.test',   'employee', true),
  ('00000000-0000-0000-0000-0000000000a3', 'Carol', 'carol@x.test', 'employee', true),
  ('00000000-0000-0000-0000-0000000000a4', 'Dan',   'dan@x.test',   'employee', true),
  ('00000000-0000-0000-0000-0000000000a5', 'Eve',   'eve@x.test',   'employee', true),
  ('00000000-0000-0000-0000-0000000000a6', 'Gone',  'gone@x.test',  'employee', false);

do $$
declare
  ok integer := 0;
  admin_id constant text := '00000000-0000-0000-0000-0000000000a0';
  alice constant uuid := '00000000-0000-0000-0000-0000000000a1';
  bob   constant uuid := '00000000-0000-0000-0000-0000000000a2';
  carol constant uuid := '00000000-0000-0000-0000-0000000000a3';
  dan   constant uuid := '00000000-0000-0000-0000-0000000000a4';
  eve   constant uuid := '00000000-0000-0000-0000-0000000000a5';
  gb constant bigint := 1073741824;
  stamp constant text := '202610180500';
  batch jsonb;
  batch2 jsonb;
  ov jsonb;
  a_id uuid;
  b_id uuid;
  rid1 text;
  rid2 text;
begin
  -- 1. nothing is bought until an administrator switches delivery on ------------------------
  perform pg_temp.as_user(admin_id);
  perform public.admin_data_add_purchase(1500 * gb, 'MTN 1.5TB', 450000, '', null);
  perform public.admin_data_set_plan(alice, 'gb1');
  perform public.admin_data_set_plan(bob, 'mb500');
  perform public.admin_data_set_plan(carol, 'gb2');
  perform public.admin_data_set_plan(dan, 'gb1');
  perform public.admin_data_set_plan(eve, 'gb1', 'suspended');
  if public.topup_claim_batch(stamp, 40) = '[]'::jsonb then ok := ok + 1; else raise exception 'FAIL claims while disabled'; end if;

  -- 2. phone numbers are cleaned, validated, unique and admin only ----------------------------
  perform public.admin_data_set_phone(alice, '+234 803 123 4567');
  if (select msisdn from public.data_plans where employee_id = alice) = '08031234567' then ok := ok + 1; else raise exception 'FAIL +234 format'; end if;
  perform public.admin_data_set_phone(bob, '2348061234567');
  perform public.admin_data_set_phone(carol, '0706-123-4567');
  perform public.admin_data_set_phone(eve, '0813 000 0001');
  perform pg_temp.expect_fail($q$select public.admin_data_set_phone('00000000-0000-0000-0000-0000000000a4','12345')$q$, 'short number');
  perform pg_temp.expect_fail($q$select public.admin_data_set_phone('00000000-0000-0000-0000-0000000000a4','08031234567')$q$, 'duplicate number');
  perform pg_temp.expect_fail($q$select public.admin_data_set_phone('00000000-0000-0000-0000-0000000000a6','08031234560')$q$, 'person without plan');
  ok := ok + 1;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform pg_temp.expect_fail($q$select public.admin_data_set_phone('00000000-0000-0000-0000-0000000000a1','08039999999')$q$, 'non-admin phone');
  perform pg_temp.expect_fail($q$select public.admin_data_set_topup(true, 1000)$q$, 'non-admin enable');
  perform pg_temp.expect_fail($q$select public.admin_data_topup_overview()$q$, 'non-admin overview');
  perform pg_temp.expect_fail($q$select * from public.admin_data_topups(3)$q$, 'non-admin list');
  ok := ok + 1;

  -- 3. it refuses to switch on without a spending limit or a configured bundle ---------------
  perform pg_temp.as_user(admin_id);
  perform pg_temp.expect_fail('select public.admin_data_set_topup(true, 0)', 'no cap');
  perform pg_temp.expect_fail('select public.admin_data_set_topup(true, 1000)', 'no bundle configured');
  perform pg_temp.expect_fail($q$select public.admin_data_set_tier_bundle('gb1', 'mtn-1gb', null)$q$, 'bundle without price');
  perform pg_temp.expect_fail($q$select public.admin_data_set_tier_bundle('gb1', 'bad code!', 100)$q$, 'bad code');
  perform pg_temp.expect_fail($q$select public.admin_data_set_tier_bundle('gb99', 'x', 100)$q$, 'unknown tier');
  ok := ok + 1;

  perform public.admin_data_set_tier_bundle('gb1', 'mtn-1gb-350', 350);
  perform public.admin_data_set_tier_bundle('mb500', 'mtn-500mb-200', 200);
  perform public.admin_data_set_topup(true, 1000);
  -- carol (gb2) has no bundle, dan has no phone, eve is suspended
  batch := public.topup_claim_batch(stamp, 40);
  if jsonb_array_length(batch) = 2
     and (select string_agg(x->>'tier_code', ',' order by x->>'tier_code') from jsonb_array_elements(batch) x) = 'gb1,mb500'
  then ok := ok + 1; else raise exception 'FAIL claim set: %', batch; end if;

  -- 4. request ids follow the reseller rules, and a second run buys nothing -----------------
  if (select bool_and((x->>'request_id') ~ '^202610180500ra[0-9a-f]{12}a1$') from jsonb_array_elements(batch) x)
  then ok := ok + 1; else raise exception 'FAIL request id: %', batch; end if;
  if public.topup_claim_batch(stamp, 40) = '[]'::jsonb then ok := ok + 1; else raise exception 'FAIL double claim'; end if;
  if (select count(*) from public.data_topups where status = 'pending') = 2 then ok := ok + 1; else raise exception 'FAIL pending rows'; end if;
  perform pg_temp.expect_fail($q$select public.topup_claim_batch('bad', 5)$q$, 'bad stamp');
  ok := ok + 1;

  select (x->>'id')::uuid into a_id from jsonb_array_elements(batch) x where x->>'tier_code' = 'gb1';
  select (x->>'id')::uuid into b_id from jsonb_array_elements(batch) x where x->>'tier_code' = 'mb500';

  -- 5. delivered: the pool is debited and the outcome is final --------------------------------
  perform public.topup_complete(a_id, 'delivered', 'TX1', 350, 'TRANSACTION SUCCESSFUL');
  if (select used_bytes from public.data_usage_daily where employee_id = alice and day = public.data_today()) = gb then ok := ok + 1;
  else raise exception 'FAIL usage debit'; end if;
  if public.data_pool_remaining() = 1500 * gb - gb then ok := ok + 1; else raise exception 'FAIL pool %', public.data_pool_remaining(); end if;
  perform public.topup_complete(a_id, 'failed', null, null, 'late failure');
  perform public.topup_complete(a_id, 'pending', null, null, 'late pending');
  if (select status from public.data_topups where id = a_id) = 'delivered' then ok := ok + 1; else raise exception 'FAIL delivered not final'; end if;
  perform public.topup_complete(a_id, 'delivered', 'TX1', 350, 'again');
  if (select used_bytes from public.data_usage_daily where employee_id = alice and day = public.data_today()) = gb then ok := ok + 1;
  else raise exception 'FAIL double debit'; end if;

  -- 6. failed: retried with a new request id, at most three times a day -----------------------
  select request_id into rid1 from public.data_topups where id = b_id;
  perform public.topup_complete(b_id, 'failed', null, null, 'Insufficient wallet');
  batch2 := public.topup_claim_batch('202610180600', 40);
  if jsonb_array_length(batch2) = 1 and (batch2->0->>'employee_id')::uuid = bob and (batch2->0->>'request_id') <> rid1
     and (batch2->0->>'request_id') like '%a2'
  then ok := ok + 1; else raise exception 'FAIL retry: %', batch2; end if;
  perform public.topup_complete(b_id, 'failed', null, null, 'again');
  batch2 := public.topup_claim_batch('202610180700', 40);
  perform public.topup_complete(b_id, 'failed', null, null, 'third');
  if public.topup_claim_batch('202610180800', 40) = '[]'::jsonb then ok := ok + 1; else raise exception 'FAIL more than 3 attempts'; end if;
  if (select attempts from public.data_topups where id = b_id) = 3 then ok := ok + 1; else raise exception 'FAIL attempts'; end if;

  -- 7. skipped hands the attempt back ---------------------------------------------------------
  update public.data_topups set attempts = 1, status = 'failed' where id = b_id;
  batch2 := public.topup_claim_batch('202610180900', 40);
  perform public.topup_complete(b_id, 'skipped', null, null, 'wallet low');
  if (select attempts from public.data_topups where id = b_id) = 1 and (select status from public.data_topups where id = b_id) = 'skipped'
  then ok := ok + 1; else raise exception 'FAIL skipped'; end if;

  -- 8. the daily spending cap holds ------------------------------------------------------------
  perform public.admin_data_set_topup(true, 500);      -- 350 already delivered, bob needs 200
  if public.topup_claim_batch('202610181000', 40) = '[]'::jsonb then ok := ok + 1; else raise exception 'FAIL cap'; end if;
  perform public.admin_data_set_topup(true, 550);
  if jsonb_array_length(public.topup_claim_batch('202610181010', 40)) = 1 then ok := ok + 1; else raise exception 'FAIL cap boundary'; end if;
  perform public.topup_complete(b_id, 'delivered', 'TX2', 200, '');
  if (public.admin_data_topup_overview()->>'spent_today_ngn')::numeric = 550 then ok := ok + 1; else raise exception 'FAIL spent %', public.admin_data_topup_overview(); end if;

  -- 9. an empty pool stops delivery -------------------------------------------------------------
  delete from public.data_topups where employee_id = bob;
  delete from public.data_usage_daily where employee_id = bob;
  delete from public.data_pool_purchases;
  perform public.admin_data_add_purchase(gb, 'tiny', null, '', null);   -- 1 GB bought, 1 GB already delivered to alice
  if public.topup_claim_batch('202610181100', 40) = '[]'::jsonb then ok := ok + 1; else raise exception 'FAIL empty pool'; end if;
  perform public.admin_data_add_purchase(100 * gb, 'more', null, '', null);
  if jsonb_array_length(public.topup_claim_batch('202610181110', 40)) = 1 then ok := ok + 1; else raise exception 'FAIL pool refilled'; end if;

  -- 10. an unknown outcome is never bought twice; the administrator settles it ------------------
  perform public.topup_complete((select id from public.data_topups where employee_id = bob), 'pending', null, null, 'timeout');
  if public.topup_claim_batch('202610181200', 40) = '[]'::jsonb then ok := ok + 1; else raise exception 'FAIL rebuy while pending'; end if;
  if jsonb_array_length(public.topup_pending(10)) = 1 then ok := ok + 1; else raise exception 'FAIL pending list'; end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform pg_temp.expect_fail($q$select public.admin_data_topup_resolve((select id from public.data_topups where employee_id='00000000-0000-0000-0000-0000000000a2'), true)$q$, 'non-admin resolve');
  perform pg_temp.as_user(admin_id);
  perform public.admin_data_topup_resolve((select id from public.data_topups where employee_id = bob), true);
  if (select status from public.data_topups where employee_id = bob) = 'delivered' then ok := ok + 1; else raise exception 'FAIL resolve'; end if;
  perform pg_temp.expect_fail($q$select public.admin_data_topup_resolve((select id from public.data_topups where employee_id='00000000-0000-0000-0000-0000000000a2'), false)$q$, 'resolve non-pending');
  ok := ok + 1;

  -- 11. the person sees their own delivery, with the number masked ------------------------------
  perform pg_temp.as_user(alice::text);
  ov := public.my_data_delivery();
  if (ov->>'today_status') = 'delivered' and (ov->>'phone_masked') = '0803 *** 4567' and (ov->>'tier_label') = '1 GB'
  then ok := ok + 1; else raise exception 'FAIL my delivery: %', ov; end if;
  perform pg_temp.as_user(dan::text);
  if (public.my_data_delivery()->>'has_phone')::boolean = false then ok := ok + 1; else raise exception 'FAIL dan phone'; end if;

  -- 12. bulk import reports each problem ---------------------------------------------------------
  perform pg_temp.as_user(admin_id);
  ov := public.admin_data_import_phones('[
    {"email":"dan@x.test","phone":"0903 555 0101"},
    {"email":"nobody@x.test","phone":"08031230000"},
    {"email":"carol@x.test","phone":"0903 555 0101"},
    {"email":"eve@x.test","phone":"nope"}]'::jsonb);
  if (ov->>'updated')::int = 1 and jsonb_array_length(ov->'errors') = 3 and (select msisdn from public.data_plans where employee_id = dan) = '09035550101'
  then ok := ok + 1; else raise exception 'FAIL import: %', ov; end if;

  -- 13. the audit trail records the changes but never a full number --------------------------------
  if exists (select 1 from public.admin_audit_log where action = 'data.phone.set')
     and not exists (select 1 from public.admin_audit_log where metadata::text ~ '0803[0-9]{7}') then ok := ok + 1;
  else raise exception 'FAIL audit'; end if;

  raise notice 'data topup checks passed (logic): %', ok;
end $$;

do $$
begin
  if not has_function_privilege('authenticated', 'public.topup_claim_batch(text,integer)', 'execute')
     and not has_function_privilege('authenticated', 'public.topup_complete(uuid,text,text,numeric,text)', 'execute')
     and not has_function_privilege('authenticated', 'public.topup_pending(integer)', 'execute')
     and not has_function_privilege('anon', 'public.admin_data_set_topup(boolean,numeric)', 'execute')
     and has_function_privilege('service_role', 'public.topup_claim_batch(text,integer)', 'execute')
     and has_function_privilege('authenticated', 'public.admin_data_topup_overview()', 'execute')
     and not has_table_privilege('authenticated', 'public.data_topups', 'insert')
     and not has_table_privilege('authenticated', 'public.data_topups', 'update')
  then raise notice 'data topup checks passed (privileges): 1';
  else raise exception 'FAIL privileges'; end if;
end $$;
