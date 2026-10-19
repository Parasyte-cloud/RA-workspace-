-- PArAsYtE | RA-Workspace support module
-- Team scoping for supervisors. Until now every supervisor could act on and read everything.
-- A supervisor can now be limited to their own team: they assign work only to their officers,
-- decide location requests only for their officers, and read only their team's audit trail
-- and reports. Defaults keep today's behaviour (scope = all) until an administrator changes it.
--
-- Deliberately NOT scoped:
--   * the shared queues and the floor board (officers see colleagues' availability too)
--   * emergencies: an SOS never waits for a team boundary, so every supervisor can act on one
-- Additive and idempotent.

begin;

create table if not exists public.support_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists support_teams_name_idx on public.support_teams (lower(name));

alter table public.support_agents add column if not exists team_id uuid references public.support_teams(id) on delete set null;
alter table public.support_agents add column if not exists supervisor_scope text not null default 'all';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_agents_scope_chk') then
    alter table public.support_agents add constraint support_agents_scope_chk check (supervisor_scope in ('all','team'));
  end if;
end $$;
create index if not exists support_agents_team_idx on public.support_agents (team_id);

alter table public.support_invites add column if not exists team_id uuid references public.support_teams(id) on delete set null;

-- 'all', 'team', or null when the person is not a supervisor.
-- Administrators and the Head of Support are never limited, whatever the row says.
create or replace function public.support_supervisor_scope(p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.support_is_supervisor(p_user) then null
    when exists (
      select 1 from public.employee_profiles ep
       where ep.id = p_user
         and (ep.role = 'admin'
              or lower(ep.job_title) ~ 'head of support'
              or exists (select 1 from public.workspace_workstation_assignments a
                          where a.employee_id = ep.id and a.active and a.workstation = 'administration'))
    ) then 'all'
    else coalesce((select sa.supervisor_scope from public.support_agents sa where sa.employee_id = p_user and sa.enabled), 'all')
  end;
$$;

-- May this supervisor act on this person's work? A null target (no one) is always fine.
create or replace function public.support_supervises(p_user uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.support_is_supervisor(p_user) and (
    p_target is null
    or p_target = p_user
    or public.support_supervisor_scope(p_user) = 'all'
    or exists (
      select 1 from public.support_agents me
       join public.support_agents them on them.team_id = me.team_id
       where me.employee_id = p_user and them.employee_id = p_target and me.team_id is not null
    )
  );
$$;

create or replace function public.support_audit_visible(p_user uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.support_is_supervisor(p_user) and (
    public.support_supervisor_scope(p_user) = 'all'
    or (p_actor is not null and public.support_supervises(p_user, p_actor))
  );
$$;


-- Existing functions, redefined with the team check.

create or replace function public.support_assign_ticket(p_ticket uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  if p_to is not null and not exists (select 1 from public.support_agents where employee_id = p_to and enabled and role_kind <> 'watcher') then
    raise exception 'target is not an enabled Support officer';
  end if;
  -- Team scope: a team supervisor moves work only to their own officers, and does not take
  -- a ticket that another team's officer is already working.
  if p_to is not null and not public.support_supervises(auth.uid(), p_to) then
    raise exception 'that officer is not on your team';
  end if;
  if exists (select 1 from public.support_tickets x
              where x.id = p_ticket and x.assigned_agent_id is not null
                and not public.support_supervises(auth.uid(), x.assigned_agent_id)) then
    raise exception 'that ticket belongs to an officer outside your team';
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

create or replace function public.support_decide_location(p_session uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_s public.support_location_sessions%rowtype; v_set public.support_safety_settings%rowtype;
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  select * into v_s from public.support_location_sessions where id = p_session for update;
  if not found then raise exception 'session not found'; end if;
  if v_s.status <> 'pending_approval' then raise exception 'this request is no longer waiting for approval'; end if;
  if v_s.requested_by = auth.uid() then raise exception 'you cannot approve your own request'; end if;
  if v_s.incident_id is null and not public.support_supervises(auth.uid(), v_s.requested_by) then
    raise exception 'that officer is not on your team';
  end if;
  if v_s.expires_at <= now() then raise exception 'this request has expired, ask the officer to request again'; end if;
  select * into v_set from public.support_safety_settings limit 1;
  if p_approve then
    update public.support_location_sessions
       set status = 'active', approved_by = auth.uid(), approved_at = now(),
           expires_at = now() + make_interval(mins => v_set.location_session_minutes)
     where id = p_session;
  else
    update public.support_location_sessions
       set status = 'denied', ended_at = now(), end_reason = left(btrim(coalesce(p_note, 'denied')), 200)
     where id = p_session;
  end if;
  perform public.support_write_audit(auth.uid(), case when p_approve then 'location_session_approved' else 'location_session_denied' end,
    'location_session', p_session::text, jsonb_build_object('requested_by', v_s.requested_by));
end;
$$;

create or replace function public.support_end_location(p_session uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_s public.support_location_sessions%rowtype;
begin
  if not public.support_is_staff(auth.uid()) then raise exception 'support access required'; end if;
  select * into v_s from public.support_location_sessions where id = p_session for update;
  if not found then raise exception 'session not found'; end if;
  if v_s.requested_by <> auth.uid() and not (public.support_is_supervisor(auth.uid())
       and (v_s.incident_id is not null or public.support_supervises(auth.uid(), v_s.requested_by))) then
    raise exception 'only the requester or a supervisor can end this session';
  end if;
  if v_s.status not in ('active','pending_approval') then return; end if;
  update public.support_location_sessions
     set status = 'ended', ended_at = now(),
         end_reason = left(coalesce(nullif(btrim(p_reason), ''), case when v_s.requested_by = auth.uid() then 'ended by officer' else 'revoked by supervisor' end), 200)
   where id = p_session;
  perform public.support_write_audit(auth.uid(), 'location_session_ended', 'location_session', p_session::text,
    jsonb_build_object('revoked', v_s.requested_by <> auth.uid()));
end;
$$;

create or replace function public.support_audit_search(
  p_action text default null, p_actor uuid default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 200
)
returns table (id bigint, created_at timestamptz, actor_id uuid, actor_name text, action text, entity_type text, entity_id text, payload jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  return query
    select a.id, a.created_at, a.actor_id, ep.full_name, a.action, a.entity_type, a.entity_id, a.payload
      from public.support_audit_log a
      left join public.employee_profiles ep on ep.id = a.actor_id
     where public.support_audit_visible(auth.uid(), a.actor_id)
       and (p_action is null or p_action = '' or a.action ilike '%' || p_action || '%')
       and (p_actor is null or a.actor_id = p_actor)
       and (p_from is null or a.created_at >= p_from)
       and (p_to is null or a.created_at < p_to)
     order by a.created_at desc, a.id desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

create or replace function public.support_report_summary(
  p_from timestamptz default null, p_to timestamptz default null, p_agent uuid default null, p_category text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_from timestamptz; v_to timestamptz; v_out jsonb;
begin
  if not public.support_is_supervisor(auth.uid()) then raise exception 'supervisor access required'; end if;
  v_to := coalesce(p_to, now());
  v_from := coalesce(p_from, v_to - interval '7 days');
  if v_from >= v_to then raise exception 'the start of the range must be before the end'; end if;
  if v_to - v_from > interval '366 days' then raise exception 'ranges longer than 366 days are not supported'; end if;

  with t as (
    select x.* from public.support_tickets x
     where x.created_at >= v_from and x.created_at < v_to
       and (p_agent is null or x.assigned_agent_id = p_agent)
       and (p_category is null or p_category = '' or x.category = p_category)
       and (x.assigned_agent_id is null or public.support_supervises(auth.uid(), x.assigned_agent_id))
  ), sc as (
    select e.ticket_id, e.created_at, e.payload->>'to' as to_status,
           lead(e.created_at) over (partition by e.ticket_id order by e.created_at, e.id) as next_at
      from public.support_ticket_events e join t on t.id = e.ticket_id
     where e.event_type = 'status_changed'
  ), wait as (
    select sc.ticket_id,
           sum(extract(epoch from (coalesce(sc.next_at, coalesce(t.resolved_at, now())) - sc.created_at))) as secs
      from sc join t on t.id = sc.ticket_id
     where sc.to_status = 'waiting_customer'
     group by sc.ticket_id
  ), esc as (
    select distinct e.ticket_id from public.support_ticket_events e join t on t.id = e.ticket_id
     where e.event_type = 'status_changed' and e.payload->>'to' = 'escalated'
  ), inc as (
    select * from public.support_incidents where activated_at >= v_from and activated_at < v_to
  ), loc as (
    select l.outcome from public.support_location_access_log l where l.created_at >= v_from and l.created_at < v_to
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'cases', jsonb_build_object(
      'total', (select count(*) from t),
      'open', (select count(*) from t where status not in ('resolved','closed')),
      'resolved', (select count(*) from t where status in ('resolved','closed')),
      'reopened', (select count(*) from t where reopen_count > 0),
      'escalated', (select count(*) from esc),
      'avg_first_response_minutes', (select round(avg(extract(epoch from (first_responded_at - created_at))) / 60.0, 1) from t where first_responded_at is not null),
      'avg_resolution_minutes', (select round(avg(extract(epoch from (resolved_at - created_at))) / 60.0, 1) from t where resolved_at is not null),
      'avg_waiting_minutes', (select round(avg(w.secs) / 60.0, 1) from wait w join t on t.id = w.ticket_id where t.resolved_at is not null),
      'avg_active_minutes', (select round(avg(extract(epoch from (t.resolved_at - t.created_at)) - coalesce(w.secs, 0)) / 60.0, 1)
                               from t left join wait w on w.ticket_id = t.id where t.resolved_at is not null),
      'first_response_sla_pct', (select round(100.0 * count(*) filter (where first_responded_at is not null and first_responded_at <= first_response_due_at)
                                              / nullif(count(*) filter (where first_response_due_at is not null and (first_responded_at is not null or first_response_due_at < now())), 0), 1) from t),
      'resolution_sla_pct', (select round(100.0 * count(*) filter (where resolved_at is not null and resolved_at <= resolution_due_at)
                                          / nullif(count(*) filter (where resolution_due_at is not null and (resolved_at is not null or resolution_due_at < now())), 0), 1) from t)
    ),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'total', c.total, 'open', c.open_n, 'resolved', c.res_n) order by c.total desc), '[]'::jsonb)
                      from (select category, count(*) as total,
                                   count(*) filter (where status not in ('resolved','closed')) as open_n,
                                   count(*) filter (where status in ('resolved','closed')) as res_n
                              from t group by category) c),
    'by_priority', (select coalesce(jsonb_agg(jsonb_build_object('priority', c.priority, 'total', c.total) order by c.priority), '[]'::jsonb)
                      from (select priority, count(*) as total from t group by priority) c),
    'by_agent', (select coalesce(jsonb_agg(jsonb_build_object('employee_id', c.employee_id, 'name', c.name, 'handled', c.handled,
                                                               'resolved', c.resolved_n, 'avg_resolution_minutes', c.avg_res) order by c.handled desc), '[]'::jsonb)
                   from (select t.assigned_agent_id as employee_id, ep.full_name as name, count(*) as handled,
                                count(*) filter (where t.resolved_at is not null) as resolved_n,
                                round(avg(extract(epoch from (t.resolved_at - t.created_at))) filter (where t.resolved_at is not null) / 60.0, 1) as avg_res
                           from t join public.employee_profiles ep on ep.id = t.assigned_agent_id
                          group by t.assigned_agent_id, ep.full_name) c),
    'queue_aging_now', (select jsonb_build_object('unassigned', count(*),
                               'oldest_minutes', coalesce(round(max(extract(epoch from (now() - created_at))) / 60.0), 0))
                          from public.support_tickets where assigned_agent_id is null and status not in ('resolved','closed')),
    'emergencies', jsonb_build_object(
      'total', (select count(*) from inc),
      'unresolved', (select count(*) from inc where status <> 'resolved'),
      'escalated', (select count(*) from inc where escalation_level > 0),
      'avg_seconds_to_acknowledge', (select round(avg(extract(epoch from (acknowledged_at - received_at)))) from inc where acknowledged_at is not null),
      'max_seconds_to_acknowledge', (select round(max(extract(epoch from (acknowledged_at - received_at)))) from inc where acknowledged_at is not null),
      'avg_minutes_to_resolve', (select round(avg(extract(epoch from (resolved_at - received_at))) / 60.0, 1) from inc where resolved_at is not null)),
    'location', jsonb_build_object(
      'sessions', (select count(*) from public.support_location_sessions where created_at >= v_from and created_at < v_to
                   and (incident_id is not null or public.support_supervises(auth.uid(), requested_by))),
      'fetches', (select count(*) from loc),
      'served', (select count(*) from loc where outcome = 'served'),
      'stale', (select count(*) from loc where outcome = 'stale'),
      'unavailable', (select count(*) from loc where outcome in ('unavailable','not_configured')),
      'availability_pct', (select round(100.0 * count(*) filter (where outcome in ('served','stale')) / nullif(count(*) filter (where outcome <> 'denied'), 0), 1) from loc))
  ) into v_out;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads: the sensitive histories follow the same scope
-- ---------------------------------------------------------------------------

drop policy if exists support_supervisor_read on public.support_audit_log;
create policy support_supervisor_read on public.support_audit_log
  for select to authenticated using (public.support_audit_visible(auth.uid(), actor_id));

drop policy if exists support_supervisor_read on public.support_identity_lookups;
create policy support_supervisor_read on public.support_identity_lookups
  for select to authenticated using (public.support_audit_visible(auth.uid(), actor_id));

drop policy if exists support_own_or_supervisor_read on public.support_location_sessions;
create policy support_own_or_supervisor_read on public.support_location_sessions for select to authenticated
  using (requested_by = auth.uid()
         or (public.support_is_supervisor(auth.uid()) and (incident_id is not null or public.support_supervises(auth.uid(), requested_by))));

drop policy if exists support_supervisor_read on public.support_location_access_log;
create policy support_supervisor_read on public.support_location_access_log for select to authenticated
  using (public.support_audit_visible(auth.uid(), actor_id));

drop policy if exists support_voice_devices_read on public.support_agent_voice_devices;
create policy support_voice_devices_read on public.support_agent_voice_devices
  for select to authenticated
  using (employee_id = auth.uid() or public.support_supervises(auth.uid(), employee_id));

-- Teams are readable by staff (names only), written by the control function.
alter table public.support_teams enable row level security;
revoke all on public.support_teams from public, anon, authenticated;
grant all on public.support_teams to service_role;
drop policy if exists support_staff_read on public.support_teams;
create policy support_staff_read on public.support_teams for select to authenticated using (public.support_is_staff(auth.uid()));
grant select on public.support_teams to authenticated;

-- The invite RPCs learn about teams: an invited person can be placed on a team at the door.
-- (support_invite_create keeps its signature; the team is set by the function afterwards.)
create or replace function public.support_invite_set_team(p_actor uuid, p_invite uuid, p_team uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_can_invite(p_actor) then raise exception 'Not allowed to invite staff' using errcode = '42501'; end if;
  if p_team is not null and not exists (select 1 from public.support_teams where id = p_team and active) then raise exception 'Unknown team'; end if;
  update public.support_invites set team_id = p_team where id = p_invite and status = 'pending';
end;
$$;

create or replace function public.support_invite_complete(p_invite uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.support_invites%rowtype;
  v_role text;
begin
  select * into v_row from public.support_invites where id = p_invite for update;
  if not found or v_row.status <> 'pending' then raise exception 'Invite is no longer valid'; end if;

  insert into public.employee_profiles (id, full_name, email, department, job_title, role, active)
  values (p_user, v_row.full_name, v_row.email, 'Support', v_row.job_title, 'support', true)
  on conflict (id) do update
    set role = case when public.employee_profiles.role = 'employee' then 'support' else public.employee_profiles.role end,
        department = case when public.employee_profiles.department in ('', 'Unassigned') then 'Support' else public.employee_profiles.department end,
        updated_at = now();

  insert into public.workspace_workstation_assignments (employee_id, workstation, is_primary, active)
  values (p_user, 'support', true, true)
  on conflict (employee_id, workstation) do update set active = true;

  v_role := v_row.role_kind;
  insert into public.support_agents (employee_id, enabled, role_kind, is_supervisor, voice_enabled, voice_capacity, messaging_capacity, team_id)
  values (p_user, true, v_role, v_role = 'supervisor', v_role <> 'watcher',
          case when v_role = 'watcher' then 0 else 1 end, case when v_role = 'watcher' then 0 else 3 end, v_row.team_id)
  on conflict (employee_id) do update
    set enabled = true, role_kind = excluded.role_kind, is_supervisor = excluded.is_supervisor,
        team_id = coalesce(excluded.team_id, public.support_agents.team_id);

  insert into public.support_agent_presence (employee_id, state, state_reason, active_shift)
  values (p_user, 'offline', 'joined', false)
  on conflict (employee_id) do nothing;

  update public.support_invites set status = 'redeemed', redeemed_at = now(), redeemed_user = p_user where id = p_invite;
  perform public.support_write_audit(p_user, 'staff_invite_redeemed', 'support_invite', p_invite::text,
    jsonb_build_object('email', v_row.email, 'role_kind', v_role, 'invited_by', v_row.created_by, 'team_id', v_row.team_id));
end;
$$;

revoke all on function public.support_supervisor_scope(uuid) from public, anon;
revoke all on function public.support_supervises(uuid,uuid) from public, anon;
revoke all on function public.support_audit_visible(uuid,uuid) from public, anon;
revoke all on function public.support_invite_set_team(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.support_invite_complete(uuid,uuid) from public, anon, authenticated;
grant execute on function public.support_supervisor_scope(uuid) to authenticated, service_role;
grant execute on function public.support_supervises(uuid,uuid) to authenticated, service_role;
grant execute on function public.support_audit_visible(uuid,uuid) to authenticated, service_role;
grant execute on function public.support_invite_set_team(uuid,uuid,uuid) to service_role;
grant execute on function public.support_invite_complete(uuid,uuid) to service_role;
grant execute on function public.support_assign_ticket(uuid,uuid) to authenticated, service_role;
grant execute on function public.support_decide_location(uuid,boolean,text) to authenticated, service_role;
grant execute on function public.support_end_location(uuid,text) to authenticated, service_role;
grant execute on function public.support_audit_search(text,uuid,timestamptz,timestamptz,integer) to authenticated, service_role;
grant execute on function public.support_report_summary(timestamptz,timestamptz,uuid,text) to authenticated, service_role;

commit;
