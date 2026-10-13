begin;

-- ============================================================
-- RideArrivo Department Communications
-- Default Department Room lifecycle + department head ownership.
--
-- The employee profile is authoritative for active status and department.
-- Membership changes happen inside the same transaction as profile changes.
-- ============================================================


-- ------------------------------------------------------------
-- Internal helper: create/get one active default room per department.
-- Caller identity is never accepted from browser input.
-- ------------------------------------------------------------

create or replace function public.ensure_default_department_room(
  p_department text,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_department text := btrim(coalesce(p_department, ''));
  v_key text;
  v_room uuid;
begin
  if v_department = ''
     or lower(v_department) = 'unassigned' then
    return null;
  end if;

  v_key := lower(v_department);

  -- Serialize first-room creation for a department.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'ridearrivo-chat-department:' || v_key,
      0
    )
  );

  select r.conversation_id
  into v_room
  from public.chat_rooms r
  where r.room_type = 'department'
    and r.status = 'active'
    and lower(btrim(r.department)) = v_key
  limit 1;

  if v_room is null then
    insert into public.social_conversations(
      is_group,
      title,
      created_by,
      conversation_kind
    )
    values(
      true,
      v_department,
      p_created_by,
      'department'
    )
    returning id into v_room;

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
      v_room,
      'department',
      v_department,
      'Default Department Room for ' || v_department,
      'active',
      'full',
      p_created_by
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
      auth.uid(),
      p_created_by,
      'chat.department_room.created',
      'chat_rooms',
      v_room::text,
      'department-chat-sync',
      jsonb_build_object(
        'department',
        v_department,
        'history_policy',
        'full'
      )
    );
  else
    -- Defensive normalization if an existing governed room predates this
    -- synchronization routine.
    update public.social_conversations
    set
      is_group = true,
      conversation_kind = 'department'
    where id = v_room;
  end if;

  return v_room;
end;
$$;

revoke all
on function public.ensure_default_department_room(text, uuid)
from public, anon, authenticated;


-- ------------------------------------------------------------
-- Synchronize one employee against their authoritative profile.
--
-- This function is intentionally NOT browser-callable. Profile lifecycle
-- triggers and trusted service-side operations invoke it.
-- ------------------------------------------------------------

create or replace function public.sync_employee_department_room(
  p_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.employee_profiles%rowtype;
  v_department text;
  v_department_key text;
  v_room uuid;
  v_is_lead boolean := false;
  v_existing_removed_at timestamptz;
  v_existing_role text;
  v_target_role text;
  v_had_membership boolean := false;
  v_old record;
  v_added_by uuid;
begin
  select *
  into v_profile
  from public.employee_profiles
  where id = p_employee_id
  for update;

  if not found then
    return;
  end if;

  v_department := btrim(coalesce(v_profile.department, ''));
  v_department_key := lower(v_department);

  v_added_by := coalesce(auth.uid(), p_employee_id);

  -- Revoke every active Department Room membership that is no longer
  -- authoritative. For inactive employees this revokes all of them.
  for v_old in
    select
      m.conversation_id,
      r.department
    from public.social_conversation_members m
    join public.chat_rooms r
      on r.conversation_id = m.conversation_id
    where m.user_id = p_employee_id
      and m.removed_at is null
      and (
        v_profile.active is not true
        or (
          r.room_type = 'department'
          and (
            v_department = ''
            or v_department_key = 'unassigned'
            or lower(btrim(r.department)) <> v_department_key
          )
        )
      )
    for update of m
  loop
    update public.social_conversation_members
    set removed_at = clock_timestamp()
    where conversation_id = v_old.conversation_id
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
      auth.uid(),
      p_employee_id,
      'chat.department_membership.removed',
      'social_conversation_members',
      v_old.conversation_id::text,
      'department-chat-sync',
      jsonb_build_object(
        'department',
        v_old.department,
        'reason',
        case
          when v_profile.active is not true
            then 'employee_inactive'
          else 'department_changed'
        end
      )
    );
  end loop;

  -- Inactive and unassigned people receive no default Department Room.
  if v_profile.active is not true
     or v_department = ''
     or v_department_key = 'unassigned' then
    return;
  end if;

  v_room := public.ensure_default_department_room(
    v_department,
    p_employee_id
  );

  if v_room is null then
    return;
  end if;

  select exists(
    select 1
    from public.workspace_department_leads l
    where l.employee_id = p_employee_id
      and l.ended_at is null
      and lower(btrim(l.department)) = v_department_key
  )
  into v_is_lead;

  select
    m.removed_at,
    m.room_role
  into
    v_existing_removed_at,
    v_existing_role
  from public.social_conversation_members m
  where m.conversation_id = v_room
    and m.user_id = p_employee_id
  for update;

  v_had_membership := found;

  v_target_role := case
    when v_is_lead then 'owner'
    when v_had_membership
         and v_existing_role = 'admin' then 'admin'
    else 'member'
  end;

  if v_had_membership then
    update public.social_conversation_members
    set
      removed_at = null,
      history_from = null,
      added_by = v_added_by,
      room_role = v_target_role
    where conversation_id = v_room
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
      v_room,
      p_employee_id,
      v_target_role,
      v_added_by,
      null,
      null
    );
  end if;

  if not v_had_membership
     or v_existing_removed_at is not null then
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
      auth.uid(),
      p_employee_id,
      'chat.department_membership.added',
      'social_conversation_members',
      v_room::text,
      'department-chat-sync',
      jsonb_build_object(
        'department',
        v_department,
        'room_role',
        v_target_role,
        'history_policy',
        'full'
      )
    );
  elsif v_existing_role is distinct from v_target_role then
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
      auth.uid(),
      p_employee_id,
      'chat.department_membership.role_changed',
      'social_conversation_members',
      v_room::text,
      'department-chat-sync',
      jsonb_build_object(
        'department',
        v_department,
        'from_role',
        v_existing_role,
        'to_role',
        v_target_role
      )
    );
  end if;
