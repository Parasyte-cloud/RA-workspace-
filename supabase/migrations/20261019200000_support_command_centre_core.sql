-- PArAsYtE | RA-Workspace support module
-- RA Support Command Centre: core schema, authorization, ticket engine.
--
-- Idempotent on purpose: it can be replayed on a fresh database (CI runs every
-- migration from scratch) and on a database where an earlier draft of the
-- Command Centre was applied.
--
-- Security model
--   * Browsers (role "authenticated") may SELECT support data if they are
--     Support staff, and may call a short list of RPCs. They get no INSERT,
--     UPDATE or DELETE on any support table.
--   * Everything that mutates state on behalf of a provider (Twilio, WhatsApp,
--     email) runs in an Edge Function with the service role.
--   * Postgres grants EXECUTE on new functions to PUBLIC by default, so every
--     function here is revoked from PUBLIC/anon/authenticated and then granted
--     back only where it is meant to be called.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.support_agents (
  employee_id uuid primary key references public.employee_profiles(id) on delete cascade,
  enabled boolean not null default true,
  is_supervisor boolean not null default false,
  supervisor_id uuid references public.employee_profiles(id) on delete set null,
  voice_enabled boolean not null default true,
  messaging_enabled boolean not null default true,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default true,
  whatsapp_enabled boolean not null default true,
  web_chat_enabled boolean not null default true,
  voice_capacity integer not null default 1 check (voice_capacity between 0 and 5),
  messaging_capacity integer not null default 3 check (messaging_capacity between 0 and 20),
  skills text[] not null default '{}',
  languages text[] not null default array['English']::text[],
  shift_override_until timestamptz,
  last_assigned_at timestamptz,
  provider_worker_id text,
  provider_worker_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.support_agents add column if not exists is_supervisor boolean not null default false;
alter table public.support_agents add column if not exists shift_override_until timestamptz;
alter table public.support_agents add column if not exists last_assigned_at timestamptz;
alter table public.support_agents add column if not exists provider_worker_id text;
alter table public.support_agents add column if not exists provider_worker_synced_at timestamptz;

create table if not exists public.support_agent_presence (
  employee_id uuid primary key references public.support_agents(employee_id) on delete cascade,
  state text not null default 'offline'
    check (state in ('available','busy','on_call','wrap_up','break','away','offline')),
  state_reason text,
  state_changed_at timestamptz not null default now(),
  active_shift boolean not null default false,
  voice_active integer not null default 0 check (voice_active >= 0),
  messaging_active integer not null default 0 check (messaging_active >= 0),
  last_seen_at timestamptz,
  provider_activity_sid text,
  provider_activity_name text,
  updated_at timestamptz not null default now()
);
alter table public.support_agent_presence add column if not exists state_reason text;
alter table public.support_agent_presence add column if not exists state_changed_at timestamptz not null default now();
alter table public.support_agent_presence add column if not exists provider_activity_sid text;
alter table public.support_agent_presence add column if not exists provider_activity_name text;

create table if not exists public.support_shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Africa/Lagos',
  starts_at time not null,
  ends_at time not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists support_shifts_name_key on public.support_shifts (lower(name));

create table if not exists public.support_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.support_shifts(id) on delete cascade,
  employee_id uuid not null references public.support_agents(employee_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  effective_from date,
  effective_to date,
  unique (shift_id, employee_id, weekday)
);
create index if not exists support_shift_assignments_employee_idx on public.support_shift_assignments (employee_id);

create table if not exists public.support_queues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  channel text check (channel is null or channel in ('voice','whatsapp','web_chat','email','sms','form')),
  priority smallint not null default 100,
  required_skills text[] not null default '{}',
  reservation_timeout_seconds integer not null default 20
    check (reservation_timeout_seconds between 5 and 600),
  provider_queue_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.support_queue_memberships (
  queue_id uuid not null references public.support_queues(id) on delete cascade,
  employee_id uuid not null references public.support_agents(employee_id) on delete cascade,
  priority smallint not null default 100,
  created_at timestamptz not null default now(),
  primary key (queue_id, employee_id)
);

create table if not exists public.support_sla_policies (
  priority text primary key check (priority in ('P0','P1','P2','P3','P4')),
  first_response_minutes integer not null check (first_response_minutes > 0),
  resolution_minutes integer not null check (resolution_minutes > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_customers (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  primary_email text,
  primary_phone text,
  rider_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_customer_identities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.support_customers(id) on delete cascade,
  identity_type text not null
    check (identity_type in ('phone','email','whatsapp','rider_id','external')),
  identity_value text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (identity_type, identity_value)
);
create index if not exists support_customer_identities_customer_idx on public.support_customer_identities (customer_id);

create sequence if not exists public.support_ticket_number_seq start 1;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique
    default ('RA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.support_ticket_number_seq')::text, 6, '0')),
  customer_id uuid references public.support_customers(id) on delete set null,
  subject text not null,
  category text not null default 'general_enquiry',
  channel text not null check (channel in ('voice','whatsapp','web_chat','email','sms','form')),
  priority text not null default 'P3' check (priority in ('P0','P1','P2','P3','P4')),
  status text not null default 'new'
    check (status in ('new','queued','assigned','in_progress','waiting_customer','waiting_internal','escalated','resolved','closed','reopened')),
  queue_id uuid references public.support_queues(id) on delete set null,
  assigned_agent_id uuid references public.support_agents(employee_id) on delete set null,
  source_reference text,
  tags text[] not null default '{}',
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_responded_at timestamptz,
  last_customer_message_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  reopen_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.support_tickets add column if not exists tags text[] not null default '{}';
alter table public.support_tickets add column if not exists last_customer_message_at timestamptz;
alter table public.support_tickets add column if not exists closed_at timestamptz;
alter table public.support_tickets add column if not exists reopen_count integer not null default 0;

create index if not exists support_tickets_queue_status_idx on public.support_tickets (queue_id, status, priority, created_at);
create index if not exists support_tickets_agent_status_idx on public.support_tickets (assigned_agent_id, status, updated_at desc);
create index if not exists support_tickets_customer_idx on public.support_tickets (customer_id, updated_at desc);
create index if not exists support_tickets_source_ref_idx on public.support_tickets (source_reference) where source_reference is not null;
create index if not exists support_tickets_open_sla_idx on public.support_tickets (first_response_due_at)
  where status not in ('resolved','closed');

create table if not exists public.support_ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_events_ticket_idx on public.support_ticket_events (ticket_id, created_at);

create table if not exists public.support_ticket_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references public.employee_profiles(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 8000),
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_notes_ticket_idx on public.support_ticket_notes (ticket_id, created_at);

create table if not exists public.support_interactions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.support_tickets(id) on delete set null,
  customer_id uuid references public.support_customers(id) on delete set null,
  channel text not null check (channel in ('voice','whatsapp','web_chat','email','sms','form')),
  direction text not null check (direction in ('inbound','outbound','internal')),
  provider text,
  provider_interaction_id text,
  body text,
  media jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_interaction_id)
);
create index if not exists support_interactions_ticket_idx on public.support_interactions (ticket_id, occurred_at);

