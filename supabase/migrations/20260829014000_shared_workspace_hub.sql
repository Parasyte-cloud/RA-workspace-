begin;

-- ==========================================================
-- SHARED WORKSPACE HUB HARDENING
-- Keep department workspaces private while giving employees
-- controlled project/cross-department collaboration controls.
-- ==========================================================

create or replace function public.can_manage_collaboration_space(
  target_space uuid
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
      where me.id=auth.uid()
        and me.active=true
    )
    and (
      public.has_workspace_role(array['manager','admin'])
      or exists(
        select 1
        from public.collaboration_space_members m
        join public.collaboration_spaces s
          on s.id=m.space_id
        where m.space_id=target_space
          and m.user_id=auth.uid()
          and m.member_role in ('owner','admin')
          and s.archived_at is null
      )
    );
$$;

grant execute
on function public.can_manage_collaboration_space(uuid)
to authenticated;

-- Invitations are only for explicitly shared spaces.
-- Department membership continues to come from department assignment.
create or replace function public.invite_to_collaboration_space(
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
  workspace public.collaboration_spaces%rowtype;
  my_member_role text;
begin
  select *
  into workspace
  from public.collaboration_spaces
  where id=p_space_id
    and archived_at is null;

  if not found then
    raise exception 'Workspace not found';
  end if;

  if workspace.space_type='department' then
    raise exception 'Department workspaces do not accept invitations';
  end if;

  if not public.can_access_collaboration_space(p_space_id) then
    raise exception 'You cannot access this workspace';
  end if;

  select m.member_role
  into my_member_role
  from public.collaboration_space_members m
  where m.space_id=p_space_id
    and m.user_id=auth.uid();

  if not (
    public.has_workspace_role(array['manager','admin'])
    or my_member_role in ('owner','admin','member')
  ) then
    raise exception 'Your workspace role cannot invite collaborators';
  end if;

  if p_invitee_id=auth.uid() then
    raise exception 'You are already in this workspace';
  end if;

  if not exists(
    select 1
    from public.employee_profiles
    where id=p_invitee_id
      and active=true
  ) then
    raise exception 'Invitee is not an active employee';
  end if;

  if exists(
    select 1
    from public.collaboration_space_members
    where space_id=p_space_id
      and user_id=p_invitee_id
  ) then
    raise exception 'Employee is already a workspace member';
  end if;

  select id
  into invite_id
  from public.collaboration_invites
  where space_id=p_space_id
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
    nullif(trim(coalesce(p_message,'')),'')
  )
  returning id into invite_id;

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
      || workspace.name
      || '.',
    'collaboration_invite',
    invite_id
  );

  return invite_id;
end;
$$;

grant execute
on function public.invite_to_collaboration_space(uuid,uuid,text)
to authenticated;