end;
$$;

revoke all
on function public.sync_employee_department_room(uuid)
from public, anon, authenticated;

grant execute
on function public.sync_employee_department_room(uuid)
to service_role;


-- ------------------------------------------------------------
-- Profile lifecycle trigger.
--
-- Department transfer, activation, and deactivation are synchronized in
-- the SAME database transaction as employee_profiles.
-- ------------------------------------------------------------

create or replace function public.sync_employee_department_room_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT'
     or old.department is distinct from new.department
     or old.active is distinct from new.active then
    perform public.sync_employee_department_room(new.id);
  end if;

  return new;
end;
$$;

revoke all
on function public.sync_employee_department_room_trigger()
from public, anon, authenticated;

drop trigger if exists sync_employee_department_room
on public.employee_profiles;

create trigger sync_employee_department_room
after insert or update of department, active
on public.employee_profiles
for each row
execute function public.sync_employee_department_room_trigger();


-- ------------------------------------------------------------
-- Explicit Department Lead management.
--
-- Global Chat authority is capability-driven. No job-title inference.
-- ------------------------------------------------------------

create or replace function public.set_department_lead(
  p_department text,
  p_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_department text := btrim(coalesce(p_department, ''));
  v_department_key text;
  v_employee_department text;
  v_room uuid;
  v_old_lead uuid;
begin
  if v_actor is null
     or not public.is_workspace_chat_admin() then
    raise exception 'Chat administrator access required'
      using errcode = '42501';
  end if;

  if v_department = ''
     or lower(v_department) = 'unassigned' then
    raise exception 'A valid department is required';
  end if;

  v_department_key := lower(v_department);

  select btrim(p.department)
  into v_employee_department
  from public.employee_profiles p
  where p.id = p_employee_id
    and p.active = true;

  if v_employee_department is null then
    raise exception 'Department lead must be an active employee';
  end if;

  if lower(v_employee_department) <> v_department_key then
    raise exception 'Department lead must belong to that department';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'ridearrivo-chat-department-lead:' || v_department_key,
      0
    )
  );

  v_room := public.ensure_default_department_room(
    v_department,
    p_employee_id
  );

  select l.employee_id
  into v_old_lead
  from public.workspace_department_leads l
  where l.ended_at is null
    and lower(btrim(l.department)) = v_department_key
  limit 1
  for update;

  if v_old_lead is distinct from p_employee_id then
    update public.workspace_department_leads
    set ended_at = clock_timestamp()
    where ended_at is null
      and lower(btrim(department)) = v_department_key;

    insert into public.workspace_department_leads(
      department,
      employee_id,
      assigned_by,
      assigned_at,
      ended_at
    )
    values(
      v_department,
      p_employee_id,
      v_actor,
      clock_timestamp(),
      null
    );
  end if;

  -- The former lead remains an ordinary member if they still belong
  -- to this active Department Room.
  if v_old_lead is not null
     and v_old_lead is distinct from p_employee_id then
    update public.social_conversation_members
    set room_role = 'member'
    where conversation_id = v_room
      and user_id = v_old_lead
      and removed_at is null;
  end if;

  -- Ensure the new lead is the active owner.
  update public.social_conversation_members
  set
    room_role = 'owner',
    removed_at = null,
    history_from = null,
    added_by = v_actor
  where conversation_id = v_room
    and user_id = p_employee_id;

  if not found then
    insert into public.social_conversation_members(
      conversation_id,
      user_id,
      room_role,
      added_by,
      removed_at,
      history_from
    )
    values(
      v_room,
      p_employee_id,
      'owner',
      v_actor,
      null,
      null
    );
  end if;

  if v_old_lead is distinct from p_employee_id then
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
      'chat.department_lead.assigned',
      'workspace_department_leads',
      v_room::text,
      'department-chat-admin',
      jsonb_build_object(
        'department',
        v_department,
        'previous_lead',
        v_old_lead,
        'new_lead',
        p_employee_id
      )
    );
  end if;
end;
$$;

revoke all
on function public.set_department_lead(text, uuid)
from public, anon;

grant execute
on function public.set_department_lead(text, uuid)
to authenticated;


-- ------------------------------------------------------------
-- Backfill all current employees.
--
-- Existing DMs remain untouched. Only governed Department Room
-- memberships are created/synchronized.
-- ------------------------------------------------------------

do $$
declare
  v_employee record;
begin
  for v_employee in
    select p.id
    from public.employee_profiles p
    order by p.created_at, p.id
  loop
    perform public.sync_employee_department_room(v_employee.id);
  end loop;
end;
$$;


commit;
