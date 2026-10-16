-- Administration > Chat: one place to see every chat room, who is in it, who
-- can post, and why somebody cannot. Read functions are for workspace chat
-- administrators only. Posting rules are NOT changed here; this only shows
-- them and adds the one missing repair (restore an archived or ungoverned
-- room). Safe to run twice.

begin;

-- Every room, with the thing that stops people posting (if any).
create or replace function public.admin_chat_rooms()
returns table (
  conversation_id uuid,
  title text,
  room_type text,
  department text,
  description text,
  status text,
  problem text,
  active_members integer,
  blocked_members integer,
  last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_workspace_chat_admin() then
    raise exception 'Chat administrator access required' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    coalesce(nullif(btrim(c.title), ''), 'Untitled room'),
    coalesce(r.room_type, c.conversation_kind),
    r.department,
    r.description,
    coalesce(r.status, 'no record'),
    case
      when c.conversation_kind <> 'direct' and r.conversation_id is null
        then 'This room has no governance record, so nobody can post in it.'
      when r.status = 'archived'
        then 'This room is archived, so nobody can post in it.'
      else null
    end,
    (select count(*)::int from public.social_conversation_members m
       join public.employee_profiles ep on ep.id = m.user_id and ep.active
      where m.conversation_id = c.id and m.removed_at is null),
    (select count(*)::int from public.social_conversation_members m
       left join public.employee_profiles ep on ep.id = m.user_id
      where m.conversation_id = c.id
        and (m.removed_at is not null or ep.id is null or not ep.active)),
    (select max(sm.created_at) from public.social_messages sm where sm.conversation_id = c.id)
  from public.social_conversations c
  left join public.chat_rooms r on r.conversation_id = c.id
  where c.conversation_kind <> 'direct' or r.conversation_id is not null
  order by (r.status = 'archived') nulls first, lower(coalesce(c.title, ''));
end;
$$;
revoke all on function public.admin_chat_rooms() from public, anon;
grant execute on function public.admin_chat_rooms() to authenticated;

-- Members of one room, each with a plain reason when they cannot post.
create or replace function public.admin_chat_room_members(p_conversation_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  employee_role text,
  department text,
  profile_active boolean,
  room_role text,
  joined_at timestamptz,
  removed_at timestamptz,
  can_post boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_room_problem text;
begin
  if auth.uid() is null or not public.is_workspace_chat_admin() then
    raise exception 'Chat administrator access required' using errcode = '42501';
  end if;

  select case
           when c.conversation_kind <> 'direct' and r.conversation_id is null then 'This room has no governance record'
           when r.status = 'archived' then 'This room is archived'
           else null
         end
    into v_room_problem
  from public.social_conversations c
  left join public.chat_rooms r on r.conversation_id = c.id
  where c.id = p_conversation_id;

  return query
  select
    m.user_id,
    ep.full_name,
    ep.email,
    ep.role,
    ep.department,
    coalesce(ep.active, false),
    m.room_role,
    m.joined_at,
    m.removed_at,
    (m.removed_at is null and coalesce(ep.active, false) and v_room_problem is null),
    case
      when m.removed_at is not null then 'Removed from this room'
      when not coalesce(ep.active, false) then 'Employee profile is not active'
      else v_room_problem
    end
  from public.social_conversation_members m
  left join public.employee_profiles ep on ep.id = m.user_id
  where m.conversation_id = p_conversation_id
  order by (m.removed_at is not null), case m.room_role when 'owner' then 0 when 'admin' then 1 else 2 end, lower(coalesce(ep.full_name, ''));
end;
$$;
revoke all on function public.admin_chat_room_members(uuid) from public, anon;
grant execute on function public.admin_chat_room_members(uuid) to authenticated;

-- Fixes the two room-level causes of "Conversation write access required":
-- an archived room, and a room that has no chat_rooms record.
create or replace function public.admin_restore_chat_room(p_conversation_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_conv public.social_conversations%rowtype;
  v_room public.chat_rooms%rowtype;
  v_result text;
begin
  if v_actor is null or not public.is_workspace_chat_admin() then
    raise exception 'Chat administrator access required' using errcode = '42501';
  end if;

  select * into v_conv from public.social_conversations where id = p_conversation_id;
  if not found then
    raise exception 'Room not found';
  end if;

  select * into v_room from public.chat_rooms where conversation_id = p_conversation_id for update;

  if found then
    if v_room.status = 'active' then
      return 'Nothing to restore. The room is already active.';
    end if;
    update public.chat_rooms
    set status = 'active', archived_at = null, updated_at = clock_timestamp()
    where conversation_id = p_conversation_id;
    v_result := 'Room restored. Members can post again.';
  else
    if v_conv.conversation_kind not in ('department', 'project', 'committee', 'restricted') then
      raise exception 'This is not a governed room';
    end if;
    insert into public.chat_rooms (conversation_id, room_type, department, status, created_by)
    values (
      p_conversation_id,
      v_conv.conversation_kind,
      case when v_conv.conversation_kind = 'department' then coalesce(nullif(btrim(v_conv.title), ''), 'General') end,
      'active',
      v_actor
    );
    v_result := 'Governance record created. Members can post again.';
  end if;

  insert into public.admin_audit_log (actor_id, target_employee_id, action, entity_type, entity_id, source, metadata)
  values (v_actor, v_actor, 'chat.room.restored', 'chat_rooms', p_conversation_id::text, 'admin-chat-access',
          jsonb_build_object('result', v_result));

  return v_result;
end;
$$;
revoke all on function public.admin_restore_chat_room(uuid) from public, anon;
grant execute on function public.admin_restore_chat_room(uuid) to authenticated;

commit;
