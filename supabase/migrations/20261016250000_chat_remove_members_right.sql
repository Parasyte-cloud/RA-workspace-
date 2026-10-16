begin;

-- A room admin can give a member the right to remove people from one room,
-- without making that person an admin. Admins, owners and global chat admins
-- can always remove. A member who only holds the right can remove plain
-- members, never admins or owners, and never themselves.

alter table public.social_conversation_members
  add column if not exists can_remove_members boolean not null default false;

create or replace function public.can_remove_room_members(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and (
      public.is_room_admin(p_conversation_id)
      or exists (
        select 1
        from public.social_conversation_members m
        join public.employee_profiles ep on ep.id = m.user_id and ep.active = true
        where m.conversation_id = p_conversation_id
          and m.user_id = auth.uid()
          and m.removed_at is null
          and m.can_remove_members = true
      )
    );
$$;

revoke all on function public.can_remove_room_members(uuid) from public, anon;
grant execute on function public.can_remove_room_members(uuid) to authenticated, service_role;

create or replace function public.set_chat_member_remove_right(
  p_conversation_id uuid,
  p_employee_id uuid,
  p_allowed boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_target_role text;
begin
  if v_actor is null or not public.is_room_admin(p_conversation_id) then
    raise exception 'Room administrator access required' using errcode = '42501';
  end if;

  select m.room_role into v_target_role
  from public.social_conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = p_employee_id
    and m.removed_at is null
  for update;

  if not found then
    raise exception 'Active room membership not found';
  end if;

  update public.social_conversation_members
  set can_remove_members = coalesce(p_allowed, false)
  where conversation_id = p_conversation_id and user_id = p_employee_id;

  insert into public.admin_audit_log(actor_id, target_employee_id, action, entity_type, entity_id, source, metadata)
  values (v_actor, p_employee_id,
    case when coalesce(p_allowed, false) then 'chat.room.remove_right_granted' else 'chat.room.remove_right_revoked' end,
    'social_conversation_members', p_conversation_id::text, 'chat-room-admin',
    jsonb_build_object('room_role', v_target_role));
end;
$$;

revoke all on function public.set_chat_member_remove_right(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_chat_member_remove_right(uuid, uuid, boolean) to authenticated;

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
  v_is_admin boolean := false;
begin
  if v_actor is null or not public.can_remove_room_members(p_conversation_id) then
    raise exception 'You do not have the right to remove people from this room'
      using errcode = '42501';
  end if;

  v_global := public.is_workspace_chat_admin();
  v_is_admin := public.is_room_admin(p_conversation_id);

  select * into v_room
  from public.chat_rooms
  where conversation_id = p_conversation_id and status = 'active'
  for update;

  if not found then
    raise exception 'Active governed room not found';
  end if;

  select m.room_role into v_target_role
  from public.social_conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = p_employee_id
    and m.removed_at is null
  for update;

  if not found then
    raise exception 'Active room membership not found';
  end if;

  select m.room_role into v_actor_role
  from public.social_conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = v_actor
    and m.removed_at is null;

  if v_room.room_type = 'department' and v_target_role = 'owner' then
    raise exception 'Department Room ownership is managed by department lead assignment';
  end if;

  if v_target_role = 'owner' and not v_global and coalesce(v_actor_role, 'member') <> 'owner' then
    raise exception 'Only a room owner or global Chat administrator may remove an owner'
      using errcode = '42501';
  end if;

  if not v_is_admin then
    if p_employee_id = v_actor then
      raise exception 'Use Leave room to remove yourself' using errcode = '42501';
    end if;
    if v_target_role <> 'member' then
      raise exception 'The remove right covers members only, not admins or owners'
        using errcode = '42501';
    end if;
  end if;

  update public.social_conversation_members
  set removed_at = clock_timestamp(), can_remove_members = false
  where conversation_id = p_conversation_id
    and user_id = p_employee_id
    and removed_at is null;

  insert into public.admin_audit_log(actor_id, target_employee_id, action, entity_type, entity_id, source, metadata)
  values (v_actor, p_employee_id, 'chat.room.member_removed',
    'social_conversation_members', p_conversation_id::text, 'chat-room-admin',
    jsonb_build_object('previous_role', v_target_role, 'room_type', v_room.room_type,
                       'by_delegated_right', not v_is_admin));
end;
$$;

revoke all on function public.remove_chat_room_member(uuid, uuid) from public, anon;
grant execute on function public.remove_chat_room_member(uuid, uuid) to authenticated;

commit;