create table if not exists public.support_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  channel text not null,
  display_name text not null,
  external_id text,
  configuration jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider, channel, display_name)
);

create table if not exists public.support_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_audit_log_created_idx on public.support_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Seed data (never overwrites an existing choice)
-- ---------------------------------------------------------------------------

insert into public.support_shifts (name, starts_at, ends_at)
select v.name, v.s::time, v.e::time
from (values ('Day Shift','07:00','19:00'), ('Night Shift','19:00','07:00')) as v(name, s, e)
where not exists (select 1 from public.support_shifts x where lower(x.name) = lower(v.name));

insert into public.support_queues (name, channel, priority, required_skills)
values
  ('Safety & Emergency', null, 1, array['safety']),
  ('Active Ride', 'voice', 10, array['active_ride']),
  ('Voice - General', 'voice', 30, '{}'),
  ('WhatsApp', 'whatsapp', 40, '{}'),
  ('Web Chat', 'web_chat', 40, '{}'),
  ('SMS', 'sms', 50, '{}'),
  ('Email', 'email', 60, '{}'),
  ('Forms', 'form', 70, '{}')
on conflict (name) do nothing;

insert into public.support_sla_policies (priority, first_response_minutes, resolution_minutes)
values ('P0', 2, 120), ('P1', 5, 240), ('P2', 15, 480), ('P3', 60, 1440), ('P4', 240, 4320)
on conflict (priority) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Authorization helpers
--    Support access follows the same model as the rest of RA-Workspace:
--    role, or an active workstation assignment, plus anyone provisioned as
--    a Support officer from Administration.
-- ---------------------------------------------------------------------------

