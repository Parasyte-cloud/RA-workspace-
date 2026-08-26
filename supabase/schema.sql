-- RideArrivo Workspace production schema
-- Run in a dedicated Supabase project after reviewing organization-specific retention and role assignments.

create extension if not exists pgcrypto;

create table if not exists public.employee_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null unique,
  department text not null default 'Unassigned',
  job_title text not null default '',
  role text not null default 'employee' check (role in ('employee','support','engineer','manager','hr','legal','operations','finance','marketing','partnerships','admin')),
  manager_id uuid references public.employee_profiles(id),
  location text not null default 'Lagos',
  active boolean not null default true,
  start_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_profiles drop constraint if exists employee_profiles_role_check;
alter table public.employee_profiles add constraint employee_profiles_role_check check (role in ('employee','support','engineer','manager','hr','legal','operations','finance','marketing','partnerships','admin'));

create or replace function public.current_workspace_role()
returns text language sql stable security definer set search_path=public as $$
  select coalesce((select role from public.employee_profiles where id = auth.uid() and active = true),'employee');
$$;

create or replace function public.has_workspace_role(roles text[])
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_workspace_role() = any(roles);
$$;

create or replace function public.handle_new_workspace_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  domain text;
begin
  domain := lower(split_part(new.email,'@',2));
  if domain <> 'ridearrivo.com' then
    raise exception 'Only RideArrivo company email accounts are allowed';
  end if;
  insert into public.employee_profiles(id,full_name,email)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),lower(new.email))
  on conflict(id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_workspace on auth.users;
create trigger on_auth_user_created_workspace after insert on auth.users for each row execute function public.handle_new_workspace_user();

create table if not exists public.workspace_apps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  url text,
  mode text not null default 'native' check (mode in ('native','embed','api','download')),
  allowed_roles text[] not null default array['employee']::text[],
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- CRM
create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_type text not null default 'individual' check(account_type in ('individual','corporate','hotel','travel_partner','other')),
  status text not null default 'active',
  owner_id uuid references public.employee_profiles(id),
  lifecycle_stage text not null default 'customer',
  estimated_value numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.crm_accounts(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  contact_type text not null default 'rider',
  preferred_channel text,
  owner_id uuid references public.employee_profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  source text,
  stage text not null default 'new' check(stage in ('new','qualified','proposal','negotiation','won','lost')),
  owner_id uuid references public.employee_profiles(id),
  estimated_value numeric(14,2) not null default 0,
  next_action_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.crm_accounts(id) on delete cascade,
  name text not null,
  stage text not null default 'discovery',
  amount numeric(14,2) not null default 0,
  probability smallint not null default 10 check(probability between 0 and 100),
  owner_id uuid references public.employee_profiles(id),
  expected_close_date date,
  created_at timestamptz not null default now()
);
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.crm_accounts(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  activity_type text not null check(activity_type in ('call','email','meeting','note','task','support')),
  subject text not null,
  body text,
  owner_id uuid references public.employee_profiles(id),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Support / operations
create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  subject text not null,
  category text not null default 'general',
  priority text not null default 'normal' check(priority in ('low','normal','high','critical')),
  status text not null default 'open' check(status in ('open','in_progress','waiting','resolved','closed')),
  rider_contact_id uuid references public.crm_contacts(id),
  booking_reference text,
  owner_id uuid references public.employee_profiles(id),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  severity text not null default 'low' check(severity in ('low','medium','high','critical')),
  category text not null,
  summary text not null,
  owner_id uuid references public.employee_profiles(id),
  status text not null default 'open',
  occurred_at timestamptz not null default now(),
  closed_at timestamptz
);

-- People & HR
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check(status in ('pending','approved','declined','cancelled')),
  approver_id uuid references public.employee_profiles(id),
  created_at timestamptz not null default now(),
  check(end_date >= start_date)
);
create table if not exists public.hr_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  category text not null,
  subject text not null,
  details text,
  status text not null default 'open',
  owner_id uuid references public.employee_profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  title text not null,
  category text not null default 'general',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Legal/compliance
create table if not exists public.legal_contracts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  counterparty text not null,
  owner_id uuid references public.employee_profiles(id),
  status text not null default 'draft',
  effective_date date,
  renewal_date date,
  document_path text,
  created_at timestamptz not null default now()
);
create table if not exists public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner_id uuid references public.employee_profiles(id),
  due_date date,
  status text not null default 'open',
  evidence_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.employee_profiles(id),
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.employee_profiles enable row level security;
alter table public.workspace_apps enable row level security;
alter table public.crm_accounts enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_opportunities enable row level security;
alter table public.crm_activities enable row level security;
alter table public.support_cases enable row level security;
alter table public.incidents enable row level security;
alter table public.leave_requests enable row level security;
alter table public.hr_requests enable row level security;
alter table public.onboarding_tasks enable row level security;
alter table public.legal_contracts enable row level security;
alter table public.compliance_items enable row level security;
alter table public.workspace_audit_log enable row level security;

