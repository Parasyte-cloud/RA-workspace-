-- HR sees everyone in Department Admin, including who is online.
--
-- Until now Department Admin only opened for a head of department, and only
-- showed that head's own department. People & HR (role 'hr') now get the same
-- view across the whole company, including people with no department yet
-- (shown as 'unassigned').
--
-- What this does NOT do: it does not make HR a head of anything. The helper
-- is_department_head_of() is untouched, because it also drives who may assign
-- work, request sign-off and cancel work. HR gets a read-only view through a
-- separate helper, can_view_department_member().
--
-- Same limits as the head view: no sign-in addresses, IP addresses, browsers,
-- locations, serial numbers or IMEI numbers. Every time HR opens one person's
-- detail, a line is written to the administrator audit trail.
--
-- Safe to run twice. Run 20261011240000_department_head_overview.sql first.

begin;

create or replace function public.can_view_department_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.is_department_head_of(target)
    or (
      public.has_workspace_role(array['hr'])
      and exists(
        select 1 from public.employee_profiles p
        where p.id = target and p.active = true
      )
    ),
    false
  );
$$;

revoke all on function public.can_view_department_member(uuid) from public, anon;
grant execute on function public.can_view_department_member(uuid) to authenticated;

create or replace function public.get_department_team_overview()
returns table(
  workstation text,
  employee_id uuid,
  full_name text,
  email text,
  job_title text,
  active boolean,
  last_seen_at timestamptz,
  rolling_score numeric,
  rolling_status text,
  current_badge text,
  device_count bigint,
  open_work bigint,
  overdue_work bigint,
  completed_30d bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with scope as (
    -- A head: the people in the department(s) they head.
    select h.workstation as ws, m.employee_id as emp
    from public.workspace_workstation_assignments h
    join public.employee_profiles hp
      on hp.id = h.employee_id and hp.active = true
    join public.workspace_workstation_assignments m
      on m.workstation = h.workstation and m.active = true
    where h.employee_id = auth.uid()
      and h.active = true
      and h.is_head = true
    union
    -- HR: every active person, under each department they belong to.
    select coalesce(a.workstation, 'unassigned'), p.id
    from public.employee_profiles p
    left join public.workspace_workstation_assignments a
      on a.employee_id = p.id and a.active = true
    where p.active = true
      and public.has_workspace_role(array['hr'])
  )
  select
    s.ws,
    mp.id,
    mp.full_name,
    mp.email,
    mp.job_title,
    mp.active,
    (
      select max(l.last_seen_at)
      from public.employee_sign_in_locations l
      where l.employee_id = mp.id
    ),
    ks.score,
    ks.status,
    ra.badge_label,
    (
      select count(*)
      from public.company_devices d
      where d.assigned_employee_id = mp.id
        and d.status not in ('returned', 'retired')
    ),
    (
      select count(*)
      from public.work_items w
      join public.work_item_assignees a on a.work_item_id = w.id
      where a.assignee_id = mp.id
        and w.project_space_id is null
        and w.status not in ('completed', 'cancelled')
    ),
    (
      select count(*)
      from public.work_items w
      join public.work_item_assignees a on a.work_item_id = w.id
      where a.assignee_id = mp.id
        and w.project_space_id is null
        and w.status not in ('completed', 'cancelled')
        and w.due_at is not null
        and w.due_at < now()
    ),
    (
      select count(*)
      from public.work_items w
      join public.work_item_assignees a on a.work_item_id = w.id
      where a.assignee_id = mp.id
        and w.project_space_id is null
        and w.status = 'completed'
        and w.completed_at > now() - interval '30 days'
    )
  from scope s
  join public.employee_profiles mp
    on mp.id = s.emp and mp.active = true
  left join lateral (
    select k.score, k.status
    from public.employee_kpi_snapshots k
    where k.employee_id = mp.id
    order by k.snapshot_date desc
    limit 1
  ) ks on true
  left join lateral (
    select r.badge_label
    from public.employee_recognition_awards r
    where r.employee_id = mp.id and r.active = true
    order by r.awarded_at desc
    limit 1
  ) ra on true
  order by s.ws, lower(coalesce(mp.full_name, mp.email)), mp.email;
$$;

revoke all on function public.get_department_team_overview() from public, anon;
grant execute on function public.get_department_team_overview() to authenticated;

-- Detail view: same body as before, but the gate is the new helper.
create or replace function public.get_department_member_detail(target_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  devices jsonb;
  work jsonb;
begin
  if actor is null or not public.can_view_department_member(target_user) then
    raise exception 'You can only view people in a department you head';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'asset_tag', d.asset_tag,
    'device_type', d.device_type,
    'manufacturer', d.manufacturer,
    'model', d.model,
    'operating_system', d.operating_system,
    'status', d.status
  ) order by d.asset_tag), '[]'::jsonb)
  into devices
  from public.company_devices d
  where d.assigned_employee_id = target_user
    and d.status not in ('returned', 'retired');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id,
    'title', w.title,
    'status', w.status,
    'priority', w.priority,
    'due_at', w.due_at
  ) order by w.due_at nulls last, w.created_at desc), '[]'::jsonb)
  into work
  from public.work_items w
  join public.work_item_assignees a on a.work_item_id = w.id
  where a.assignee_id = target_user
    and w.project_space_id is null
    and w.status not in ('completed', 'cancelled');

  insert into public.admin_audit_log(
    actor_id, target_employee_id, action, entity_type, entity_id, source, metadata
  ) values (
    actor, target_user, 'department_head.member_viewed', 'employee_profiles',
    target_user::text, 'department-admin-view', '{}'::jsonb
  );

  return jsonb_build_object('devices', devices, 'open_work', work);
end;
$$;

revoke all on function public.get_department_member_detail(uuid) from public, anon;
grant execute on function public.get_department_member_detail(uuid) to authenticated;

commit;
