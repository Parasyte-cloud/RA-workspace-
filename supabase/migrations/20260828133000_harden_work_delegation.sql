-- ============================================================
-- RideArrivo Work Delegation Hardening
--
-- Removes circular RLS lookups and provides an atomic
-- server-side task assignment RPC.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- SECURITY-DEFINER READ CHECK
-- Prevents work_items <-> assignees RLS recursion.
-- ------------------------------------------------------------

create or replace function public.can_read_work_item(
  target_work_item uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.work_items w
    where
      w.id = target_work_item
      and (
        w.created_by = auth.uid()

        or exists(
          select 1
          from public.work_item_assignees a
          where
            a.work_item_id = w.id
            and a.assignee_id = auth.uid()
        )

        or public.has_workspace_role(
          array['manager','admin']
        )
      )
  );
$$;

revoke all
on function public.can_read_work_item(uuid)
from public;

grant execute
on function public.can_read_work_item(uuid)
to authenticated;


-- ------------------------------------------------------------
-- REBUILD READ POLICIES USING THE SAFE HELPER
-- ------------------------------------------------------------

drop policy if exists
  "work items read"
on public.work_items;

create policy "work items read"
on public.work_items
for select
to authenticated
using (
  public.can_read_work_item(id)
);


drop policy if exists
  "work assignees read"
on public.work_item_assignees;

create policy "work assignees read"
on public.work_item_assignees
for select
to authenticated
using (
  public.can_read_work_item(work_item_id)
);


drop policy if exists
  "work comments read"
on public.work_item_comments;

create policy "work comments read"
on public.work_item_comments
for select
to authenticated
using (
  public.can_read_work_item(work_item_id)
);


drop policy if exists
  "work comments create"
on public.work_item_comments;

create policy "work comments create"
on public.work_item_comments
for insert
to authenticated
with check (
  author_id = auth.uid()
  and public.can_read_work_item(work_item_id)
);


drop policy if exists
  "work activity read"
on public.work_item_activity;

create policy "work activity read"
on public.work_item_activity
for select
to authenticated
using (
  public.can_read_work_item(work_item_id)
);


-- ------------------------------------------------------------
-- ATOMIC ASSIGNMENT RPC
--
-- Creates:
--   work item
--   assignee
--   notification (via trigger)
--   activity event (via trigger)
--
-- all in one transaction.
-- ------------------------------------------------------------

create or replace function public.create_work_assignment(
  task_title text,
  task_description text default '',
  target_user uuid default null,
  task_priority text default 'normal',
  task_due_at timestamptz default null,
  task_department text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid;
  assignee uuid;
  new_work_item uuid;
  target_department text;
begin
  actor := auth.uid();

  if actor is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(task_title),'') is null then
    raise exception 'Task title is required';
  end if;

  if task_priority not in (
    'low',
    'normal',
    'high',
    'urgent'
  ) then
    raise exception 'Invalid task priority';
  end if;

  assignee := coalesce(
    target_user,
    actor
  );

  if not public.can_assign_work(assignee) then
    raise exception
      'You are not permitted to assign work to this employee';
  end if;

  select department
  into target_department
  from public.employee_profiles
  where
    id = assignee
    and active = true;

  if target_department is null then
    raise exception
      'Assignee is not an active employee';
  end if;

  insert into public.work_items(
    title,
    description,
    status,
    priority,
    department,
    created_by,
    due_at
  )
  values(
    trim(task_title),
    coalesce(task_description,''),
    'assigned',
    task_priority,
    coalesce(
      nullif(trim(task_department),''),
      target_department
    ),
    actor,
    task_due_at
  )
  returning id
  into new_work_item;

  insert into public.work_item_assignees(
    work_item_id,
    assignee_id,
    assigned_by
  )
  values(
    new_work_item,
    assignee,
    actor
  );

  return new_work_item;
end;
$$;

revoke all
on function public.create_work_assignment(
  text,
  text,
  uuid,
  text,
  timestamptz,
  text
)
from public;

grant execute
on function public.create_work_assignment(
  text,
  text,
  uuid,
  text,
  timestamptz,
  text
)
to authenticated;


-- ------------------------------------------------------------
-- SAFE STATUS RPC
-- Prevent assignees from freely altering task ownership,
-- department, creator, etc.
-- ------------------------------------------------------------

create or replace function public.update_work_status(
  target_work_item uuid,
  new_status text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if new_status not in (
    'assigned',
    'in_progress',
    'blocked',
    'review',
    'completed',
    'cancelled'
  ) then
    raise exception 'Invalid work status';
  end if;

  if not public.can_read_work_item(target_work_item) then
    raise exception 'Work item not accessible';
  end if;

  update public.work_items
  set
    status = new_status,
    completed_at =
      case
        when new_status='completed'
          then now()
        else null
      end
  where id = target_work_item;

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    target_work_item,
    auth.uid(),
    'status_changed',
    jsonb_build_object(
      'status',
      new_status
    )
  );
end;
$$;

revoke all
on function public.update_work_status(uuid,text)
from public;

grant execute
on function public.update_work_status(uuid,text)
to authenticated;


-- Do not permit arbitrary client-side UPDATE of work-item
-- ownership/security fields.
revoke update
on public.work_items
from authenticated;

grant select,insert
on public.work_items
to authenticated;


commit;