create or replace function public.support_is_staff(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null and exists (
    select 1
    from public.employee_profiles ep
    where ep.id = p_user
      and ep.active
      and (
        ep.role in ('support','manager','admin')
        or lower(ep.job_title) ~ '(head of support|support lead|support manager)'
        or exists (
          select 1 from public.workspace_workstation_assignments a
          where a.employee_id = ep.id and a.active and a.workstation in ('support','administration')
        )
        or exists (
          select 1 from public.support_agents sa
          where sa.employee_id = ep.id and sa.enabled
        )
      )
  );
$$;

-- Head of Support, Support leads, managers and administrators.
create or replace function public.support_is_supervisor(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null and exists (
    select 1
    from public.employee_profiles ep
    where ep.id = p_user
      and ep.active
      and (
        ep.role in ('manager','admin')
        or lower(ep.job_title) ~ '(head of support|support lead|support manager)'
        or exists (
          select 1 from public.workspace_workstation_assignments a
          where a.employee_id = ep.id and a.active and a.workstation = 'administration'
        )
        or exists (
          select 1 from public.support_agents sa
          where sa.employee_id = ep.id and sa.enabled and sa.is_supervisor
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Shift logic. Evaluated live; never trust a stored snapshot.
--    weekday: 0 = Sunday ... 6 = Saturday (same as JavaScript getDay()).
--    A shift is attached to the weekday it STARTS on, so a Monday night shift
--    (19:00 to 07:00) is still running at 03:00 on Tuesday.
-- ---------------------------------------------------------------------------

create or replace function public.support_is_employee_on_shift(p_employee_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((select sa.shift_override_until > p_at from public.support_agents sa where sa.employee_id = p_employee_id), false)
    or exists (
      select 1
      from public.support_shift_assignments a
      join public.support_shifts s on s.id = a.shift_id and s.active
      cross join lateral (select (p_at at time zone s.timezone) as local_ts) z
      where a.employee_id = p_employee_id
        and (a.effective_from is null or z.local_ts::date >= a.effective_from)
        and (a.effective_to is null or z.local_ts::date <= a.effective_to)
        and (
          (s.starts_at < s.ends_at
            and extract(dow from z.local_ts)::int = a.weekday
            and z.local_ts::time >= s.starts_at
            and z.local_ts::time < s.ends_at)
          or
          (s.starts_at > s.ends_at and (
            (z.local_ts::time >= s.starts_at and extract(dow from z.local_ts)::int = a.weekday)
            or
            (z.local_ts::time < s.ends_at and ((extract(dow from z.local_ts)::int + 6) % 7) = a.weekday)
          ))
        )
    );
$$;

-- ---------------------------------------------------------------------------
-- 5. Pure helpers
-- ---------------------------------------------------------------------------

create or replace function public.support_normalize_phone(p_value text)
returns text
language plpgsql
immutable
as $$
declare v text;
begin
  v := regexp_replace(coalesce(p_value, ''), '[^0-9+]', '', 'g');
  if v ~ '^00[0-9]+$' then v := '+' || substr(v, 3); end if;
  if v ~ '^0[0-9]{10}$' then v := '+234' || substr(v, 2); end if;
  if v ~ '^234[0-9]{10}$' then v := '+' || v; end if;
  if v !~ '^\+[1-9][0-9]{7,14}$' then return null; end if;
  return v;
end;
$$;

-- Rules-based triage. Deliberately simple and explainable; it only picks a
-- starting category and priority and an agent can always change both.
create or replace function public.support_classify(p_text text)
returns table (category text, priority text)
language plpgsql
immutable
as $$
declare t text := lower(coalesce(p_text, ''));
begin
  if t ~ '(accident|emergency|unsafe|assault|harass|kidnap|robber|attack|crash|injur|threaten|panic|sos)' then
    return query select 'safety'::text, 'P0'::text; return;
  end if;
  if t ~ '(not arrived|has not arrived|hasn''t arrived|still waiting|driver is late|wrong location|cancel my ride|wrong pickup|stuck)' then
    return query select 'active_ride'::text, 'P1'::text; return;
  end if;
  if t ~ '(refund|double charge|charged twice|overcharg)' then
    return query select 'refund'::text, 'P2'::text; return;
  end if;
  if t ~ '(payment|debit|charged|receipt|card|transfer)' then
    return query select 'payment'::text, 'P2'::text; return;
  end if;
  if t ~ '(rude|complain|dangerous driving|misbehav)' then
    return query select 'complaint'::text, 'P2'::text; return;
  end if;
  if t ~ '(lost property|left my|forgot my|lost my)' then
    return query select 'lost_property'::text, 'P3'::text; return;
  end if;
  if t ~ '(driver)' then
    return query select 'driver'::text, 'P3'::text; return;
  end if;
  if t ~ '(book|reservation|schedule|airport)' then
    return query select 'booking'::text, 'P3'::text; return;
  end if;
  return query select 'general_enquiry'::text, 'P3'::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Triggers: updated_at, SLA clocks, ticket audit trail, interaction effects
-- ---------------------------------------------------------------------------

create or replace function public.support_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists support_agents_touch on public.support_agents;
create trigger support_agents_touch before update on public.support_agents
  for each row execute function public.support_touch_updated_at();

drop trigger if exists support_customers_touch on public.support_customers;
create trigger support_customers_touch before update on public.support_customers
  for each row execute function public.support_touch_updated_at();

create or replace function public.support_tickets_sla()
returns trigger
language plpgsql
as $$
declare v_policy public.support_sla_policies%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_policy from public.support_sla_policies where priority = new.priority;
    if found then
      if new.first_response_due_at is null then
        new.first_response_due_at := new.created_at + make_interval(mins => v_policy.first_response_minutes);
      end if;
      if new.resolution_due_at is null then
        new.resolution_due_at := new.created_at + make_interval(mins => v_policy.resolution_minutes);
      end if;
    end if;
    return new;
  end if;

  new.updated_at := now();

  if new.priority is distinct from old.priority then
    select * into v_policy from public.support_sla_policies where priority = new.priority;
    if found then
      if new.first_responded_at is null then
        new.first_response_due_at := old.created_at + make_interval(mins => v_policy.first_response_minutes);
      end if;
      if new.status not in ('resolved','closed') then
        new.resolution_due_at := old.created_at + make_interval(mins => v_policy.resolution_minutes);
      end if;
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'resolved' and new.resolved_at is null then new.resolved_at := now(); end if;
    if new.status = 'closed' then
      new.closed_at := coalesce(new.closed_at, now());
      new.resolved_at := coalesce(new.resolved_at, now());
    end if;
    if new.status = 'reopened' then
      new.resolved_at := null;
      new.closed_at := null;
      new.reopen_count := old.reopen_count + 1;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists support_tickets_sla_trg on public.support_tickets;
create trigger support_tickets_sla_trg
  before insert or update on public.support_tickets
  for each row execute function public.support_tickets_sla();

create or replace function public.support_tickets_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (new.id, auth.uid(), 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.priority is distinct from old.priority then
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (new.id, auth.uid(), 'priority_changed', jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;
  if new.assigned_agent_id is distinct from old.assigned_agent_id then
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (new.id, auth.uid(), 'assignment_changed', jsonb_build_object('from', old.assigned_agent_id, 'to', new.assigned_agent_id));
  end if;
  if new.category is distinct from old.category then
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (new.id, auth.uid(), 'category_changed', jsonb_build_object('from', old.category, 'to', new.category));
  end if;
  return new;
end;
$$;

drop trigger if exists support_tickets_audit_trg on public.support_tickets;
create trigger support_tickets_audit_trg
  after update on public.support_tickets
  for each row execute function public.support_tickets_audit();

-- Effects of a new interaction on its ticket:
--   * first outbound reply stops the first-response clock
--   * a customer message on a waiting ticket wakes it up
--   * a customer message shortly after resolution reopens it
create or replace function public.support_interactions_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ticket public.support_tickets%rowtype;
begin
  if new.ticket_id is null then return new; end if;
  select * into v_ticket from public.support_tickets where id = new.ticket_id for update;
  if not found then return new; end if;

  if new.direction = 'outbound' and new.channel <> 'form' and v_ticket.first_responded_at is null then
    update public.support_tickets
       set first_responded_at = new.occurred_at,
           status = case when status in ('new','queued','assigned') then 'in_progress' else status end
     where id = v_ticket.id;
  elsif new.direction = 'inbound' then
    update public.support_tickets
       set last_customer_message_at = new.occurred_at,
           status = case
             when status = 'waiting_customer' then 'in_progress'
             when status in ('resolved','closed') and coalesce(resolved_at, updated_at) > now() - interval '7 days' then 'reopened'
             else status end
     where id = v_ticket.id;
  else
    update public.support_tickets set updated_at = now() where id = v_ticket.id;
  end if;
  return new;
end;
$$;

drop trigger if exists support_interactions_after_insert_trg on public.support_interactions;
create trigger support_interactions_after_insert_trg
  after insert on public.support_interactions
  for each row execute function public.support_interactions_after_insert();

-- ---------------------------------------------------------------------------
-- 7. Service-only functions (Edge Functions and triggers call these)
-- ---------------------------------------------------------------------------

create or replace function public.support_write_audit(
  p_actor uuid, p_action text, p_entity_type text default null, p_entity_id text default null, p_payload jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.support_audit_log (actor_id, action, entity_type, entity_id, payload)
  values (p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb));
$$;

-- One person, one customer record. Resolves by identity and creates on miss.
create or replace function public.support_resolve_customer(
  p_identity_type text, p_identity_value text, p_display_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer uuid;
  v_created uuid;
  v_value text := btrim(coalesce(p_identity_value, ''));
begin
  if p_identity_type not in ('phone','email','whatsapp','rider_id','external') then
    raise exception 'invalid identity type %', p_identity_type;
  end if;
  if v_value = '' then raise exception 'identity value is required'; end if;
  if p_identity_type = 'email' then v_value := lower(v_value); end if;

  select customer_id into v_customer
    from public.support_customer_identities
   where identity_type = p_identity_type and identity_value = v_value;
  if v_customer is not null then
    if nullif(btrim(coalesce(p_display_name, '')), '') is not null then
      update public.support_customers
         set display_name = btrim(p_display_name)
       where id = v_customer and coalesce(display_name, '') = '';
    end if;
    return v_customer;
  end if;

  insert into public.support_customers (display_name, primary_phone, primary_email)
  values (
    nullif(btrim(coalesce(p_display_name, '')), ''),
    case when p_identity_type = 'phone' then v_value end,
    case when p_identity_type = 'email' then v_value end
  )
  returning id into v_created;

  insert into public.support_customer_identities (customer_id, identity_type, identity_value)
  values (v_created, p_identity_type, v_value)
  on conflict (identity_type, identity_value) do nothing;

  select customer_id into v_customer
    from public.support_customer_identities
   where identity_type = p_identity_type and identity_value = v_value;

  -- Lost a race with a concurrent insert: drop the orphan.
  if v_customer is distinct from v_created then
    delete from public.support_customers where id = v_created;
  end if;
  return v_customer;
end;
$$;

-- The single entry point for every channel. Voice, SMS, WhatsApp, email, web
-- chat and forms all create tickets through here, so they behave identically:
--   idempotent on (provider, external id), one customer per identity,
--   attach to the customer's open ticket or create one, apply triage and SLA.
create or replace function public.support_ingest_interaction(
  p_channel text,
  p_direction text,
  p_provider text,
  p_external_id text,
  p_identity_type text,
  p_identity_value text,
  p_display_name text default null,
  p_subject text default null,
  p_body text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source_reference text default null,
  p_priority text default null,
  p_category text default null,
  p_extra_identities jsonb default '[]'::jsonb,
  p_occurred_at timestamptz default now()
) returns table (
  ticket_id uuid, interaction_id uuid, customer_id uuid, public_id text,
  ticket_created boolean, duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value text;
  v_type text := p_identity_type;
  v_customer uuid;
  v_ticket public.support_tickets%rowtype;
  v_found boolean := false;
  v_created boolean := false;
  v_interaction uuid;
  v_class record;
  v_queue uuid;
  v_priority text;
  v_category text;
  v_subject text;
  v_extra jsonb;
  v_text text := concat_ws(' ', p_subject, p_body);
begin
  if p_channel not in ('voice','whatsapp','web_chat','email','sms','form') then
    raise exception 'invalid channel %', p_channel;
  end if;
  if p_direction not in ('inbound','outbound') then
    raise exception 'invalid direction %', p_direction;
  end if;

  -- Replay protection.
  if p_provider is not null and p_external_id is not null then
    select i.id, i.ticket_id, i.customer_id into v_interaction, v_ticket.id, v_customer
      from public.support_interactions i
     where i.provider = p_provider and i.provider_interaction_id = p_external_id;
    if v_interaction is not null then
      return query
        select v_ticket.id, v_interaction, v_customer, t.public_id, false, true
          from public.support_tickets t where t.id = v_ticket.id;
      return;
    end if;
  end if;

  v_value := btrim(coalesce(p_identity_value, ''));
  if v_type = 'phone' then
    v_value := coalesce(public.support_normalize_phone(v_value), '');
    if v_value = '' then
      v_type := 'external';
      v_value := 'raw:' || btrim(coalesce(p_identity_value, ''));
    end if;
  end if;
  if v_value = '' or v_value = 'raw:' then
    v_type := 'external';
    v_value := 'unknown:' || coalesce(p_external_id, gen_random_uuid()::text);
  end if;

  v_customer := public.support_resolve_customer(v_type, v_value, p_display_name);
  perform pg_advisory_xact_lock(hashtextextended(v_customer::text, 0));

  for v_extra in select * from jsonb_array_elements(coalesce(p_extra_identities, '[]'::jsonb)) loop
    declare
      x_type text := v_extra ->> 'type';
      x_val text := btrim(coalesce(v_extra ->> 'value', ''));
    begin
      if x_type = 'phone' then x_val := coalesce(public.support_normalize_phone(x_val), ''); end if;
      if x_type = 'email' then x_val := lower(x_val); end if;
      if x_type in ('phone','email','whatsapp','rider_id','external') and x_val <> '' then
        insert into public.support_customer_identities (customer_id, identity_type, identity_value)
        values (v_customer, x_type, x_val)
        on conflict (identity_type, identity_value) do nothing;
        if x_type = 'email' then
          update public.support_customers set primary_email = coalesce(primary_email, x_val) where id = v_customer;
        elsif x_type = 'phone' then
          update public.support_customers set primary_phone = coalesce(primary_phone, x_val) where id = v_customer;
        end if;
      end if;
    end;
  end loop;

  -- Find the ticket this belongs to.
  if p_source_reference is not null then
    select * into v_ticket from public.support_tickets t
     where t.source_reference = p_source_reference
     order by t.created_at desc limit 1;
    v_found := found;
    if v_found and v_ticket.status in ('resolved','closed')
       and coalesce(v_ticket.resolved_at, v_ticket.updated_at) < now() - interval '7 days' then
      v_found := false;
    end if;
  end if;
  if not v_found then
    select * into v_ticket from public.support_tickets t
     where t.customer_id = v_customer
       and t.status not in ('resolved','closed')
       and t.updated_at > now() - interval '24 hours'
     order by t.updated_at desc limit 1;
    v_found := found;
  end if;

  select * into v_class from public.support_classify(v_text);
  v_priority := coalesce(nullif(p_priority, ''), v_class.priority);
  v_category := coalesce(nullif(p_category, ''), v_class.category);

  if not v_found then
    if v_category = 'safety' then
      select q.id into v_queue from public.support_queues q where q.active and q.name = 'Safety & Emergency';
    end if;
    if v_queue is null then
      select q.id into v_queue from public.support_queues q
       where q.active and q.channel = p_channel order by q.priority, q.name limit 1;
    end if;
    v_subject := coalesce(
      nullif(btrim(coalesce(p_subject, '')), ''),
      nullif(left(btrim(coalesce(p_body, '')), 80), ''),
      case p_channel
        when 'voice' then 'Support call'
        when 'whatsapp' then 'WhatsApp enquiry'
        when 'sms' then 'SMS enquiry'
        when 'email' then 'Email enquiry'
        when 'web_chat' then 'Web chat enquiry'
        else 'Support request'
      end
    );
    insert into public.support_tickets (customer_id, subject, category, channel, priority, status, queue_id, source_reference)
    values (v_customer, left(v_subject, 200), v_category, p_channel, v_priority, 'queued', v_queue, p_source_reference)
    returning * into v_ticket;
    v_created := true;
    insert into public.support_ticket_events (ticket_id, event_type, payload)
    values (v_ticket.id, 'ticket_created', jsonb_build_object('channel', p_channel, 'provider', p_provider, 'category', v_category, 'priority', v_priority));
  elsif p_direction = 'inbound' and v_priority < v_ticket.priority and v_ticket.status not in ('resolved','closed') then
    -- P0 sorts before P1 etc., so a lower string means more urgent.
    update public.support_tickets set priority = v_priority where id = v_ticket.id
    returning * into v_ticket;
  end if;

  insert into public.support_interactions
    (ticket_id, customer_id, channel, direction, provider, provider_interaction_id, body, metadata, occurred_at)
  values
    (v_ticket.id, v_customer, p_channel, p_direction, p_provider, p_external_id, p_body, coalesce(p_metadata, '{}'::jsonb), coalesce(p_occurred_at, now()))
  on conflict (provider, provider_interaction_id) do nothing
  returning id into v_interaction;

  if v_interaction is null then
    select i.id into v_interaction from public.support_interactions i
     where i.provider = p_provider and i.provider_interaction_id = p_external_id;
    return query select v_ticket.id, v_interaction, v_customer, v_ticket.public_id, false, true;
    return;
  end if;

  return query select v_ticket.id, v_interaction, v_customer, v_ticket.public_id, v_created, false;
end;
$$;

-- Service-role presence setter. The browser never writes presence; it asks the
-- Edge Function, which calls this and then mirrors the state into TaskRouter.
create or replace function public.support_set_presence(
  p_employee uuid, p_state text, p_reason text default null, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent public.support_agents%rowtype;
  v_on_shift boolean;
begin
  if p_state not in ('available','busy','on_call','wrap_up','break','away','offline') then
    raise exception 'invalid presence state';
  end if;
  select * into v_agent from public.support_agents where employee_id = p_employee;
  if not found or not v_agent.enabled then
    raise exception 'not_provisioned: this employee is not an enabled Support officer';
  end if;
  v_on_shift := public.support_is_employee_on_shift(p_employee, now());
  if p_state = 'available' and not v_on_shift then
    raise exception 'not_on_shift: you can only go Available during your assigned shift';
  end if;

  insert into public.support_agent_presence (employee_id, state, state_reason, state_changed_at, active_shift, last_seen_at, updated_at)
  values (p_employee, p_state, p_reason, now(), v_on_shift, now(), now())
  on conflict (employee_id) do update
    set state = excluded.state,
        state_reason = excluded.state_reason,
        state_changed_at = case when public.support_agent_presence.state is distinct from excluded.state then now() else public.support_agent_presence.state_changed_at end,
        active_shift = excluded.active_shift,
        voice_active = case when excluded.state in ('offline','away','break','available') then 0 else public.support_agent_presence.voice_active end,
        last_seen_at = now(),
        updated_at = now();

  return jsonb_build_object('state', p_state, 'on_shift', v_on_shift, 'reason', p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Staff RPCs (called from the browser; every one re-checks the caller)
-- ---------------------------------------------------------------------------

create or replace function public.support_heartbeat()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.support_agent_presence%rowtype;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  update public.support_agent_presence
     set last_seen_at = now(),
         active_shift = public.support_is_employee_on_shift(employee_id, now())
   where employee_id = auth.uid()
   returning * into v_row;
  if not found then
    return jsonb_build_object('provisioned', false, 'supervisor', public.support_is_supervisor(auth.uid()));
  end if;
  return jsonb_build_object(
    'provisioned', true,
    'state', v_row.state,
    'reason', v_row.state_reason,
    'changed_at', v_row.state_changed_at,
    'on_shift', v_row.active_shift,
    'supervisor', public.support_is_supervisor(auth.uid())
  );
end;
$$;

create or replace function public.support_claim_ticket(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ticket public.support_tickets%rowtype;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  if not exists (select 1 from public.support_agents where employee_id = auth.uid() and enabled) then
    raise exception 'only provisioned Support officers can take tickets';
  end if;
  select * into v_ticket from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'ticket not found'; end if;
  if v_ticket.status in ('resolved','closed') then raise exception 'ticket is already resolved'; end if;
  if v_ticket.assigned_agent_id is not null and v_ticket.assigned_agent_id <> auth.uid() then
    raise exception 'ticket is already assigned to another officer';
  end if;
  update public.support_tickets
     set assigned_agent_id = auth.uid(),
         status = case when status in ('new','queued') then 'assigned' else status end
   where id = p_ticket;
end;
$$;

create or replace function public.support_assign_ticket(p_ticket uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  if p_to is not null and not exists (select 1 from public.support_agents where employee_id = p_to and enabled) then
    raise exception 'target is not an enabled Support officer';
  end if;
  update public.support_tickets
     set assigned_agent_id = p_to,
         status = case
           when p_to is null and status in ('assigned','in_progress') then 'queued'
           when p_to is not null and status in ('new','queued') then 'assigned'
           else status end
   where id = p_ticket;
  if not found then raise exception 'ticket not found'; end if;
  perform public.support_write_audit(auth.uid(), 'ticket_assigned', 'ticket', p_ticket::text, jsonb_build_object('to', p_to));
end;
$$;

create or replace function public.support_update_ticket(
  p_ticket uuid,
  p_status text default null,
  p_priority text default null,
  p_category text default null,
  p_subject text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_super boolean := public.support_is_supervisor(auth.uid());
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'ticket not found'; end if;

  if not v_super and v_ticket.assigned_agent_id is not null and v_ticket.assigned_agent_id <> auth.uid() then
    raise exception 'this ticket belongs to another officer';
  end if;

  if p_status is not null then
    if p_status not in ('in_progress','waiting_customer','waiting_internal','escalated','resolved','closed','reopened') then
      raise exception 'status % cannot be set manually', p_status;
    end if;
    if p_status = 'reopened' and v_ticket.status not in ('resolved','closed') then
      raise exception 'only resolved or closed tickets can be reopened';
    end if;
    if p_status = 'closed' and v_ticket.status <> 'resolved' and not v_super then
      raise exception 'resolve the ticket before closing it';
    end if;
  end if;
  if p_priority is not null and p_priority not in ('P0','P1','P2','P3','P4') then
    raise exception 'invalid priority';
  end if;
  if p_category is not null and p_category !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'invalid category';
  end if;

  update public.support_tickets
     set status = coalesce(p_status, status),
         priority = coalesce(p_priority, priority),
         category = coalesce(p_category, category),
         subject = coalesce(nullif(btrim(p_subject), ''), subject),
         assigned_agent_id = case
           when assigned_agent_id is null and exists (select 1 from public.support_agents where employee_id = auth.uid() and enabled)
             then auth.uid()
           else assigned_agent_id end
   where id = p_ticket;
end;
$$;

create or replace function public.support_add_note(p_ticket uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  if not exists (select 1 from public.support_tickets where id = p_ticket) then raise exception 'ticket not found'; end if;
  insert into public.support_ticket_notes (ticket_id, author_id, body)
  values (p_ticket, auth.uid(), btrim(p_body))
  returning id into v_id;
  insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
  values (p_ticket, auth.uid(), 'note_added', jsonb_build_object('note_id', v_id));
  update public.support_tickets set updated_at = now() where id = p_ticket;
  return v_id;
end;
$$;

-- Everything the ticket drawer needs, in one round trip.
create or replace function public.support_ticket_detail(p_ticket uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_result jsonb;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket;
  if not found then return null; end if;

  select jsonb_build_object(
    'ticket', to_jsonb(v_ticket) || jsonb_build_object(
      'assigned_agent_name', (select ep.full_name from public.employee_profiles ep where ep.id = v_ticket.assigned_agent_id),
      'queue_name', (select q.name from public.support_queues q where q.id = v_ticket.queue_id)
    ),
    'customer', (
      select to_jsonb(c) || jsonb_build_object(
        'identities', coalesce((select jsonb_agg(jsonb_build_object('type', i.identity_type, 'value', i.identity_value) order by i.created_at)
                                  from public.support_customer_identities i where i.customer_id = c.id), '[]'::jsonb),
        'ticket_count', (select count(*) from public.support_tickets t where t.customer_id = c.id)
      )
      from public.support_customers c where c.id = v_ticket.customer_id
    ),
    'interactions', coalesce((
      select jsonb_agg(x order by x.occurred_at) from (
        select i.id, i.channel, i.direction, i.body, i.metadata, i.occurred_at
          from public.support_interactions i where i.ticket_id = p_ticket
         order by i.occurred_at desc limit 200
      ) x), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(x order by x.created_at) from (
        select n.id, n.body, n.created_at, ep.full_name as author_name
          from public.support_ticket_notes n
          left join public.employee_profiles ep on ep.id = n.author_id
         where n.ticket_id = p_ticket order by n.created_at desc limit 100
      ) x), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(x order by x.created_at) from (
        select e.id, e.event_type, e.payload, e.created_at, ep.full_name as actor_name
          from public.support_ticket_events e
          left join public.employee_profiles ep on ep.id = e.actor_id
         where e.ticket_id = p_ticket order by e.created_at desc limit 100
      ) x), '[]'::jsonb),
    'related', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select t.id, t.public_id, t.subject, t.status, t.priority, t.channel, t.created_at
          from public.support_tickets t
         where t.customer_id = v_ticket.customer_id and t.id <> p_ticket
         order by t.created_at desc limit 10
      ) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Views (read model for the UI)
--    These run with the owner's rights so they can show employee names to
--    Support staff without depending on employee_profiles policies; every
--    one filters on support_is_staff() itself.
-- ---------------------------------------------------------------------------

drop view if exists public.support_agent_presence_view;
create view public.support_agent_presence_view as
select
  a.employee_id,
  ep.full_name as display_name,
  a.is_supervisor,
  case
    when p.state is null then 'offline'
    when p.state in ('available','busy') and coalesce(p.last_seen_at, 'epoch'::timestamptz) < now() - interval '120 seconds' then 'offline'
    else p.state
  end as state,
  p.state as raw_state,
  p.state_reason,
  p.state_changed_at,
  public.support_is_employee_on_shift(a.employee_id, now()) as active_shift,
  a.voice_capacity,
  coalesce(p.voice_active, 0) as voice_active,
  a.messaging_capacity,
  (select count(*) from public.support_tickets mt
    where mt.assigned_agent_id = a.employee_id and mt.channel <> 'voice'
      and mt.status in ('assigned','in_progress','escalated','waiting_internal'))::int as messaging_active,
  a.skills,
  a.languages,
  p.last_seen_at
from public.support_agents a
join public.employee_profiles ep on ep.id = a.employee_id and ep.active
left join public.support_agent_presence p on p.employee_id = a.employee_id
where a.enabled and public.support_is_staff(auth.uid());

drop view if exists public.support_queue_snapshot_view;
create view public.support_queue_snapshot_view as
select
  q.id, q.name, q.channel, q.priority as queue_priority,
  count(t.id) filter (where t.status in ('new','queued'))::int as waiting,
  count(t.id) filter (
    where t.status not in ('resolved','closed')
      and t.first_responded_at is null
      and t.first_response_due_at is not null
      and t.first_response_due_at > now()
      and t.first_response_due_at <= now() + interval '10 minutes'
  )::int as sla_at_risk,
  count(t.id) filter (
    where t.status not in ('resolved','closed')
      and ((t.first_responded_at is null and t.first_response_due_at < now()) or t.resolution_due_at < now())
  )::int as sla_breached,
  coalesce(extract(epoch from (now() - min(t.created_at) filter (where t.status in ('new','queued'))))::int, 0) as oldest_wait_seconds
from public.support_queues q
left join public.support_tickets t on t.queue_id = q.id
where q.active and public.support_is_staff(auth.uid())
group by q.id, q.name, q.channel, q.priority;

drop view if exists public.support_ticket_summary_view;
create view public.support_ticket_summary_view as
select
  t.id, t.public_id, t.subject, t.category, t.channel, t.priority, t.status,
  t.queue_id, q.name as queue_name,
  t.customer_id, c.display_name as customer_name, c.primary_phone as customer_phone, c.primary_email as customer_email,
  t.assigned_agent_id, ep.full_name as assigned_agent_name,
  t.first_response_due_at, t.resolution_due_at, t.first_responded_at, t.last_customer_message_at,
  t.resolved_at, t.created_at, t.updated_at,
  case
    when t.status in ('resolved','closed') then 'met'
    when (t.first_responded_at is null and t.first_response_due_at < now()) or t.resolution_due_at < now() then 'breached'
    when (t.first_responded_at is null and t.first_response_due_at < now() + interval '10 minutes')
      or t.resolution_due_at < now() + interval '30 minutes' then 'at_risk'
    else 'ok'
  end as sla_state
from public.support_tickets t
left join public.support_customers c on c.id = t.customer_id
left join public.employee_profiles ep on ep.id = t.assigned_agent_id
left join public.support_queues q on q.id = t.queue_id
where public.support_is_staff(auth.uid());

-- ---------------------------------------------------------------------------
-- 10. Row level security + grants
-- ---------------------------------------------------------------------------

do $$
declare n text;
begin
  foreach n in array array[
    'support_agents','support_agent_presence','support_shifts','support_shift_assignments',
    'support_queues','support_queue_memberships','support_sla_policies','support_customers',
    'support_customer_identities','support_tickets','support_ticket_events','support_ticket_notes',
    'support_interactions','support_provider_accounts','support_audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', n);
    execute format('revoke all on table public.%I from public, anon, authenticated', n);
    execute format('grant all on table public.%I to service_role', n);
  end loop;

  foreach n in array array[
    'support_agents','support_agent_presence','support_shifts','support_shift_assignments',
    'support_queues','support_queue_memberships','support_sla_policies','support_customers',
    'support_customer_identities','support_tickets','support_ticket_events','support_ticket_notes',
    'support_interactions'
  ] loop
    execute format('drop policy if exists support_staff_read on public.%I', n);
    execute format('create policy support_staff_read on public.%I for select to authenticated using (public.support_is_staff(auth.uid()))', n);
    execute format('grant select on table public.%I to authenticated', n);
  end loop;
end $$;

-- The audit trail is for supervisors only.
drop policy if exists support_supervisor_read on public.support_audit_log;
create policy support_supervisor_read on public.support_audit_log
  for select to authenticated using (public.support_is_supervisor(auth.uid()));
grant select on public.support_audit_log to authenticated;

revoke all on public.support_agent_presence_view, public.support_queue_snapshot_view, public.support_ticket_summary_view
  from public, anon, authenticated;
grant select on public.support_agent_presence_view, public.support_queue_snapshot_view, public.support_ticket_summary_view
  to authenticated, service_role;

-- Sequence used by the ticket number default.
revoke all on sequence public.support_ticket_number_seq from public, anon, authenticated;
grant usage, select on sequence public.support_ticket_number_seq to service_role;

-- ---------------------------------------------------------------------------
-- 11. Function privileges (explicit list; nothing is callable by accident)
-- ---------------------------------------------------------------------------

revoke all on function public.support_write_audit(uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.support_resolve_customer(text,text,text) from public, anon, authenticated;
revoke all on function public.support_ingest_interaction(text,text,text,text,text,text,text,text,text,jsonb,text,text,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.support_set_presence(uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.support_is_staff(uuid) from public, anon;
revoke all on function public.support_is_supervisor(uuid) from public, anon;
revoke all on function public.support_is_employee_on_shift(uuid,timestamptz) from public, anon;
revoke all on function public.support_heartbeat() from public, anon;
revoke all on function public.support_claim_ticket(uuid) from public, anon;
revoke all on function public.support_assign_ticket(uuid,uuid) from public, anon;
revoke all on function public.support_update_ticket(uuid,text,text,text,text) from public, anon;
revoke all on function public.support_add_note(uuid,text) from public, anon;
revoke all on function public.support_ticket_detail(uuid) from public, anon;

grant execute on function public.support_write_audit(uuid,text,text,text,jsonb) to service_role;
grant execute on function public.support_resolve_customer(text,text,text) to service_role;
grant execute on function public.support_ingest_interaction(text,text,text,text,text,text,text,text,text,jsonb,text,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.support_set_presence(uuid,text,text,uuid) to service_role;
grant execute on function public.support_is_staff(uuid) to authenticated, service_role;
grant execute on function public.support_is_supervisor(uuid) to authenticated, service_role;
grant execute on function public.support_is_employee_on_shift(uuid,timestamptz) to authenticated, service_role;
grant execute on function public.support_heartbeat() to authenticated;
grant execute on function public.support_claim_ticket(uuid) to authenticated;
grant execute on function public.support_assign_ticket(uuid,uuid) to authenticated;
grant execute on function public.support_update_ticket(uuid,text,text,text,text) to authenticated;
grant execute on function public.support_add_note(uuid,text) to authenticated;
grant execute on function public.support_ticket_detail(uuid) to authenticated;

commit;
