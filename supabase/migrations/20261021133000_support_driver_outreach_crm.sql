-- PArAsYtE | RA-Workspace Support
-- Driver Outreach CRM layered on the existing Support Command Centre.
-- Keeps ticket lifecycle separate from the driver's business outcome/status.

begin;

create table if not exists public.support_driver_statuses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (length(btrim(label)) between 1 and 80),
  description text,
  is_terminal boolean not null default false,
  is_success boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.support_driver_statuses (code, label, description, is_terminal, is_success, sort_order)
values
  ('to_contact', 'To contact', 'Driver has been added to the outreach queue but no outcome has been recorded yet.', false, false, 5),
  ('interested', 'Interested', 'Driver is interested in joining RideArrivo.', false, false, 10),
  ('follow_up', 'Follow up', 'Driver asked to be contacted again.', false, false, 20),
  ('onboarding', 'Onboarding', 'Driver is progressing through onboarding.', false, true, 30),
  ('onboarded', 'Onboarded', 'Driver has completed onboarding.', true, true, 40),
  ('not_interested', 'Not interested', 'Driver declined the invitation.', true, false, 50)
on conflict (code) do nothing;

create table if not exists public.support_driver_cases (
  ticket_id uuid primary key references public.support_tickets(id) on delete cascade,
  customer_id uuid not null references public.support_customers(id) on delete cascade,
  driver_status_id uuid references public.support_driver_statuses(id) on delete set null,
  area text,
  vehicle_details jsonb not null default '{}'::jsonb,
  source text not null default 'outbound_recruitment',
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_driver_cases_status_idx on public.support_driver_cases (driver_status_id, updated_at desc);
create index if not exists support_driver_cases_customer_idx on public.support_driver_cases (customer_id, updated_at desc);

create table if not exists public.support_ticket_followups (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  action text not null check (length(btrim(action)) between 1 and 1000),
  due_at timestamptz not null,
  completed_at timestamptz,
  completed_by uuid references public.employee_profiles(id) on delete set null,
  cancelled_at timestamptz,
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (completed_at is not null and cancelled_at is not null))
);
create index if not exists support_ticket_followups_open_due_idx
  on public.support_ticket_followups (due_at, ticket_id)
  where completed_at is null and cancelled_at is null;

-- Reuse the existing updated_at helper.
drop trigger if exists support_driver_statuses_touch on public.support_driver_statuses;
create trigger support_driver_statuses_touch before update on public.support_driver_statuses
  for each row execute function public.support_touch_updated_at();

drop trigger if exists support_driver_cases_touch on public.support_driver_cases;
create trigger support_driver_cases_touch before update on public.support_driver_cases
  for each row execute function public.support_touch_updated_at();

drop trigger if exists support_ticket_followups_touch on public.support_ticket_followups;
create trigger support_ticket_followups_touch before update on public.support_ticket_followups
  for each row execute function public.support_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Staff RPCs
-- ---------------------------------------------------------------------------

