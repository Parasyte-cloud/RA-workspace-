begin;

-- CRM V2: general relationship management foundation while preserving Driver Outreach.

do $$ begin
  create type public.crm_relationship_kind as enum (
    'customer','driver','driver_prospect','corporate_contact','partner','vendor','investor','lead','other'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.crm_contact_relationships (
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  kind public.crm_relationship_kind not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (contact_id, kind)
);

create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 180),
  account_type text not null default 'corporate',
  industry text,
  website text,
  phone_e164 text,
  email text,
  owner_user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_account_contacts (
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  title text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (account_id, contact_id)
);

create table if not exists public.crm_ticket_categories (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,48}$'),
  label text not null,
  active boolean not null default true,
  sort_order integer not null default 100
);

insert into public.crm_ticket_categories(code,label,sort_order) values
  ('driver_recruitment','Driver Recruitment',10),
  ('customer_complaint','Customer Complaint',20),
  ('booking','Booking',30),
  ('payment','Payment',40),
  ('refund','Refund',50),
  ('safety','Safety',60),
  ('lost_item','Lost Item',70),
  ('corporate','Corporate',80),
  ('partnership','Partnership',90),
  ('membership','Membership',100),
  ('technical','Technical',110),
  ('general_enquiry','General Enquiry',120)
on conflict(code) do nothing;

alter table public.crm_tickets
  add column if not exists category_code text references public.crm_ticket_categories(code) on delete set null,
  add column if not exists channel text not null default 'internal',
  add column if not exists assigned_team text,
  add column if not exists account_id uuid references public.crm_accounts(id) on delete set null;

update public.crm_tickets set category_code='driver_recruitment' where category_code is null and subject='Driver outreach';

create table if not exists public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,48}$'),
  label text not null,
  relationship_kind public.crm_relationship_kind,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  code text not null,
  label text not null,
  is_terminal boolean not null default false,
  is_success boolean not null default false,
  sort_order integer not null default 100,
  unique(pipeline_id, code)
);

