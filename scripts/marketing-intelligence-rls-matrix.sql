set client_min_messages = warning;

-- This file runs only inside the transaction provided by the
-- M2B shell gate. All identities, records and schema changes
-- are rolled back after the matrix completes.

create function public.m2b_test_assert_count(
  p_label text,
  p_statement text,
  p_expected bigint
)
returns void
language plpgsql
security invoker
as $$
declare
  v_actual bigint;
begin
  execute p_statement
  into v_actual;

  if v_actual <> p_expected then
    raise exception
      '% expected %, got %',
      p_label,
      p_expected,
      v_actual;
  end if;
end;
$$;

create function public.m2b_test_expect_denied(
  p_label text,
  p_statement text
)
returns void
language plpgsql
security invoker
as $$
declare
  v_denied boolean := false;
begin
  begin
    execute p_statement;
  exception
    when sqlstate '42501' then
      v_denied := true;
  end;

  if not v_denied then
    raise exception
      '% was not denied',
      p_label;
  end if;
end;
$$;

-- The matrix changes PostgreSQL roles with SET ROLE.
-- Keep the helpers SECURITY INVOKER so RLS is evaluated using
-- the actor under test, while granting those actors permission
-- to execute the test helpers.
revoke all
on function public.m2b_test_assert_count(
  text,
  text,
  bigint
)
from public, anon, authenticated;

grant execute
on function public.m2b_test_assert_count(
  text,
  text,
  bigint
)
to authenticated;

revoke all
on function public.m2b_test_expect_denied(
  text,
  text
)
from public, anon, authenticated;

grant execute
on function public.m2b_test_expect_denied(
  text,
  text
)
to authenticated, anon;

-- ------------------------------------------------------------
-- POLICY TOPOLOGY
-- ------------------------------------------------------------

do $$
declare
  v_table text;
  v_count integer;
begin
  foreach v_table in array array[
    'marketing_creators',
    'marketing_campaign_creators',
    'marketing_content_creators',
    'marketing_tracking_links',
    'marketing_attribution_links'
  ]
  loop
    select count(*)
    into v_count
    from pg_policies
    where
      schemaname = 'public'
      and tablename = v_table;

    if v_count <> 4 then
      raise exception
        '% expected 4 policies, got %',
        v_table,
        v_count;
    end if;

    if not has_table_privilege(
      'authenticated',
      'public.' || v_table,
      'SELECT'
    ) then
      raise exception
        'authenticated SELECT missing on %',
        v_table;
    end if;

    if not has_table_privilege(
      'authenticated',
      'public.' || v_table,
      'INSERT'
    ) then
      raise exception
        'authenticated INSERT missing on %',
        v_table;
    end if;

    if not has_table_privilege(
      'authenticated',
      'public.' || v_table,
      'UPDATE'
    ) then
      raise exception
        'authenticated UPDATE missing on %',
        v_table;
    end if;

    if not has_table_privilege(
      'authenticated',
      'public.' || v_table,
      'DELETE'
    ) then
      raise exception
        'authenticated DELETE missing on %',
        v_table;
    end if;

    if has_table_privilege(
      'anon',
      'public.' || v_table,
      'SELECT'
    ) then
      raise exception
        'anon unexpectedly has SELECT on %',
        v_table;
    end if;
  end loop;

  select count(*)
  into v_count
  from pg_policies
  where
    schemaname = 'public'
    and tablename =
      'marketing_performance_snapshots';

  if v_count <> 2 then
    raise exception
      'snapshot table expected 2 policies, got %',
      v_count;
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.marketing_performance_snapshots',
    'SELECT'
  ) then
    raise exception
      'snapshot SELECT missing';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.marketing_performance_snapshots',
    'INSERT'
  ) then
    raise exception
      'snapshot INSERT missing';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.marketing_performance_snapshots',
    'UPDATE'
  ) then
    raise exception
      'snapshot UPDATE unexpectedly granted';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.marketing_performance_snapshots',
    'DELETE'
  ) then
    raise exception
      'snapshot DELETE unexpectedly granted';
  end if;

  if has_table_privilege(
    'anon',
    'public.marketing_performance_snapshots',
    'SELECT'
  ) then
    raise exception
      'anon snapshot SELECT unexpectedly granted';
  end if;
end;
$$;

select 'M2B_POLICY_AND_GRANT_TOPOLOGY=PASS';

-- ------------------------------------------------------------
-- TEMPORARY AUTH IDENTITIES
-- ------------------------------------------------------------

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
(
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'm2b-marketing@ridearrivo.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"M2B Marketing"}'::jsonb,
  now(),
  now()
),
(
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-4222-8222-222222222222',
  'authenticated',
  'authenticated',
  'm2b-admin@ridearrivo.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"M2B Admin"}'::jsonb,
  now(),
  now()
),
(
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-4333-8333-333333333333',
  'authenticated',
  'authenticated',
  'm2b-manager@ridearrivo.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"M2B Manager"}'::jsonb,
  now(),
  now()
),
(
  '00000000-0000-0000-0000-000000000000',
  '44444444-4444-4444-8444-444444444444',
  'authenticated',
  'authenticated',
  'm2b-operations@ridearrivo.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"M2B Operations"}'::jsonb,
  now(),
  now()
);

