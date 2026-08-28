-- ============================================================
-- RideArrivo Work Delegation + Realtime Notifications
-- ============================================================

begin;

-- ------------------------------------------------------------
-- WORK ITEMS
-- ------------------------------------------------------------

create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  description text not null default '',

  status text not null default 'assigned'
    check (
      status in (
        'draft',
        'assigned',
        'in_progress',
        'blocked',
        'review',
        'completed',
        'cancelled'
      )
    ),

  priority text not null default 'normal'
    check (
      priority in (
        'low',
        'normal',
        'high',
        'urgent'
      )
    ),

  department text,

  created_by uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  due_at timestamptz,

  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- ASSIGNEES
-- Supports one or many employees per work item.
-- ------------------------------------------------------------

create table if not exists public.work_item_assignees (
  id uuid primary key default gen_random_uuid(),

  work_item_id uuid not null
    references public.work_items(id)
    on delete cascade,

  assignee_id uuid not null
    references public.employee_profiles(id)
    on delete cascade,

  assigned_by uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  assigned_at timestamptz not null default now(),

  acknowledged_at timestamptz,

  unique(work_item_id,assignee_id)
);


-- ------------------------------------------------------------
-- COMMENTS
-- ------------------------------------------------------------

create table if not exists public.work_item_comments (
  id uuid primary key default gen_random_uuid(),

  work_item_id uuid not null
    references public.work_items(id)
    on delete cascade,

  author_id uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  body text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- ACTIVITY / AUDIT TRAIL
-- ------------------------------------------------------------

create table if not exists public.work_item_activity (
  id uuid primary key default gen_random_uuid(),

  work_item_id uuid not null
    references public.work_items(id)
    on delete cascade,

  actor_id uuid
    references public.employee_profiles(id)
    on delete set null,

  action text not null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- NOTIFICATIONS
-- ------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.employee_profiles(id)
    on delete cascade,

  type text not null,

  title text not null,

  body text not null default '',

  entity_type text,
  entity_id uuid,

  read_at timestamptz,

  created_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

create index if not exists
  idx_work_items_created_by
on public.work_items(created_by);

create index if not exists
  idx_work_items_department
on public.work_items(department);

create index if not exists
  idx_work_items_status
on public.work_items(status);

create index if not exists
  idx_work_items_due_at
on public.work_items(due_at);

create index if not exists
  idx_work_assignees_assignee
on public.work_item_assignees(assignee_id);

create index if not exists
  idx_work_assignees_item
on public.work_item_assignees(work_item_id);

create index if not exists
  idx_work_comments_item
on public.work_item_comments(work_item_id,created_at);

create index if not exists
  idx_work_activity_item
on public.work_item_activity(work_item_id,created_at);

create index if not exists
  idx_notifications_user_unread
on public.notifications(user_id,read_at,created_at desc);


-- ------------------------------------------------------------
-- UPDATED_AT
-- ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists
  work_items_set_updated_at
on public.work_items;

create trigger
  work_items_set_updated_at
before update on public.work_items
for each row
execute function public.set_updated_at();


drop trigger if exists
  work_comments_set_updated_at
on public.work_item_comments;

create trigger
  work_comments_set_updated_at
before update on public.work_item_comments
for each row
execute function public.set_updated_at();


-- ------------------------------------------------------------
-- ASSIGNMENT AUTHORIZATION
--
-- Admin/Manager:
--   may assign work to any active employee.
--
-- Everyone else:
--   may currently create work for themselves only.
--
-- CTO will be added in a separate role migration and will
-- receive Engineering-only delegation rights.
-- ------------------------------------------------------------

create or replace function public.can_assign_work(
  target_user uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select
    case
      when public.has_workspace_role(
        array['admin','manager']
      )
      then exists(
        select 1
        from public.employee_profiles p
        where
          p.id = target_user
          and p.active = true
      )

      else target_user = auth.uid()
    end;
$$;


-- ------------------------------------------------------------
-- AUTOMATIC NOTIFICATION ON ASSIGNMENT
-- ------------------------------------------------------------

create or replace function
public.notify_work_assignment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  item_title text;
begin
  select title
  into item_title
  from public.work_items
  where id = new.work_item_id;

  insert into public.notifications(
    user_id,
    type,
    title,
    body,
    entity_type,
    entity_id
  )
  values(
    new.assignee_id,
    'task_assigned',
    'New work assigned',
    coalesce(item_title,'Work item'),
    'work_item',
    new.work_item_id
  );

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    new.work_item_id,
    new.assigned_by,
    'assigned',
    jsonb_build_object(
      'assignee_id',
      new.assignee_id
    )
  );

  return new;
end;
$$;

drop trigger if exists
  notify_work_assignment
on public.work_item_assignees;

create trigger
  notify_work_assignment
after insert
on public.work_item_assignees
for each row
execute function public.notify_work_assignment();


-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.work_items
  enable row level security;

alter table public.work_item_assignees
  enable row level security;

alter table public.work_item_comments
  enable row level security;

alter table public.work_item_activity
  enable row level security;

alter table public.notifications
  enable row level security;


-- ------------------------------------------------------------
-- WORK ITEM READ
--
-- User sees work if:
--   assigned to them
--   created by them
--   Manager/Admin
-- ------------------------------------------------------------

drop policy if exists
  "work items read"
on public.work_items;

create policy "work items read"
on public.work_items
for select
to authenticated
using (
  created_by = auth.uid()

  or exists(
    select 1
    from public.work_item_assignees a
    where
      a.work_item_id = work_items.id
      and a.assignee_id = auth.uid()
  )

  or public.has_workspace_role(
    array['manager','admin']
  )
);


-- ------------------------------------------------------------
-- CREATE WORK ITEMS
-- ------------------------------------------------------------

drop policy if exists
  "work items create"
on public.work_items;

create policy "work items create"
on public.work_items
for insert
to authenticated
with check (
  created_by = auth.uid()
);


-- ------------------------------------------------------------
-- UPDATE WORK ITEMS
--
-- Creator, assignee, Manager/Admin.
-- ------------------------------------------------------------

drop policy if exists
  "work items update"
on public.work_items;

create policy "work items update"
on public.work_items
for update
to authenticated
using (
  created_by = auth.uid()

  or exists(
    select 1
    from public.work_item_assignees a
    where
      a.work_item_id = work_items.id
      and a.assignee_id = auth.uid()
  )

  or public.has_workspace_role(
    array['manager','admin']
  )
)
with check (
  created_by = auth.uid()

  or exists(
    select 1
    from public.work_item_assignees a
    where
      a.work_item_id = work_items.id
      and a.assignee_id = auth.uid()
  )

  or public.has_workspace_role(
    array['manager','admin']
  )
);


-- ------------------------------------------------------------
-- ASSIGNEES
-- ------------------------------------------------------------

drop policy if exists
  "work assignees read"
on public.work_item_assignees;

create policy "work assignees read"
on public.work_item_assignees
for select
to authenticated
using (
  assignee_id = auth.uid()

  or assigned_by = auth.uid()

  or exists(
    select 1
    from public.work_items w
    where
      w.id = work_item_id
      and w.created_by = auth.uid()
  )

  or public.has_workspace_role(
    array['manager','admin']
  )
);


drop policy if exists
  "work assignees create"
on public.work_item_assignees;

create policy "work assignees create"
on public.work_item_assignees
for insert
to authenticated
with check (
  assigned_by = auth.uid()
  and public.can_assign_work(assignee_id)
);


-- ------------------------------------------------------------
-- COMMENTS
-- Users can comment only on work they can access.
-- ------------------------------------------------------------

drop policy if exists
  "work comments read"
on public.work_item_comments;

create policy "work comments read"
on public.work_item_comments
for select
to authenticated
using (
  exists(
    select 1
    from public.work_items w
    where
      w.id = work_item_id
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
  )
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

  and exists(
    select 1
    from public.work_items w
    where
      w.id = work_item_id
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
  )
);


-- ------------------------------------------------------------
-- ACTIVITY
-- ------------------------------------------------------------

drop policy if exists
  "work activity read"
on public.work_item_activity;

create policy "work activity read"
on public.work_item_activity
for select
to authenticated
using (
  exists(
    select 1
    from public.work_items w
    where
      w.id = work_item_id
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
  )
);


-- ------------------------------------------------------------
-- NOTIFICATIONS
-- User can only read/update their own notifications.
-- ------------------------------------------------------------

drop policy if exists
  "notifications own read"
on public.notifications;

create policy "notifications own read"
on public.notifications
for select
to authenticated
using (
  user_id = auth.uid()
);


drop policy if exists
  "notifications own update"
on public.notifications;

create policy "notifications own update"
on public.notifications
for update
to authenticated
using (
  user_id = auth.uid()
)
with check (
  user_id = auth.uid()
);


-- ------------------------------------------------------------
-- GRANTS
-- ------------------------------------------------------------

grant select,insert,update
on public.work_items
to authenticated;

grant select,insert
on public.work_item_assignees
to authenticated;

grant select,insert
on public.work_item_comments
to authenticated;

grant select
on public.work_item_activity
to authenticated;

grant select,update
on public.notifications
to authenticated;

grant execute
on function public.can_assign_work(uuid)
to authenticated;

revoke all
on public.work_items
from anon;

revoke all
on public.work_item_assignees
from anon;

revoke all
on public.work_item_comments
from anon;

revoke all
on public.work_item_activity
from anon;

revoke all
on public.notifications
from anon;


-- ------------------------------------------------------------
-- REALTIME
-- Add notifications/work changes to Supabase realtime.
-- Ignore duplicate publication membership safely.
-- ------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime
      add table public.notifications;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime
      add table public.work_items;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime
      add table public.work_item_assignees;
  exception
    when duplicate_object then null;
  end;
end
$$;

commit;
