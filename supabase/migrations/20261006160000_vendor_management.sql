begin;

-- ============================================================
-- VENDOR MANAGEMENT
--
-- One directory of vendors, with a log of every conversation and a
-- list of the items we are waiting on (orders, quotes, deliveries,
-- invoices, repairs). Items and conversations belong to a vendor, so
-- "what do we owe and what are we waiting for, and from whom" has a
-- single answer.
--
-- Access: operations, finance and admin can read and write.
-- Only admin can delete. Everyone else gets nothing (default deny).
-- Rows are never silently removed in normal use: vendors are set to
-- inactive instead, so history stays intact.
-- ============================================================

create or replace function public.can_manage_vendors()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_workspace_role() in ('operations', 'finance', 'admin'),
    false
  );
$$;

revoke all on function public.can_manage_vendors() from public, anon;
grant execute on function public.can_manage_vendors() to authenticated;


create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),

  name text not null
    check (length(btrim(name)) between 2 and 160),

  category text not null default 'other'
    check (category in (
      'fleet_maintenance', 'fuel', 'vehicle_supply', 'insurance',
      'airport_venue', 'software', 'professional_services',
      'office_supplies', 'other'
    )),

  status text not null default 'active'
    check (status in ('onboarding', 'active', 'on_hold', 'inactive')),

  email text check (email is null or length(email) <= 254),
  phone text check (phone is null or length(phone) <= 40),
  website text check (website is null or length(website) <= 300),
  address text check (address is null or length(address) <= 400),

  payment_terms text check (payment_terms is null or length(payment_terms) <= 200),
  contract_start date,
  contract_end date,
  document_notes text check (document_notes is null or length(document_notes) <= 2000),
  notes text check (notes is null or length(notes) <= 4000),

  owner_id uuid references public.employee_profiles(id) on delete set null,

  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (contract_end is null or contract_start is null or contract_end >= contract_start)
);

create unique index if not exists vendors_name_unique
  on public.vendors (lower(btrim(name)));
create index if not exists vendors_status_idx on public.vendors (status, name);
create index if not exists vendors_category_idx on public.vendors (category);
create index if not exists vendors_contract_end_idx
  on public.vendors (contract_end) where contract_end is not null;


create table if not exists public.vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  job_title text check (job_title is null or length(job_title) <= 120),
  email text check (email is null or length(email) <= 254),
  phone text check (phone is null or length(phone) <= 40),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists vendor_contacts_vendor_idx
  on public.vendor_contacts (vendor_id);
-- At most one primary contact per vendor.
create unique index if not exists vendor_contacts_one_primary
  on public.vendor_contacts (vendor_id) where is_primary;