update public.employee_profiles
set
  full_name = 'M2B Marketing',
  department = 'Marketing',
  job_title = 'Marketing Security Test',
  role = 'marketing',
  active = true
where id =
  '11111111-1111-4111-8111-111111111111';

update public.employee_profiles
set
  full_name = 'M2B Admin',
  department = 'Administration',
  job_title = 'Admin Security Test',
  role = 'admin',
  active = true
where id =
  '22222222-2222-4222-8222-222222222222';

update public.employee_profiles
set
  full_name = 'M2B Manager',
  department = 'Management',
  job_title = 'Manager Security Test',
  role = 'manager',
  active = true
where id =
  '33333333-3333-4333-8333-333333333333';

update public.employee_profiles
set
  full_name = 'M2B Operations',
  department = 'Operations',
  job_title = 'Operations Security Test',
  role = 'operations',
  active = true
where id =
  '44444444-4444-4444-8444-444444444444';

select public.m2b_test_assert_count(
  'temporary employee identities',
  $stmt$
    select count(*)
    from public.employee_profiles
    where id in (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    )
  $stmt$,
  4
);

select 'M2B_TEST_IDENTITIES=PASS';

-- ------------------------------------------------------------
-- FIXTURE HIERARCHY
-- ------------------------------------------------------------

insert into public.marketing_campaigns (
  id,
  name,
  objective,
  channel,
  budget,
  status
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'M2B Security Campaign',
  'Security matrix',
  'social',
  1000,
  'planned'
);

insert into public.marketing_content (
  id,
  campaign_id,
  title,
  content_type,
  channel,
  status
)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'M2B Security Content',
  'video',
  'instagram',
  'published'
);

insert into public.marketing_creators (
  id,
  display_name,
  creator_code,
  primary_platform,
  public_handle,
  created_by
)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'M2B Fixture Creator',
  'm2b_fixture_creator',
  'instagram',
  '@m2bfixture',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.marketing_campaign_creators (
  id,
  campaign_id,
  creator_id,
  tracking_code,
  agreed_fee,
  status,
  created_by
)
values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'm2b_fixture_assignment',
  500,
  'active',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.marketing_content_creators (
  id,
  campaign_id,
  content_id,
  campaign_creator_id,
  relationship_role,
  created_by
)
values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'primary',
  '11111111-1111-4111-8111-111111111111'
);

select 'M2B_FIXTURE_HIERARCHY=PASS';

-- ------------------------------------------------------------
-- MARKETING: READ + WRITE
-- ------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

set local role authenticated;

select public.m2b_test_assert_count(
  'marketing read',
  'select count(*) from public.marketing_creators',
  1
);

insert into public.marketing_creators (
  display_name,
  creator_code,
  primary_platform
)
values (
  'M2B Marketing Writer',
  'm2b_marketing_writer',
  'instagram'
);

select public.m2b_test_assert_count(
  'marketing write',
  $stmt$
    select count(*)
    from public.marketing_creators
    where creator_code='m2b_marketing_writer'
  $stmt$,
  1
);

reset role;

select 'M2B_MARKETING_READ_WRITE=PASS';

-- ------------------------------------------------------------
-- ADMIN: READ + WRITE
-- ------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

set local role authenticated;

select public.m2b_test_assert_count(
  'admin read',
  'select count(*) from public.marketing_creators',
  2
);

insert into public.marketing_creators (
  display_name,
  creator_code,
  primary_platform
)
values (
  'M2B Admin Writer',
  'm2b_admin_writer',
  'youtube'
);

select public.m2b_test_assert_count(
  'admin write',
  $stmt$
    select count(*)
    from public.marketing_creators
    where creator_code='m2b_admin_writer'
  $stmt$,
  1
);

reset role;

select 'M2B_ADMIN_READ_WRITE=PASS';

-- ------------------------------------------------------------
-- MANAGER: READ ONLY
-- ------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  true
);

set local role authenticated;

select public.m2b_test_assert_count(
  'manager read',
  'select count(*) from public.marketing_creators',
  3
);

select public.m2b_test_expect_denied(
  'manager insert',
  $stmt$
    insert into public.marketing_creators (
      display_name,
      creator_code
    )
    values (
      'M2B Manager Denied',
      'm2b_manager_denied'
    )
  $stmt$
);

update public.marketing_creators
set display_name='M2B Manager Update Attempt'
where creator_code='m2b_fixture_creator';

select public.m2b_test_assert_count(
  'manager update blocked',
  $stmt$
    select count(*)
    from public.marketing_creators
    where
      creator_code='m2b_fixture_creator'
      and display_name='M2B Fixture Creator'
  $stmt$,
  1
);

delete from public.marketing_creators
where creator_code='m2b_fixture_creator';

