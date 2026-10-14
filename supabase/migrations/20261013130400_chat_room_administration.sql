begin;

-- ============================================================
-- RideArrivo Department Communications
-- Secured governed-room administration.
--
-- Browser clients receive EXECUTE permission only.
-- Direct chat_rooms mutations remain denied by RLS/grants.
-- ============================================================


-- ------------------------------------------------------------
-- Create an additional governed room.
--
-- Default Department Rooms remain structural and are created by
-- the department synchronisation lifecycle, not this browser RPC.
-- ------------------------------------------------------------

create or replace function public.create_chat_room(
  p_title text,
  p_room_type text,
  p_description text default null,
  p_history_policy text default 'full'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_room_type text := lower(btrim(coalesce(p_room_type, '')));
  v_description text :=
    nullif(btrim(coalesce(p_description, '')), '');
  v_history_policy text :=
    lower(btrim(coalesce(p_history_policy, 'full')));
  v_conversation uuid;
  v_history_from timestamptz;
begin
  if v_actor is null
     or not public.is_workspace_chat_admin() then
    raise exception 'Chat administrator access required'
      using errcode = '42501';
  end if;

  if char_length(v_title) < 2
     or char_length(v_title) > 120 then
    raise exception
      'Room title must be between 2 and 120 characters';
  end if;

  if v_room_type not in (
    'project',
    'committee',
    'restricted'
  ) then
    raise exception 'Unsupported governed room type';
  end if;

  if v_history_policy not in (
    'full',
    'from_join_date'
  ) then
    raise exception 'Unsupported room history policy';
  end if;

  if v_description is not null
     and char_length(v_description) > 1000 then
    raise exception
      'Room description must be 1000 characters or fewer';
  end if;

  insert into public.social_conversations(
    is_group,
    title,
    created_by,
    conversation_kind
  )
  values(
    true,
    v_title,
    v_actor,
    v_room_type
  )
  returning id into v_conversation;

  insert into public.chat_rooms(
    conversation_id,
    room_type,
    department,
    description,
    status,
    history_policy,
    created_by
  )
  values(
    v_conversation,
    v_room_type,
    null,
    v_description,
    'active',
    v_history_policy,
    v_actor
  );

  v_history_from := case
    when v_history_policy = 'from_join_date'
      then clock_timestamp()
    else null
  end;

  insert into public.social_conversation_members(
    conversation_id,
    user_id,
    room_role,
    added_by,
    removed_at,
    history_from
  )
  values(
    v_conversation,
    v_actor,
    'owner',
    v_actor,
    null,
    v_history_from
  );

  insert into public.admin_audit_log(
    actor_id,
    target_employee_id,
    action,
    entity_type,
    entity_id,
    source,
    metadata
  )
  values(
    v_actor,
    v_actor,
    'chat.room.created',
    'chat_rooms',
    v_conversation::text,
    'chat-room-admin',
    jsonb_build_object(
      'title', v_title,
      'room_type', v_room_type,
      'history_policy', v_history_policy
    )
  );

  return v_conversation;
end;
$$;

revoke all
on function public.create_chat_room(text, text, text, text)
from public, anon;

grant execute
on function public.create_chat_room(text, text, text, text)
to authenticated;


-- ------------------------------------------------------------
-- Add or restore a member.
-- ------------------------------------------------------------

create or replace function public.add_chat_room_member(
  p_conversation_id uuid,
  p_employee_id uuid,
  p_room_role text default 'member'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text :=
    lower(btrim(coalesce(p_room_role, 'member')));
  v_room public.chat_rooms%rowtype;
  v_existing_removed_at timestamptz;
  v_existing_role text;
  v_had_membership boolean := false;
  v_history_from timestamptz;
begin
  if v_actor is null
     or not public.is_room_admin(p_conversation_id) then
    raise exception 'Room administrator access required'
      using errcode = '42501';
  end if;

  if v_role not in ('member', 'admin') then
    raise exception
      'New room members may be added only as member or admin';
  end if;

  select *
  into v_room
  from public.chat_rooms
  where conversation_id = p_conversation_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Active governed room not found';
  end if;

  if not exists (
    select 1
    from public.employee_profiles ep
    where ep.id = p_employee_id
      and ep.active = true
  ) then
    raise exception
      'Room member must be an active employee';
  end if;

  select
    m.removed_at,
    m.room_role
  into
    v_existing_removed_at,
    v_existing_role
  from public.social_conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = p_employee_id
  for update;

  v_had_membership := found;

  v_history_from := case
    when v_room.history_policy = 'from_join_date'
      then clock_timestamp()
    else null
  end;

  if v_had_membership then
    update public.social_conversation_members
    set
      room_role = v_role,
      added_by = v_actor,
      removed_at = null,
      history_from = v_history_from
    where conversation_id = p_conversation_id
      and user_id = p_employee_id;
  else
    insert into public.social_conversation_members(
      conversation_id,
      user_id,
      room_role,
      added_by,
      removed_at,
      history_from
    )
    values(
      p_conversation_id,
      p_employee_id,
      v_role,
      v_actor,
      null,
      v_history_from
    );
  end if;

  insert into public.admin_audit_log(
    actor_id,
    target_employee_id,
    action,
    entity_type,
    entity_id,
    source,
    metadata
  )
  values(
    v_actor,
    p_employee_id,
    'chat.room.member_added',
    'social_conversation_members',
    p_conversation_id::text,
    'chat-room-admin',
    jsonb_build_object(
      'room_role', v_role,
      'restored',
        v_had_membership
        and v_existing_removed_at is not null,
      'previous_role', v_existing_role,
      'history_policy', v_room.history_policy
    )
  );
end;
$$;

revoke all
on function public.add_chat_room_member(uuid, uuid, text)
from public, anon;

grant execute
on function public.add_chat_room_member(uuid, uuid, text)
to authenticated;


-- ------------------------------------------------------------
-- Remove a member.
--
-- Department Room ownership is managed by department-lead sync.
-- ------------------------------------------------------------

create or replace function public.remove_chat_room_member(
  p_conversation_id uuid,
  p_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_room public.chat_rooms%rowtype;
  v_target_role text;
  v_actor_role text;
  v_global boolean := false;
begin
  if v_actor is null
     or not public.is_room_admin(p_conversation_id) then
    raise exception 'Room administrator access required'
      using errcode = '42501';
  end if;

  v_global := public.is_workspace_chat_admin();

  select *
  into v_room
  from public.chat_rooms
  where conversation_id = p_conversation_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Active governed room not found';
  end if;

  select m.room_role
  into v_target_role
  from public.social_conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = p_employee_id
    and m.removed_at is null
  for update;

  if not found then
    raise exception 'Active room membership not found';
  end if;

  select m.room_role
  into v_actor_role
  from public.social_conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = v_actor
    and m.removed_at is null;

  if v_room.room_type = 'department'
     and v_target_role = 'owner' then
    raise exception
      'Department Room ownership is managed by department lead assignment';
  end if;

  if v_target_role = 'owner'
     and not v_global
     and coalesce(v_actor_role, 'member') <> 'owner' then
    raise exception
      'Only a room owner or global Chat administrator may remove an owner'
      using errcode = '42501';
  end if;

  update public.social_conversation_members
  set removed_at = clock_timestamp()
  where conversation_id = p_conversation_id
    and user_id = p_employee_id
    and removed_at is null;

  insert into public.admin_audit_log(
    actor_id,
    target_employee_id,
    action,
    entity_type,
    entity_id,
    source,
    metadata
  )
  values(
    v_actor,
    p_employee_id,
    'chat.room.member_removed',
    'social_conversation_members',
    p_conversation_id::text,
    'chat-room-admin',
    jsonb_build_object(
      'previous_role', v_target_role,
      'room_type', v_room.room_type
    )
  );
end;
$$;

revoke all
on function public.remove_chat_room_member(uuid, uuid)
from public, anon;

grant execute
on function public.remove_chat_room_member(uuid, uuid)
to authenticated;


-- ------------------------------------------------------------
-- Change a room-local member role.
-- ------------------------------------------------------------

create or replace function public.set_chat_room_member_role(
  p_conversation_id uuid,
  p_employee_id uuid,
  p_room_role text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text :=
    lower(btrim(coalesce(p_room_role, '')));
  v_room public.chat_rooms%rowtype;
  v_old_role text;
  v_actor_role text;
  v_global boolean := false;
begin
  if v_actor is null
     or not public.is_room_admin(p_conversation_id) then
    raise exception 'Room administrator access required'
      using errcode = '42501';
  end if;

  if v_role not in ('member', 'admin', 'owner') then
    raise exception 'Unsupported room role';
  end if;

  v_global := public.is_workspace_chat_admin();

  select *
  into v_room
  from public.chat_rooms
  where conversation_id = p_conversation_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Active governed room not found';
  end if;

  select m.room_role
  into v_old_role
  from public.social_conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = p_employee_id
    and m.removed_at is null
  for update;

  if not found then
    raise exception 'Active room membership not found';
  end if;

  select m.room_role
  into v_actor_role
  from public.social_conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = v_actor
    and m.removed_at is null;

  if v_room.room_type = 'department'
     and (
       v_role = 'owner'
       or v_old_role = 'owner'
     ) then
    raise exception
      'Department Room ownership is managed by department lead assignment';
  end if;

  if (
    v_role = 'owner'
    or v_old_role = 'owner'
  )
     and not v_global
     and coalesce(v_actor_role, 'member') <> 'owner' then
    raise exception
      'Only a room owner or global Chat administrator may manage owner role'
      using errcode = '42501';
  end if;

  if v_old_role = v_role then
    return;
  end if;

  update public.social_conversation_members
  set room_role = v_role
  where conversation_id = p_conversation_id
    and user_id = p_employee_id
    and removed_at is null;

  insert into public.admin_audit_log(
    actor_id,
    target_employee_id,
    action,
    entity_type,
    entity_id,
    source,
    metadata
  )
  values(
    v_actor,
    p_employee_id,
    'chat.room.member_role_changed',
    'social_conversation_members',
    p_conversation_id::text,
    'chat-room-admin',
    jsonb_build_object(
      'from_role', v_old_role,
      'to_role', v_role,
      'room_type', v_room.room_type
    )
  );
end;
$$;

revoke all
on function public.set_chat_room_member_role(uuid, uuid, text)
from public, anon;

grant execute
on function public.set_chat_room_member_role(uuid, uuid, text)
to authenticated;


-- ------------------------------------------------------------
-- Archive a governed room.
--
-- Same-room owners/admins may archive additional rooms.
-- Department Rooms require global Chat administration.
-- ------------------------------------------------------------

create or replace function public.archive_chat_room(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_room public.chat_rooms%rowtype;
begin
  if v_actor is null
     or not public.is_room_admin(p_conversation_id) then
    raise exception 'Room administrator access required'
      using errcode = '42501';
  end if;

  select *
  into v_room
  from public.chat_rooms
  where conversation_id = p_conversation_id
  for update;

  if not found then
    raise exception 'Governed room not found';
  end if;

  if v_room.room_type = 'department'
     and not public.is_workspace_chat_admin() then
    raise exception
      'Global Chat administrator access is required to archive a Department Room'
      using errcode = '42501';
  end if;

  if v_room.status = 'archived' then
    return;
  end if;

  update public.chat_rooms
  set
    status = 'archived',
    archived_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where conversation_id = p_conversation_id;

  insert into public.admin_audit_log(
    actor_id,
    target_employee_id,
    action,
    entity_type,
    entity_id,
    source,
    metadata
  )
  values(
    v_actor,
    v_actor,
    'chat.room.archived',
    'chat_rooms',
    p_conversation_id::text,
    'chat-room-admin',
    jsonb_build_object(
      'room_type', v_room.room_type,
      'department', v_room.department
    )
  );
end;
$$;

revoke all
on function public.archive_chat_room(uuid)
from public, anon;

grant execute
on function public.archive_chat_room(uuid)
to authenticated;

commit;
