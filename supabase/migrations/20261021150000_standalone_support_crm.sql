begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.crm_role as enum ('representative','supervisor','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_ticket_state as enum ('new','open','in_progress','waiting','resolved','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_call_direction as enum ('inbound','outbound');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.crm_role not null default 'representative',
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_statuses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  description text,
  active boolean not null default true,
  is_terminal boolean not null default false,
  is_success boolean not null default false,
  sort_order integer not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 160),
  phone_e164 text not null unique check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  secondary_phone_e164 text,
  email text,
  area text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_driver_profiles (
  contact_id uuid primary key references public.crm_contacts(id) on delete cascade,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer check (vehicle_year is null or vehicle_year between 1980 and 2100),
  registration_number text,
  vehicle_ownership text,
  source text,
  current_status_id uuid references public.crm_statuses(id) on delete set null,
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('DRV-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  subject text not null default 'Driver outreach',
  state public.crm_ticket_state not null default 'new',
  assigned_to uuid references auth.users(id) on delete set null,
  priority smallint not null default 2 check (priority between 1 and 4),
  opened_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_tickets_assigned_state_idx on public.crm_tickets(assigned_to,state,updated_at desc);
create index if not exists crm_tickets_contact_idx on public.crm_tickets(contact_id,updated_at desc);

create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.crm_tickets(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  author_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists crm_notes_ticket_idx on public.crm_notes(ticket_id,created_at desc);

create table if not exists public.crm_followups (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.crm_tickets(id) on delete cascade,
  action text not null check (char_length(btrim(action)) between 1 and 1000),
  due_at timestamptz not null,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (completed_at is not null and cancelled_at is not null))
);
create index if not exists crm_followups_open_due_idx on public.crm_followups(due_at,ticket_id)
  where completed_at is null and cancelled_at is null;

create table if not exists public.crm_calls (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'pending',
  provider_call_id text,
  ticket_id uuid references public.crm_tickets(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  representative_id uuid references auth.users(id) on delete set null,
  direction public.crm_call_direction not null,
  from_number text,
  to_number text,
  outcome text,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  recording_object_path text,
  created_at timestamptz not null default now(),
  unique(provider,provider_call_id)
);
create index if not exists crm_calls_contact_idx on public.crm_calls(contact_id,started_at desc);
create index if not exists crm_calls_ticket_idx on public.crm_calls(ticket_id,started_at desc);

create table if not exists public.crm_audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  old_value jsonb,
  new_value jsonb,
  source text not null default 'crm',
  request_id text,
  created_at timestamptz not null default now()
);
create index if not exists crm_audit_events_entity_idx on public.crm_audit_events(entity_type,entity_id,created_at desc);

create or replace function public.crm_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace trigger crm_members_touch before update on public.crm_members
for each row execute function public.crm_touch_updated_at();
create or replace trigger crm_statuses_touch before update on public.crm_statuses
for each row execute function public.crm_touch_updated_at();
create or replace trigger crm_contacts_touch before update on public.crm_contacts
for each row execute function public.crm_touch_updated_at();
create or replace trigger crm_driver_profiles_touch before update on public.crm_driver_profiles
for each row execute function public.crm_touch_updated_at();
create or replace trigger crm_tickets_touch before update on public.crm_tickets
for each row execute function public.crm_touch_updated_at();
create or replace trigger crm_followups_touch before update on public.crm_followups
for each row execute function public.crm_touch_updated_at();

create or replace function public.crm_is_member(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.crm_members m where m.user_id=p_user and m.active);
$$;

create or replace function public.crm_role_of(p_user uuid default auth.uid())
returns public.crm_role language sql stable security definer set search_path = public as $$
  select m.role from public.crm_members m where m.user_id=p_user and m.active limit 1;
$$;

create or replace function public.crm_is_supervisor(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_role_of(p_user) in ('supervisor','admin'),false);
$$;

create or replace function public.crm_is_admin(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_role_of(p_user)='admin',false);
$$;

create or replace function public.crm_can_access_ticket(p_ticket uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.crm_tickets t
    where t.id=p_ticket
      and public.crm_is_member(p_user)
      and (public.crm_is_supervisor(p_user) or t.assigned_to=p_user or t.opened_by=p_user)
  );
$$;

revoke all on function public.crm_is_member(uuid) from public;
revoke all on function public.crm_role_of(uuid) from public;
revoke all on function public.crm_is_supervisor(uuid) from public;
revoke all on function public.crm_is_admin(uuid) from public;
revoke all on function public.crm_can_access_ticket(uuid,uuid) from public;
grant execute on function public.crm_is_member(uuid) to authenticated;
grant execute on function public.crm_role_of(uuid) to authenticated;
grant execute on function public.crm_is_supervisor(uuid) to authenticated;
grant execute on function public.crm_is_admin(uuid) to authenticated;
grant execute on function public.crm_can_access_ticket(uuid,uuid) to authenticated;

alter table public.crm_members enable row level security;
alter table public.crm_statuses enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_driver_profiles enable row level security;
alter table public.crm_tickets enable row level security;
alter table public.crm_notes enable row level security;
alter table public.crm_followups enable row level security;
alter table public.crm_calls enable row level security;
alter table public.crm_audit_events enable row level security;

revoke all on public.crm_members, public.crm_statuses, public.crm_contacts, public.crm_driver_profiles,
  public.crm_tickets, public.crm_notes, public.crm_followups, public.crm_calls, public.crm_audit_events
  from public, anon, authenticated;
grant all on public.crm_members, public.crm_statuses, public.crm_contacts, public.crm_driver_profiles,
  public.crm_tickets, public.crm_notes, public.crm_followups, public.crm_calls, public.crm_audit_events
  to service_role;
grant select on public.crm_members, public.crm_statuses, public.crm_contacts, public.crm_driver_profiles,
  public.crm_tickets, public.crm_notes, public.crm_followups, public.crm_calls, public.crm_audit_events
  to authenticated;

create policy crm_members_self_or_admin_read on public.crm_members for select to authenticated
using (user_id=auth.uid() or public.crm_is_admin(auth.uid()));

create policy crm_statuses_member_read on public.crm_statuses for select to authenticated
using (public.crm_is_member(auth.uid()));

create policy crm_tickets_scope_read on public.crm_tickets for select to authenticated
using (public.crm_is_supervisor(auth.uid()) or assigned_to=auth.uid() or opened_by=auth.uid());

create policy crm_contacts_ticket_scope_read on public.crm_contacts for select to authenticated
using (exists(select 1 from public.crm_tickets t where t.contact_id=crm_contacts.id and public.crm_can_access_ticket(t.id,auth.uid())));

create policy crm_driver_profiles_ticket_scope_read on public.crm_driver_profiles for select to authenticated
using (exists(select 1 from public.crm_tickets t where t.contact_id=crm_driver_profiles.contact_id and public.crm_can_access_ticket(t.id,auth.uid())));

create policy crm_notes_ticket_scope_read on public.crm_notes for select to authenticated
using (public.crm_can_access_ticket(ticket_id,auth.uid()));

create policy crm_followups_ticket_scope_read on public.crm_followups for select to authenticated
using (public.crm_can_access_ticket(ticket_id,auth.uid()));

create policy crm_calls_ticket_scope_read on public.crm_calls for select to authenticated
using (ticket_id is not null and public.crm_can_access_ticket(ticket_id,auth.uid()));

create policy crm_audit_supervisor_read on public.crm_audit_events for select to authenticated
using (public.crm_is_supervisor(auth.uid()));

create or replace function public.crm_create_driver_ticket(
  p_full_name text,
  p_phone_e164 text,
  p_area text default null,
  p_vehicle_make text default null,
  p_vehicle_model text default null,
  p_assigned_to uuid default null,
  p_status_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid;
  v_ticket uuid;
  v_status uuid;
  v_actor uuid := auth.uid();
begin
  if not public.crm_is_member(v_actor) then raise exception 'CRM access denied'; end if;
  if p_assigned_to is not null and p_assigned_to <> v_actor and not public.crm_is_supervisor(v_actor) then
    raise exception 'Only supervisors can assign another representative';
  end if;
  if p_phone_e164 !~ '^\\+[1-9][0-9]{7,14}$' then raise exception 'Phone must be E.164'; end if;

  select id into v_contact from public.crm_contacts where phone_e164=p_phone_e164 limit 1;
  if v_contact is null then
    insert into public.crm_contacts(full_name,phone_e164,area,created_by)
    values (btrim(p_full_name),p_phone_e164,nullif(btrim(p_area),''),v_actor)
    returning id into v_contact;
  end if;

  if p_status_id is null then
    select id into v_status from public.crm_statuses where code='to_contact' and active order by sort_order limit 1;
  else
    select id into v_status from public.crm_statuses where id=p_status_id and active;
  end if;

  insert into public.crm_driver_profiles(contact_id,vehicle_make,vehicle_model,current_status_id)
  values(v_contact,nullif(btrim(p_vehicle_make),''),nullif(btrim(p_vehicle_model),''),v_status)
  on conflict(contact_id) do update set
    vehicle_make=coalesce(excluded.vehicle_make,crm_driver_profiles.vehicle_make),
    vehicle_model=coalesce(excluded.vehicle_model,crm_driver_profiles.vehicle_model),
    current_status_id=coalesce(excluded.current_status_id,crm_driver_profiles.current_status_id);

  select id into v_ticket from public.crm_tickets
    where contact_id=v_contact and state not in ('resolved','closed')
    order by created_at desc limit 1;
  if v_ticket is null then
    insert into public.crm_tickets(contact_id,assigned_to,opened_by,state)
    values(v_contact,coalesce(p_assigned_to,v_actor),v_actor,'open') returning id into v_ticket;
    insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,new_value)
    values('ticket',v_ticket,'ticket.created',v_actor,jsonb_build_object('contact_id',v_contact));
  end if;
  return v_ticket;
end $$;

create or replace function public.crm_add_note(p_ticket uuid,p_body text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_actor uuid:=auth.uid();
begin
  if not public.crm_can_access_ticket(p_ticket,v_actor) then raise exception 'Ticket access denied'; end if;
  insert into public.crm_notes(ticket_id,body,author_id) values(p_ticket,btrim(p_body),v_actor) returning id into v_id;
  insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,new_value)
  values('ticket',p_ticket,'note.created',v_actor,jsonb_build_object('note_id',v_id));
  return v_id;
end $$;

create or replace function public.crm_create_followup(p_ticket uuid,p_action text,p_due_at timestamptz,p_assigned_to uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_actor uuid:=auth.uid(); v_owner uuid;
begin
  if not public.crm_can_access_ticket(p_ticket,v_actor) then raise exception 'Ticket access denied'; end if;
  if p_assigned_to is not null and p_assigned_to<>v_actor and not public.crm_is_supervisor(v_actor) then raise exception 'Only supervisors can assign another representative'; end if;
  select assigned_to into v_owner from public.crm_tickets where id=p_ticket;
  insert into public.crm_followups(ticket_id,action,due_at,assigned_to,created_by)
  values(p_ticket,btrim(p_action),p_due_at,coalesce(p_assigned_to,v_owner,v_actor),v_actor) returning id into v_id;
  insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,new_value)
  values('ticket',p_ticket,'followup.created',v_actor,jsonb_build_object('followup_id',v_id,'due_at',p_due_at));
  return v_id;
end $$;

create or replace function public.crm_complete_followup(p_followup uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_ticket uuid; v_owner uuid;
begin
  select ticket_id,assigned_to into v_ticket,v_owner from public.crm_followups where id=p_followup;
  if v_ticket is null then raise exception 'Follow-up not found'; end if;
  if not public.crm_is_supervisor(v_actor) and v_owner<>v_actor then raise exception 'Follow-up access denied'; end if;
  update public.crm_followups set completed_at=now(),completed_by=v_actor where id=p_followup and completed_at is null and cancelled_at is null;
  insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,new_value)
  values('ticket',v_ticket,'followup.completed',v_actor,jsonb_build_object('followup_id',p_followup));
end $$;

create or replace function public.crm_update_driver_status(p_contact uuid,p_status uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_ticket uuid; v_old uuid;
begin
  select id into v_ticket from public.crm_tickets where contact_id=p_contact and state not in ('resolved','closed') order by created_at desc limit 1;
  if v_ticket is null or not public.crm_can_access_ticket(v_ticket,v_actor) then raise exception 'Driver access denied'; end if;
  if not exists(select 1 from public.crm_statuses where id=p_status and active) then raise exception 'Invalid status'; end if;
  select current_status_id into v_old from public.crm_driver_profiles where contact_id=p_contact;
  update public.crm_driver_profiles set current_status_id=p_status,last_contacted_at=now() where contact_id=p_contact;
  insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,old_value,new_value)
  values('driver',p_contact,'driver.status_changed',v_actor,jsonb_build_object('status_id',v_old),jsonb_build_object('status_id',p_status));
end $$;

create or replace function public.crm_reassign_ticket(p_ticket uuid,p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_old uuid;
begin
  if not public.crm_is_supervisor(v_actor) then raise exception 'Supervisor access required'; end if;
  if not exists(select 1 from public.crm_members where user_id=p_user and active and role in ('representative','supervisor')) then raise exception 'Invalid assignee'; end if;
  select assigned_to into v_old from public.crm_tickets where id=p_ticket;
  update public.crm_tickets set assigned_to=p_user where id=p_ticket;
  update public.crm_followups set assigned_to=p_user where ticket_id=p_ticket and completed_at is null and cancelled_at is null;
  insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,old_value,new_value)
  values('ticket',p_ticket,'ticket.reassigned',v_actor,jsonb_build_object('assigned_to',v_old),jsonb_build_object('assigned_to',p_user));
end $$;

create or replace function public.crm_upsert_status(p_id uuid,p_code text,p_label text,p_description text,p_terminal boolean,p_success boolean,p_active boolean,p_sort integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_id uuid;
begin
  if not public.crm_is_admin(v_actor) then raise exception 'Admin access required'; end if;
  if p_id is null then
    insert into public.crm_statuses(code,label,description,is_terminal,is_success,active,sort_order,created_by)
    values(lower(btrim(p_code)),btrim(p_label),nullif(btrim(p_description),''),p_terminal,p_success,p_active,p_sort,v_actor)
    returning id into v_id;
  else
    update public.crm_statuses set code=lower(btrim(p_code)),label=btrim(p_label),description=nullif(btrim(p_description),''),
      is_terminal=p_terminal,is_success=p_success,active=p_active,sort_order=p_sort where id=p_id returning id into v_id;
  end if;
  return v_id;
end $$;

grant execute on function public.crm_create_driver_ticket(text,text,text,text,text,uuid,uuid) to authenticated;
grant execute on function public.crm_add_note(uuid,text) to authenticated;
grant execute on function public.crm_create_followup(uuid,text,timestamptz,uuid) to authenticated;
grant execute on function public.crm_complete_followup(uuid) to authenticated;
grant execute on function public.crm_update_driver_status(uuid,uuid) to authenticated;
grant execute on function public.crm_reassign_ticket(uuid,uuid) to authenticated;
grant execute on function public.crm_upsert_status(uuid,text,text,text,boolean,boolean,boolean,integer) to authenticated;

insert into public.crm_statuses(code,label,description,is_terminal,is_success,sort_order)
values
 ('to_contact','To Contact','Driver has not yet been reached.',false,false,10),
 ('interested','Interested','Driver is interested in joining RideArrivo.',false,true,20),
 ('follow_up','Follow Up','Driver needs another conversation or action.',false,false,30),
 ('onboarding','Onboarding','Driver is progressing through onboarding.',false,true,40),
 ('onboarded','Onboarded','Driver successfully completed onboarding.',true,true,50),
 ('not_interested','Not Interested','Driver declined the opportunity.',true,false,60)
on conflict(code) do nothing;

commit;
