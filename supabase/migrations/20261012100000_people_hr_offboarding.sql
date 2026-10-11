-- People & HR: edit employee records, offboard leavers, see what a leaver still holds.
--
-- HR and Admin can already read and update employee_profiles through RLS, but
-- the app gave them no way to do it, and there was no safe way to move a leaver's
-- work and reports to someone else. This migration adds three functions. All of
-- them are limited to HR and Admin, none of them touches an Admin account (demote
-- first), and each one writes a line to the administrator audit trail, because
-- the automatic audit trigger only records changes made by an Admin.
--
--   get_offboarding_summary(target)       what the person still holds
--   offboard_employee(target, successor)  hand over work and reports, then archive
--   update_employee_record(...)           edit name, department, title, manager
--
-- Permanent deletion of the sign-in account is done by the workspace-user-admin
-- Edge Function (action delete-former), which needs the service key.
--
-- Safe to run twice.

begin;

create or replace function public.get_offboarding_summary(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  work jsonb;
  devices jsonb;
  reports jsonb;
begin
  if auth.uid() is null or not public.has_workspace_role(array['hr', 'admin']) then
    raise exception 'Only People & HR or an administrator can do this' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id, 'title', w.title, 'status', w.status, 'due_at', w.due_at
  ) order by w.due_at nulls last, w.created_at desc), '[]'::jsonb)
  into work
  from public.work_items w
  join public.work_item_assignees a on a.work_item_id = w.id
  where a.assignee_id = target
    and w.status not in ('completed', 'cancelled');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'asset_tag', d.asset_tag, 'device_type', d.device_type,
    'model', d.model, 'status', d.status
  ) order by d.asset_tag), '[]'::jsonb)
  into devices
  from public.company_devices d
  where d.assigned_employee_id = target
    and d.status not in ('returned', 'retired');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email
  ) order by lower(p.full_name)), '[]'::jsonb)
  into reports
  from public.employee_profiles p
  where p.manager_id = target;

  return jsonb_build_object('open_work', work, 'devices', devices, 'direct_reports', reports);
end;
$$;

revoke all on function public.get_offboarding_summary(uuid) from public, anon;
grant execute on function public.get_offboarding_summary(uuid) to authenticated;

create or replace function public.offboard_employee(target uuid, successor uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target_row public.employee_profiles%rowtype;
  moved_work int := 0;
  moved_reports int := 0;
begin
  if actor is null or not public.has_workspace_role(array['hr', 'admin']) then
    raise exception 'Only People & HR or an administrator can do this' using errcode = '42501';
  end if;
  if target = actor then
    raise exception 'You cannot offboard yourself';
  end if;

  select * into target_row from public.employee_profiles where id = target;
  if not found then
    raise exception 'Employee not found';
  end if;
  if lower(target_row.role) = 'admin' then
    raise exception 'An administrator cannot be offboarded. Change their role first.';
  end if;

  if successor is not null then
    if successor = target then
      raise exception 'The person taking over cannot be the leaver';
    end if;
    if not exists (
      select 1 from public.employee_profiles where id = successor and active = true
    ) then
      raise exception 'The person taking over must be an active employee';
    end if;

    -- Hand over open work.
    insert into public.work_item_assignees (work_item_id, assignee_id, assigned_by)
    select a.work_item_id, successor, actor
    from public.work_item_assignees a
    join public.work_items w on w.id = a.work_item_id
    where a.assignee_id = target
      and w.status not in ('completed', 'cancelled')
    on conflict (work_item_id, assignee_id) do nothing;

    delete from public.work_item_assignees a
    using public.work_items w
    where w.id = a.work_item_id
      and a.assignee_id = target
      and w.status not in ('completed', 'cancelled');
    get diagnostics moved_work = row_count;
  end if;

  -- Their direct reports move to the successor, or up to the leaver's own manager.
  update public.employee_profiles
  set manager_id = case
        when successor is not null then successor
        else target_row.manager_id
      end,
      updated_at = now()
  where manager_id = target;
  get diagnostics moved_reports = row_count;

  update public.workspace_workstation_assignments
  set active = false, is_head = false
  where employee_id = target and active = true;

  update public.employee_profiles
  set active = false, updated_at = now()
  where id = target;

  insert into public.admin_audit_log(
    actor_id, target_employee_id, action, entity_type, entity_id, source, metadata
  ) values (
    actor, target, 'employee.offboard', 'employee_profiles', target::text, 'people-hr',
    jsonb_build_object(
      'successor', successor,
      'work_items_moved', moved_work,
      'reports_moved', moved_reports
    )
  );

  return jsonb_build_object('work_items_moved', moved_work, 'reports_moved', moved_reports);
end;
$$;

revoke all on function public.offboard_employee(uuid, uuid) from public, anon;
grant execute on function public.offboard_employee(uuid, uuid) to authenticated;

-- Edit a record. Role changes are Administrator only and keep their own guard.
create or replace function public.update_employee_record(
  target uuid,
  new_full_name text,
  new_department text,
  new_job_title text,
  new_manager uuid,
  new_role text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  caller_role text := public.current_workspace_role();
  old_row public.employee_profiles%rowtype;
  next_role text;
begin
  if actor is null or not public.has_workspace_role(array['hr', 'admin']) then
    raise exception 'Only People & HR or an administrator can do this' using errcode = '42501';
  end if;

  select * into old_row from public.employee_profiles where id = target;
  if not found then
    raise exception 'Employee not found';
  end if;
  if lower(old_row.role) = 'admin' and caller_role <> 'admin' then
    raise exception 'Only an administrator can edit an administrator';
  end if;
  if nullif(btrim(new_full_name), '') is null then
    raise exception 'Name is required';
  end if;
  if new_manager = target then
    raise exception 'An employee cannot be their own manager';
  end if;
  if new_manager is not null and not exists (
    select 1 from public.employee_profiles where id = new_manager
  ) then
    raise exception 'Manager not found';
  end if;

  next_role := old_row.role;
  if new_role is not null and lower(new_role) <> lower(old_row.role) then
    if caller_role <> 'admin' then
      raise exception 'Only an administrator can change a role' using errcode = '42501';
    end if;
    next_role := lower(new_role);
  end if;

  update public.employee_profiles
  set full_name = btrim(new_full_name),
      department = coalesce(nullif(btrim(new_department), ''), 'Unassigned'),
      job_title = btrim(coalesce(new_job_title, '')),
      manager_id = new_manager,
      role = next_role,
      updated_at = now()
  where id = target;

  insert into public.admin_audit_log(
    actor_id, target_employee_id, action, entity_type, entity_id, source, metadata
  ) values (
    actor, target, 'employee.record_edited', 'employee_profiles', target::text, 'people-hr',
    jsonb_build_object(
      'before', jsonb_build_object(
        'full_name', old_row.full_name, 'department', old_row.department,
        'job_title', old_row.job_title, 'manager_id', old_row.manager_id, 'role', old_row.role
      ),
      'after', jsonb_build_object(
        'full_name', btrim(new_full_name),
        'department', coalesce(nullif(btrim(new_department), ''), 'Unassigned'),
        'job_title', btrim(coalesce(new_job_title, '')),
        'manager_id', new_manager, 'role', next_role
      )
    )
  );
end;
$$;

revoke all on function public.update_employee_record(uuid, text, text, text, uuid, text) from public, anon;
grant execute on function public.update_employee_record(uuid, text, text, text, uuid, text) to authenticated;

commit;
