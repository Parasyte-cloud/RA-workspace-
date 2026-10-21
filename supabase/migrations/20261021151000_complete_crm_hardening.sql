begin;

alter table public.crm_members
  add column if not exists phone_e164 text,
  add column if not exists team text default 'Support',
  add column if not exists shift text,
  add column if not exists availability text not null default 'offline';

alter table public.crm_members drop constraint if exists crm_members_phone_e164_check;
alter table public.crm_members add constraint crm_members_phone_e164_check check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
alter table public.crm_members drop constraint if exists crm_members_availability_check;
alter table public.crm_members add constraint crm_members_availability_check check (availability in ('offline','available','busy','away'));

alter table public.crm_calls
  add column if not exists status text,
  add column if not exists disposition text,
  add column if not exists recording_provider_id text;

-- Supervisors need the team directory for assignment and reporting.

-- Supervisors may triage inbound calls that have not yet matched a ticket.
drop policy if exists crm_calls_ticket_scope_read on public.crm_calls;
create policy crm_calls_ticket_scope_read on public.crm_calls for select to authenticated
using (public.crm_is_supervisor(auth.uid()) or (ticket_id is not null and public.crm_can_access_ticket(ticket_id,auth.uid())));

drop policy if exists crm_members_self_or_admin_read on public.crm_members;
create policy crm_members_self_or_supervisor_read on public.crm_members for select to authenticated
using (user_id=auth.uid() or public.crm_is_supervisor(auth.uid()));

create or replace function public.crm_create_driver_ticket_v2(
  p_full_name text,
  p_phone_e164 text,
  p_area text default null,
  p_email text default null,
  p_vehicle_make text default null,
  p_vehicle_model text default null,
  p_vehicle_year integer default null,
  p_registration_number text default null,
  p_vehicle_ownership text default null,
  p_source text default 'manual',
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
  if length(btrim(coalesce(p_full_name,''))) < 1 then raise exception 'Driver name is required'; end if;
  if p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Phone must be E.164'; end if;
  if p_vehicle_year is not null and (p_vehicle_year < 1980 or p_vehicle_year > 2100) then raise exception 'Invalid vehicle year'; end if;
  if p_assigned_to is not null and p_assigned_to <> v_actor and not public.crm_is_supervisor(v_actor) then
    raise exception 'Only supervisors can assign another representative';
  end if;
  if p_assigned_to is not null and not exists(select 1 from public.crm_members where user_id=p_assigned_to and active) then
    raise exception 'Assignee is not an active CRM member';
  end if;

  select id into v_contact from public.crm_contacts where phone_e164=p_phone_e164 limit 1;
  if v_contact is null then
    insert into public.crm_contacts(full_name,phone_e164,email,area,created_by)
    values (btrim(p_full_name),p_phone_e164,nullif(lower(btrim(p_email)),''),nullif(btrim(p_area),''),v_actor)
    returning id into v_contact;
  else
    update public.crm_contacts set
      full_name = coalesce(nullif(btrim(p_full_name),''), full_name),
      email = coalesce(nullif(lower(btrim(p_email)),''), email),
      area = coalesce(nullif(btrim(p_area),''), area)
    where id=v_contact;
  end if;

  if p_status_id is null then
    select id into v_status from public.crm_statuses where code='to_contact' and active order by sort_order limit 1;
  else
    select id into v_status from public.crm_statuses where id=p_status_id and active;
    if v_status is null then raise exception 'Invalid driver status'; end if;
  end if;

  insert into public.crm_driver_profiles(contact_id,vehicle_make,vehicle_model,vehicle_year,registration_number,vehicle_ownership,source,current_status_id)
  values(v_contact,nullif(btrim(p_vehicle_make),''),nullif(btrim(p_vehicle_model),''),p_vehicle_year,nullif(upper(btrim(p_registration_number)),''),nullif(btrim(p_vehicle_ownership),''),coalesce(nullif(btrim(p_source),''),'manual'),v_status)
  on conflict(contact_id) do update set
    vehicle_make=coalesce(excluded.vehicle_make,crm_driver_profiles.vehicle_make),
    vehicle_model=coalesce(excluded.vehicle_model,crm_driver_profiles.vehicle_model),
    vehicle_year=coalesce(excluded.vehicle_year,crm_driver_profiles.vehicle_year),
    registration_number=coalesce(excluded.registration_number,crm_driver_profiles.registration_number),
    vehicle_ownership=coalesce(excluded.vehicle_ownership,crm_driver_profiles.vehicle_ownership),
    source=coalesce(excluded.source,crm_driver_profiles.source),
    current_status_id=coalesce(excluded.current_status_id,crm_driver_profiles.current_status_id);

  select id into v_ticket from public.crm_tickets
  where contact_id=v_contact and state not in ('resolved','closed')
  order by created_at desc limit 1;

  if v_ticket is null then
    insert into public.crm_tickets(contact_id,assigned_to,opened_by,state)
    values(v_contact,coalesce(p_assigned_to,v_actor),v_actor,'open') returning id into v_ticket;
    insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,new_value)
    values('ticket',v_ticket,'ticket.created',v_actor,jsonb_build_object('contact_id',v_contact,'assigned_to',coalesce(p_assigned_to,v_actor)));
  elsif p_assigned_to is not null and public.crm_is_supervisor(v_actor) then
    update public.crm_tickets set assigned_to=p_assigned_to where id=v_ticket;
  end if;
  return v_ticket;