select public.m2b_test_assert_count(
  'manager delete blocked',
  $stmt$
    select count(*)
    from public.marketing_creators
    where creator_code='m2b_fixture_creator'
  $stmt$,
  1
);

reset role;

select 'M2B_MANAGER_READ_ONLY=PASS';

-- ------------------------------------------------------------
-- OPERATIONS / OTHER STAFF: NO ACCESS
-- ------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-8444-444444444444',
  true
);

set local role authenticated;

select public.m2b_test_assert_count(
  'operations read blocked',
  'select count(*) from public.marketing_creators',
  0
);

select public.m2b_test_expect_denied(
  'operations insert',
  $stmt$
    insert into public.marketing_creators (
      display_name,
      creator_code
    )
    values (
      'M2B Operations Denied',
      'm2b_operations_denied'
    )
  $stmt$
);

reset role;

select 'M2B_OTHER_STAFF_DENIED=PASS';

-- ------------------------------------------------------------
-- ANONYMOUS: NO TABLE ACCESS
-- ------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000000',
  true
);

set local role anon;

select public.m2b_test_expect_denied(
  'anonymous select',
  'select count(*) from public.marketing_creators'
);

select public.m2b_test_expect_denied(
  'anonymous insert',
  $stmt$
    insert into public.marketing_creators (
      display_name,
      creator_code
    )
    values (
      'M2B Anonymous Denied',
      'm2b_anonymous_denied'
    )
  $stmt$
);

reset role;

select 'M2B_ANONYMOUS_DENIED=PASS';

-- ------------------------------------------------------------
-- SNAPSHOT APPEND-ONLY MATRIX
-- ------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

set local role authenticated;

insert into public.marketing_performance_snapshots (
  id,
  campaign_id,
  campaign_creator_id,
  content_creator_id,
  platform,
  period_start,
  period_end,
  reach,
  impressions,
  views,
  engagements,
  link_clicks
)
values (
  '55555555-5555-4555-8555-555555555555',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'instagram',
  current_date,
  current_date,
  1000,
  1300,
  900,
  120,
  40
);

select public.m2b_test_expect_denied(
  'marketing snapshot update',
  $stmt$
    update public.marketing_performance_snapshots
    set reach=1001
    where id='55555555-5555-4555-8555-555555555555'
  $stmt$
);

select public.m2b_test_expect_denied(
  'marketing snapshot delete',
  $stmt$
    delete from public.marketing_performance_snapshots
    where id='55555555-5555-4555-8555-555555555555'
  $stmt$
);

reset role;

select 'M2B_MARKETING_SNAPSHOT_APPEND_ONLY=PASS';

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

set local role authenticated;

insert into public.marketing_performance_snapshots (
  id,
  campaign_id,
  campaign_creator_id,
  content_creator_id,
  platform,
  period_start,
  period_end,
  reach,
  impressions
)
values (
  '66666666-6666-4666-8666-666666666666',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'instagram',
  current_date,
  current_date,
  1100,
  1400
);

select public.m2b_test_expect_denied(
  'admin snapshot update',
  $stmt$
    update public.marketing_performance_snapshots
    set reach=1101
    where id='66666666-6666-4666-8666-666666666666'
  $stmt$
);

select public.m2b_test_expect_denied(
  'admin snapshot delete',
  $stmt$
    delete from public.marketing_performance_snapshots
    where id='66666666-6666-4666-8666-666666666666'
  $stmt$
);

reset role;

select 'M2B_ADMIN_SNAPSHOT_APPEND_ONLY=PASS';

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  true
);

set local role authenticated;

select public.m2b_test_assert_count(
  'manager snapshot read',
  'select count(*) from public.marketing_performance_snapshots',
  2
);

select public.m2b_test_expect_denied(
  'manager snapshot insert',
  $stmt$
    insert into public.marketing_performance_snapshots (
      campaign_id,
      campaign_creator_id,
      content_creator_id,
      platform,
      period_start,
      period_end
    )
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'instagram',
      current_date,
      current_date
    )
  $stmt$
);

reset role;

select 'M2B_MANAGER_SNAPSHOT_READ_ONLY=PASS';

select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-8444-444444444444',
  true
);

set local role authenticated;

select public.m2b_test_assert_count(
  'operations snapshot read blocked',
  'select count(*) from public.marketing_performance_snapshots',
  0
);

reset role;

select 'M2B_OTHER_STAFF_SNAPSHOT_DENIED=PASS';

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000000',
  true
);

set local role anon;

select public.m2b_test_expect_denied(
  'anonymous snapshot select',
  'select count(*) from public.marketing_performance_snapshots'
);

select public.m2b_test_expect_denied(
  'anonymous snapshot insert',
  $stmt$
    insert into public.marketing_performance_snapshots (
      campaign_id,
      campaign_creator_id,
      content_creator_id,
      platform,
      period_start,
      period_end
    )
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'instagram',
      current_date,
      current_date
    )
  $stmt$
);

reset role;

select 'M2B_ANON_SNAPSHOT_DENIED=PASS';

select 'MARKETING_M2_FULL_RLS_MATRIX=PASS';
