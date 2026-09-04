begin;

-- ============================================================
-- RideArrivo Marketing Wallet workstation bootstrap
--
-- This migration does NOT fund the wallet.
-- It creates one canonical active Marketing wallet only when
-- no active Marketing wallet already exists.
--
-- Existing active Marketing employees receive explicit,
-- wallet-scoped OPERATOR authority so they can submit governed
-- funding/payment requests.
--
-- Existing active Manager/Admin employees receive explicit,
-- wallet-scoped FINAL APPROVER authority.
--
-- Finance authority remains independent and continues to be
-- derived by the existing finance control plane.
-- ============================================================

do $$
declare
  v_wallet_id uuid;
begin

  select w.id
  into v_wallet_id
  from public.marketing_wallets w
  where w.department='marketing'
    and w.status='active'
  order by
    w.created_at asc,
    w.id asc
  limit 1;

  if v_wallet_id is null then

    insert into public.marketing_wallets (
      wallet_code,
      name,
      department,
      currency,
      status,
      created_by
    )
    values (
      'MARKETING-OPERATING',
      'Marketing Operating Wallet',
      'marketing',
      'NGN',
      'active',
      null
    )
    returning id
    into v_wallet_id;

    insert into public.marketing_wallet_audit_events (
      wallet_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      v_wallet_id,
      null,
      'wallet_bootstrapped',
      'wallet',
      v_wallet_id,
      jsonb_build_object(
        'source',
        'migration',
        'wallet_code',
        'MARKETING-OPERATING'
      )
    );

  end if;

  -- ----------------------------------------------------------
  -- Initial Marketing operators
  --
  -- This is an explicit wallet_authorizations row, not a
  -- client-side role bypass.
  --
  -- Only staff who are ACTIVE at migration time qualify.
  -- Future staff should be managed through the Administration
  -- wallet-authority surface rather than automatic triggers.
  -- ----------------------------------------------------------

  insert into public.marketing_wallet_authorizations (
    wallet_id,
    employee_id,
    authority,
    active,
    assigned_by,
    revoked_at
  )
  select
    v_wallet_id,
    p.id,
    'operator',
    true,
    null,
    null
  from public.employee_profiles p
  where p.active=true
    and (
      lower(coalesce(p.role,''))='marketing'
      or lower(coalesce(p.department,''))
        like '%marketing%'
    )
  on conflict (
    wallet_id,
    employee_id,
    authority
  )
  do update
  set
    active=true,
    revoked_at=null;

  -- ----------------------------------------------------------
  -- Initial independent final approvers
  --
  -- Marketing operators are NOT final approvers.
  -- Finance reviewers remain a separate authority.
  -- ----------------------------------------------------------

  insert into public.marketing_wallet_authorizations (
    wallet_id,
    employee_id,
    authority,
    active,
    assigned_by,
    revoked_at
  )
  select
    v_wallet_id,
    p.id,
    'final_approver',
    true,
    null,
    null
  from public.employee_profiles p
  where p.active=true
    and lower(coalesce(p.role,'')) in (
      'manager',
      'admin'
    )
  on conflict (
    wallet_id,
    employee_id,
    authority
  )
  do update
  set
    active=true,
    revoked_at=null;

end;
$$;

commit;