create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.crm_pipelines(id) on delete restrict,
  stage_id uuid references public.crm_pipeline_stages(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  account_id uuid references public.crm_accounts(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  value_minor bigint,
  currency text not null default 'NGN',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.crm_pipelines(code,label,relationship_kind,sort_order) values
 ('driver_acquisition','Driver Acquisition','driver_prospect',10),
 ('corporate_sales','Corporate Sales','corporate_contact',20),
 ('partnerships','Partnerships','partner',30)
on conflict(code) do nothing;

insert into public.crm_pipeline_stages(pipeline_id,code,label,is_terminal,is_success,sort_order)
select p.id, x.code, x.label, x.terminal, x.success, x.ord
from public.crm_pipelines p
join (values
 ('driver_acquisition','new','New Lead',false,false,10),
 ('driver_acquisition','contacted','Contacted',false,false,20),
 ('driver_acquisition','interested','Interested',false,true,30),
 ('driver_acquisition','documents','Documents',false,true,40),
 ('driver_acquisition','verification','Verification',false,true,50),
 ('driver_acquisition','onboarding','Onboarding',false,true,60),
 ('driver_acquisition','activated','Activated',true,true,70),
 ('driver_acquisition','lost','Not Interested',true,false,80),
 ('corporate_sales','lead','Lead',false,false,10),
 ('corporate_sales','qualified','Qualified',false,false,20),
 ('corporate_sales','meeting','Meeting',false,false,30),
 ('corporate_sales','proposal','Proposal',false,true,40),
 ('corporate_sales','negotiation','Negotiation',false,true,50),
 ('corporate_sales','won','Won',true,true,60),
 ('corporate_sales','lost','Lost',true,false,70),
 ('partnerships','prospect','Prospect',false,false,10),
 ('partnerships','contacted','Contacted',false,false,20),
 ('partnerships','discussion','Discussion',false,false,30),
 ('partnerships','due_diligence','Due Diligence',false,true,40),
 ('partnerships','agreement','Agreement',false,true,50),
 ('partnerships','active','Active',true,true,60)
) as x(pipeline_code,code,label,terminal,success,ord) on p.code=x.pipeline_code
on conflict(pipeline_id,code) do nothing;

-- Backfill existing driver records into the generalized relationship model.
insert into public.crm_contact_relationships(contact_id,kind,metadata)
select contact_id,'driver_prospect','{"source":"driver_outreach_v1"}'::jsonb
from public.crm_driver_profiles
on conflict(contact_id,kind) do nothing;

-- Stable ticket workspace view avoids fragile PostgREST nested-relation aliases.
create or replace view public.crm_ticket_workspace_v
with (security_invoker=true) as
select
  t.id, t.reference, t.contact_id, t.subject, t.state, t.assigned_to,
  t.priority, t.opened_by, t.closed_at, t.created_at, t.updated_at,
  t.category_code, t.channel, t.assigned_team, t.account_id,
  c.full_name as contact_full_name,
  c.phone as contact_phone_e164,
  null::text as contact_secondary_phone_e164,
  c.email as contact_email,
  null::text as contact_area,
  dp.vehicle_make, dp.vehicle_model, dp.vehicle_year, dp.registration_number,
  dp.vehicle_ownership, dp.source as driver_source, dp.current_status_id,
  dp.first_contacted_at, dp.last_contacted_at
from public.crm_tickets t
join public.crm_contacts c on c.id=t.contact_id
left join public.crm_driver_profiles dp on dp.contact_id=c.id;

create or replace view public.crm_contact_360_v
with (security_invoker=true) as
select
  c.id,
  c.full_name,
  c.phone as phone_e164,
  null::text as secondary_phone_e164,
  c.email,
  null::text as area,
  c.created_at,
  c.created_at as updated_at,
  coalesce(array_agg(distinct r.kind::text) filter (where r.kind is not null), '{}') as relationships,
  count(distinct t.id) as ticket_count,
  max(t.updated_at) as last_ticket_activity
from public.crm_contacts c
left join public.crm_contact_relationships r on r.contact_id=c.id and r.active
left join public.crm_tickets t on t.contact_id=c.id
group by c.id;

-- RLS for new tables.
alter table public.crm_contact_relationships enable row level security;
alter table public.crm_accounts enable row level security;
alter table public.crm_account_contacts enable row level security;
alter table public.crm_ticket_categories enable row level security;
alter table public.crm_pipelines enable row level security;
alter table public.crm_pipeline_stages enable row level security;
alter table public.crm_opportunities enable row level security;

create policy crm_contact_relationships_read on public.crm_contact_relationships for select to authenticated
using (public.crm_is_member(auth.uid()) and exists(select 1 from public.crm_tickets t where t.contact_id=crm_contact_relationships.contact_id and public.crm_can_access_ticket(t.id,auth.uid())));
create policy crm_accounts_supervisor_read on public.crm_accounts for select to authenticated using (public.crm_is_supervisor(auth.uid()));
create policy crm_account_contacts_supervisor_read on public.crm_account_contacts for select to authenticated using (public.crm_is_supervisor(auth.uid()));
create policy crm_ticket_categories_member_read on public.crm_ticket_categories for select to authenticated using (public.crm_is_member(auth.uid()));
create policy crm_pipelines_member_read on public.crm_pipelines for select to authenticated using (public.crm_is_member(auth.uid()));
create policy crm_pipeline_stages_member_read on public.crm_pipeline_stages for select to authenticated using (public.crm_is_member(auth.uid()));
create policy crm_opportunities_supervisor_read on public.crm_opportunities for select to authenticated using (public.crm_is_supervisor(auth.uid()) or owner_id=auth.uid());

grant select on public.crm_ticket_workspace_v to authenticated;
grant select on public.crm_contact_360_v to authenticated;
grant select on public.crm_ticket_categories, public.crm_pipelines, public.crm_pipeline_stages to authenticated;
grant select on public.crm_contact_relationships, public.crm_accounts, public.crm_account_contacts, public.crm_opportunities to authenticated;

commit;