end $$;

grant execute on function public.crm_create_driver_ticket_v2(text,text,text,text,text,text,integer,text,text,text,uuid,uuid) to authenticated;

create or replace function public.crm_update_ticket_state(p_ticket uuid,p_state public.crm_ticket_state)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_old public.crm_ticket_state;
begin
  if not public.crm_can_access_ticket(p_ticket,v_actor) then raise exception 'Ticket access denied'; end if;
  select state into v_old from public.crm_tickets where id=p_ticket;
  update public.crm_tickets set state=p_state, closed_at=case when p_state in ('resolved','closed') then now() else null end where id=p_ticket;
  insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,old_value,new_value)
  values('ticket',p_ticket,'ticket.state_changed',v_actor,jsonb_build_object('state',v_old),jsonb_build_object('state',p_state));
end $$;

grant execute on function public.crm_update_ticket_state(uuid,public.crm_ticket_state) to authenticated;

create or replace function public.crm_update_driver_contact(
  p_ticket uuid,
  p_full_name text,
  p_email text default null,
  p_area text default null,
  p_secondary_phone text default null,
  p_vehicle_make text default null,
  p_vehicle_model text default null,
  p_vehicle_year integer default null,
  p_registration_number text default null,
  p_vehicle_ownership text default null,
  p_source text default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_contact uuid;
begin
  if not public.crm_can_access_ticket(p_ticket,v_actor) then raise exception 'Ticket access denied'; end if;
  if p_secondary_phone is not null and p_secondary_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Secondary phone must be E.164'; end if;
  select contact_id into v_contact from public.crm_tickets where id=p_ticket;
  update public.crm_contacts set
    full_name=coalesce(nullif(btrim(p_full_name),''),full_name),
    email=nullif(lower(btrim(p_email)),''),
    area=nullif(btrim(p_area),''),
    secondary_phone_e164=nullif(btrim(p_secondary_phone),'')
  where id=v_contact;
  update public.crm_driver_profiles set
    vehicle_make=nullif(btrim(p_vehicle_make),''), vehicle_model=nullif(btrim(p_vehicle_model),''), vehicle_year=p_vehicle_year,
    registration_number=nullif(upper(btrim(p_registration_number)),''), vehicle_ownership=nullif(btrim(p_vehicle_ownership),''), source=coalesce(nullif(btrim(p_source),''),source)
  where contact_id=v_contact;
  insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,new_value)
  values('driver',v_contact,'driver.profile_updated',v_actor,jsonb_build_object('ticket_id',p_ticket));
end $$;

grant execute on function public.crm_update_driver_contact(uuid,text,text,text,text,text,text,integer,text,text,text) to authenticated;

create or replace function public.crm_upsert_member(
  p_user uuid,
  p_display_name text,
  p_role public.crm_role,
  p_active boolean,
  p_phone_e164 text default null,
  p_team text default null,
  p_shift text default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid();
begin
  if not public.crm_is_admin(v_actor) then raise exception 'Admin access required'; end if;
  if not exists(select 1 from auth.users where id=p_user) then raise exception 'Auth user not found'; end if;
  if p_phone_e164 is not null and p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Phone must be E.164'; end if;
  insert into public.crm_members(user_id,display_name,role,active,phone_e164,team,shift)
  values(p_user,btrim(p_display_name),p_role,p_active,p_phone_e164,nullif(btrim(p_team),''),nullif(btrim(p_shift),''))
  on conflict(user_id) do update set display_name=excluded.display_name,role=excluded.role,active=excluded.active,phone_e164=excluded.phone_e164,team=excluded.team,shift=excluded.shift;
  insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,new_value)
  values('member',p_user,'member.upserted',v_actor,jsonb_build_object('role',p_role,'active',p_active));
end $$;

grant execute on function public.crm_upsert_member(uuid,text,public.crm_role,boolean,text,text,text) to authenticated;

create or replace function public.crm_set_availability(p_availability text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid();
begin
  if p_availability not in ('offline','available','busy','away') then raise exception 'Invalid availability'; end if;
  if not public.crm_is_member(v_actor) then raise exception 'CRM access denied'; end if;
  update public.crm_members set availability=p_availability where user_id=v_actor;
end $$;

grant execute on function public.crm_set_availability(text) to authenticated;

create or replace function public.crm_set_call_disposition(p_call uuid,p_disposition text,p_outcome text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_ticket uuid;
begin
  select ticket_id into v_ticket from public.crm_calls where id=p_call;
  if not public.crm_is_supervisor(v_actor) and (v_ticket is null or not public.crm_can_access_ticket(v_ticket,v_actor)) then raise exception 'Call access denied'; end if;
  update public.crm_calls set disposition=nullif(btrim(p_disposition),''), outcome=coalesce(nullif(btrim(p_outcome),''),outcome) where id=p_call;
  insert into public.crm_audit_events(entity_type,entity_id,action,actor_user_id,new_value)
  values('call',p_call,'call.disposition_set',v_actor,jsonb_build_object('disposition',p_disposition,'outcome',p_outcome));
end $$;

grant execute on function public.crm_set_call_disposition(uuid,text,text) to authenticated;

commit;
