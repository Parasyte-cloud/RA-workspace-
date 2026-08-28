-- ============================================================
-- RideArrivo Workspace Security Hardening
--
-- Final security layer before Shared Spaces UI.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- ACTIVE MEMBERSHIP
-- No active employee = no workspace role.
-- ------------------------------------------------------------

create or replace function public.current_workspace_role()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select p.role
  from public.employee_profiles p
  where
    p.id=auth.uid()
    and p.active=true
  limit 1;
$$;

create or replace function public.has_workspace_role(
  roles text[]
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(
    public.current_workspace_role() = any(roles),
    false
  );
$$;

revoke all
on function public.current_workspace_role()
from public;

revoke all
on function public.has_workspace_role(text[])
from public;

grant execute
on function public.current_workspace_role()
to authenticated;

grant execute
on function public.has_workspace_role(text[])
to authenticated;


-- ------------------------------------------------------------
-- WORK DESK READ AUTHORIZATION
--
-- Creator
-- Assignee
-- Watcher
-- Manager/Admin
--
-- All require an active employee profile.
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
  select

    exists(
      select 1
      from public.employee_profiles me
      where
        me.id=auth.uid()
        and me.active=true
    )

    and

    exists(
      select 1
      from public.work_items w
      where
        w.id=target_work_item

        and (
          w.created_by=auth.uid()

          or exists(
            select 1
            from public.work_item_assignees a
            where
              a.work_item_id=w.id
              and a.assignee_id=auth.uid()
          )

          or exists(
            select 1
            from public.work_item_watchers wt
            where
              wt.work_item_id=w.id
              and wt.user_id=auth.uid()
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
-- FORCE AUDITED ASSIGNMENT PATHS
--
-- Task creation must use create_work_assignment().
-- Additional assignees must use add_work_assignee().
-- ------------------------------------------------------------

revoke insert
on public.work_items
from authenticated;

revoke update
on public.work_items
from authenticated;

revoke insert
on public.work_item_assignees
from authenticated;

revoke delete
on public.work_item_assignees
from authenticated;

grant select
on public.work_items,
   public.work_item_assignees
to authenticated;


-- Old policies can remain harmless without grants, but remove
-- the obsolete direct UPDATE policy so the security model is
-- unambiguous.
drop policy if exists
  "work items update"
on public.work_items;


-- ------------------------------------------------------------
-- NOTIFICATIONS
--
-- A recipient may mark a notification read.
-- They may not rewrite its title/body/entity/user.
-- ------------------------------------------------------------

revoke update
on public.notifications
from authenticated;

grant update(read_at)
on public.notifications
to authenticated;


-- ------------------------------------------------------------
-- DEPARTMENT SPACE SYNCHRONISATION
--
-- When any employee opens their department workspace:
--   1. create it if needed
--   2. remove stale department members
--   3. add every active employee in that department
--
-- This means 2, 5 or 50 Marketing employees automatically
-- share the same Marketing Team Workspace.
-- ------------------------------------------------------------

create or replace function
public.ensure_department_space()
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  me public.employee_profiles%rowtype;
  result_id uuid;
begin

  select *
  into me
  from public.employee_profiles
  where
    id=auth.uid()
    and active=true;

  if not found then
    raise exception
      'Active workspace profile required';
  end if;

  if
    me.department is null
    or trim(me.department)=''
    or lower(trim(me.department))='unassigned'
  then
    raise exception
      'Employee department is not configured';
  end if;


  select s.id
  into result_id
  from public.collaboration_spaces s
  where
    s.space_type='department'
    and s.archived_at is null
    and lower(trim(s.home_department))
        = lower(trim(me.department))
  limit 1;


  if result_id is null then

    begin

      insert into public.collaboration_spaces(
        name,
        description,
        space_type,
        home_department,
        created_by
      )
      values(
        me.department || ' Team Workspace',

        'Shared workspace for the '
          || me.department
          || ' team.',

        'department',
        me.department,
        auth.uid()
      )
      returning id
      into result_id;

    exception
      when unique_violation then

        select s.id
        into result_id
        from public.collaboration_spaces s
        where
          s.space_type='department'
          and s.archived_at is null
          and lower(trim(s.home_department))
              = lower(trim(me.department))
        limit 1;

    end;

  end if;


  -- Remove people who are no longer active members
  -- of this department.
  delete from public.collaboration_space_members m
  where
    m.space_id=result_id

    and not exists(
      select 1
      from public.employee_profiles p
      where
        p.id=m.user_id
        and p.active=true
        and lower(trim(p.department))
            = lower(trim(me.department))
    );


  -- Add every active employee in this department.
  insert into public.collaboration_space_members(
    space_id,
    user_id,
    member_role,
    added_by
  )
  select
    result_id,
    p.id,

    case
      when p.id=auth.uid()
        and not exists(
          select 1
          from public.collaboration_space_members existing
          where existing.space_id=result_id
        )
      then 'owner'
      else 'member'
    end,

    auth.uid()

  from public.employee_profiles p

  where
    p.active=true
    and lower(trim(p.department))
        = lower(trim(me.department))

  on conflict(space_id,user_id)
  do nothing;


  return result_id;
end;
$$;

revoke all
on function public.ensure_department_space()
from public;

grant execute
on function public.ensure_department_space()
to authenticated;


-- ------------------------------------------------------------
-- CROSS-DEPARTMENT INVITATIONS
--
-- Department workspaces stay private to that department.
-- Cross-department work must happen in Project or
-- Cross-Department spaces.
-- ------------------------------------------------------------

create or replace function
public.invite_to_collaboration_space(
  p_space_id uuid,
  p_invitee_id uuid,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  invite_id uuid;
  space_name text;
  space_kind text;
  space_department text;
  invitee_department text;
begin

  if not public.can_access_collaboration_space(
    p_space_id
  ) then
    raise exception
      'You cannot access this workspace';
  end if;


  if p_invitee_id=auth.uid() then
    raise exception
      'You are already in this workspace';
  end if;


  select
    name,
    space_type,
    home_department
  into
    space_name,
    space_kind,
    space_department
  from public.collaboration_spaces
  where
    id=p_space_id
    and archived_at is null;

  if not found then
    raise exception
      'Workspace not found';
  end if;


  select department
  into invitee_department
  from public.employee_profiles
  where
    id=p_invitee_id
    and active=true;

  if not found then
    raise exception
      'Invitee is not an active employee';
  end if;


  -- Never use an invitation to bypass departmental isolation.
  if
    space_kind='department'
    and lower(trim(coalesce(invitee_department,'')))
        <>
        lower(trim(coalesce(space_department,'')))
  then
    raise exception
      'Cross-department collaboration requires a project or shared workspace';
  end if;


  if exists(
    select 1
    from public.collaboration_space_members
    where
      space_id=p_space_id
      and user_id=p_invitee_id
  ) then
    raise exception
      'Employee is already a workspace member';
  end if;


  select id
  into invite_id
  from public.collaboration_invites
  where
    space_id=p_space_id
    and invitee_id=p_invitee_id
    and status='pending'
  limit 1;

  if invite_id is not null then
    return invite_id;
  end if;


  insert into public.collaboration_invites(
    space_id,
    inviter_id,
    invitee_id,
    message
  )
  values(
    p_space_id,
    auth.uid(),
    p_invitee_id,
    nullif(
      trim(
        coalesce(
          p_message,
          ''
        )
      ),
      ''
    )
  )
  returning id
  into invite_id;


  insert into public.notifications(
    user_id,
    type,
    title,
    body,
    entity_type,
    entity_id
  )
  values(
    p_invitee_id,

    'collaboration_invite',

    'Workspace invitation',

    'You were invited to collaborate in '
      || coalesce(
        space_name,
        'a shared workspace'
      )
      || '.',

    'collaboration_invite',
    invite_id
  );


  return invite_id;
end;
$$;

revoke all
on function public.invite_to_collaboration_space(
  uuid,
  uuid,
  text
)
from public;

grant execute
on function public.invite_to_collaboration_space(
  uuid,
  uuid,
  text
)
to authenticated;


commit;
