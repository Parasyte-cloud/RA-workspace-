-- Head of department: a department-scoped admin level for every department.
--
-- A head is a normal member of a department (workstation) who has been marked
-- as its head by an administrator. Within THEIR OWN department only, a head can:
--   * monitor: see work created by or assigned to people in the department,
--   * assign work to people in the department,
--   * sign off: request and decide approvals on that work,
--   * change the status of that work and cancel it.
-- A head gets nothing outside the department, cannot change roles or access, and
-- does not see project or collaboration-space work they were not given.
--
-- Administrators pick heads in Workstation Control. Safe to run twice.

begin;

alter table public.workspace_workstation_assignments
  add column if not exists is_head boolean not null default false;

-- A head flag only means something while the assignment is active. If the
-- person is moved or the assignment is switched off, the flag goes with it.
create or replace function public.workstation_head_guard()
returns trigger
language plpgsql
as $$
begin
  if new.active is not true then
    new.is_head := false;
  end if;
  return new;
end;
$$;

drop trigger if exists workstation_head_guard on public.workspace_workstation_assignments;

create trigger workstation_head_guard
before insert or update on public.workspace_workstation_assignments
for each row
execute function public.workstation_head_guard();

-- True when the signed in user heads a department that `target` belongs to.
-- The head counts as a member of their own department.
create or replace function public.is_department_head_of(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(exists(
    select 1
    from public.workspace_workstation_assignments h
    join public.employee_profiles hp
      on hp.id = h.employee_id and hp.active = true
    join public.workspace_workstation_assignments m
      on m.workstation = h.workstation and m.active = true
    join public.employee_profiles mp
      on mp.id = m.employee_id and mp.active = true
    where h.employee_id = auth.uid()
      and h.active = true
      and h.is_head = true
      and m.employee_id = target
  ), false);
$$;

revoke all on function public.is_department_head_of(uuid) from public, anon;
grant execute on function public.is_department_head_of(uuid) to authenticated;

-- True when the signed in user heads the department of the person who created
-- the work item or of anyone it is assigned to. Project and collaboration work
-- is excluded: those spaces keep their own membership rules.
create or replace function public.is_department_head_of_work(target_work_item uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(exists(
    select 1
    from public.work_items w
    where w.id = target_work_item
      and w.project_space_id is null
      and (
        public.is_department_head_of(w.created_by)
        or exists(
          select 1
          from public.work_item_assignees a
          where a.work_item_id = w.id
            and public.is_department_head_of(a.assignee_id)
        )
      )
  ), false);
$$;

revoke all on function public.is_department_head_of_work(uuid) from public, anon;
grant execute on function public.is_department_head_of_work(uuid) to authenticated;

-- The people a head looks after, with names, for the Work Desk. Ordinary
-- employees cannot browse the directory, so a head gets exactly their own
-- department through this function and nothing more.
create or replace function public.get_department_head_scope()
returns table(
  workstation text,
  employee_id uuid,
  full_name text,
  email text,
  job_title text
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
    mp.job_title
  from public.workspace_workstation_assignments h
  join public.employee_profiles hp
    on hp.id = h.employee_id and hp.active = true
  join public.workspace_workstation_assignments m
    on m.workstation = h.workstation and m.active = true
  join public.employee_profiles mp
    on mp.id = m.employee_id and mp.active = true
  where h.employee_id = auth.uid()
    and h.active = true
    and h.is_head = true
  order by h.workstation, mp.full_name, mp.email;
$$;

revoke all on function public.get_department_head_scope() from public, anon;
grant execute on function public.get_department_head_scope() to authenticated;

-- Administrators name (or remove) the head of a department.
create or replace function public.set_workstation_head(
  target_user uuid,
  make_head boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_ws text;
begin
  if public.current_workspace_role() is distinct from 'admin' then
    raise exception 'Only an administrator can name a department head';
  end if;

  select a.workstation
  into current_ws
  from public.workspace_workstation_assignments a
  join public.employee_profiles p on p.id = a.employee_id and p.active = true
  where a.employee_id = target_user
    and a.active = true
  limit 1;

  if current_ws is null then
    raise exception 'Assign this person to a department workstation first';
  end if;

  if make_head and current_ws in ('administration', 'executive') then
    raise exception 'Administration and Executive already have full access, so they do not need a head';
  end if;

  update public.workspace_workstation_assignments
  set is_head = make_head, updated_at = now()
  where employee_id = target_user
    and active = true;
end;
$$;

revoke all on function public.set_workstation_head(uuid, boolean) from public, anon;
grant execute on function public.set_workstation_head(uuid, boolean) to authenticated;

-- Re-saving someone's workstation must not drop their head flag when the
-- workstation has not changed. Same function as before with one condition:
-- only OTHER assignments are switched off.
create or replace function public.assign_primary_workstation(
  target_user uuid,
  new_workstation text
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor_role text;
  target_role text;
  clean_workstation text;
begin
  actor_role:=public.current_workspace_role();
  if actor_role<>'admin' then
    raise exception 'Only an administrator can assign workstations';
  end if;

  clean_workstation:=lower(trim(new_workstation));
  if clean_workstation not in (
    'support','operations','people','engineering','finance','marketing',
    'partnerships','legal','executive','administration'
  ) then
    raise exception 'Invalid workstation';
  end if;

  select role into target_role
  from public.employee_profiles
  where id=target_user and active=true;

  if target_role is null then
    raise exception 'Active employee not found';
  end if;

  if clean_workstation='administration' and target_role<>'admin' then
    raise exception 'Administration workstation requires the admin role';
  end if;

  if clean_workstation='executive' and target_role not in ('manager','admin') then
    raise exception 'Executive workstation requires manager or admin role';
  end if;

  update public.workspace_workstation_assignments
  set is_primary=false,active=false,updated_at=now()
  where employee_id=target_user and active=true
    and workstation<>clean_workstation;

  insert into public.workspace_workstation_assignments(
    employee_id,workstation,is_primary,active,assigned_by,assigned_at,updated_at
  ) values (
    target_user,clean_workstation,true,true,auth.uid(),now(),now()
  )
  on conflict(employee_id,workstation)
  do update set
    is_primary=true,
    active=true,
    assigned_by=excluded.assigned_by,
    assigned_at=now(),
    updated_at=now();
end;
$$;


-- Permission checks below are unchanged except for the added head-of-department lines.
create or replace function public.can_assign_work(
  target_user uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.employee_profiles me
    join public.employee_profiles target
      on target.id=target_user
    where
      me.id=auth.uid()
      and me.active=true
      and target.active=true
      and (
        me.role in (
          'manager',
          'admin',
          'operations',
          'cto'
        )
        or target.id=me.id
        or public.is_department_head_of(target.id)
      )
  );
$$;

create or replace function public.can_read_work_item(
  target_work_item uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.work_items w
    where
      w.id=target_work_item
      and (
        (
          w.project_space_id is null
          and (
            w.created_by=auth.uid()
            or exists(
              select 1
              from public.work_item_assignees a
              where
                a.work_item_id=w.id
                and a.assignee_id=auth.uid()
            )
            or public.has_workspace_role(
              array['manager','admin']
            )
            or public.is_department_head_of_work(w.id)
          )
        )
        or
        (
          w.project_space_id is not null
          and public.can_access_collaboration_space(
            w.project_space_id
          )
        )
      )
  );
$$;

create or replace function public.get_work_approval_candidates(
  target_work_item uuid
)
returns table(
  id uuid,
  full_name text,
  email text,
  department text,
  job_title text
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
  creator uuid;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  select created_by
  into creator
  from public.work_items
  where work_items.id=target_work_item;

  if creator is null then
    raise exception 'Work item not found';
  end if;

  if not (
    actor=creator
    or public.has_workspace_role(array['manager','admin'])
    or public.is_department_head_of_work(target_work_item)
  ) then
    raise exception 'You cannot request approval for this work item';
  end if;

  return query
  select
    ep.id,
    ep.full_name,
    ep.email,
    ep.department,
    ep.job_title
  from public.employee_profiles ep
  where ep.active=true
    and ep.id<>actor
  order by ep.full_name,ep.email;
end;
$$;

create or replace function public.request_work_approval(
  target_work_item uuid,
  target_approver uuid,
  note text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
  creator uuid;
  task_title text;
  task_status text;
  new_approval uuid;
  latest_round integer;
  pending_in_latest integer;
  next_round integer;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  select created_by,title,status
  into creator,task_title,task_status
  from public.work_items
  where id=target_work_item
  for update;

  if creator is null then
    raise exception 'Work item not found';
  end if;

  if task_status='cancelled' then
    raise exception 'A cancelled work item cannot be sent for approval';
  end if;

  if not (
    actor=creator
    or public.has_workspace_role(array['manager','admin'])
    or public.is_department_head_of_work(target_work_item)
  ) then
    raise exception 'You cannot request approval for this work item';
  end if;

  if not exists(
    select 1
    from public.employee_profiles
    where id=target_approver and active=true
  ) then
    raise exception 'Approver is not an active employee';
  end if;

  if target_approver=actor then
    raise exception 'A requester cannot approve their own work';
  end if;

  select
    coalesce(max(approval_round),0),
    count(*) filter (
      where status='pending'
        and approval_round=(
          select coalesce(max(a2.approval_round),0)
          from public.work_item_approvals a2
          where a2.work_item_id=target_work_item
        )
    )
  into latest_round,pending_in_latest
  from public.work_item_approvals
  where work_item_id=target_work_item;

  next_round := case
    when latest_round=0 then 1
    when pending_in_latest>0 then latest_round
    else latest_round+1
  end;

  insert into public.work_item_approvals(
    work_item_id,
    approver_id,
    requested_by,
    approval_round,
    request_note
  )
  values(
    target_work_item,
    target_approver,
    actor,
    next_round,
    nullif(trim(coalesce(note,'')),'')
  )
  returning id into new_approval;

  update public.work_items
  set status='review',completed_at=null
  where id=target_work_item
    and status<>'cancelled';

  insert into public.notifications(
    user_id,type,title,body,entity_type,entity_id
  )
  values(
    target_approver,
    'approval_required',
    'Approval required',
    coalesce(task_title,'Work item'),
    'work_item',
    target_work_item
  );

  insert into public.work_item_activity(
    work_item_id,actor_id,action,metadata
  )
  values(
    target_work_item,
    actor,
    'approval_requested',
    jsonb_build_object(
      'approval_id',new_approval,
      'approver_id',target_approver,
      'approval_round',next_round
    )
  );

  return new_approval;
end;
$$;

create or replace function public.decide_work_approval(
  target_approval uuid,
  decision text,
  note text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
  approval_row public.work_item_approvals%rowtype;
  pending_count integer;
  rejected_count integer;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  if decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select *
  into approval_row
  from public.work_item_approvals
  where id=target_approval
  for update;

  if approval_row.id is null then
    raise exception 'Approval not found';
  end if;

  if approval_row.status<>'pending' then
    raise exception 'Approval has already been decided';
  end if;

  if not (
    approval_row.approver_id=actor
    or public.has_workspace_role(array['manager','admin'])
    or (
      public.is_department_head_of_work(approval_row.work_item_id)
      and approval_row.requested_by<>actor
    )
  ) then
    raise exception 'You cannot decide this approval';
  end if;

  perform 1
  from public.work_items
  where id=approval_row.work_item_id
  for update;

  update public.work_item_approvals
  set
    status=decision,
    decision_note=nullif(trim(coalesce(note,'')),''),
    decided_at=now()
  where id=target_approval;

  select
    count(*) filter (where status='pending'),
    count(*) filter (where status='rejected')
  into pending_count,rejected_count
  from public.work_item_approvals
  where work_item_id=approval_row.work_item_id
    and approval_round=approval_row.approval_round;

  if decision='rejected' or rejected_count>0 then
    update public.work_items
    set status='in_progress',completed_at=null
    where id=approval_row.work_item_id;
  elsif pending_count=0 then
    update public.work_items
    set status='completed',completed_at=now()
    where id=approval_row.work_item_id;
  end if;

  insert into public.work_item_activity(
    work_item_id,actor_id,action,metadata
  )
  values(
    approval_row.work_item_id,
    actor,
    case when decision='approved'
      then 'approval_approved'
      else 'approval_rejected'
    end,
    jsonb_build_object(
      'approval_id',target_approval,
      'decision',decision,
      'approval_round',approval_row.approval_round
    )
  );

  insert into public.notifications(
    user_id,type,title,body,entity_type,entity_id
  )
  select
    w.created_by,
    case when decision='approved'
      then 'approval_completed'
      else 'approval_rejected'
    end,
    case when decision='approved'
      then 'Work approved'
      else 'Approval rejected'
    end,
    w.title,
    'work_item',
    w.id
  from public.work_items w
  where w.id=approval_row.work_item_id;
end;
$$;

create or replace function public.update_work_status(
  target_work_item uuid,
  new_status text
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.work_items
  where id=target_work_item
  for update;

  if not found then
    raise exception 'Work item not found';
  end if;

  if new_status not in (
    'assigned','in_progress','blocked','review','completed','cancelled'
  ) then
    raise exception 'Invalid work status';
  end if;

  if not (
    exists(
      select 1
      from public.work_items w
      where w.id=target_work_item
        and w.created_by=actor
    )
    or exists(
      select 1
      from public.work_item_assignees a
      where a.work_item_id=target_work_item
        and a.assignee_id=actor
    )
    or public.has_workspace_role(array['manager','admin'])
    or public.is_department_head_of_work(target_work_item)
  ) then
    raise exception 'You cannot change this work item status';
  end if;

  if new_status='cancelled'
    and not (
      exists(
        select 1
        from public.work_items w
        where w.id=target_work_item
          and w.created_by=actor
      )
      or public.has_workspace_role(array['manager','admin'])
      or public.is_department_head_of_work(target_work_item)
    )
  then
    raise exception 'Only the creator, a department head, Manager or Admin can cancel work';
  end if;

  if new_status='completed'
    and exists(
      select 1
      from public.work_item_approvals a
      where a.work_item_id=target_work_item
        and a.status='pending'
    )
  then
    raise exception 'Pending approvals must be decided before completion';
  end if;

  update public.work_items
  set
    status=new_status,
    completed_at=case
      when new_status='completed' then now()
      else null
    end
  where id=target_work_item;

  insert into public.work_item_activity(
    work_item_id,actor_id,action,metadata
  )
  values(
    target_work_item,
    actor,
    'status_changed',
    jsonb_build_object('status',new_status)
  );
end;
$$;

create or replace function public.cancel_work_approval(
  target_approval uuid,
  note text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid := auth.uid();
  approval_row public.work_item_approvals%rowtype;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  select *
  into approval_row
  from public.work_item_approvals
  where id=target_approval
  for update;

  if approval_row.id is null then
    raise exception 'Approval not found';
  end if;

  if approval_row.status<>'pending' then
    raise exception 'Only a pending approval can be cancelled';
  end if;

  if not (
    approval_row.requested_by=actor
    or public.has_workspace_role(array['manager','admin'])
    or public.is_department_head_of_work(approval_row.work_item_id)
  ) then
    raise exception 'You cannot cancel this approval';
  end if;

  perform 1
  from public.work_items
  where id=approval_row.work_item_id
  for update;

  update public.work_item_approvals
  set
    status='cancelled',
    decision_note=nullif(trim(coalesce(note,'')),''),
    decided_at=now()
  where id=target_approval;

  if not exists(
    select 1
    from public.work_item_approvals
    where work_item_id=approval_row.work_item_id
      and approval_round=approval_row.approval_round
      and status='pending'
  ) then
    update public.work_items
    set status='in_progress',completed_at=null
    where id=approval_row.work_item_id
      and status='review';
  end if;

  insert into public.work_item_activity(
    work_item_id,actor_id,action,metadata
  )
  values(
    approval_row.work_item_id,
    actor,
    'approval_cancelled',
    jsonb_build_object(
      'approval_id',target_approval,
      'approval_round',approval_row.approval_round
    )
  );
end;
$$;

commit;