create or replace function public.support_driver_outreach_create(
  p_name text,
  p_phone text,
  p_area text default null,
  p_vehicle_details jsonb default '{}'::jsonb,
  p_status_id uuid default null,
  p_note text default null,
  p_follow_up_action text default null,
  p_follow_up_due_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := public.support_normalize_phone(p_phone);
  v_customer uuid;
  v_ticket uuid;
  v_status uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_area text := nullif(btrim(coalesce(p_area, '')), '');
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  if v_phone is null then raise exception 'enter a valid phone number'; end if;

  v_customer := public.support_resolve_customer('phone', v_phone, v_name);
  update public.support_customers
     set display_name = coalesce(v_name, display_name),
         primary_phone = coalesce(primary_phone, v_phone)
   where id = v_customer;

  -- Reuse an open outreach case for the same driver instead of creating duplicates.
  select dc.ticket_id into v_ticket
    from public.support_driver_cases dc
    join public.support_tickets t on t.id = dc.ticket_id
   where dc.customer_id = v_customer
     and t.status not in ('resolved','closed')
   order by dc.updated_at desc
   limit 1;

  if p_status_id is not null then
    select id into v_status from public.support_driver_statuses where id = p_status_id and active;
    if v_status is null then raise exception 'invalid driver status'; end if;
  else
    select id into v_status from public.support_driver_statuses where code = 'to_contact' and active limit 1;
  end if;

  if v_ticket is null then
    insert into public.support_tickets (
      customer_id, subject, category, channel, priority, status,
      assigned_agent_id, source_reference, tags
    ) values (
      v_customer,
      left('Driver outreach — ' || coalesce(v_name, v_phone), 200),
      'driver_outreach', 'voice', 'P3', 'in_progress',
      auth.uid(), 'driver-outreach:' || v_customer::text, array['driver_outreach']::text[]
    ) returning id into v_ticket;

    insert into public.support_driver_cases (
      ticket_id, customer_id, driver_status_id, area, vehicle_details, created_by
    ) values (
      v_ticket, v_customer, v_status, v_area, coalesce(p_vehicle_details, '{}'::jsonb), auth.uid()
    );

    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (v_ticket, auth.uid(), 'driver_outreach_created', jsonb_build_object('phone', v_phone, 'area', v_area, 'status_id', v_status));
  else
    update public.support_driver_cases
       set area = coalesce(v_area, area),
           vehicle_details = case when coalesce(p_vehicle_details, '{}'::jsonb) = '{}'::jsonb then vehicle_details else p_vehicle_details end,
           driver_status_id = coalesce(v_status, driver_status_id)
     where ticket_id = v_ticket;
  end if;

  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    perform public.support_add_note(v_ticket, p_note);
  end if;

  if nullif(btrim(coalesce(p_follow_up_action, '')), '') is not null then
    if p_follow_up_due_at is null then raise exception 'follow-up due date is required'; end if;
    insert into public.support_ticket_followups (ticket_id, action, due_at, created_by)
    values (v_ticket, btrim(p_follow_up_action), p_follow_up_due_at, auth.uid());
    insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
    values (v_ticket, auth.uid(), 'follow_up_created', jsonb_build_object('action', btrim(p_follow_up_action), 'due_at', p_follow_up_due_at));
  end if;

  return v_ticket;
end;
$$;

create or replace function public.support_driver_set_status(p_ticket uuid, p_status uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old uuid;
  v_code text;
  v_terminal boolean;
  v_success boolean;
  v_owner uuid;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select t.assigned_agent_id, dc.driver_status_id
    into v_owner, v_old
    from public.support_driver_cases dc
    join public.support_tickets t on t.id = dc.ticket_id
   where dc.ticket_id = p_ticket
   for update of dc;
  if not found then raise exception 'driver outreach ticket not found'; end if;
  if not public.support_is_supervisor(auth.uid()) and v_owner is distinct from auth.uid() then
    raise exception 'this driver ticket belongs to another officer';
  end if;

  select code, is_terminal, is_success into v_code, v_terminal, v_success
    from public.support_driver_statuses where id = p_status and active;
  if v_code is null then raise exception 'invalid driver status'; end if;

  update public.support_driver_cases set driver_status_id = p_status where ticket_id = p_ticket;
  insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
  values (p_ticket, auth.uid(), 'driver_status_changed', jsonb_build_object('from', v_old, 'to', p_status, 'code', v_code));

  if v_terminal then
    update public.support_tickets
       set status = 'resolved', resolved_at = coalesce(resolved_at, now())
     where id = p_ticket and status not in ('resolved','closed');
  elsif v_success then
    update public.support_tickets
       set status = case when status in ('new','queued','assigned') then 'in_progress' else status end
     where id = p_ticket;
  end if;
end;
$$;

create or replace function public.support_driver_add_followup(p_ticket uuid, p_action text, p_due_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_owner uuid;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  if nullif(btrim(coalesce(p_action, '')), '') is null then raise exception 'follow-up action is required'; end if;
  if p_due_at is null then raise exception 'follow-up due date is required'; end if;
  select assigned_agent_id into v_owner from public.support_tickets where id = p_ticket;
  if not found then raise exception 'ticket not found'; end if;
  if not public.support_is_supervisor(auth.uid()) and v_owner is distinct from auth.uid() then
    raise exception 'this ticket belongs to another officer';
  end if;
  insert into public.support_ticket_followups (ticket_id, action, due_at, created_by)
  values (p_ticket, btrim(p_action), p_due_at, auth.uid()) returning id into v_id;
  insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
  values (p_ticket, auth.uid(), 'follow_up_created', jsonb_build_object('follow_up_id', v_id, 'due_at', p_due_at));
  update public.support_tickets set updated_at = now() where id = p_ticket;
  return v_id;
end;
$$;

create or replace function public.support_driver_complete_followup(p_followup uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ticket uuid; v_owner uuid;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select f.ticket_id, t.assigned_agent_id into v_ticket, v_owner
    from public.support_ticket_followups f join public.support_tickets t on t.id = f.ticket_id
   where f.id = p_followup for update of f;
  if not found then raise exception 'follow-up not found'; end if;
  if not public.support_is_supervisor(auth.uid()) and v_owner is distinct from auth.uid() then
    raise exception 'this ticket belongs to another officer';
  end if;
  update public.support_ticket_followups
     set completed_at = now(), completed_by = auth.uid()
   where id = p_followup and completed_at is null and cancelled_at is null;
  insert into public.support_ticket_events (ticket_id, actor_id, event_type, payload)
  values (v_ticket, auth.uid(), 'follow_up_completed', jsonb_build_object('follow_up_id', p_followup));
  update public.support_tickets set updated_at = now() where id = v_ticket;
end;
$$;

create or replace function public.support_driver_status_upsert(
  p_id uuid,
  p_code text,
  p_label text,
  p_description text default null,
  p_terminal boolean default false,
  p_success boolean default false,
  p_active boolean default true,
  p_sort_order integer default 100
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  if p_code !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'invalid status code'; end if;
  if nullif(btrim(coalesce(p_label, '')), '') is null then raise exception 'status label is required'; end if;
  if p_id is null then
    insert into public.support_driver_statuses (code, label, description, is_terminal, is_success, active, sort_order)
    values (p_code, btrim(p_label), nullif(btrim(coalesce(p_description, '')), ''), p_terminal, p_success, p_active, p_sort_order)
    returning id into v_id;
  else
    update public.support_driver_statuses
       set code = p_code, label = btrim(p_label), description = nullif(btrim(coalesce(p_description, '')), ''),
           is_terminal = p_terminal, is_success = p_success, active = p_active, sort_order = p_sort_order
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'status not found'; end if;
  end if;
  perform public.support_write_audit(auth.uid(), 'driver_status_upserted', 'driver_status', v_id::text,
    jsonb_build_object('code', p_code, 'label', p_label, 'active', p_active));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read models. Non-supervisors only see cases assigned to them.
-- ---------------------------------------------------------------------------

drop view if exists public.support_driver_outreach_view;
create view public.support_driver_outreach_view with (security_invoker = true) as
select
  dc.ticket_id,
  t.public_id,
  t.customer_id,
  c.display_name as driver_name,
  c.primary_phone as driver_phone,
  dc.area,
  dc.vehicle_details,
  dc.driver_status_id,
  ds.code as driver_status_code,
  ds.label as driver_status_label,
  ds.is_terminal,
  ds.is_success,
  t.status as ticket_status,
  t.assigned_agent_id,
  ep.full_name as assigned_agent_name,
  t.created_at,
  t.updated_at,
  fu.id as next_followup_id,
  fu.action as next_followup_action,
  fu.due_at as next_followup_due_at,
  (fu.due_at < now()) as followup_overdue
from public.support_driver_cases dc
join public.support_tickets t on t.id = dc.ticket_id
join public.support_customers c on c.id = dc.customer_id
left join public.support_driver_statuses ds on ds.id = dc.driver_status_id
left join public.employee_profiles ep on ep.id = t.assigned_agent_id
left join lateral (
  select f.id, f.action, f.due_at
    from public.support_ticket_followups f
   where f.ticket_id = t.id and f.completed_at is null and f.cancelled_at is null
   order by f.due_at asc
   limit 1
) fu on true
where public.support_is_staff(auth.uid())
  and (public.support_is_supervisor(auth.uid()) or t.assigned_agent_id = auth.uid());

drop view if exists public.support_driver_pipeline_view;
create view public.support_driver_pipeline_view with (security_invoker = true) as
select
  ds.id as status_id,
  ds.code,
  ds.label,
  ds.is_terminal,
  ds.is_success,
  ds.sort_order,
  count(dc.ticket_id) filter (
    where public.support_is_supervisor(auth.uid())
       or exists (select 1 from public.support_tickets t where t.id = dc.ticket_id and t.assigned_agent_id = auth.uid())
  )::int as driver_count
from public.support_driver_statuses ds
left join public.support_driver_cases dc on dc.driver_status_id = ds.id
where ds.active and public.support_is_staff(auth.uid())
group by ds.id, ds.code, ds.label, ds.is_terminal, ds.is_success, ds.sort_order;

drop view if exists public.support_driver_team_activity_view;
create view public.support_driver_team_activity_view with (security_invoker = true) as
select
  a.employee_id,
  ep.full_name as officer_name,
  count(distinct dc.ticket_id) filter (where dc.created_at >= date_trunc('day', now()))::int as tickets_today,
  count(distinct dc.ticket_id) filter (where dc.created_at >= now() - interval '7 days')::int as tickets_7d,
  count(distinct sc.id) filter (where sc.direction = 'outbound' and sc.created_at >= date_trunc('day', now()))::int as calls_today,
  count(distinct sc.id) filter (where sc.direction = 'outbound' and sc.created_at >= now() - interval '7 days')::int as calls_7d,
  count(distinct fu.id) filter (where fu.completed_at >= date_trunc('day', now()))::int as followups_today,
  count(distinct fu.id) filter (where fu.completed_at >= now() - interval '7 days')::int as followups_7d
from public.support_agents a
join public.employee_profiles ep on ep.id = a.employee_id
left join public.support_tickets t on t.assigned_agent_id = a.employee_id
left join public.support_driver_cases dc on dc.ticket_id = t.id
left join public.support_calls sc on sc.ticket_id = dc.ticket_id
left join public.support_ticket_followups fu on fu.ticket_id = dc.ticket_id and fu.completed_by = a.employee_id
where a.enabled and public.support_is_supervisor(auth.uid())
group by a.employee_id, ep.full_name;

-- RLS and grants for the new tables.
--
-- Status definitions are visible to all Support staff.
-- Driver cases and follow-ups are restricted to:
--   * the assigned representative; or
--   * a Support supervisor.
--
-- Mutations are intentionally performed through the guarded RPCs below.

alter table public.support_driver_statuses enable row level security;
alter table public.support_driver_cases enable row level security;
alter table public.support_ticket_followups enable row level security;

revoke all on table public.support_driver_statuses from public, anon, authenticated;
revoke all on table public.support_driver_cases from public, anon, authenticated;
revoke all on table public.support_ticket_followups from public, anon, authenticated;

grant all on table public.support_driver_statuses to service_role;
grant all on table public.support_driver_cases to service_role;
grant all on table public.support_ticket_followups to service_role;

drop policy if exists support_staff_read on public.support_driver_statuses;
drop policy if exists support_staff_read on public.support_driver_cases;
drop policy if exists support_staff_read on public.support_ticket_followups;

drop policy if exists support_driver_statuses_staff_read
  on public.support_driver_statuses;
create policy support_driver_statuses_staff_read
  on public.support_driver_statuses
  for select
  to authenticated
  using (public.support_is_staff(auth.uid()));

drop policy if exists support_driver_cases_assigned_read
  on public.support_driver_cases;
create policy support_driver_cases_assigned_read
  on public.support_driver_cases
  for select
  to authenticated
  using (
    public.support_is_supervisor(auth.uid())
    or exists (
      select 1
        from public.support_tickets t
       where t.id = support_driver_cases.ticket_id
         and t.assigned_agent_id = auth.uid()
    )
  );

drop policy if exists support_ticket_followups_assigned_read
  on public.support_ticket_followups;
create policy support_ticket_followups_assigned_read
  on public.support_ticket_followups
  for select
  to authenticated
  using (
    public.support_is_supervisor(auth.uid())
    or exists (
      select 1
        from public.support_tickets t
       where t.id = support_ticket_followups.ticket_id
         and t.assigned_agent_id = auth.uid()
    )
  );

grant select on table public.support_driver_statuses to authenticated;
grant select on table public.support_driver_cases to authenticated;
grant select on table public.support_ticket_followups to authenticated;

revoke all on public.support_driver_outreach_view, public.support_driver_pipeline_view, public.support_driver_team_activity_view from public, anon, authenticated;
grant select on public.support_driver_outreach_view, public.support_driver_pipeline_view, public.support_driver_team_activity_view to authenticated, service_role;

revoke all on function public.support_driver_outreach_create(text,text,text,jsonb,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.support_driver_set_status(uuid,uuid) from public, anon, authenticated;
revoke all on function public.support_driver_add_followup(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.support_driver_complete_followup(uuid) from public, anon, authenticated;
revoke all on function public.support_driver_status_upsert(uuid,text,text,text,boolean,boolean,boolean,integer) from public, anon, authenticated;

grant execute on function public.support_driver_outreach_create(text,text,text,jsonb,uuid,text,text,timestamptz) to authenticated;
grant execute on function public.support_driver_set_status(uuid,uuid) to authenticated;
grant execute on function public.support_driver_add_followup(uuid,text,timestamptz) to authenticated;
grant execute on function public.support_driver_complete_followup(uuid) to authenticated;
grant execute on function public.support_driver_status_upsert(uuid,text,text,text,boolean,boolean,boolean,integer) to authenticated;

-- Realtime refreshes the outreach board when status/follow-up work changes.
do $$
declare n text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach n in array array['support_driver_cases','support_ticket_followups','support_driver_statuses'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = n
      ) then
        execute format('alter publication supabase_realtime add table public.%I', n);
      end if;
    end loop;
  end if;
end $$;

commit;
