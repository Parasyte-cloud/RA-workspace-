-- RideArrivo Workspace production schema
-- Run in a dedicated Supabase project after reviewing organization-specific retention and role assignments.

create extension if not exists pgcrypto;

create or replace function public.current_workspace_role()
returns text language sql stable security definer set search_path=public as $$
  select coalesce((select role from public.employee_profiles where id = auth.uid() and active = true),'employee');
$$;

create or replace function public.has_workspace_role(roles text[])
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_workspace_role() = any(roles);
$$;

create table if not exists public.employee_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null unique,
  department text not null default 'Unassigned',
  job_title text not null default '',
  role text not null default 'employee' check (role in ('employee','support','engineer','manager','hr','legal','operations','admin')),
  manager_id uuid references public.employee_profiles(id),
  location text not null default 'Lagos',
  active boolean not null default true,
  start_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create policy "employees read apps" on public.workspace_apps for select to authenticated using(active=true and (public.current_workspace_role() = any(allowed_roles) or 'employee'=any(allowed_roles)));
create policy "admins manage apps" on public.workspace_apps for all to authenticated using(public.has_workspace_role(array['admin'])) with check(public.has_workspace_role(array['admin']));

-- CRM visible to customer-facing and management roles.
create policy "crm read" on public.crm_accounts for select to authenticated using(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "crm write" on public.crm_accounts for all to authenticated using(public.has_workspace_role(array['support','operations','manager','admin'])) with check(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "crm contacts read" on public.crm_contacts for select to authenticated using(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "crm contacts write" on public.crm_contacts for all to authenticated using(public.has_workspace_role(array['support','operations','manager','admin'])) with check(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "crm leads read" on public.crm_leads for select to authenticated using(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "crm leads write" on public.crm_leads for all to authenticated using(public.has_workspace_role(array['support','operations','manager','admin'])) with check(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "crm opp read" on public.crm_opportunities for select to authenticated using(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "crm opp write" on public.crm_opportunities for all to authenticated using(public.has_workspace_role(array['support','operations','manager','admin'])) with check(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "crm activity read" on public.crm_activities for select to authenticated using(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "crm activity write" on public.crm_activities for all to authenticated using(public.has_workspace_role(array['support','operations','manager','admin'])) with check(public.has_workspace_role(array['support','operations','manager','admin']));

create policy "support read" on public.support_cases for select to authenticated using(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "support write" on public.support_cases for all to authenticated using(public.has_workspace_role(array['support','operations','manager','admin'])) with check(public.has_workspace_role(array['support','operations','manager','admin']));
create policy "incident read" on public.incidents for select to authenticated using(public.has_workspace_role(array['support','operations','legal','manager','admin']));
create policy "incident write" on public.incidents for all to authenticated using(public.has_workspace_role(array['support','operations','manager','admin'])) with check(public.has_workspace_role(array['support','operations','manager','admin']));

create policy "own leave read" on public.leave_requests for select to authenticated using(employee_id=auth.uid() or public.has_workspace_role(array['manager','hr','admin']));
create policy "own leave create" on public.leave_requests for insert to authenticated with check(employee_id=auth.uid());
create policy "hr leave manage" on public.leave_requests for update to authenticated using(public.has_workspace_role(array['manager','hr','admin'])) with check(public.has_workspace_role(array['manager','hr','admin']));
create policy "own hr requests" on public.hr_requests for select to authenticated using(employee_id=auth.uid() or public.has_workspace_role(array['hr','admin']));
create policy "own hr request create" on public.hr_requests for insert to authenticated with check(employee_id=auth.uid());
create policy "hr request manage" on public.hr_requests for update to authenticated using(public.has_workspace_role(array['hr','admin'])) with check(public.has_workspace_role(array['hr','admin']));
create policy "onboarding read" on public.onboarding_tasks for select to authenticated using(employee_id=auth.uid() or public.has_workspace_role(array['hr','admin']));
create policy "onboarding manage" on public.onboarding_tasks for all to authenticated using(public.has_workspace_role(array['hr','admin'])) with check(public.has_workspace_role(array['hr','admin']));

create policy "legal read" on public.legal_contracts for select to authenticated using(public.has_workspace_role(array['legal','manager','admin']));
create policy "legal manage" on public.legal_contracts for all to authenticated using(public.has_workspace_role(array['legal','admin'])) with check(public.has_workspace_role(array['legal','admin']));
create policy "compliance read" on public.compliance_items for select to authenticated using(public.has_workspace_role(array['legal','operations','manager','admin']));
create policy "compliance manage" on public.compliance_items for all to authenticated using(public.has_workspace_role(array['legal','admin'])) with check(public.has_workspace_role(array['legal','admin']));
create policy "audit admin read" on public.workspace_audit_log for select to authenticated using(public.has_workspace_role(array['admin']));

create index if not exists idx_crm_contacts_account on public.crm_contacts(account_id);
create index if not exists idx_crm_activities_account on public.crm_activities(account_id,created_at desc);
create index if not exists idx_support_cases_status on public.support_cases(status,priority);
create index if not exists idx_leave_employee on public.leave_requests(employee_id,start_date desc);
create index if not exists idx_contract_renewal on public.legal_contracts(renewal_date);
