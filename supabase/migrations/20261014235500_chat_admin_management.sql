begin;

-- ============================================================
-- RideArrivo Chat Administration
--
-- Global Chat-administrator delegation is intentionally
-- separate from job titles and room-scoped roles.
--
-- Only a true workspace administrator may grant or revoke
-- delegated global Chat-admin authority.
--
-- HR and workspace administrators continue to receive built-in
-- Chat-admin authority from is_workspace_chat_admin().
-- ============================================================


-- ------------------------------------------------------------
-- 1. Effective Chat-administrator directory
-- ------------------------------------------------------------

create or replace function public.list_workspace_chat_admins()
returns table (
  employee_id uuid,
  full_name text,
  email text,
  role text,
  department text,
  authority_source text,
  granted_by uuid,
  granted_by_name text,
  granted_at timestamptz,
  revocable boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or not public.is_workspace_admin() then
    raise exception 'Workspace administrator access required'
      using errcode = '42501';
  end if;

  return query

  -- Built-in Chat administrators.
  select
    ep.id,
    coalesce(ep.full_name, ''),
    coalesce(ep.email, ''),
    ep.role,
    coalesce(ep.department, ''),
    case
      when ep.role = 'admin'
        then 'workspace_admin'
      when ep.role = 'hr'
        then 'hr'
      else 'built_in'
    end::text,
    null::uuid,
    null::text,
    null::timestamptz,
    false
  from public.employee_profiles ep
  where ep.active = true
    and ep.role in ('hr', 'admin')

  union all

  -- Explicit delegated Chat administrators.
  select
    ep.id,
    coalesce(ep.full_name, ''),
    coalesce(ep.email, ''),
    ep.role,
    coalesce(ep.department, ''),
    'delegated'::text,
    g.granted_by,
    coalesce(granter.full_name, granter.email, ''),
    g.granted_at,
    true
  from public.workspace_chat_admin_grants g
  join public.employee_profiles ep
    on ep.id = g.employee_id
   and ep.active = true
  left join public.employee_profiles granter
    on granter.id = g.granted_by
  where g.revoked_at is null

    -- Do not duplicate users whose authority is already built in.
    and ep.role not in ('hr', 'admin')

  order by
    2,
    3;
end;
$$;

revoke all
on function public.list_workspace_chat_admins()
from public, anon;

grant execute
on function public.list_workspace_chat_admins()
to authenticated, service_role;


-- ------------------------------------------------------------
-- 2. Grant delegated global Chat-admin capability
-- ------------------------------------------------------------

create or replace function public.grant_workspace_chat_admin(
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_target public.employee_profiles%rowtype;
  v_existing_id uuid;
  v_grant_id uuid;
begin
  if v_actor is null
     or not public.is_workspace_admin() then
    raise exception 'Workspace administrator access required'
      using errcode = '42501';
  end if;

  if p_employee_id is null then
    raise exception 'Employee is required'
      using errcode = '22004';
  end if;

  select ep.*
  into v_target
  from public.employee_profiles ep
  where ep.id = p_employee_id
  for update;

  if not found then
    raise exception 'Employee not found'
      using errcode = 'P0002';
  end if;

  if v_target.active is distinct from true then
    raise exception 'Only active employees can become Chat administrators'
      using errcode = '42501';
  end if;

  -- HR and workspace administrators already possess built-in global
  -- Chat authority. Creating a redundant delegated grant would blur
  -- the authority source and make revocation misleading.
  if v_target.role in ('hr', 'admin') then
    raise exception
      'Employee already has built-in Chat administrator authority'
      using errcode = 'P0001';
  end if;

  select g.id
  into v_existing_id
  from public.workspace_chat_admin_grants g
  where g.employee_id = p_employee_id
    and g.revoked_at is null
  order by g.granted_at desc
  limit 1
  for update;

  -- Idempotent retry: return the existing active grant.
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  insert into public.workspace_chat_admin_grants(
    employee_id,
    granted_by,
    granted_at,
    revoked_at
  )
  values(
    p_employee_id,
    v_actor,
    now(),
    null
  )
  returning id
  into v_grant_id;

  perform public.record_admin_audit(
    'chat.admin.granted',
    'workspace_chat_admin_grants',
    v_grant_id::text,
    p_employee_id,
    jsonb_build_object(
      'authority_source', 'delegated',
      'target_role', v_target.role,
      'target_department', v_target.department
    ),
    'chat-admin-management'
  );

  return v_grant_id;
end;
$$;

revoke all
on function public.grant_workspace_chat_admin(uuid)
from public, anon;

grant execute
on function public.grant_workspace_chat_admin(uuid)
to authenticated, service_role;


-- ------------------------------------------------------------
-- 3. Revoke delegated global Chat-admin capability
-- ------------------------------------------------------------

create or replace function public.revoke_workspace_chat_admin(
  p_employee_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_target public.employee_profiles%rowtype;
  v_grant_ids uuid[];
begin
  if v_actor is null
     or not public.is_workspace_admin() then
    raise exception 'Workspace administrator access required'
      using errcode = '42501';
  end if;

  if p_employee_id is null then
    raise exception 'Employee is required'
      using errcode = '22004';
  end if;

  select ep.*
  into v_target
  from public.employee_profiles ep
  where ep.id = p_employee_id;

  if not found then
    raise exception 'Employee not found'
      using errcode = 'P0002';
  end if;

  -- Built-in HR/admin authority is role-derived and cannot be revoked
  -- through delegated Chat-admin management.
  if v_target.active = true
     and v_target.role in ('hr', 'admin') then
    raise exception
      'Built-in Chat administrator authority cannot be revoked here'
      using errcode = '42501';
  end if;

  select array_agg(g.id)
  into v_grant_ids
  from public.workspace_chat_admin_grants g
  where g.employee_id = p_employee_id
    and g.revoked_at is null;

  if coalesce(array_length(v_grant_ids, 1), 0) = 0 then
    -- Idempotent retry.
    return false;
  end if;

  update public.workspace_chat_admin_grants
  set revoked_at = now()
  where employee_id = p_employee_id
    and revoked_at is null;

  perform public.record_admin_audit(
    'chat.admin.revoked',
    'workspace_chat_admin_grants',
    p_employee_id::text,
    p_employee_id,
    jsonb_build_object(
      'authority_source', 'delegated',
      'revoked_grant_ids', to_jsonb(v_grant_ids),
      'target_role', v_target.role,
      'target_department', v_target.department
    ),
    'chat-admin-management'
  );

  return true;
end;
$$;

revoke all
on function public.revoke_workspace_chat_admin(uuid)
from public, anon;

grant execute
on function public.revoke_workspace_chat_admin(uuid)
to authenticated, service_role;


-- ------------------------------------------------------------
-- 4. Preserve direct-browser mutation boundary
-- ------------------------------------------------------------

revoke insert, update, delete
on table public.workspace_chat_admin_grants
from authenticated;

revoke all
on table public.workspace_chat_admin_grants
from anon;

commit;
