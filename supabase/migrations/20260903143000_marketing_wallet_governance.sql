-- RideArrivo Marketing Wallet & Vendor Disbursement Governance
-- Additive foundation only.
-- No Providus credentials, no bank calls and no production seed data.

create table public.marketing_wallets (
  id uuid primary key default gen_random_uuid(),
  wallet_code text not null unique,
  name text not null,
  department text not null default 'marketing'
    check (department = 'marketing'),
  currency text not null default 'NGN'
    check (currency = 'NGN'),
  status text not null default 'active'
    check (status in ('active','suspended','closed')),
  created_by uuid references public.employee_profiles(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (wallet_code ~ '^[A-Z0-9_-]{3,40}$')
);

create table public.marketing_wallet_authorizations (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null
    references public.marketing_wallets(id) on delete restrict,
  employee_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  authority text not null
    check (authority in ('operator','final_approver')),
  active boolean not null default true,
  assigned_by uuid
    references public.employee_profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(wallet_id,employee_id,authority)
);

create table public.marketing_wallet_vendors (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null
    references public.marketing_wallets(id) on delete restrict,
  legal_name text not null,
  display_name text,
  bank_name text,
  account_name text,
  account_last4 text,
  bank_account_reference text,
  verification_status text not null default 'pending'
    check (
      verification_status in (
        'pending','verified','suspended','rejected'
      )
    ),
  verified_by uuid
    references public.employee_profiles(id) on delete set null,
  verified_at timestamptz,
  created_by uuid
    references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    account_last4 is null
    or account_last4 ~ '^[0-9]{4}$'
  )
);

create table public.marketing_wallet_funding_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null
    references public.marketing_wallets(id) on delete restrict,
  requested_by uuid not null
    references public.employee_profiles(id) on delete restrict,
  budget_id uuid
    references public.finance_budgets(id) on delete set null,
  campaign_id uuid
    references public.marketing_campaigns(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  purpose text not null,
  status text not null default 'draft'
    check (
      status in (
        'draft',
        'finance_review',
        'executive_approval',
        'approved_for_funding',
        'funding_in_progress',
        'funded',
        'rejected',
        'cancelled',
        'failed'
      )
    ),
  finance_reviewed_by uuid
    references public.employee_profiles(id) on delete set null,
  finance_reviewed_at timestamptz,
  finance_note text,
  executive_approved_by uuid
    references public.employee_profiles(id) on delete set null,
  executive_approved_at timestamptz,
  executive_note text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_wallet_payment_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null
    references public.marketing_wallets(id) on delete restrict,
  vendor_id uuid not null
    references public.marketing_wallet_vendors(id) on delete restrict,
  requested_by uuid not null
    references public.employee_profiles(id) on delete restrict,
  budget_id uuid
    references public.finance_budgets(id) on delete set null,
  campaign_id uuid
    references public.marketing_campaigns(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  narration text not null,
  vendor_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (
      status in (
        'draft',
        'submitted',
        'executive_approval',
        'approved_for_transfer',
        'transfer_in_progress',
        'settled',
        'rejected',
        'cancelled',
        'failed'
      )
    ),
  executive_approved_by uuid
    references public.employee_profiles(id) on delete set null,
  executive_approved_at timestamptz,
  executive_note text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_wallet_bank_transfers (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null
    references public.marketing_wallets(id) on delete restrict,
  funding_request_id uuid
    references public.marketing_wallet_funding_requests(id)
    on delete restrict,
  payment_request_id uuid
    references public.marketing_wallet_payment_requests(id)
    on delete restrict,
  provider text not null default 'providus'
    check (provider = 'providus'),
  direction text not null
    check (direction in ('funding_in','vendor_out')),
  amount numeric(14,2) not null check (amount > 0),
  idempotency_key text not null unique,
  provider_reference text unique,
  status text not null default 'created'
    check (
      status in (
        'created',
        'submitted',
        'succeeded',
        'failed',
        'unknown'
      )
    ),
  provider_response_digest text,
  requested_by uuid
    references public.employee_profiles(id) on delete set null,
  submitted_at timestamptz,
  settled_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  check (
    (
      direction='funding_in'
      and funding_request_id is not null
      and payment_request_id is null
    )
    or
    (
      direction='vendor_out'
      and payment_request_id is not null
      and funding_request_id is null
    )
  )
);

create table public.marketing_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null
    references public.marketing_wallets(id) on delete restrict,
  entry_type text not null
    check (
      entry_type in (
        'funding_credit',
        'vendor_reservation',
        'vendor_settlement',
        'reservation_release',
        'reversal'
      )
    ),
  available_delta numeric(14,2) not null default 0,
  reserved_delta numeric(14,2) not null default 0,
  funding_request_id uuid
    references public.marketing_wallet_funding_requests(id)
    on delete restrict,
  payment_request_id uuid
    references public.marketing_wallet_payment_requests(id)
    on delete restrict,
  bank_transfer_id uuid
    references public.marketing_wallet_bank_transfers(id)
    on delete restrict,
  idempotency_key text not null unique,
  description text not null,
  created_by uuid
    references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    available_delta <> 0
    or reserved_delta <> 0
  )
);

create table public.marketing_wallet_documents (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null
    references public.marketing_wallets(id) on delete restrict,
  funding_request_id uuid
    references public.marketing_wallet_funding_requests(id)
    on delete restrict,
  payment_request_id uuid
    references public.marketing_wallet_payment_requests(id)
    on delete restrict,
  document_type text not null,
  file_name text not null,
  storage_path text not null,
  uploaded_by uuid
    references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    funding_request_id is not null
    or payment_request_id is not null
  )
);