create or replace function public.cancel_collaboration_invite(
  p_invite_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  invitation public.collaboration_invites%rowtype;
begin
  select *
  into invitation
  from public.collaboration_invites
  where id=p_invite_id
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if invitation.status<>'pending' then
    raise exception 'Invitation is no longer pending';
  end if;

  if not (
    invitation.inviter_id=auth.uid()
    or public.can_manage_collaboration_space(invitation.space_id)
  ) then
    raise exception 'You cannot cancel this invitation';
  end if;

  update public.collaboration_invites
  set
    status='cancelled',
    responded_at=now()
  where id=p_invite_id;
end;
$$;

grant execute
on function public.cancel_collaboration_invite(uuid)
to authenticated;

create or replace function public.set_collaboration_member_role(
  p_space_id uuid,
  p_user_id uuid,
  p_member_role text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  workspace_type text;
  existing_role text;
  owner_count integer;
begin
  if p_member_role not in ('owner','admin','member','viewer') then
    raise exception 'Invalid collaboration member role';
  end if;

  select space_type
  into workspace_type
  from public.collaboration_spaces
  where id=p_space_id
    and archived_at is null;

  if workspace_type is null then
    raise exception 'Workspace not found';
  end if;

  if workspace_type='department' then
    raise exception 'Department workspace roles are managed by employee department assignment';
  end if;

  if not public.can_manage_collaboration_space(p_space_id) then
    raise exception 'You cannot manage this workspace';
  end if;

  select member_role
  into existing_role
  from public.collaboration_space_members
  where space_id=p_space_id
    and user_id=p_user_id;

  if existing_role is null then
    raise exception 'Workspace member not found';
  end if;

  if existing_role='owner' and p_member_role<>'owner' then
    select count(*)
    into owner_count
    from public.collaboration_space_members
    where space_id=p_space_id
      and member_role='owner';

    if owner_count<=1 then
      raise exception 'Assign another owner before changing the last owner role';
    end if;
  end if;

  update public.collaboration_space_members
  set member_role=p_member_role
  where space_id=p_space_id
    and user_id=p_user_id;

  if not found then
    raise exception 'Workspace member not found';
  end if;
end;
$$;

grant execute
on function public.set_collaboration_member_role(uuid,uuid,text)
to authenticated;

create or replace function public.remove_collaboration_space_member(
  p_space_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  workspace_type text;
  target_role text;
  owner_count integer;
begin
  select space_type
  into workspace_type
  from public.collaboration_spaces
  where id=p_space_id
    and archived_at is null;

  if workspace_type is null then
    raise exception 'Workspace not found';
  end if;

  if workspace_type='department' then
    raise exception 'Department membership is controlled by employee department assignment';
  end if;

  if p_user_id=auth.uid() then
    raise exception 'Use leave workspace to remove yourself';
  end if;

  if not public.can_manage_collaboration_space(p_space_id) then
    raise exception 'You cannot manage this workspace';
  end if;

  select member_role
  into target_role
  from public.collaboration_space_members
  where space_id=p_space_id
    and user_id=p_user_id;

  if target_role is null then
    raise exception 'Workspace member not found';
  end if;

  if target_role='owner' then
    select count(*)
    into owner_count
    from public.collaboration_space_members
    where space_id=p_space_id
      and member_role='owner';

    if owner_count<=1 then
      raise exception 'The last workspace owner cannot be removed';
    end if;
  end if;

  delete from public.collaboration_space_members
  where space_id=p_space_id
    and user_id=p_user_id;
end;
$$;

grant execute
on function public.remove_collaboration_space_member(uuid,uuid)
to authenticated;

create or replace function public.leave_collaboration_space(
  p_space_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  workspace_type text;
  my_role text;
  owner_count integer;
begin
  select space_type
  into workspace_type
  from public.collaboration_spaces
  where id=p_space_id
    and archived_at is null;

  if workspace_type is null then
    raise exception 'Workspace not found';
  end if;

  if workspace_type='department' then
    raise exception 'Department membership follows your employee department assignment';
  end if;

  select member_role
  into my_role
  from public.collaboration_space_members
  where space_id=p_space_id
    and user_id=auth.uid();

  if my_role is null then
    raise exception 'You are not a member of this workspace';
  end if;

  if my_role='owner' then
    select count(*)
    into owner_count
    from public.collaboration_space_members
    where space_id=p_space_id
      and member_role='owner';

    if owner_count<=1 then
      raise exception 'Assign another owner before leaving this workspace';
    end if;
  end if;

  delete from public.collaboration_space_members
  where space_id=p_space_id
    and user_id=auth.uid();
end;
$$;

grant execute
on function public.leave_collaboration_space(uuid)
to authenticated;

create or replace function public.archive_collaboration_space(
  p_space_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  workspace_type text;
begin
  select space_type
  into workspace_type
  from public.collaboration_spaces
  where id=p_space_id
    and archived_at is null;

  if workspace_type is null then
    raise exception 'Workspace not found';
  end if;

  if workspace_type='department' then
    raise exception 'Department workspaces cannot be archived here';
  end if;

  if not public.can_manage_collaboration_space(p_space_id) then
    raise exception 'You cannot archive this workspace';
  end if;

  update public.collaboration_spaces
  set archived_at=now()
  where id=p_space_id;

  update public.collaboration_invites
  set
    status='cancelled',
    responded_at=coalesce(responded_at,now())
  where space_id=p_space_id
    and status='pending';
end;
$$;

grant execute
on function public.archive_collaboration_space(uuid)
to authenticated;

commit;
