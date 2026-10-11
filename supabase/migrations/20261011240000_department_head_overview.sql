-- Department admin view: what a head of department sees about their own people.
--
-- A head of department (see 20261011230000_department_heads.sql) can see the
-- people in THEIR department and nothing else. This is deliberately narrower
-- than the company Administration view. It shows who they are, whether they
-- are online, how they are doing, their equipment and their work. It does NOT
-- show sign-in addresses, IP addresses, browsers, locations, serial numbers or
-- IMEI numbers, and it has no company-wide settings, payments or audit trail.
--
-- Every time a head opens one person's detail, a line is written to the
-- administrator audit trail, so the company can always see who looked at whom.
--
-- Safe to run twice. Run 20261011230000_department_heads.sql first.

begin;

-- One row per person in every department the signed in user heads.
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
  select
    h.workstation,
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
  from public.workspace_workstation_assignments h
  join public.employee_profiles hp
    on hp.id = h.employee_id and hp.active = true
  join public.workspace_workstation_assignments m
    on m.workstation = h.workstation and m.active = true
  join public.employee_profiles mp
    on mp.id = m.employee_id and mp.active = true
  left join lateral (
    select s.score, s.status
    from public.employee_kpi_snapshots s
    where s.employee_id = mp.id
    order by s.snapshot_date desc
    limit 1
  ) ks on true
  left join lateral (
    select a.badge_label
    from public.employee_recognition_awards a
    where a.employee_id = mp.id and a.active = true
    order by a.awarded_at desc
    limit 1
  ) ra on true
  where h.employee_id = auth.uid()
    and h.active = true
    and h.is_head = true
  order by h.workstation, lower(coalesce(mp.full_name, mp.email)), mp.email;
$$;

revoke all on function public.get_department_team_overview() from public, anon;
grant execute on function public.get_department_team_overview() to authenticated;

-- One person's detail: equipment (no serial or IMEI) and their open work.
-- Refuses anyone outside the caller's department, and records the view.
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
  if actor is null or not public.is_department_head_of(target_user) then
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
