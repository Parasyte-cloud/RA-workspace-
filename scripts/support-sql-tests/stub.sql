-- PArAsYtE | RA-Workspace support module
-- Minimal Supabase-shaped environment for testing migrations on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create publication supabase_realtime;

create table public.employee_profiles (
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
create table public.workspace_workstation_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  workstation text not null check (workstation in ('support','operations','people','engineering','finance','marketing','partnerships','legal','executive','administration')),
  is_primary boolean not null default true,
  active boolean not null default true,
  unique(employee_id,workstation)
);
create table public.support_whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique, phone text,
  customer_name text not null default 'WhatsApp Customer',
  status text not null default 'open' check (status in ('open','closed')),
  last_message_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.support_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_whatsapp_conversations(id) on delete cascade,
  whatsapp_message_id text,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text', body text not null default '',
  sent_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now());
create unique index support_whatsapp_messages_message_id_unique on public.support_whatsapp_messages(whatsapp_message_id);
create table public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null default gen_random_uuid(), form_version_id uuid not null default gen_random_uuid(), category_id uuid not null default gen_random_uuid(),
  form_title_snapshot text not null, category_title_snapshot text not null, payload jsonb not null,
  source text not null default 'form', source_reference text, destination_workstation text not null,
  status text not null default 'new', submitted_at timestamptz not null default now());