create table if not exists public.vendor_communications (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,

  channel text not null default 'email'
    check (channel in ('email', 'phone', 'whatsapp', 'meeting', 'other')),
  direction text not null default 'outbound'
    check (direction in ('inbound', 'outbound')),

  subject text not null check (length(btrim(subject)) between 1 and 200),
  summary text check (summary is null or length(summary) <= 4000),
  occurred_at timestamptz not null default now(),

  follow_up_date date,
  follow_up_done boolean not null default false,

  logged_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists vendor_comms_vendor_idx
  on public.vendor_communications (vendor_id, occurred_at desc);
create index if not exists vendor_comms_followup_idx
  on public.vendor_communications (follow_up_date)
  where follow_up_date is not null and follow_up_done = false;


create table if not exists public.vendor_items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,

  kind text not null default 'order'
    check (kind in ('order', 'quote', 'delivery', 'invoice', 'repair', 'other')),

  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  reference text check (reference is null or length(reference) <= 80),

  amount numeric(14, 2) check (amount is null or amount >= 0),
  currency text not null default 'NGN' check (length(currency) = 3),

  status text not null default 'requested'
    check (status in (
      'requested', 'quoted', 'ordered', 'in_progress',
      'delivered', 'invoiced', 'paid', 'cancelled'
    )),

  owner_id uuid references public.employee_profiles(id) on delete set null,
  due_date date,
  completed_at timestamptz,

  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_items_vendor_idx
  on public.vendor_items (vendor_id, created_at desc);
create index if not exists vendor_items_open_due_idx
  on public.vendor_items (due_date)
  where status not in ('paid', 'cancelled', 'delivered');


-- ------------------------------------------------------------
-- Server-controlled fields: who created or logged a row, and when
-- it changed, cannot be set or forged from the browser.
-- ------------------------------------------------------------

create or replace function public.vendor_row_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    if TG_TABLE_NAME in ('vendors', 'vendor_items') then
      new.created_by := auth.uid();
      new.created_at := now();
    elsif TG_TABLE_NAME = 'vendor_communications' then
      new.logged_by := auth.uid();
      new.created_at := now();
    end if;
  else
    -- Authorship and creation time never change after insert.
    if TG_TABLE_NAME in ('vendors', 'vendor_items') then
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    elsif TG_TABLE_NAME = 'vendor_communications' then
      new.logged_by := old.logged_by;
      new.created_at := old.created_at;
      new.vendor_id := old.vendor_id;
    end if;
    if TG_TABLE_NAME = 'vendor_items' then
      new.vendor_id := old.vendor_id;
    end if;
  end if;

  if TG_TABLE_NAME in ('vendors', 'vendor_items') then
    new.updated_at := now();
  end if;

  -- Stamp completion automatically when an item reaches a finished state.
  if TG_TABLE_NAME = 'vendor_items' then
    if new.status in ('delivered', 'paid') and new.completed_at is null then
      new.completed_at := now();
    elsif new.status not in ('delivered', 'paid') then
      new.completed_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists vendors_guard on public.vendors;
create trigger vendors_guard before insert or update on public.vendors
  for each row execute function public.vendor_row_guard();

drop trigger if exists vendor_items_guard on public.vendor_items;
create trigger vendor_items_guard before insert or update on public.vendor_items
  for each row execute function public.vendor_row_guard();

drop trigger if exists vendor_comms_guard on public.vendor_communications;
create trigger vendor_comms_guard before insert or update on public.vendor_communications
  for each row execute function public.vendor_row_guard();


-- ------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------

alter table public.vendors enable row level security;
alter table public.vendor_contacts enable row level security;
alter table public.vendor_communications enable row level security;
alter table public.vendor_items enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'vendors', 'vendor_contacts', 'vendor_communications', 'vendor_items'
  ]
  loop
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format('drop policy if exists "%1$s insert" on public.%1$s', t);
    execute format('drop policy if exists "%1$s update" on public.%1$s', t);
    execute format('drop policy if exists "%1$s delete" on public.%1$s', t);

    execute format(
      'create policy "%1$s read" on public.%1$s for select to authenticated
         using (public.can_manage_vendors())', t);
    execute format(
      'create policy "%1$s insert" on public.%1$s for insert to authenticated
         with check (public.can_manage_vendors())', t);
    execute format(
      'create policy "%1$s update" on public.%1$s for update to authenticated
         using (public.can_manage_vendors())
         with check (public.can_manage_vendors())', t);
    -- Deleting is admin only, except contacts, which staff may remove
    -- when someone leaves a vendor. Day to day, set a vendor to inactive.
    execute format(
      'create policy "%1$s delete" on public.%1$s for delete to authenticated
         using (%2$s)', t,
      case when t = 'vendor_contacts'
        then 'public.can_manage_vendors()'
        else 'public.current_workspace_role() = ''admin''' end);
  end loop;
end $$;

revoke all on public.vendors, public.vendor_contacts,
  public.vendor_communications, public.vendor_items from anon, public;
grant select, insert, update, delete on public.vendors,
  public.vendor_contacts, public.vendor_communications,
  public.vendor_items to authenticated;
grant all on public.vendors, public.vendor_contacts,
  public.vendor_communications, public.vendor_items to service_role;

commit;