create table public.marketing_wallet_audit_events (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid
    references public.marketing_wallets(id) on delete restrict,
  actor_id uuid
    references public.employee_profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index marketing_wallet_authority_employee_idx
  on public.marketing_wallet_authorizations(
    employee_id,
    active,
    authority
  );

create index marketing_wallet_vendor_wallet_idx
  on public.marketing_wallet_vendors(
    wallet_id,
    verification_status
  );

create index marketing_wallet_funding_status_idx
  on public.marketing_wallet_funding_requests(
    wallet_id,
    status,
    created_at desc
  );

create index marketing_wallet_payment_status_idx
  on public.marketing_wallet_payment_requests(
    wallet_id,
    status,
    created_at desc
  );

create index marketing_wallet_ledger_wallet_idx
  on public.marketing_wallet_ledger(
    wallet_id,
    created_at
  );

create index marketing_wallet_transfer_status_idx
  on public.marketing_wallet_bank_transfers(
    wallet_id,
    status,
    created_at desc
  );

create or replace function public.marketing_wallet_is_finance()
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    public.has_workspace_role(array['finance','admin'])
    or public.has_workstation_access(array['finance']);
$$;

create or replace function
  public.marketing_wallet_is_finance_executor()
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    public.has_workspace_role(array['finance'])
    or public.has_workstation_access(array['finance']);
$$;

revoke all on function
  public.marketing_wallet_is_finance_executor()
from public,anon;

grant execute on function
  public.marketing_wallet_is_finance_executor()
to authenticated;


create or replace function public.marketing_wallet_has_authority(
  p_wallet_id uuid,
  p_authority text
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists (
    select 1
    from public.marketing_wallet_authorizations a
    join public.employee_profiles p
      on p.id=a.employee_id
    where a.wallet_id=p_wallet_id
      and a.employee_id=auth.uid()
      and a.authority=p_authority
      and a.active=true
      and p.active=true
  );
$$;

revoke all on function
  public.marketing_wallet_is_finance()
from public,anon;

revoke all on function
  public.marketing_wallet_has_authority(uuid,text)
from public,anon;

grant execute on function
  public.marketing_wallet_is_finance()
to authenticated;

grant execute on function
  public.marketing_wallet_has_authority(uuid,text)
to authenticated;

alter table public.marketing_wallets enable row level security;
alter table public.marketing_wallet_authorizations enable row level security;
alter table public.marketing_wallet_vendors enable row level security;
alter table public.marketing_wallet_funding_requests enable row level security;
alter table public.marketing_wallet_payment_requests enable row level security;
alter table public.marketing_wallet_bank_transfers enable row level security;
alter table public.marketing_wallet_ledger enable row level security;
alter table public.marketing_wallet_documents enable row level security;
alter table public.marketing_wallet_audit_events enable row level security;

create policy "marketing wallet authorised read"
on public.marketing_wallets
for select
to authenticated
using (
  public.marketing_wallet_is_finance()
  or public.has_workspace_role(array['marketing','manager'])
  or public.has_workstation_access(array['marketing'])
  or public.marketing_wallet_has_authority(id,'operator')
  or public.marketing_wallet_has_authority(id,'final_approver')
);

create policy "marketing wallet authority self or oversight read"
on public.marketing_wallet_authorizations
for select
to authenticated
using (
  employee_id=auth.uid()
  or public.marketing_wallet_is_finance()
  or public.has_workspace_role(array['admin'])
);

create policy "marketing wallet vendor controlled read"
on public.marketing_wallet_vendors
for select
to authenticated
using (
  public.marketing_wallet_is_finance()
  or public.marketing_wallet_has_authority(wallet_id,'operator')
  or public.marketing_wallet_has_authority(wallet_id,'final_approver')
);

create policy "marketing wallet funding controlled read"
on public.marketing_wallet_funding_requests
for select
to authenticated
using (
  requested_by=auth.uid()
  or public.marketing_wallet_is_finance()
  or public.marketing_wallet_has_authority(wallet_id,'operator')
  or public.marketing_wallet_has_authority(wallet_id,'final_approver')
);

create policy "marketing wallet payment controlled read"
on public.marketing_wallet_payment_requests
for select
to authenticated
using (
  requested_by=auth.uid()
  or public.marketing_wallet_is_finance()
  or public.marketing_wallet_has_authority(wallet_id,'operator')
  or public.marketing_wallet_has_authority(wallet_id,'final_approver')
);

create policy "marketing wallet transfer controlled read"
on public.marketing_wallet_bank_transfers
for select
to authenticated
using (
  public.marketing_wallet_is_finance()
  or public.marketing_wallet_has_authority(wallet_id,'operator')
  or public.marketing_wallet_has_authority(wallet_id,'final_approver')
);

create policy "marketing wallet ledger controlled read"
on public.marketing_wallet_ledger
for select
to authenticated
using (
  public.marketing_wallet_is_finance()
  or public.marketing_wallet_has_authority(wallet_id,'operator')
  or public.marketing_wallet_has_authority(wallet_id,'final_approver')
);

create policy "marketing wallet documents controlled read"
on public.marketing_wallet_documents
for select
to authenticated
using (
  public.marketing_wallet_is_finance()
  or public.marketing_wallet_has_authority(wallet_id,'operator')
  or public.marketing_wallet_has_authority(wallet_id,'final_approver')
);

create policy "marketing wallet audit oversight read"
on public.marketing_wallet_audit_events
for select
to authenticated
using (
  public.marketing_wallet_is_finance()
  or (
    wallet_id is not null
    and public.marketing_wallet_has_authority(
      wallet_id,
      'final_approver'
    )
  )
);

create or replace function public.protect_marketing_wallet_immutable_rows()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  raise exception
    'Marketing wallet financial history is append-only';
end;
$$;

revoke all on function
  public.protect_marketing_wallet_immutable_rows()
from public,anon,authenticated;

create trigger protect_marketing_wallet_ledger
before update or delete
on public.marketing_wallet_ledger
for each row
execute function public.protect_marketing_wallet_immutable_rows();

create trigger protect_marketing_wallet_audit
before update or delete
on public.marketing_wallet_audit_events
for each row
execute function public.protect_marketing_wallet_immutable_rows();

create view public.marketing_wallet_balances
with (security_invoker=true)
as
select
  w.id as wallet_id,
  w.wallet_code,
  w.name,
  w.currency,
  w.status,
  coalesce(sum(l.available_delta),0)::numeric(14,2)
    as available_balance,
  coalesce(sum(l.reserved_delta),0)::numeric(14,2)
    as reserved_balance,
  (
    coalesce(sum(l.available_delta),0)
    + coalesce(sum(l.reserved_delta),0)
  )::numeric(14,2) as controlled_balance
from public.marketing_wallets w
left join public.marketing_wallet_ledger l
  on l.wallet_id=w.id
group by
  w.id,
  w.wallet_code,
  w.name,
  w.currency,
  w.status;

revoke all on
  public.marketing_wallets,
  public.marketing_wallet_authorizations,
  public.marketing_wallet_vendors,
  public.marketing_wallet_funding_requests,
  public.marketing_wallet_payment_requests,
  public.marketing_wallet_bank_transfers,
  public.marketing_wallet_ledger,
  public.marketing_wallet_documents,
  public.marketing_wallet_audit_events
from anon,authenticated;

grant select on
  public.marketing_wallets,
  public.marketing_wallet_authorizations,
  public.marketing_wallet_vendors,
  public.marketing_wallet_funding_requests,
  public.marketing_wallet_payment_requests,
  public.marketing_wallet_bank_transfers,
  public.marketing_wallet_ledger,
  public.marketing_wallet_documents,
  public.marketing_wallet_audit_events,
  public.marketing_wallet_balances
to authenticated;

grant select,insert,update on
  public.marketing_wallets,
  public.marketing_wallet_authorizations,
  public.marketing_wallet_vendors,
  public.marketing_wallet_funding_requests,
  public.marketing_wallet_payment_requests,
  public.marketing_wallet_bank_transfers,
  public.marketing_wallet_documents
to service_role;

grant select,insert on
  public.marketing_wallet_ledger,
  public.marketing_wallet_audit_events
to service_role;

revoke delete on
  public.marketing_wallets,
  public.marketing_wallet_authorizations,
  public.marketing_wallet_vendors,
  public.marketing_wallet_funding_requests,
  public.marketing_wallet_payment_requests,
  public.marketing_wallet_bank_transfers,
  public.marketing_wallet_ledger,
  public.marketing_wallet_documents,
  public.marketing_wallet_audit_events
from authenticated,service_role;

-- ------------------------------------------------------------
-- Marketing Wallet controlled state transitions
-- ------------------------------------------------------------

create or replace function public.marketing_wallet_submit_funding_request(
  p_wallet_id uuid,
  p_amount numeric,
  p_purpose text,
  p_idempotency_key text,
  p_budget_id uuid default null,
  p_campaign_id uuid default null
)
returns public.marketing_wallet_funding_requests
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_wallet public.marketing_wallets%rowtype;
  v_existing public.marketing_wallet_funding_requests%rowtype;
  v_request public.marketing_wallet_funding_requests%rowtype;
begin
  if v_actor is null then
    raise exception
      'Authenticated Marketing Wallet actor is required'
      using errcode='42501';
  end if;

  if p_wallet_id is null then
    raise exception
      'Marketing wallet identifier is required'
      using errcode='22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception
      'Funding amount must be greater than zero'
      using errcode='22023';
  end if;

  if nullif(btrim(p_purpose),'') is null then
    raise exception
      'Funding purpose is required'
      using errcode='22023';
  end if;

  if nullif(btrim(p_idempotency_key),'') is null then
    raise exception
      'Funding idempotency key is required'
      using errcode='22023';
  end if;

  select *
  into v_wallet
  from public.marketing_wallets
  where id=p_wallet_id
  for update;

  if not found then
    raise exception
      'Marketing wallet not found'
      using errcode='P0002';
  end if;

  if v_wallet.status <> 'active' then
    raise exception
      'Marketing wallet is not active'
      using errcode='55000';
  end if;

  if not public.marketing_wallet_has_authority(
    p_wallet_id,
    'operator'
  ) then
    raise exception
      'Marketing Wallet operator authority is required'
      using errcode='42501';
  end if;

  select *
  into v_existing
  from public.marketing_wallet_funding_requests
  where idempotency_key=btrim(p_idempotency_key);

  if found then
    if (
      v_existing.wallet_id=p_wallet_id
      and v_existing.requested_by=v_actor
      and v_existing.amount=p_amount
      and v_existing.purpose=btrim(p_purpose)
      and v_existing.budget_id is not distinct from p_budget_id
      and v_existing.campaign_id is not distinct from p_campaign_id
    ) then
      return v_existing;
    end if;

    raise exception
      'Funding idempotency key is already bound to another request'
      using errcode='23505';
  end if;

  insert into public.marketing_wallet_funding_requests (
    wallet_id,
    requested_by,
    budget_id,
    campaign_id,
    amount,
    purpose,
    status,
    idempotency_key
  )
  values (
    p_wallet_id,
    v_actor,
    p_budget_id,
    p_campaign_id,
    p_amount,
    btrim(p_purpose),
    'finance_review',
    btrim(p_idempotency_key)
  )
  returning *
  into v_request;

  insert into public.marketing_wallet_audit_events (
    wallet_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_wallet_id,
    v_actor,
    'funding_request_submitted',
    'funding_request',
    v_request.id,
    jsonb_build_object(
      'status',
      'finance_review',
      'amount',
      p_amount
    )
  );

  return v_request;
end;
$$;

revoke all on function
  public.marketing_wallet_submit_funding_request(
    uuid,
    numeric,
    text,
    text,
    uuid,
    uuid
  )
from public,anon;

grant execute on function
  public.marketing_wallet_submit_funding_request(
    uuid,
    numeric,
    text,
    text,
    uuid,
    uuid
  )
to authenticated;

create or replace function
  public.marketing_wallet_review_funding_request(
    p_request_id uuid,
    p_approve boolean,
    p_note text default null
  )
returns public.marketing_wallet_funding_requests
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_request
    public.marketing_wallet_funding_requests%rowtype;
  v_result
    public.marketing_wallet_funding_requests%rowtype;
begin
  if v_actor is null then
    raise exception
      'Authenticated Finance actor is required'
      using errcode='42501';
  end if;

  if p_request_id is null then
    raise exception
      'Funding request identifier is required'
      using errcode='22023';
  end if;

  if p_approve is null then
    raise exception
      'Finance review decision is required'
      using errcode='22023';
  end if;

  if not public.marketing_wallet_is_finance_executor() then
    raise exception
      'Finance execution authority is required'
      using errcode='42501';
  end if;

  select *
  into v_request
  from public.marketing_wallet_funding_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet funding request not found'
      using errcode='P0002';
  end if;

  if v_request.status <> 'finance_review' then
    raise exception
      'Funding request is not awaiting Finance review'
      using errcode='55000';
  end if;

  if v_request.requested_by = v_actor then
    raise exception
      'Requester cannot perform Finance review'
      using errcode='42501';
  end if;

  update public.marketing_wallet_funding_requests
  set
    status =
      case
        when p_approve
          then 'executive_approval'
        else 'rejected'
      end,
    finance_reviewed_by=v_actor,
    finance_reviewed_at=now(),
    finance_note=
      nullif(btrim(coalesce(p_note,'')),''),
    updated_at=now()
  where id=p_request_id
  returning *
  into v_result;

  insert into public.marketing_wallet_audit_events (
    wallet_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_result.wallet_id,
    v_actor,
    case
      when p_approve
        then 'funding_request_finance_approved'
      else 'funding_request_finance_rejected'
    end,
    'funding_request',
    v_result.id,
    jsonb_build_object(
      'from_status',
      'finance_review',
      'to_status',
      v_result.status,
      'note',
      v_result.finance_note
    )
  );

  return v_result;
end;
$$;

revoke all on function
  public.marketing_wallet_review_funding_request(
    uuid,
    boolean,
    text
  )
from public,anon;

grant execute on function
  public.marketing_wallet_review_funding_request(
    uuid,
    boolean,
    text
  )
to authenticated;


-- ------------------------------------------------------------
-- Executive final approval of Marketing Wallet funding
--
-- Finance review must already have succeeded.
-- The final approver must hold an explicit wallet-scoped
-- final_approver authorization and must be independent of both
-- the requester and the Finance reviewer.
-- ------------------------------------------------------------

create or replace function
  public.marketing_wallet_final_approve_funding_request(
    p_request_id uuid,
    p_approve boolean,
    p_note text default null
  )
returns public.marketing_wallet_funding_requests
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();

  v_request
    public.marketing_wallet_funding_requests%rowtype;

  v_result
    public.marketing_wallet_funding_requests%rowtype;
begin
  if v_actor is null then
    raise exception
      'Authenticated final approver is required'
      using errcode='42501';
  end if;

  if p_request_id is null then
    raise exception
      'Funding request identifier is required'
      using errcode='22023';
  end if;

  if p_approve is null then
    raise exception
      'Final funding approval decision is required'
      using errcode='22023';
  end if;

  select *
  into v_request
  from public.marketing_wallet_funding_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet funding request not found'
      using errcode='P0002';
  end if;

  if v_request.status <> 'executive_approval' then
    raise exception
      'Funding request is not awaiting executive approval'
      using errcode='55000';
  end if;

  if
    v_request.finance_reviewed_by is null
    or v_request.finance_reviewed_at is null
  then
    raise exception
      'Funding request has not completed Finance review'
      using errcode='55000';
  end if;

  if not public.marketing_wallet_has_authority(
    v_request.wallet_id,
    'final_approver'
  ) then
    raise exception
      'Final funding approval authority is required'
      using errcode='42501';
  end if;

  if v_request.requested_by = v_actor then
    raise exception
      'Requester cannot perform final funding approval'
      using errcode='42501';
  end if;

  if v_request.finance_reviewed_by = v_actor then
    raise exception
      'Finance reviewer cannot perform final funding approval'
      using errcode='42501';
  end if;

  update public.marketing_wallet_funding_requests
  set
    status =
      case
        when p_approve
          then 'approved_for_funding'
        else 'rejected'
      end,

    executive_approved_by=v_actor,
    executive_approved_at=now(),

    executive_note=
      nullif(
        btrim(coalesce(p_note,'')),
        ''
      ),

    updated_at=now()
  where id=p_request_id
  returning *
  into v_result;

  insert into public.marketing_wallet_audit_events (
    wallet_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_result.wallet_id,
    v_actor,

    case
      when p_approve
        then 'funding_request_final_approved'
      else 'funding_request_final_rejected'
    end,

    'funding_request',
    v_result.id,

    jsonb_build_object(
      'from_status',
      'executive_approval',

      'to_status',
      v_result.status,

      'finance_reviewed_by',
      v_result.finance_reviewed_by,

      'final_approver',
      v_actor,

      'note',
      v_result.executive_note
    )
  );

  return v_result;
end;
$$;

revoke all on function
  public.marketing_wallet_final_approve_funding_request(
    uuid,
    boolean,
    text
  )
from public,anon;

grant execute on function
  public.marketing_wallet_final_approve_funding_request(
    uuid,
    boolean,
    text
  )
to authenticated;

-- ------------------------------------------------------------
-- Confirm Marketing Wallet funding
--
-- TRUST BOUNDARY:
--
-- This RPC does not create or assert Providus settlement evidence.
-- Trusted server-side/provider ingestion must already have recorded
-- exactly one succeeded funding_in bank-transfer row for the funding
-- request.
--
-- Authenticated Finance execution may consume that server-created
-- evidence, but cannot manufacture a succeeded provider transfer.
--
-- Atomic database transition:
--
--   pre-existing succeeded Providus funding_in evidence
--     -> immutable funding_credit ledger entry
--     -> funded
--     -> immutable audit event
--
-- Exact replay with the same provider evidence is idempotent.
-- Conflicting replay fails closed.
-- ------------------------------------------------------------

create or replace function
  public.marketing_wallet_confirm_funding(
    p_request_id uuid,
    p_confirmed_amount numeric,
    p_provider_reference text,
    p_idempotency_key text,
    p_provider_response_digest text default null
  )
returns public.marketing_wallet_funding_requests
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();

  v_request
    public.marketing_wallet_funding_requests%rowtype;

  v_result
    public.marketing_wallet_funding_requests%rowtype;

  v_transfer_by_key
    public.marketing_wallet_bank_transfers%rowtype;

  v_transfer_by_reference
    public.marketing_wallet_bank_transfers%rowtype;

  v_transfer
    public.marketing_wallet_bank_transfers%rowtype;

  v_credit
    public.marketing_wallet_ledger%rowtype;

  v_idempotency_key text :=
    btrim(coalesce(p_idempotency_key,''));

  v_provider_reference text :=
    btrim(coalesce(p_provider_reference,''));

  v_provider_response_digest text :=
    nullif(
      lower(
        btrim(
          coalesce(p_provider_response_digest,'')
        )
      ),
      ''
    );

  v_credit_count bigint := 0;
  v_successful_transfer_count bigint := 0;
begin
  if v_actor is null then
    raise exception
      'Authenticated Finance executor is required'
      using errcode='42501';
  end if;

  if p_request_id is null then
    raise exception
      'Funding request identifier is required'
      using errcode='22023';
  end if;

  if
    p_confirmed_amount is null
    or p_confirmed_amount <= 0
  then
    raise exception
      'Confirmed funding amount must be greater than zero'
      using errcode='22023';
  end if;

  if v_provider_reference = '' then
    raise exception
      'Providus funding reference is required'
      using errcode='22023';
  end if;

  if v_idempotency_key = '' then
    raise exception
      'Funding confirmation idempotency key is required'
      using errcode='22023';
  end if;

  if
    v_provider_response_digest is null
    or v_provider_response_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception
      'Provider response digest must be a SHA-256 hex digest'
      using errcode='22023';
  end if;

  if not public.marketing_wallet_is_finance_executor() then
    raise exception
      'Finance execution authority is required'
      using errcode='42501';
  end if;

  select *
  into v_request
  from public.marketing_wallet_funding_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet funding request not found'
      using errcode='P0002';
  end if;

  if p_confirmed_amount <> v_request.amount then
    raise exception
      'Confirmed funding amount does not match approved request amount'
      using errcode='22023';
  end if;

  select *
  into v_transfer_by_key
  from public.marketing_wallet_bank_transfers
  where idempotency_key=v_idempotency_key;

  select *
  into v_transfer_by_reference
  from public.marketing_wallet_bank_transfers
  where provider_reference=v_provider_reference;

  select count(*)
  into v_successful_transfer_count
  from public.marketing_wallet_bank_transfers
  where funding_request_id=v_request.id
    and direction='funding_in'
    and status='succeeded';

  select count(*)
  into v_credit_count
  from public.marketing_wallet_ledger
  where funding_request_id=v_request.id
    and entry_type='funding_credit';

  -- ----------------------------------------------------------
  -- Exact replay of an already completed confirmation.
  --
  -- The request must have exactly one succeeded provider transfer
  -- and exactly one immutable funding credit, with the caller's
  -- identifiers resolving to that same server-created evidence.
  -- ----------------------------------------------------------

  if v_request.status = 'funded' then
    if
      v_successful_transfer_count <> 1
      or v_credit_count <> 1
      or v_transfer_by_key.id is null
      or v_transfer_by_reference.id is null
      or v_transfer_by_key.id <> v_transfer_by_reference.id
      or v_transfer_by_key.funding_request_id
           is distinct from v_request.id
      or v_transfer_by_key.wallet_id <> v_request.wallet_id
      or v_transfer_by_key.provider <> 'providus'
      or v_transfer_by_key.direction <> 'funding_in'
      or v_transfer_by_key.amount <> v_request.amount
      or v_transfer_by_key.status <> 'succeeded'
      or v_transfer_by_key.settled_at is null
      or v_transfer_by_key.provider_reference
           <> v_provider_reference
      or v_transfer_by_key.provider_response_digest
           is distinct from v_provider_response_digest
    then
      raise exception
        'Funding request is already funded with different confirmation evidence'
        using errcode='55000';
    end if;

    select *
    into v_credit
    from public.marketing_wallet_ledger
    where funding_request_id=v_request.id
      and entry_type='funding_credit'
    order by created_at asc
    limit 1;

    if
      v_credit.bank_transfer_id
        is distinct from v_transfer_by_key.id
      or v_credit.wallet_id <> v_request.wallet_id
      or v_credit.available_delta <> v_request.amount
      or v_credit.reserved_delta <> 0
      or v_credit.idempotency_key
           <> ('funding-credit:' || v_idempotency_key)
    then
      raise exception
        'Existing Marketing Wallet funding credit does not match confirmation evidence'
        using errcode='55000';
    end if;

    return v_request;
  end if;

  if v_request.status <> 'approved_for_funding' then
    raise exception
      'Funding request is not approved for funding confirmation'
      using errcode='55000';
  end if;

  if
    v_request.finance_reviewed_by is null
    or v_request.finance_reviewed_at is null
    or v_request.executive_approved_by is null
    or v_request.executive_approved_at is null
  then
    raise exception
      'Funding request has not completed required approvals'
      using errcode='55000';
  end if;

  if v_credit_count <> 0 then
    raise exception
      'Funding request already contains a funding credit'
      using errcode='55000';
  end if;

  -- A succeeded incoming transfer is the trust anchor.
  --
  -- This row must already exist before an authenticated Finance
  -- executor reaches this RPC. Authenticated callers cannot create
  -- that provider evidence through this function.

  if v_successful_transfer_count <> 1 then
    raise exception
      'Exactly one succeeded Providus funding confirmation is required'
      using errcode='55000';
  end if;

  if
    v_transfer_by_key.id is null
    or v_transfer_by_reference.id is null
    or v_transfer_by_key.id <> v_transfer_by_reference.id
  then
    raise exception
      'Funding confirmation identifiers do not resolve to the same provider evidence'
      using errcode='55000';
  end if;

  select *
  into v_transfer
  from public.marketing_wallet_bank_transfers
  where id=v_transfer_by_key.id
  for update;

  if not found then
    raise exception
      'Providus funding confirmation evidence was not found'
      using errcode='P0002';
  end if;

  if
    v_transfer.funding_request_id
      is distinct from v_request.id
    or v_transfer.wallet_id <> v_request.wallet_id
    or v_transfer.payment_request_id is not null
    or v_transfer.provider <> 'providus'
    or v_transfer.direction <> 'funding_in'
    or v_transfer.amount <> v_request.amount
    or v_transfer.status <> 'succeeded'
    or v_transfer.settled_at is null
    or v_transfer.provider_reference
         <> v_provider_reference
    or v_transfer.provider_response_digest
         is distinct from v_provider_response_digest
  then
    raise exception
      'Succeeded Providus funding evidence does not match the approved funding request'
      using errcode='55000';
  end if;

  insert into public.marketing_wallet_ledger (
    wallet_id,
    entry_type,
    available_delta,
    reserved_delta,
    funding_request_id,
    payment_request_id,
    bank_transfer_id,
    idempotency_key,
    description,
    created_by
  )
  values (
    v_request.wallet_id,
    'funding_credit',
    v_request.amount,
    0,
    v_request.id,
    null,
    v_transfer.id,
    'funding-credit:' || v_idempotency_key,
    'Confirmed Providus funding credit',
    v_actor
  );

  update public.marketing_wallet_funding_requests
  set
    status='funded',
    updated_at=now()
  where id=v_request.id
  returning *
  into v_result;

  insert into public.marketing_wallet_audit_events (
    wallet_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_result.wallet_id,
    v_actor,
    'funding_request_funded',
    'funding_request',
    v_result.id,
    jsonb_build_object(
      'from_status',
      'approved_for_funding',

      'to_status',
      'funded',

      'amount',
      v_result.amount,

      'provider',
      'providus',

      'provider_reference',
      v_transfer.provider_reference,

      'bank_transfer_id',
      v_transfer.id
    )
  );

  return v_result;
end;
$$;

revoke all on function
  public.marketing_wallet_confirm_funding(
    uuid,
    numeric,
    text,
    text,
    text
  )
from public,anon;

grant execute on function
  public.marketing_wallet_confirm_funding(
    uuid,
    numeric,
    text,
    text,
    text
  )
to authenticated;

-- ------------------------------------------------------------
-- Submit Marketing Wallet vendor payment request
--
-- Submission validates:
--   * authenticated actor
--   * active Marketing Wallet
--   * explicit wallet operator authority
--   * verified vendor belonging to the wallet
--   * complete verified bank destination
--   * durable request idempotency
--
-- Vendor destination data is snapshotted so subsequent vendor
-- edits cannot silently alter the destination being approved.
--
-- Submission deliberately does not reserve wallet funds.
-- Financial reservation occurs only at final executive approval.
-- ------------------------------------------------------------

create or replace function
  public.marketing_wallet_submit_payment_request(
    p_wallet_id uuid,
    p_vendor_id uuid,
    p_amount numeric,
    p_narration text,
    p_idempotency_key text,
    p_budget_id uuid default null,
    p_campaign_id uuid default null
  )
returns public.marketing_wallet_payment_requests
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();

  v_wallet
    public.marketing_wallets%rowtype;

  v_vendor
    public.marketing_wallet_vendors%rowtype;

  v_existing
    public.marketing_wallet_payment_requests%rowtype;

  v_request
    public.marketing_wallet_payment_requests%rowtype;

  v_narration text :=
    btrim(coalesce(p_narration,''));

  v_idempotency_key text :=
    btrim(coalesce(p_idempotency_key,''));

  v_vendor_snapshot jsonb;
begin
  if v_actor is null then
    raise exception
      'Authenticated Marketing Wallet actor is required'
      using errcode='42501';
  end if;

  if p_wallet_id is null then
    raise exception
      'Marketing wallet identifier is required'
      using errcode='22023';
  end if;

  if p_vendor_id is null then
    raise exception
      'Marketing Wallet vendor identifier is required'
      using errcode='22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception
      'Payment amount must be greater than zero'
      using errcode='22023';
  end if;

  if v_narration = '' then
    raise exception
      'Payment narration is required'
      using errcode='22023';
  end if;

  if v_idempotency_key = '' then
    raise exception
      'Payment request idempotency key is required'
      using errcode='22023';
  end if;

  select *
  into v_wallet
  from public.marketing_wallets
  where id=p_wallet_id
  for update;

  if not found then
    raise exception
      'Marketing wallet not found'
      using errcode='P0002';
  end if;

  if v_wallet.status <> 'active' then
    raise exception
      'Marketing wallet is not active'
      using errcode='55000';
  end if;

  if not public.marketing_wallet_has_authority(
    p_wallet_id,
    'operator'
  ) then
    raise exception
      'Marketing Wallet operator authority is required'
      using errcode='42501';
  end if;

  select *
  into v_existing
  from public.marketing_wallet_payment_requests
  where idempotency_key=v_idempotency_key;

  if found then
    if
      v_existing.wallet_id = p_wallet_id
      and v_existing.vendor_id = p_vendor_id
      and v_existing.requested_by = v_actor
      and v_existing.amount = p_amount
      and v_existing.narration = v_narration
      and v_existing.budget_id
            is not distinct from p_budget_id
      and v_existing.campaign_id
            is not distinct from p_campaign_id
    then
      return v_existing;
    end if;

    raise exception
      'Payment request idempotency key is already bound to another request'
      using errcode='23505';
  end if;

  select *
  into v_vendor
  from public.marketing_wallet_vendors
  where id=p_vendor_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet vendor not found'
      using errcode='P0002';
  end if;

  if v_vendor.wallet_id is distinct from p_wallet_id then
    raise exception
      'Marketing Wallet vendor does not belong to this wallet'
      using errcode='22023';
  end if;

  if v_vendor.verification_status <> 'verified' then
    raise exception
      'Marketing Wallet vendor is not verified'
      using errcode='55000';
  end if;

  if
    v_vendor.verified_by is null
    or v_vendor.verified_at is null
  then
    raise exception
      'Verified vendor is missing verification provenance'
      using errcode='55000';
  end if;

  if
    nullif(
      btrim(coalesce(v_vendor.legal_name,'')),
      ''
    ) is null
    or nullif(
      btrim(coalesce(v_vendor.bank_name,'')),
      ''
    ) is null
    or nullif(
      btrim(coalesce(v_vendor.account_name,'')),
      ''
    ) is null
    or v_vendor.account_last4 is null
    or v_vendor.account_last4 !~ '^[0-9]{4}$'
    or nullif(
      btrim(
        coalesce(
          v_vendor.bank_account_reference,
          ''
        )
      ),
      ''
    ) is null
  then
    raise exception
      'Verified vendor bank destination is incomplete'
      using errcode='55000';
  end if;

  v_vendor_snapshot :=
    jsonb_build_object(
      'schema_version',
      1,

      'vendor_id',
      v_vendor.id,

      'wallet_id',
      v_vendor.wallet_id,

      'legal_name',
      btrim(v_vendor.legal_name),

      'display_name',
      nullif(
        btrim(coalesce(v_vendor.display_name,'')),
        ''
      ),

      'bank_name',
      btrim(v_vendor.bank_name),

      'account_name',
      btrim(v_vendor.account_name),

      'account_last4',
      v_vendor.account_last4,

      'bank_account_reference',
      btrim(v_vendor.bank_account_reference),

      'verification_status',
      v_vendor.verification_status,

      'verified_by',
      v_vendor.verified_by,

      'verified_at',
      v_vendor.verified_at,

      'captured_at',
      now()
    );

  insert into public.marketing_wallet_payment_requests (
    wallet_id,
    vendor_id,
    requested_by,
    budget_id,
    campaign_id,
    amount,
    narration,
    vendor_snapshot,
    status,
    idempotency_key
  )
  values (
    p_wallet_id,
    p_vendor_id,
    v_actor,
    p_budget_id,
    p_campaign_id,
    p_amount,
    v_narration,
    v_vendor_snapshot,
    'executive_approval',
    v_idempotency_key
  )
  returning *
  into v_request;

  insert into public.marketing_wallet_audit_events (
    wallet_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_wallet_id,
    v_actor,
    'payment_request_submitted',
    'payment_request',
    v_request.id,
    jsonb_build_object(
      'from_status',
      'draft',

      'to_status',
      'executive_approval',

      'vendor_id',
      p_vendor_id,

      'amount',
      p_amount,

      'reservation_created',
      false
    )
  );

  return v_request;
end;
$$;

revoke all on function
  public.marketing_wallet_submit_payment_request(
    uuid,
    uuid,
    numeric,
    text,
    text,
    uuid,
    uuid
  )
from public,anon;

grant execute on function
  public.marketing_wallet_submit_payment_request(
    uuid,
    uuid,
    numeric,
    text,
    text,
    uuid,
    uuid
  )
to authenticated;

-- ------------------------------------------------------------
-- Final approval for Marketing Wallet vendor payment
--
-- Approval is the financial reservation boundary.
--
-- An approval:
--   * requires explicit wallet final_approver authority
--   * cannot be performed by the original requester
--   * requires the wallet to remain active
--   * requires the vendor to remain verified
--   * requires the live vendor payment destination to match the
--     immutable vendor snapshot captured at submission
--   * requires sufficient available wallet balance
--   * creates exactly one vendor_reservation ledger entry
--   * moves amount atomically from available to reserved
--   * moves request to approved_for_transfer
--
-- A rejection:
--   * creates no reservation
--   * moves request directly to rejected
--
-- No external bank transfer is created here.
-- ------------------------------------------------------------

create or replace function
  public.marketing_wallet_final_approve_payment_request(
    p_request_id uuid,
    p_approve boolean,
    p_note text default null
  )
returns public.marketing_wallet_payment_requests
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();

  v_request
    public.marketing_wallet_payment_requests%rowtype;

  v_result
    public.marketing_wallet_payment_requests%rowtype;

  v_wallet
    public.marketing_wallets%rowtype;

  v_vendor
    public.marketing_wallet_vendors%rowtype;

  v_available_balance numeric(14,2);

  v_existing_financial_rows bigint;

  v_note text :=
    nullif(
      btrim(coalesce(p_note,'')),
      ''
    );

  v_reservation_key text;
begin
  if v_actor is null then
    raise exception
      'Authenticated Marketing Wallet actor is required'
      using errcode='42501';
  end if;

  if p_request_id is null then
    raise exception
      'Payment request identifier is required'
      using errcode='22023';
  end if;

  if p_approve is null then
    raise exception
      'Final payment approval decision is required'
      using errcode='22023';
  end if;

  select *
  into v_request
  from public.marketing_wallet_payment_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet payment request not found'
      using errcode='P0002';
  end if;

  if v_request.status <> 'executive_approval' then
    raise exception
      'Payment request is not awaiting final executive approval'
      using errcode='55000';
  end if;

  if not public.marketing_wallet_has_authority(
    v_request.wallet_id,
    'final_approver'
  ) then
    raise exception
      'Final payment approval authority is required'
      using errcode='42501';
  end if;

  if v_request.requested_by = v_actor then
    raise exception
      'Requester cannot perform final payment approval'
      using errcode='42501';
  end if;

  -- ----------------------------------------------------------
  -- Rejection has no financial side effect.
  -- ----------------------------------------------------------

  if not p_approve then
    update public.marketing_wallet_payment_requests
    set
      status='rejected',
      executive_approved_by=v_actor,
      executive_approved_at=now(),
      executive_note=v_note,
      updated_at=now()
    where id=v_request.id
    returning *
    into v_result;

    insert into public.marketing_wallet_audit_events (
      wallet_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      v_result.wallet_id,
      v_actor,
      'payment_request_final_rejected',
      'payment_request',
      v_result.id,
      jsonb_build_object(
        'from_status',
        'executive_approval',

        'to_status',
        'rejected',

        'amount',
        v_result.amount,

        'reservation_created',
        false,

        'note',
        v_result.executive_note
      )
    );

    return v_result;
  end if;

  -- ----------------------------------------------------------
  -- Approval path.
  --
  -- Lock the wallet to serialize reservation decisions.
  -- ----------------------------------------------------------

  select *
  into v_wallet
  from public.marketing_wallets
  where id=v_request.wallet_id
  for update;

  if not found then
    raise exception
      'Marketing wallet not found'
      using errcode='P0002';
  end if;

  if v_wallet.status <> 'active' then
    raise exception
      'Marketing wallet is not active'
      using errcode='55000';
  end if;

  -- Financial history must still be empty for a request awaiting
  -- its first final approval.
  select count(*)
  into v_existing_financial_rows
  from public.marketing_wallet_ledger
  where payment_request_id=v_request.id;

  if v_existing_financial_rows <> 0 then
    raise exception
      'Payment request already has financial ledger history'
      using errcode='55000';
  end if;

  -- ----------------------------------------------------------
  -- Revalidate the vendor immediately before money is reserved.
  --
  -- The approved destination must still exactly match the
  -- immutable snapshot captured when the request was submitted.
  -- ----------------------------------------------------------

  select *
  into v_vendor
  from public.marketing_wallet_vendors
  where id=v_request.vendor_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet vendor not found'
      using errcode='P0002';
  end if;

  if v_vendor.wallet_id is distinct from v_request.wallet_id then
    raise exception
      'Marketing Wallet vendor no longer belongs to this wallet'
      using errcode='55000';
  end if;

  if v_vendor.verification_status <> 'verified' then
    raise exception
      'Marketing Wallet vendor is no longer verified'
      using errcode='55000';
  end if;

  if
    v_vendor.verified_by is null
    or v_vendor.verified_at is null
  then
    raise exception
      'Verified vendor is missing verification provenance'
      using errcode='55000';
  end if;

  if
    jsonb_typeof(v_request.vendor_snapshot)
      is distinct from 'object'
    or v_request.vendor_snapshot->>'schema_version'
      is distinct from '1'
    or v_request.vendor_snapshot->'vendor_id'
      is distinct from to_jsonb(v_vendor.id)
    or v_request.vendor_snapshot->'wallet_id'
      is distinct from to_jsonb(v_vendor.wallet_id)
    or v_request.vendor_snapshot->>'legal_name'
      is distinct from btrim(v_vendor.legal_name)
    or v_request.vendor_snapshot->>'bank_name'
      is distinct from btrim(coalesce(v_vendor.bank_name,''))
    or v_request.vendor_snapshot->>'account_name'
      is distinct from btrim(coalesce(v_vendor.account_name,''))
    or v_request.vendor_snapshot->>'account_last4'
      is distinct from v_vendor.account_last4
    or v_request.vendor_snapshot->>'bank_account_reference'
      is distinct from
        btrim(
          coalesce(
            v_vendor.bank_account_reference,
            ''
          )
        )
    or v_request.vendor_snapshot->>'verification_status'
      is distinct from v_vendor.verification_status
    or v_request.vendor_snapshot->'verified_by'
      is distinct from to_jsonb(v_vendor.verified_by)
    or v_request.vendor_snapshot->'verified_at'
      is distinct from to_jsonb(v_vendor.verified_at)
  then
    raise exception
      'Vendor payment destination changed after submission'
      using errcode='55000';
  end if;

  if
    nullif(
      v_request.vendor_snapshot->>'captured_at',
      ''
    ) is null
  then
    raise exception
      'Vendor payment snapshot is incomplete'
      using errcode='55000';
  end if;

  -- ----------------------------------------------------------
  -- Available balance is derived exclusively from the
  -- append-only wallet ledger.
  -- ----------------------------------------------------------

  select
    coalesce(
      sum(available_delta),
      0
    )::numeric(14,2)
  into v_available_balance
  from public.marketing_wallet_ledger
  where wallet_id=v_request.wallet_id;

  if v_available_balance < v_request.amount then
    raise exception
      'Insufficient available Marketing Wallet balance'
      using errcode='55000';
  end if;

  v_reservation_key :=
    'vendor-reservation:' || v_request.id::text;

  insert into public.marketing_wallet_ledger (
    wallet_id,
    entry_type,
    available_delta,
    reserved_delta,
    funding_request_id,
    payment_request_id,
    bank_transfer_id,
    idempotency_key,
    description,
    created_by
  )
  values (
    v_request.wallet_id,
    'vendor_reservation',
    -v_request.amount,
    v_request.amount,
    null,
    v_request.id,
    null,
    v_reservation_key,
    'Reserved for approved Marketing Wallet vendor payment',
    v_actor
  );

  update public.marketing_wallet_payment_requests
  set
    status='approved_for_transfer',
    executive_approved_by=v_actor,
    executive_approved_at=now(),
    executive_note=v_note,
    updated_at=now()
  where id=v_request.id
  returning *
  into v_result;

  insert into public.marketing_wallet_audit_events (
    wallet_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_result.wallet_id,
    v_actor,
    'payment_request_final_approved',
    'payment_request',
    v_result.id,
    jsonb_build_object(
      'from_status',
      'executive_approval',

      'to_status',
      'approved_for_transfer',

      'vendor_id',
      v_result.vendor_id,

      'amount',
      v_result.amount,

      'available_balance_before',
      v_available_balance,

      'available_balance_after',
      v_available_balance - v_result.amount,

      'reserved_amount',
      v_result.amount,

      'reservation_idempotency_key',
      v_reservation_key,

      'reservation_created',
      true,

      'note',
      v_result.executive_note
    )
  );

  return v_result;
end;
$$;

revoke all on function
  public.marketing_wallet_final_approve_payment_request(
    uuid,
    boolean,
    text
  )
from public,anon;

grant execute on function
  public.marketing_wallet_final_approve_payment_request(
    uuid,
    boolean,
    text
  )
to authenticated;

-- ------------------------------------------------------------
-- Begin Marketing Wallet vendor bank transfer
--
-- TRUST BOUNDARY:
--
-- This RPC creates an internal transfer intent only.
--
-- Authenticated Finance execution may:
--   * consume an approved payment reservation
--   * create exactly one Providus vendor_out transfer intent
--   * create it only with status='created'
--   * move the payment request to transfer_in_progress
--
-- It may NOT:
--   * call Providus
--   * invent a provider reference
--   * mark a provider transfer submitted
--   * mark a provider transfer succeeded
--   * mark a provider transfer failed
--   * mark a provider transfer unknown
--   * settle or release reserved funds
--
-- A trusted server-side/provider adapter must perform the actual
-- external transfer and update the transfer row with provider
-- outcome evidence.
--
-- Later settlement/failure RPCs consume that trusted evidence.
-- ------------------------------------------------------------

create or replace function
  public.marketing_wallet_begin_bank_transfer(
    p_request_id uuid,
    p_idempotency_key text
  )
returns public.marketing_wallet_bank_transfers
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();

  v_request
    public.marketing_wallet_payment_requests%rowtype;

  v_wallet
    public.marketing_wallets%rowtype;

  v_vendor
    public.marketing_wallet_vendors%rowtype;

  v_reservation
    public.marketing_wallet_ledger%rowtype;

  v_transfer_by_key
    public.marketing_wallet_bank_transfers%rowtype;

  v_transfer
    public.marketing_wallet_bank_transfers%rowtype;

  v_idempotency_key text :=
    btrim(coalesce(p_idempotency_key,''));

  v_transfer_count bigint := 0;

  v_financial_history_count bigint := 0;
begin
  if v_actor is null then
    raise exception
      'Authenticated Finance executor is required'
      using errcode='42501';
  end if;

  if p_request_id is null then
    raise exception
      'Payment request identifier is required'
      using errcode='22023';
  end if;

  if v_idempotency_key = '' then
    raise exception
      'Bank transfer idempotency key is required'
      using errcode='22023';
  end if;

  if not public.marketing_wallet_is_finance_executor() then
    raise exception
      'Finance execution authority is required'
      using errcode='42501';
  end if;

  select *
  into v_request
  from public.marketing_wallet_payment_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet payment request not found'
      using errcode='P0002';
  end if;

  select *
  into v_transfer_by_key
  from public.marketing_wallet_bank_transfers
  where idempotency_key=v_idempotency_key;

  select count(*)
  into v_transfer_count
  from public.marketing_wallet_bank_transfers
  where payment_request_id=v_request.id
    and direction='vendor_out';

  -- ----------------------------------------------------------
  -- Exact replay of an already-created transfer intent.
  --
  -- This is permitted only while the payment request remains
  -- transfer_in_progress and the idempotency key resolves to
  -- the one transfer intent belonging to this request.
  --
  -- Provider processing may already have advanced the trusted
  -- transfer row beyond 'created'; replay does not mutate it.
  -- ----------------------------------------------------------

  if v_transfer_by_key.id is not null then
    if
      v_transfer_count <> 1
      or v_request.status <> 'transfer_in_progress'
      or v_transfer_by_key.wallet_id
           is distinct from v_request.wallet_id
      or v_transfer_by_key.payment_request_id
           is distinct from v_request.id
      or v_transfer_by_key.funding_request_id is not null
      or v_transfer_by_key.provider <> 'providus'
      or v_transfer_by_key.direction <> 'vendor_out'
      or v_transfer_by_key.amount <> v_request.amount
    then
      raise exception
        'Existing bank transfer intent does not match this payment request'
        using errcode='55000';
    end if;

    return v_transfer_by_key;
  end if;

  if v_transfer_count <> 0 then
    raise exception
      'Payment request already has a bank transfer intent'
      using errcode='55000';
  end if;

  if v_request.status <> 'approved_for_transfer' then
    raise exception
      'Payment request is not approved for bank transfer'
      using errcode='55000';
  end if;

  if
    v_request.executive_approved_by is null
    or v_request.executive_approved_at is null
  then
    raise exception
      'Payment request has not completed final approval'
      using errcode='55000';
  end if;

  -- ----------------------------------------------------------
  -- Lock active wallet for transfer initiation.
  -- ----------------------------------------------------------

  select *
  into v_wallet
  from public.marketing_wallets
  where id=v_request.wallet_id
  for update;

  if not found then
    raise exception
      'Marketing wallet not found'
      using errcode='P0002';
  end if;

  if v_wallet.status <> 'active' then
    raise exception
      'Marketing wallet is not active'
      using errcode='55000';
  end if;

  -- ----------------------------------------------------------
  -- Revalidate vendor immediately before transfer intent.
  --
  -- The external adapter must use the immutable approved
  -- destination snapshot, not mutable live bank fields.
  -- The live vendor must nevertheless remain verified and
  -- continue to match the approved snapshot.
  -- ----------------------------------------------------------

  select *
  into v_vendor
  from public.marketing_wallet_vendors
  where id=v_request.vendor_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet vendor not found'
      using errcode='P0002';
  end if;

  if v_vendor.wallet_id is distinct from v_request.wallet_id then
    raise exception
      'Marketing Wallet vendor no longer belongs to this wallet'
      using errcode='55000';
  end if;

  if v_vendor.verification_status <> 'verified' then
    raise exception
      'Marketing Wallet vendor is no longer verified'
      using errcode='55000';
  end if;

  if
    v_vendor.verified_by is null
    or v_vendor.verified_at is null
  then
    raise exception
      'Verified vendor is missing verification provenance'
      using errcode='55000';
  end if;

  if
    jsonb_typeof(v_request.vendor_snapshot)
      is distinct from 'object'
    or v_request.vendor_snapshot->>'schema_version'
      is distinct from '1'
    or v_request.vendor_snapshot->'vendor_id'
      is distinct from to_jsonb(v_vendor.id)
    or v_request.vendor_snapshot->'wallet_id'
      is distinct from to_jsonb(v_vendor.wallet_id)
    or v_request.vendor_snapshot->>'legal_name'
      is distinct from btrim(v_vendor.legal_name)
    or v_request.vendor_snapshot->>'bank_name'
      is distinct from btrim(coalesce(v_vendor.bank_name,''))
    or v_request.vendor_snapshot->>'account_name'
      is distinct from btrim(coalesce(v_vendor.account_name,''))
    or v_request.vendor_snapshot->>'account_last4'
      is distinct from v_vendor.account_last4
    or v_request.vendor_snapshot->>'bank_account_reference'
      is distinct from
        btrim(
          coalesce(
            v_vendor.bank_account_reference,
            ''
          )
        )
    or v_request.vendor_snapshot->>'verification_status'
      is distinct from v_vendor.verification_status
    or v_request.vendor_snapshot->'verified_by'
      is distinct from to_jsonb(v_vendor.verified_by)
    or v_request.vendor_snapshot->'verified_at'
      is distinct from to_jsonb(v_vendor.verified_at)
  then
    raise exception
      'Vendor payment destination changed after approval'
      using errcode='55000';
  end if;

  if
    nullif(
      v_request.vendor_snapshot->>'captured_at',
      ''
    ) is null
    or nullif(
      v_request.vendor_snapshot->>'bank_account_reference',
      ''
    ) is null
  then
    raise exception
      'Approved vendor payment snapshot is incomplete'
      using errcode='55000';
  end if;

  -- ----------------------------------------------------------
  -- The approved reservation is the financial authority for
  -- the transfer intent.
  --
  -- Exactly one financial row may exist at this stage and it
  -- must be the immutable reservation created at final approval.
  -- ----------------------------------------------------------

  select count(*)
  into v_financial_history_count
  from public.marketing_wallet_ledger
  where payment_request_id=v_request.id;

  if v_financial_history_count <> 1 then
    raise exception
      'Payment request does not contain exactly one approved reservation'
      using errcode='55000';
  end if;

  select *
  into v_reservation
  from public.marketing_wallet_ledger
  where payment_request_id=v_request.id
  limit 1;

  if
    v_reservation.id is null
    or v_reservation.wallet_id
         is distinct from v_request.wallet_id
    or v_reservation.entry_type <> 'vendor_reservation'
    or v_reservation.available_delta <> -v_request.amount
    or v_reservation.reserved_delta <> v_request.amount
    or v_reservation.funding_request_id is not null
    or v_reservation.payment_request_id
         is distinct from v_request.id
    or v_reservation.bank_transfer_id is not null
    or v_reservation.idempotency_key
         <> ('vendor-reservation:' || v_request.id::text)
  then
    raise exception
      'Payment reservation does not match the approved payment request'
      using errcode='55000';
  end if;

  -- ----------------------------------------------------------
  -- Create an internal intent only.
  --
  -- No provider reference, response digest or provider outcome
  -- is manufactured here.
  -- ----------------------------------------------------------

  insert into public.marketing_wallet_bank_transfers (
    wallet_id,
    funding_request_id,
    payment_request_id,
    provider,
    direction,
    amount,
    idempotency_key,
    provider_reference,
    status,
    provider_response_digest,
    requested_by,
    submitted_at,
    settled_at,
    failed_at,
    failure_code
  )
  values (
    v_request.wallet_id,
    null,
    v_request.id,
    'providus',
    'vendor_out',
    v_request.amount,
    v_idempotency_key,
    null,
    'created',
    null,
    v_actor,
    null,
    null,
    null,
    null
  )
  returning *
  into v_transfer;

  update public.marketing_wallet_payment_requests
  set
    status='transfer_in_progress',
    updated_at=now()
  where id=v_request.id;

  insert into public.marketing_wallet_audit_events (
    wallet_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_request.wallet_id,
    v_actor,
    'payment_transfer_intent_created',
    'payment_request',
    v_request.id,
    jsonb_build_object(
      'from_status',
      'approved_for_transfer',

      'to_status',
      'transfer_in_progress',

      'bank_transfer_id',
      v_transfer.id,

      'provider',
      'providus',

      'provider_status',
      'created',

      'direction',
      'vendor_out',

      'amount',
      v_request.amount,

      'provider_reference_created',
      false,

      'provider_contacted',
      false
    )
  );

  return v_transfer;
end;
$$;

revoke all on function
  public.marketing_wallet_begin_bank_transfer(
    uuid,
    text
  )
from public,anon;

grant execute on function
  public.marketing_wallet_begin_bank_transfer(
    uuid,
    text
  )
to authenticated;

-- ------------------------------------------------------------
-- Settle Marketing Wallet vendor bank transfer
--
-- TRUST BOUNDARY:
--
-- This RPC does not contact Providus and cannot manufacture a
-- successful provider outcome.
--
-- Trusted server-side/provider ingestion must already have moved
-- exactly one Providus vendor_out transfer to status='succeeded'
-- and recorded complete provider evidence.
--
-- Authenticated Finance execution may consume that trusted
-- succeeded evidence and reconcile the internal wallet:
--
--   existing vendor_reservation
--     -> vendor_settlement
--     -> payment request settled
--     -> immutable audit event
--
-- Settlement removes the paid amount from reserved balance.
-- Available balance is not changed at settlement because it was
-- already reduced when the reservation was created.
--
-- IMPORTANT:
-- Live vendor state is deliberately NOT revalidated here.
-- Once trusted provider evidence says money successfully left,
-- the internal ledger must reconcile that real financial event
-- even if the vendor or wallet was subsequently suspended.
--
-- Exact replay of the already-settled transfer is idempotent.
-- Conflicting or partial settlement history fails closed.
-- ------------------------------------------------------------

create or replace function
  public.marketing_wallet_settle_bank_transfer(
    p_transfer_id uuid
  )
returns public.marketing_wallet_payment_requests
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();

  v_transfer
    public.marketing_wallet_bank_transfers%rowtype;

  v_request
    public.marketing_wallet_payment_requests%rowtype;

  v_result
    public.marketing_wallet_payment_requests%rowtype;

  v_wallet
    public.marketing_wallets%rowtype;

  v_reservation
    public.marketing_wallet_ledger%rowtype;

  v_settlement
    public.marketing_wallet_ledger%rowtype;

  v_transfer_count bigint := 0;
  v_financial_history_count bigint := 0;
  v_reservation_count bigint := 0;
  v_settlement_count bigint := 0;
  v_release_count bigint := 0;
  v_settlement_audit_count bigint := 0;

  v_settlement_key text;
begin
  if v_actor is null then
    raise exception
      'Authenticated Finance executor is required'
      using errcode='42501';
  end if;

  if p_transfer_id is null then
    raise exception
      'Bank transfer identifier is required'
      using errcode='22023';
  end if;

  if not public.marketing_wallet_is_finance_executor() then
    raise exception
      'Finance execution authority is required'
      using errcode='42501';
  end if;

  -- ----------------------------------------------------------
  -- Lock the trusted provider evidence first.
  -- ----------------------------------------------------------

  select *
  into v_transfer
  from public.marketing_wallet_bank_transfers
  where id=p_transfer_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet bank transfer not found'
      using errcode='P0002';
  end if;

  if v_transfer.payment_request_id is null then
    raise exception
      'Vendor settlement requires a payment-linked transfer'
      using errcode='55000';
  end if;

  select count(*)
  into v_transfer_count
  from public.marketing_wallet_bank_transfers
  where payment_request_id=v_transfer.payment_request_id
    and direction='vendor_out';

  if v_transfer_count <> 1 then
    raise exception
      'Payment request must have exactly one vendor transfer'
      using errcode='55000';
  end if;

  -- ----------------------------------------------------------
  -- The provider row is the external settlement trust anchor.
  --
  -- No caller-supplied provider reference, status or digest is
  -- accepted by this function.
  -- ----------------------------------------------------------

  if
    v_transfer.funding_request_id is not null
    or v_transfer.provider <> 'providus'
    or v_transfer.direction <> 'vendor_out'
    or v_transfer.status <> 'succeeded'
    or v_transfer.amount <= 0
    or nullif(
         btrim(
           coalesce(
             v_transfer.provider_reference,
             ''
           )
         ),
         ''
       ) is null
    or v_transfer.provider_response_digest is null
    or lower(v_transfer.provider_response_digest)
         !~ '^[0-9a-f]{64}$'
    or v_transfer.requested_by is null
    or v_transfer.submitted_at is null
    or v_transfer.settled_at is null
    or v_transfer.failed_at is not null
    or v_transfer.failure_code is not null
  then
    raise exception
      'Succeeded Providus vendor transfer evidence is incomplete or inconsistent'
      using errcode='55000';
  end if;

  -- ----------------------------------------------------------
  -- Lock the internal payment request.
  -- ----------------------------------------------------------

  select *
  into v_request
  from public.marketing_wallet_payment_requests
  where id=v_transfer.payment_request_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet payment request not found'
      using errcode='P0002';
  end if;

  if
    v_request.wallet_id
      is distinct from v_transfer.wallet_id
    or v_request.amount
      is distinct from v_transfer.amount
  then
    raise exception
      'Succeeded provider transfer does not match the payment request'
      using errcode='55000';
  end if;

  if
    v_request.executive_approved_by is null
    or v_request.executive_approved_at is null
  then
    raise exception
      'Payment request is missing final approval provenance'
      using errcode='55000';
  end if;

  -- Lock the wallet to serialize financial reconciliation.
  --
  -- Deliberately do NOT require status='active'. A provider
  -- success that already occurred must still be reconciled.
  select *
  into v_wallet
  from public.marketing_wallets
  where id=v_request.wallet_id
  for update;

  if not found then
    raise exception
      'Marketing wallet not found'
      using errcode='P0002';
  end if;

  select
    count(*),
    count(*) filter (
      where entry_type='vendor_reservation'
    ),
    count(*) filter (
      where entry_type='vendor_settlement'
    ),
    count(*) filter (
      where entry_type='reservation_release'
    )
  into
    v_financial_history_count,
    v_reservation_count,
    v_settlement_count,
    v_release_count
  from public.marketing_wallet_ledger
  where payment_request_id=v_request.id;

  select count(*)
  into v_settlement_audit_count
  from public.marketing_wallet_audit_events
  where entity_type='payment_request'
    and entity_id=v_request.id
    and action='payment_transfer_settled';

  v_settlement_key :=
    'vendor-settlement:' || v_transfer.id::text;

  -- ----------------------------------------------------------
  -- Exact replay.
  -- ----------------------------------------------------------

  if v_request.status = 'settled' then
    if
      v_financial_history_count <> 2
      or v_reservation_count <> 1
      or v_settlement_count <> 1
      or v_release_count <> 0
      or v_settlement_audit_count <> 1
    then
      raise exception
        'Settled payment contains inconsistent financial history'
        using errcode='55000';
    end if;

    select *
    into v_reservation
    from public.marketing_wallet_ledger
    where payment_request_id=v_request.id
      and entry_type='vendor_reservation'
    limit 1;

    select *
    into v_settlement
    from public.marketing_wallet_ledger
    where payment_request_id=v_request.id
      and entry_type='vendor_settlement'
    limit 1;

    if
      v_reservation.id is null
      or v_reservation.wallet_id
           is distinct from v_request.wallet_id
      or v_reservation.available_delta
           <> -v_request.amount
      or v_reservation.reserved_delta
           <> v_request.amount
      or v_reservation.funding_request_id is not null
      or v_reservation.bank_transfer_id is not null
      or v_reservation.idempotency_key
           <> ('vendor-reservation:' || v_request.id::text)

      or v_settlement.id is null
      or v_settlement.wallet_id
           is distinct from v_request.wallet_id
      or v_settlement.available_delta <> 0
      or v_settlement.reserved_delta
           <> -v_request.amount
      or v_settlement.funding_request_id is not null
      or v_settlement.payment_request_id
           is distinct from v_request.id
      or v_settlement.bank_transfer_id
           is distinct from v_transfer.id
      or v_settlement.idempotency_key
           <> v_settlement_key
    then
      raise exception
        'Existing vendor settlement does not match provider evidence'
        using errcode='55000';
    end if;

    return v_request;
  end if;

  -- ----------------------------------------------------------
  -- Normal settlement path.
  -- ----------------------------------------------------------

  if v_request.status <> 'transfer_in_progress' then
    raise exception
      'Payment request is not awaiting provider settlement'
      using errcode='55000';
  end if;

  if
    v_financial_history_count <> 1
    or v_reservation_count <> 1
    or v_settlement_count <> 0
    or v_release_count <> 0
    or v_settlement_audit_count <> 0
  then
    raise exception
      'Payment request does not contain exactly one unsettled reservation'
      using errcode='55000';
  end if;

  select *
  into v_reservation
  from public.marketing_wallet_ledger
  where payment_request_id=v_request.id
    and entry_type='vendor_reservation'
  limit 1;

  if
    v_reservation.id is null
    or v_reservation.wallet_id
         is distinct from v_request.wallet_id
    or v_reservation.available_delta
         <> -v_request.amount
    or v_reservation.reserved_delta
         <> v_request.amount
    or v_reservation.funding_request_id is not null
    or v_reservation.payment_request_id
         is distinct from v_request.id
    or v_reservation.bank_transfer_id is not null
    or v_reservation.idempotency_key
         <> ('vendor-reservation:' || v_request.id::text)
  then
    raise exception
      'Approved payment reservation does not match the provider transfer'
      using errcode='55000';
  end if;

  -- ----------------------------------------------------------
  -- Consume reserved funds.
  --
  -- available_delta remains zero because approval already
  -- removed this amount from available balance.
  -- ----------------------------------------------------------

  insert into public.marketing_wallet_ledger (
    wallet_id,
    entry_type,
    available_delta,
    reserved_delta,
    funding_request_id,
    payment_request_id,
    bank_transfer_id,
    idempotency_key,
    description,
    created_by
  )
  values (
    v_request.wallet_id,
    'vendor_settlement',
    0,
    -v_request.amount,
    null,
    v_request.id,
    v_transfer.id,
    v_settlement_key,
    'Settled Providus vendor payment',
    v_actor
  )
  returning *
  into v_settlement;

  update public.marketing_wallet_payment_requests
  set
    status='settled',
    updated_at=now()
  where id=v_request.id
  returning *
  into v_result;

  insert into public.marketing_wallet_audit_events (
    wallet_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_result.wallet_id,
    v_actor,
    'payment_transfer_settled',
    'payment_request',
    v_result.id,
    jsonb_build_object(
      'from_status',
      'transfer_in_progress',

      'to_status',
      'settled',

      'bank_transfer_id',
      v_transfer.id,

      'provider',
      'providus',

      'provider_reference',
      v_transfer.provider_reference,

      'provider_status',
      v_transfer.status,

      'amount',
      v_result.amount,

      'available_delta',
      0,

      'reserved_delta',
      -v_result.amount,

      'settlement_idempotency_key',
      v_settlement_key
    )
  );

  return v_result;
end;
$$;

revoke all on function
  public.marketing_wallet_settle_bank_transfer(uuid)
from public,anon;

grant execute on function
  public.marketing_wallet_settle_bank_transfer(uuid)
to authenticated;

-- ------------------------------------------------------------
-- Reconcile failed Marketing Wallet vendor bank transfer
--
-- Trusted provider processing must already have marked the
-- Providus vendor_out transfer as failed with durable evidence.
--
-- This RPC:
--   * cannot contact Providus
--   * cannot manufacture provider failure
--   * releases exactly one approved reservation
--   * restores available balance
--   * removes the same amount from reserved balance
--   * marks the payment request failed
--
-- Unknown provider status is deliberately NOT releasable.
--
-- Live vendor and active-wallet status are deliberately not
-- required after trusted provider failure. This is accounting
-- reconciliation of an external result that has already occurred.
-- ------------------------------------------------------------

create or replace function
  public.marketing_wallet_fail_bank_transfer(
    p_transfer_id uuid
  )
returns public.marketing_wallet_payment_requests
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();

  v_transfer
    public.marketing_wallet_bank_transfers%rowtype;

  v_request
    public.marketing_wallet_payment_requests%rowtype;

  v_result
    public.marketing_wallet_payment_requests%rowtype;

  v_wallet
    public.marketing_wallets%rowtype;

  v_reservation
    public.marketing_wallet_ledger%rowtype;

  v_release
    public.marketing_wallet_ledger%rowtype;

  v_transfer_count bigint := 0;
  v_financial_history_count bigint := 0;
  v_reservation_count bigint := 0;
  v_settlement_count bigint := 0;
  v_release_count bigint := 0;
  v_failure_audit_count bigint := 0;

  v_release_key text;
begin
  if v_actor is null then
    raise exception
      'Authenticated Finance executor is required'
      using errcode='42501';
  end if;

  if p_transfer_id is null then
    raise exception
      'Bank transfer identifier is required'
      using errcode='22023';
  end if;

  if not public.marketing_wallet_is_finance_executor() then
    raise exception
      'Finance execution authority is required'
      using errcode='42501';
  end if;

  select *
  into v_transfer
  from public.marketing_wallet_bank_transfers
  where id=p_transfer_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet bank transfer not found'
      using errcode='P0002';
  end if;

  if v_transfer.payment_request_id is null then
    raise exception
      'Vendor failure reconciliation requires a payment-linked transfer'
      using errcode='55000';
  end if;

  select count(*)
  into v_transfer_count
  from public.marketing_wallet_bank_transfers
  where payment_request_id=v_transfer.payment_request_id
    and direction='vendor_out';

  if v_transfer_count <> 1 then
    raise exception
      'Payment request must have exactly one vendor transfer'
      using errcode='55000';
  end if;

  if
    v_transfer.funding_request_id is not null
    or v_transfer.provider <> 'providus'
    or v_transfer.direction <> 'vendor_out'
    or v_transfer.status <> 'failed'
    or v_transfer.amount <= 0
    or v_transfer.provider_response_digest is null
    or lower(v_transfer.provider_response_digest)
         !~ '^[0-9a-f]{64}$'
    or v_transfer.requested_by is null
    or v_transfer.submitted_at is null
    or v_transfer.failed_at is null
    or v_transfer.failed_at < v_transfer.submitted_at
    or v_transfer.settled_at is not null
    or nullif(
         btrim(
           coalesce(
             v_transfer.failure_code,
             ''
           )
         ),
         ''
       ) is null
  then
    raise exception
      'Failed Providus vendor transfer evidence is incomplete or inconsistent'
      using errcode='55000';
  end if;

  select *
  into v_request
  from public.marketing_wallet_payment_requests
  where id=v_transfer.payment_request_id
  for update;

  if not found then
    raise exception
      'Marketing Wallet payment request not found'
      using errcode='P0002';
  end if;

  if
    v_request.wallet_id
      is distinct from v_transfer.wallet_id
    or v_request.amount
      is distinct from v_transfer.amount
  then
    raise exception
      'Failed provider transfer does not match the payment request'
      using errcode='55000';
  end if;

  if
    v_request.executive_approved_by is null
    or v_request.executive_approved_at is null
  then
    raise exception
      'Payment request is missing final approval provenance'
      using errcode='55000';
  end if;

  select *
  into v_wallet
  from public.marketing_wallets
  where id=v_request.wallet_id
  for update;

  if not found then
    raise exception
      'Marketing wallet not found'
      using errcode='P0002';
  end if;

  select
    count(*),
    count(*) filter (
      where entry_type='vendor_reservation'
    ),
    count(*) filter (
      where entry_type='vendor_settlement'
    ),
    count(*) filter (
      where entry_type='reservation_release'
    )
  into
    v_financial_history_count,
    v_reservation_count,
    v_settlement_count,
    v_release_count
  from public.marketing_wallet_ledger
  where payment_request_id=v_request.id;

  select count(*)
  into v_failure_audit_count
  from public.marketing_wallet_audit_events
  where entity_type='payment_request'
    and entity_id=v_request.id
    and action='payment_transfer_failed';

  v_release_key :=
    'reservation-release:' || v_transfer.id::text;

  if v_request.status = 'failed' then
    if
      v_financial_history_count <> 2
      or v_reservation_count <> 1
      or v_settlement_count <> 0
      or v_release_count <> 1
      or v_failure_audit_count <> 1
    then
      raise exception
        'Failed payment contains inconsistent financial history'
        using errcode='55000';
    end if;

    select *
    into v_reservation
    from public.marketing_wallet_ledger
    where payment_request_id=v_request.id
      and entry_type='vendor_reservation'
    limit 1;

    select *
    into v_release
    from public.marketing_wallet_ledger
    where payment_request_id=v_request.id
      and entry_type='reservation_release'
    limit 1;

    if
      v_reservation.id is null
      or v_reservation.wallet_id
           is distinct from v_request.wallet_id
      or v_reservation.available_delta
           <> -v_request.amount
      or v_reservation.reserved_delta
           <> v_request.amount
      or v_reservation.funding_request_id is not null
      or v_reservation.bank_transfer_id is not null
      or v_reservation.idempotency_key
           <> ('vendor-reservation:' || v_request.id::text)

      or v_release.id is null
      or v_release.wallet_id
           is distinct from v_request.wallet_id
      or v_release.available_delta
           <> v_request.amount
      or v_release.reserved_delta
           <> -v_request.amount
      or v_release.funding_request_id is not null
      or v_release.payment_request_id
           is distinct from v_request.id
      or v_release.bank_transfer_id
           is distinct from v_transfer.id
      or v_release.idempotency_key
           <> v_release_key
    then
      raise exception
        'Existing reservation release does not match provider failure evidence'
        using errcode='55000';
    end if;

    return v_request;
  end if;

  if v_request.status <> 'transfer_in_progress' then
    raise exception
      'Payment request is not awaiting provider outcome'
      using errcode='55000';
  end if;

  if
    v_financial_history_count <> 1
    or v_reservation_count <> 1
    or v_settlement_count <> 0
    or v_release_count <> 0
    or v_failure_audit_count <> 0
  then
    raise exception
      'Payment request does not contain exactly one releasable reservation'
      using errcode='55000';
  end if;

  select *
  into v_reservation
  from public.marketing_wallet_ledger
  where payment_request_id=v_request.id
    and entry_type='vendor_reservation'
  limit 1;

  if
    v_reservation.id is null
    or v_reservation.wallet_id
         is distinct from v_request.wallet_id
    or v_reservation.available_delta
         <> -v_request.amount
    or v_reservation.reserved_delta
         <> v_request.amount
    or v_reservation.funding_request_id is not null
    or v_reservation.payment_request_id
         is distinct from v_request.id
    or v_reservation.bank_transfer_id is not null
    or v_reservation.idempotency_key
         <> ('vendor-reservation:' || v_request.id::text)
  then
    raise exception
      'Approved payment reservation does not match the failed provider transfer'
      using errcode='55000';
  end if;

  insert into public.marketing_wallet_ledger (
    wallet_id,
    entry_type,
    available_delta,
    reserved_delta,
    funding_request_id,
    payment_request_id,
    bank_transfer_id,
    idempotency_key,
    description,
    created_by
  )
  values (
    v_request.wallet_id,
    'reservation_release',
    v_request.amount,
    -v_request.amount,
    null,
    v_request.id,
    v_transfer.id,
    v_release_key,
    'Released reservation after failed Providus vendor payment',
    v_actor
  )
  returning *
  into v_release;

  update public.marketing_wallet_payment_requests
  set
    status='failed',
    updated_at=now()
  where id=v_request.id
  returning *
  into v_result;

  insert into public.marketing_wallet_audit_events (
    wallet_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_result.wallet_id,
    v_actor,
    'payment_transfer_failed',
    'payment_request',
    v_result.id,
    jsonb_build_object(
      'from_status',
      'transfer_in_progress',

      'to_status',
      'failed',

      'bank_transfer_id',
      v_transfer.id,

      'provider',
      'providus',

      'provider_reference',
      v_transfer.provider_reference,

      'provider_status',
      v_transfer.status,

      'failure_code',
      v_transfer.failure_code,

      'amount',
      v_result.amount,

      'available_delta',
      v_result.amount,

      'reserved_delta',
      -v_result.amount,

      'release_idempotency_key',
      v_release_key
    )
  );

  return v_result;
end;
$$;

revoke all on function
  public.marketing_wallet_fail_bank_transfer(uuid)
from public,anon;

grant execute on function
  public.marketing_wallet_fail_bank_transfer(uuid)
to authenticated;