-- Directory: active employees visible internally. Role changes are admin/HR only.
drop policy if exists "employees read directory" on public.employee_profiles;
create policy "employees read directory" on public.employee_profiles for select to authenticated using(active=true);
drop policy if exists "admins manage employee profiles" on public.employee_profiles;
create policy "admins manage employee profiles" on public.employee_profiles for all to authenticated using(public.has_workspace_role(array['hr','admin'])) with check(public.has_workspace_role(array['hr','admin']));

drop policy if exists "employees read apps" on public.workspace_apps;
create policy "employees read apps" on public.workspace_apps for select to authenticated using(active=true and (public.current_workspace_role() = any(allowed_roles) or 'employee'=any(allowed_roles)));
drop policy if exists "admins manage apps" on public.workspace_apps;
create policy "admins manage apps" on public.workspace_apps for all to authenticated using(public.has_workspace_role(array['admin'])) with check(public.has_workspace_role(array['admin']));

-- CRM visible to customer-facing and management roles.
drop policy if exists "crm read" on public.crm_accounts;
create policy "crm read" on public.crm_accounts for select to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));
drop policy if exists "crm write" on public.crm_accounts;
create policy "crm write" on public.crm_accounts for all to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin'])) with check(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));
drop policy if exists "crm contacts read" on public.crm_contacts;
create policy "crm contacts read" on public.crm_contacts for select to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));
drop policy if exists "crm contacts write" on public.crm_contacts;
create policy "crm contacts write" on public.crm_contacts for all to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin'])) with check(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));
drop policy if exists "crm leads read" on public.crm_leads;
create policy "crm leads read" on public.crm_leads for select to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));
drop policy if exists "crm leads write" on public.crm_leads;
create policy "crm leads write" on public.crm_leads for all to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin'])) with check(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));
drop policy if exists "crm opp read" on public.crm_opportunities;
create policy "crm opp read" on public.crm_opportunities for select to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));
drop policy if exists "crm opp write" on public.crm_opportunities;
create policy "crm opp write" on public.crm_opportunities for all to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin'])) with check(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));
drop policy if exists "crm activity read" on public.crm_activities;
create policy "crm activity read" on public.crm_activities for select to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));
drop policy if exists "crm activity write" on public.crm_activities;
create policy "crm activity write" on public.crm_activities for all to authenticated using(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin'])) with check(public.has_workspace_role(array['support','operations','marketing','partnerships','manager','admin']));

drop policy if exists "support read" on public.support_cases;
create policy "support read" on public.support_cases for select to authenticated using(public.has_workspace_role(array['support','operations','manager','admin']));
drop policy if exists "support write" on public.support_cases;
create policy "support write" on public.support_cases for all to authenticated using(public.has_workspace_role(array['support','operations','manager','admin'])) with check(public.has_workspace_role(array['support','operations','manager','admin']));
drop policy if exists "incident read" on public.incidents;
create policy "incident read" on public.incidents for select to authenticated using(public.has_workspace_role(array['support','operations','legal','manager','admin']));
drop policy if exists "incident write" on public.incidents;
create policy "incident write" on public.incidents for all to authenticated using(public.has_workspace_role(array['support','operations','manager','admin'])) with check(public.has_workspace_role(array['support','operations','manager','admin']));

drop policy if exists "own leave read" on public.leave_requests;
create policy "own leave read" on public.leave_requests for select to authenticated using(employee_id=auth.uid() or public.has_workspace_role(array['manager','hr','admin']));
drop policy if exists "own leave create" on public.leave_requests;
create policy "own leave create" on public.leave_requests for insert to authenticated with check(employee_id=auth.uid());
drop policy if exists "hr leave manage" on public.leave_requests;
create policy "hr leave manage" on public.leave_requests for update to authenticated using(public.has_workspace_role(array['manager','hr','admin'])) with check(public.has_workspace_role(array['manager','hr','admin']));
drop policy if exists "own hr requests" on public.hr_requests;
create policy "own hr requests" on public.hr_requests for select to authenticated using(employee_id=auth.uid() or public.has_workspace_role(array['hr','admin']));
drop policy if exists "own hr request create" on public.hr_requests;
create policy "own hr request create" on public.hr_requests for insert to authenticated with check(employee_id=auth.uid());
drop policy if exists "hr request manage" on public.hr_requests;
create policy "hr request manage" on public.hr_requests for update to authenticated using(public.has_workspace_role(array['hr','admin'])) with check(public.has_workspace_role(array['hr','admin']));
drop policy if exists "onboarding read" on public.onboarding_tasks;
create policy "onboarding read" on public.onboarding_tasks for select to authenticated using(employee_id=auth.uid() or public.has_workspace_role(array['hr','admin']));
drop policy if exists "onboarding manage" on public.onboarding_tasks;
create policy "onboarding manage" on public.onboarding_tasks for all to authenticated using(public.has_workspace_role(array['hr','admin'])) with check(public.has_workspace_role(array['hr','admin']));

drop policy if exists "legal read" on public.legal_contracts;
create policy "legal read" on public.legal_contracts for select to authenticated using(public.has_workspace_role(array['legal','manager','admin']));
drop policy if exists "legal manage" on public.legal_contracts;
create policy "legal manage" on public.legal_contracts for all to authenticated using(public.has_workspace_role(array['legal','admin'])) with check(public.has_workspace_role(array['legal','admin']));
drop policy if exists "compliance read" on public.compliance_items;
create policy "compliance read" on public.compliance_items for select to authenticated using(public.has_workspace_role(array['legal','operations','manager','admin']));
drop policy if exists "compliance manage" on public.compliance_items;
create policy "compliance manage" on public.compliance_items for all to authenticated using(public.has_workspace_role(array['legal','admin'])) with check(public.has_workspace_role(array['legal','admin']));
drop policy if exists "audit admin read" on public.workspace_audit_log;
create policy "audit admin read" on public.workspace_audit_log for select to authenticated using(public.has_workspace_role(array['admin']));

create index if not exists idx_crm_contacts_account on public.crm_contacts(account_id);
create index if not exists idx_crm_activities_account on public.crm_activities(account_id,created_at desc);
create index if not exists idx_support_cases_status on public.support_cases(status,priority);
create index if not exists idx_leave_employee on public.leave_requests(employee_id,start_date desc);
create index if not exists idx_contract_renewal on public.legal_contracts(renewal_date);


-- Explicit grants for baseline tables because automatic Data API exposure is disabled.
grant usage on schema public to authenticated;
grant execute on function public.current_workspace_role() to authenticated;
grant execute on function public.has_workspace_role(text[]) to authenticated;
grant select,insert,update,delete on public.employee_profiles, public.workspace_apps, public.crm_accounts, public.crm_contacts, public.crm_leads, public.crm_opportunities, public.crm_activities, public.support_cases, public.incidents, public.leave_requests, public.hr_requests, public.onboarding_tasks, public.legal_contracts, public.compliance_items, public.workspace_audit_log to authenticated;
grant usage,select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- ============================================================
-- Finance, Marketing and Partnerships applications
-- Additive, RLS-protected, safe to re-run.
-- ============================================================

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  account_type text not null check(account_type in ('asset','liability','equity','revenue','expense')),
  active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.finance_journals (
  id uuid primary key default gen_random_uuid(), journal_number text not null unique, journal_date date not null,
  description text not null, status text not null default 'draft' check(status in ('draft','posted','reversed')),
  created_by uuid references public.employee_profiles(id) on delete set null, approved_by uuid references public.employee_profiles(id) on delete set null,
  posted_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.finance_journal_lines (
  id uuid primary key default gen_random_uuid(), journal_id uuid not null references public.finance_journals(id) on delete cascade,
  account_id uuid not null references public.finance_accounts(id), description text,
  debit numeric(14,2) not null default 0 check(debit>=0), credit numeric(14,2) not null default 0 check(credit>=0),
  created_at timestamptz not null default now(), check(not(debit>0 and credit>0)), check(debit>0 or credit>0)
);
create table if not exists public.finance_invoices (
  id uuid primary key default gen_random_uuid(), invoice_number text not null unique, customer_name text not null,
  issue_date date not null, due_date date not null, total_amount numeric(14,2) not null check(total_amount>=0),
  amount_paid numeric(14,2) not null default 0 check(amount_paid>=0),
  balance_due numeric(14,2) generated always as (greatest(total_amount-amount_paid,0)) stored,
  status text not null default 'draft' check(status in ('draft','sent','part_paid','paid','overdue','void')),
  booking_reference text, notes text, created_at timestamptz not null default now()
);
create table if not exists public.finance_bills (
  id uuid primary key default gen_random_uuid(), bill_number text not null unique, vendor_name text not null,
  bill_date date not null, due_date date, total_amount numeric(14,2) not null check(total_amount>=0),
  amount_paid numeric(14,2) not null default 0 check(amount_paid>=0),
  balance_due numeric(14,2) generated always as (greatest(total_amount-amount_paid,0)) stored,
  status text not null default 'draft' check(status in ('draft','pending_approval','approved','part_paid','paid','overdue','void')),
  notes text, created_at timestamptz not null default now()
);
create table if not exists public.finance_expenses (
  id uuid primary key default gen_random_uuid(), description text not null, category text not null, expense_date date not null,
  amount numeric(14,2) not null check(amount>=0), payment_method text,
  status text not null default 'draft' check(status in ('draft','submitted','approved','rejected','paid')),
  claimant_id uuid references public.employee_profiles(id) on delete set null, approver_id uuid references public.employee_profiles(id) on delete set null,
  receipt_path text, created_at timestamptz not null default now()
);
create table if not exists public.finance_budgets (
  id uuid primary key default gen_random_uuid(), name text not null, fiscal_year int not null,
  department text not null, category text not null, amount numeric(14,2) not null check(amount>=0),
  status text not null default 'draft' check(status in ('draft','approved','closed')), created_at timestamptz not null default now()
);
create table if not exists public.finance_assets (
  id uuid primary key default gen_random_uuid(), asset_code text not null unique, name text not null, category text not null,
  purchase_date date, cost numeric(14,2) not null check(cost>=0), useful_life_months int,
  status text not null default 'active' check(status in ('active','disposed','written_off')), created_at timestamptz not null default now()
);
create table if not exists public.finance_tax_obligations (
  id uuid primary key default gen_random_uuid(), tax_type text not null, period_label text not null, due_date date not null,
  amount numeric(14,2) not null default 0, status text not null default 'open' check(status in ('open','prepared','filed','paid','overdue')),
  evidence_path text, created_at timestamptz not null default now()
);
create table if not exists public.finance_close_tasks (
  id uuid primary key default gen_random_uuid(), period_label text not null, task_name text not null,
  owner_id uuid references public.employee_profiles(id) on delete set null, due_date date,
  status text not null default 'open' check(status in ('open','in_progress','review','complete')),
  completed_at timestamptz, created_at timestamptz not null default now()
);

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(), name text not null, objective text not null, channel text not null,
  start_date date, end_date date, budget numeric(14,2) not null default 0, actual_spend numeric(14,2) not null default 0,
  status text not null default 'draft' check(status in ('draft','planned','live','paused','completed','cancelled')),
  owner_id uuid references public.employee_profiles(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.marketing_content (
  id uuid primary key default gen_random_uuid(), campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  title text not null, content_type text not null, channel text not null, copy_text text, asset_path text, publish_at timestamptz,
  status text not null default 'idea' check(status in ('idea','draft','review','approved','scheduled','published','archived')),
  owner_id uuid references public.employee_profiles(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.marketing_attribution (
  id uuid primary key default gen_random_uuid(), campaign_name text not null, source text not null, medium text not null,
  spend numeric(14,2) not null default 0, leads int not null default 0, bookings int not null default 0,
  revenue numeric(14,2) not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.marketing_experiments (
  id uuid primary key default gen_random_uuid(), name text not null, hypothesis text not null, primary_metric text not null,
  start_date date, end_date date, result_summary text,
  status text not null default 'planned' check(status in ('planned','running','won','lost','inconclusive')),
  owner_id uuid references public.employee_profiles(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.marketing_assets (
  id uuid primary key default gen_random_uuid(), name text not null, asset_type text not null, channel text, storage_path text,
  status text not null default 'draft' check(status in ('draft','review','approved','retired')),
  owner_id uuid references public.employee_profiles(id) on delete set null, created_at timestamptz not null default now()
);

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(), name text not null,
  partner_type text not null check(partner_type in ('hotel','corporate','travel_agency','airline','tourism','embassy','institution','technology','other')),
  status text not null default 'prospect' check(status in ('prospect','engaged','active','paused','inactive')),
  website text, city text, notes text, owner_id uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.partner_opportunities (
  id uuid primary key default gen_random_uuid(), partner_name text not null, opportunity_name text not null,
  stage text not null default 'identified' check(stage in ('identified','qualified','proposal','negotiation','due_diligence','contracting','won','lost')),
  estimated_value numeric(14,2) not null default 0, expected_close_date date, next_action text,
  owner_id uuid references public.employee_profiles(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.partner_agreements (
  id uuid primary key default gen_random_uuid(), partner_name text not null, agreement_type text not null,
  effective_date date, expiry_date date, commission_rate numeric(7,4) not null default 0,
  status text not null default 'draft' check(status in ('draft','review','signed','active','expired','terminated')),
  document_path text, created_at timestamptz not null default now()
);
create table if not exists public.partner_activities (
  id uuid primary key default gen_random_uuid(), partner_name text not null,
  activity_type text not null check(activity_type in ('meeting','call','email','proposal','review','task')),
  subject text not null, activity_date date not null, next_action text, notes text,
  owner_id uuid references public.employee_profiles(id) on delete set null, created_at timestamptz not null default now()
);
create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(), partner_name text not null, booking_reference text not null,
  customer_name text, booking_value numeric(14,2) not null default 0, commission_amount numeric(14,2) not null default 0,
  status text not null default 'pending' check(status in ('pending','confirmed','payable','paid','cancelled')),
  created_at timestamptz not null default now()
);
create table if not exists public.partner_onboarding_tasks (
  id uuid primary key default gen_random_uuid(), partner_name text not null, task_name text not null,
  workstream text not null check(workstream in ('commercial','legal','finance','operations','technology','marketing')),
  due_date date, status text not null default 'not_started' check(status in ('not_started','in_progress','blocked','complete')),
  owner_id uuid references public.employee_profiles(id) on delete set null, created_at timestamptz not null default now()
);

-- RLS and explicit API grants
DO $$ declare t text; begin
  foreach t in array array['finance_accounts','finance_journals','finance_journal_lines','finance_invoices','finance_bills','finance_expenses','finance_budgets','finance_assets','finance_tax_obligations','finance_close_tasks','marketing_campaigns','marketing_content','marketing_attribution','marketing_experiments','marketing_assets','partners','partner_opportunities','partner_agreements','partner_activities','partner_referrals','partner_onboarding_tasks']
  loop execute format('alter table public.%I enable row level security',t); end loop;
end $$;
DO $$ declare t text; begin
  foreach t in array array['finance_accounts','finance_journals','finance_journal_lines','finance_invoices','finance_bills','finance_expenses','finance_budgets','finance_assets','finance_tax_obligations','finance_close_tasks'] loop
    execute format('drop policy if exists "finance read" on public.%I',t); execute format('drop policy if exists "finance write" on public.%I',t);
    execute format('create policy "finance read" on public.%I for select to authenticated using(public.has_workspace_role(array[''finance'',''manager'',''admin'']))',t);
    execute format('create policy "finance write" on public.%I for all to authenticated using(public.has_workspace_role(array[''finance'',''admin''])) with check(public.has_workspace_role(array[''finance'',''admin'']))',t);
  end loop;
end $$;
DO $$ declare t text; begin
  foreach t in array array['marketing_campaigns','marketing_content','marketing_attribution','marketing_experiments','marketing_assets'] loop
    execute format('drop policy if exists "marketing read" on public.%I',t); execute format('drop policy if exists "marketing write" on public.%I',t);
    execute format('create policy "marketing read" on public.%I for select to authenticated using(public.has_workspace_role(array[''marketing'',''partnerships'',''manager'',''admin'']))',t);
    execute format('create policy "marketing write" on public.%I for all to authenticated using(public.has_workspace_role(array[''marketing'',''admin''])) with check(public.has_workspace_role(array[''marketing'',''admin'']))',t);
  end loop;
end $$;
DO $$ declare t text; begin
  foreach t in array array['partners','partner_opportunities','partner_agreements','partner_activities','partner_referrals','partner_onboarding_tasks'] loop
    execute format('drop policy if exists "partnership read" on public.%I',t); execute format('drop policy if exists "partnership write" on public.%I',t);
    execute format('create policy "partnership read" on public.%I for select to authenticated using(public.has_workspace_role(array[''partnerships'',''marketing'',''operations'',''finance'',''legal'',''manager'',''admin'']))',t);
    execute format('create policy "partnership write" on public.%I for all to authenticated using(public.has_workspace_role(array[''partnerships'',''admin''])) with check(public.has_workspace_role(array[''partnerships'',''admin'']))',t);
  end loop;
end $$;
DO $$ declare t text; begin
  foreach t in array array['finance_accounts','finance_journals','finance_journal_lines','finance_invoices','finance_bills','finance_expenses','finance_budgets','finance_assets','finance_tax_obligations','finance_close_tasks','marketing_campaigns','marketing_content','marketing_attribution','marketing_experiments','marketing_assets','partners','partner_opportunities','partner_agreements','partner_activities','partner_referrals','partner_onboarding_tasks']
  loop execute format('grant select,insert,update,delete on public.%I to authenticated',t); end loop;
end $$;
grant usage on schema public to authenticated;
grant execute on function public.current_workspace_role() to authenticated;
grant execute on function public.has_workspace_role(text[]) to authenticated;
grant usage,select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

create index if not exists idx_finance_invoice_due on public.finance_invoices(status,due_date);
create index if not exists idx_finance_bill_due on public.finance_bills(status,due_date);
create index if not exists idx_marketing_campaign_status on public.marketing_campaigns(status,start_date);
create index if not exists idx_partner_opportunity_stage on public.partner_opportunities(stage,expected_close_date);
create index if not exists idx_partner_agreement_expiry on public.partner_agreements(status,expiry_date);

-- -----------------------------------------------------------------------------
-- RideArrivo Pulse: internal social/news platform
-- -----------------------------------------------------------------------------
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.employee_profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 10000),
  post_type text not null default 'post' check(post_type in ('post','news','announcement','reply','quote','poll')),
  visibility text not null default 'employees' check(visibility in ('employees','department','leadership')),
  reply_to_id uuid references public.social_posts(id) on delete cascade,
  quote_post_id uuid references public.social_posts(id) on delete set null,
  scheduled_for timestamptz,
  published_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.social_post_media (
  id uuid primary key default gen_random_uuid(), post_id uuid not null references public.social_posts(id) on delete cascade,
  storage_path text not null, media_type text not null check(media_type in ('image','video','gif','file')),
  alt_text text, sort_order int not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.social_post_reactions (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  reaction text not null default 'like' check(reaction in ('like')),
  created_at timestamptz not null default now(), primary key(post_id,user_id,reaction)
);
create table if not exists public.social_reposts (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(post_id,user_id)
);
create table if not exists public.social_bookmarks (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(post_id,user_id)
);
create table if not exists public.social_follows (
  follower_id uuid not null references public.employee_profiles(id) on delete cascade,
  following_id uuid not null references public.employee_profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(follower_id,following_id),
  check(follower_id<>following_id)
);
create table if not exists public.social_hashtags (
  id uuid primary key default gen_random_uuid(), tag text not null unique check(tag=lower(tag)), created_at timestamptz not null default now()
);
create table if not exists public.social_post_hashtags (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  hashtag_id uuid not null references public.social_hashtags(id) on delete cascade,
  primary key(post_id,hashtag_id)
);
create table if not exists public.social_mentions (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  mentioned_user_id uuid not null references public.employee_profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(post_id,mentioned_user_id)
);
create table if not exists public.social_polls (
  id uuid primary key default gen_random_uuid(), post_id uuid not null unique references public.social_posts(id) on delete cascade,
  question text not null, closes_at timestamptz, allow_multiple boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.social_poll_options (
  id uuid primary key default gen_random_uuid(), poll_id uuid not null references public.social_polls(id) on delete cascade,
  label text not null, sort_order int not null default 0
);
create table if not exists public.social_poll_votes (
  poll_id uuid not null references public.social_polls(id) on delete cascade,
  option_id uuid not null references public.social_poll_options(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(poll_id,option_id,user_id)
);
create table if not exists public.social_notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.employee_profiles(id) on delete cascade,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  post_id uuid references public.social_posts(id) on delete cascade,
  notification_type text not null check(notification_type in ('like','reply','repost','follow','mention','announcement','system')),
  read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.social_reports (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references public.employee_profiles(id) on delete cascade,
  post_id uuid references public.social_posts(id) on delete cascade,
  reported_user_id uuid references public.employee_profiles(id) on delete cascade,
  reason text not null, details text,
  status text not null default 'open' check(status in ('open','reviewing','actioned','dismissed')),
  reviewed_by uuid references public.employee_profiles(id) on delete set null,
  reviewed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.social_lists (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.employee_profiles(id) on delete cascade,
  name text not null, description text, is_private boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.social_list_members (
  list_id uuid not null references public.social_lists(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  primary key(list_id,user_id)
);
create table if not exists public.social_communities (
  id uuid primary key default gen_random_uuid(), name text not null unique, description text,
  visibility text not null default 'employees' check(visibility in ('employees','invite_only')),
  owner_id uuid not null references public.employee_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.social_community_members (
  community_id uuid not null references public.social_communities(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  member_role text not null default 'member' check(member_role in ('member','moderator','owner')),
  created_at timestamptz not null default now(), primary key(community_id,user_id)
);
create table if not exists public.social_conversations (
  id uuid primary key default gen_random_uuid(), is_group boolean not null default false, title text,
  created_by uuid not null references public.employee_profiles(id) on delete cascade, created_at timestamptz not null default now()
);
create table if not exists public.social_conversation_members (
  conversation_id uuid not null references public.social_conversations(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  joined_at timestamptz not null default now(), primary key(conversation_id,user_id)
);
create table if not exists public.social_messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.social_conversations(id) on delete cascade,
  sender_id uuid not null references public.employee_profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 10000), attachment_path text,
  edited_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.social_spaces (
  id uuid primary key default gen_random_uuid(), host_id uuid not null references public.employee_profiles(id) on delete cascade,
  title text not null, description text, scheduled_for timestamptz,
  status text not null default 'scheduled' check(status in ('scheduled','live','ended','cancelled')),
  provider_room_id text, created_at timestamptz not null default now()
);

DO $$ declare t text; begin
  foreach t in array array['social_posts','social_post_media','social_post_reactions','social_reposts','social_bookmarks','social_follows','social_hashtags','social_post_hashtags','social_mentions','social_polls','social_poll_options','social_poll_votes','social_notifications','social_reports','social_lists','social_list_members','social_communities','social_community_members','social_conversations','social_conversation_members','social_messages','social_spaces']
  loop execute format('alter table public.%I enable row level security',t); end loop;
end $$;

-- Public-to-employees feed objects
DO $$ declare t text; begin
  foreach t in array array['social_posts','social_post_media','social_post_reactions','social_reposts','social_hashtags','social_post_hashtags','social_mentions','social_polls','social_poll_options','social_poll_votes','social_communities','social_community_members','social_spaces'] loop
    execute format('drop policy if exists "social employee read" on public.%I',t);
    execute format('create policy "social employee read" on public.%I for select to authenticated using(true)',t);
  end loop;
end $$;

drop policy if exists "social create own posts" on public.social_posts;
create policy "social create own posts" on public.social_posts for insert to authenticated with check(author_id=auth.uid());
drop policy if exists "social update own posts" on public.social_posts;
create policy "social update own posts" on public.social_posts for update to authenticated using(author_id=auth.uid() or public.has_workspace_role(array['admin','marketing'])) with check(author_id=auth.uid() or public.has_workspace_role(array['admin','marketing']));
drop policy if exists "social delete own posts" on public.social_posts;
create policy "social delete own posts" on public.social_posts for delete to authenticated using(author_id=auth.uid() or public.has_workspace_role(array['admin','marketing']));

drop policy if exists "social media manage own post" on public.social_post_media;
create policy "social media manage own post" on public.social_post_media for all to authenticated using(exists(select 1 from public.social_posts p where p.id=post_id and (p.author_id=auth.uid() or public.has_workspace_role(array['admin','marketing'])))) with check(exists(select 1 from public.social_posts p where p.id=post_id and (p.author_id=auth.uid() or public.has_workspace_role(array['admin','marketing']))));

drop policy if exists "social reaction own" on public.social_post_reactions;
create policy "social reaction own" on public.social_post_reactions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists "social repost own" on public.social_reposts;
create policy "social repost own" on public.social_reposts for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists "social bookmarks own" on public.social_bookmarks;
create policy "social bookmarks own" on public.social_bookmarks for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists "social bookmarks read own" on public.social_bookmarks;
create policy "social bookmarks read own" on public.social_bookmarks for select to authenticated using(user_id=auth.uid());
drop policy if exists "social follows read" on public.social_follows;
create policy "social follows read" on public.social_follows for select to authenticated using(true);
drop policy if exists "social follows own" on public.social_follows;
create policy "social follows own" on public.social_follows for insert to authenticated with check(follower_id=auth.uid());
drop policy if exists "social follows delete own" on public.social_follows;
create policy "social follows delete own" on public.social_follows for delete to authenticated using(follower_id=auth.uid());

drop policy if exists "social hashtag manage" on public.social_hashtags;
create policy "social hashtag manage" on public.social_hashtags for insert to authenticated with check(true);
drop policy if exists "social post hashtag manage" on public.social_post_hashtags;
create policy "social post hashtag manage" on public.social_post_hashtags for insert to authenticated with check(exists(select 1 from public.social_posts p where p.id=post_id and p.author_id=auth.uid()));

drop policy if exists "social notification own" on public.social_notifications;
create policy "social notification own" on public.social_notifications for select to authenticated using(user_id=auth.uid());
drop policy if exists "social notification update own" on public.social_notifications;
create policy "social notification update own" on public.social_notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

drop policy if exists "social reports create" on public.social_reports;
create policy "social reports create" on public.social_reports for insert to authenticated with check(reporter_id=auth.uid());
drop policy if exists "social reports moderation" on public.social_reports;
create policy "social reports moderation" on public.social_reports for select to authenticated using(public.has_workspace_role(array['admin','marketing','hr']));
drop policy if exists "social reports moderation update" on public.social_reports;
create policy "social reports moderation update" on public.social_reports for update to authenticated using(public.has_workspace_role(array['admin','marketing','hr'])) with check(public.has_workspace_role(array['admin','marketing','hr']));

-- Lists are private to their owners; communities are employee-visible.
drop policy if exists "social lists own" on public.social_lists;
create policy "social lists own" on public.social_lists for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
drop policy if exists "social list members owner" on public.social_list_members;
create policy "social list members owner" on public.social_list_members for all to authenticated using(exists(select 1 from public.social_lists l where l.id=list_id and l.owner_id=auth.uid())) with check(exists(select 1 from public.social_lists l where l.id=list_id and l.owner_id=auth.uid()));

drop policy if exists "social community create" on public.social_communities;
create policy "social community create" on public.social_communities for insert to authenticated with check(owner_id=auth.uid());
drop policy if exists "social community manage" on public.social_communities;
create policy "social community manage" on public.social_communities for update to authenticated using(owner_id=auth.uid() or public.has_workspace_role(array['admin','marketing'])) with check(owner_id=auth.uid() or public.has_workspace_role(array['admin','marketing']));
drop policy if exists "social community member self" on public.social_community_members;
create policy "social community member self" on public.social_community_members for insert to authenticated with check(user_id=auth.uid());

-- Direct messages: only conversation members can read/write.
drop policy if exists "social conversations member read" on public.social_conversations;
create policy "social conversations member read" on public.social_conversations for select to authenticated using(created_by=auth.uid() or exists(select 1 from public.social_conversation_members m where m.conversation_id=id and m.user_id=auth.uid()));
drop policy if exists "social conversations create" on public.social_conversations;
create policy "social conversations create" on public.social_conversations for insert to authenticated with check(created_by=auth.uid());
drop policy if exists "social conversation members read" on public.social_conversation_members;
create policy "social conversation members read" on public.social_conversation_members for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.social_conversations c where c.id=conversation_id and c.created_by=auth.uid()));
drop policy if exists "social conversation members add" on public.social_conversation_members;
create policy "social conversation members add" on public.social_conversation_members for insert to authenticated with check(user_id=auth.uid() or exists(select 1 from public.social_conversations c where c.id=conversation_id and c.created_by=auth.uid()));
drop policy if exists "social messages member read" on public.social_messages;
create policy "social messages member read" on public.social_messages for select to authenticated using(exists(select 1 from public.social_conversation_members m where m.conversation_id=social_messages.conversation_id and m.user_id=auth.uid()));
drop policy if exists "social messages member send" on public.social_messages;
create policy "social messages member send" on public.social_messages for insert to authenticated with check(sender_id=auth.uid() and exists(select 1 from public.social_conversation_members m where m.conversation_id=social_messages.conversation_id and m.user_id=auth.uid()));

-- Private media bucket. Client reads with signed URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('social-media','social-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "social media employee read" on storage.objects;
create policy "social media employee read" on storage.objects for select to authenticated using(bucket_id='social-media');
drop policy if exists "social media upload own" on storage.objects;
create policy "social media upload own" on storage.objects for insert to authenticated with check(bucket_id='social-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "social media update own" on storage.objects;
create policy "social media update own" on storage.objects for update to authenticated using(bucket_id='social-media' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='social-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "social media delete own" on storage.objects;
create policy "social media delete own" on storage.objects for delete to authenticated using(bucket_id='social-media' and (storage.foldername(name))[1]=auth.uid()::text);

DO $$ declare t text; begin
  foreach t in array array['social_posts','social_post_media','social_post_reactions','social_reposts','social_bookmarks','social_follows','social_hashtags','social_post_hashtags','social_mentions','social_polls','social_poll_options','social_poll_votes','social_notifications','social_reports','social_lists','social_list_members','social_communities','social_community_members','social_conversations','social_conversation_members','social_messages','social_spaces']
  loop execute format('grant select,insert,update,delete on public.%I to authenticated',t); end loop;
end $$;

create index if not exists idx_social_posts_created on public.social_posts(created_at desc) where deleted_at is null;
create index if not exists idx_social_posts_author on public.social_posts(author_id,created_at desc) where deleted_at is null;
create index if not exists idx_social_posts_reply on public.social_posts(reply_to_id,created_at) where deleted_at is null;
create index if not exists idx_social_reactions_post on public.social_post_reactions(post_id);
create index if not exists idx_social_reposts_post on public.social_reposts(post_id);
create index if not exists idx_social_notifications_user on public.social_notifications(user_id,created_at desc);
create index if not exists idx_social_messages_conversation on public.social_messages(conversation_id,created_at desc) where deleted_at is null;
