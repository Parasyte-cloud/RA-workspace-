begin;

-- Canonical department identity for trophy access. Authorization always compares
-- exact canonical values; aliases never become substring matches.
create or replace function public.recognition_normalize_department(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'))
    when '' then null
    when 'support' then 'support'
    when 'operations' then 'operations'
    when 'people' then 'people'
    when 'people & hr' then 'people'
    when 'people and hr' then 'people'
    when 'people/hr' then 'people'
    when 'hr' then 'people'
    when 'human resources' then 'people'
    when 'engineering' then 'engineering'
    when 'finance' then 'finance'
    when 'marketing' then 'marketing'
    when 'partnership' then 'partnerships'
    when 'partnerships' then 'partnerships'
    when 'legal' then 'legal'
    when 'legal & compliance' then 'legal'
    when 'legal and compliance' then 'legal'
    when 'executive' then 'executive'
    when 'executive / ceo management' then 'executive'
    when 'executive/ceo management' then 'executive'
    when 'ceo / management' then 'executive'
    when 'ceo management' then 'executive'
    when 'administration' then 'administration'
    when 'admin' then 'administration'
    else lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'))
  end;
$$;

revoke all on function public.recognition_normalize_department(text) from public, anon, authenticated;
grant execute on function public.recognition_normalize_department(text) to service_role;

create or replace function public.recognition_department_relationship(p_department text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_department text := public.recognition_normalize_department(p_department);
  v_user_department text;
  v_active boolean := false;
begin
  if auth.uid() is null or v_department is null then
    return null;
  end if;

  select
    public.recognition_normalize_department(ep.department),
    ep.active
  into v_user_department, v_active
  from public.employee_profiles ep
  where ep.id = auth.uid();

  if coalesce(v_active, false) is not true then
    return null;
  end if;

  if public.is_workspace_admin() then
    return 'workspace_admin';
  end if;

  if exists (
    select 1
    from public.workspace_workstation_assignments a
    where a.employee_id = auth.uid()
      and a.active = true
      and a.is_head = true
      and public.recognition_normalize_department(a.workstation) = v_department
  ) then
    return 'department_head';
  end if;

  if exists (
    select 1
    from public.workspace_department_leads l
    where l.employee_id = auth.uid()
      and l.ended_at is null
      and public.recognition_normalize_department(l.department) = v_department
  ) then
    return 'delegated_leadership';
  end if;

  if v_user_department = v_department then
    return 'department_member';
  end if;

  if exists (
    select 1
    from public.workspace_workstation_assignments a
    where a.employee_id = auth.uid()
      and a.active = true
      and public.recognition_normalize_department(a.workstation) = v_department
  ) then
    return 'workstation_assignee';
  end if;

  return null;
end;
$$;

revoke all on function public.recognition_department_relationship(text) from public, anon, authenticated;
grant execute on function public.recognition_department_relationship(text) to service_role;

-- Preserve callers of the old predicate while moving its authority to the new resolver.
create or replace function public.can_view_department_achievement(p_department text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.recognition_department_relationship(p_department) is not null;
$$;

revoke all on function public.can_view_department_achievement(text) from public, anon;
grant execute on function public.can_view_department_achievement(text) to authenticated;

create or replace function public.get_authorized_department_trophy_context(p_department text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_department text := public.recognition_normalize_department(p_department);
  v_relationship text;
  v_count integer := 0;
begin
  v_relationship := public.recognition_department_relationship(v_department);

  if v_relationship is not null then
    select count(*)::integer
    into v_count
    from public.department_achievements a
    where public.recognition_normalize_department(a.department) = v_department;
  end if;

  return jsonb_build_object(
    'authorized', v_relationship is not null,
    'department', v_department,
    'relationship', v_relationship,
    'achievement_count', case when v_relationship is null then 0 else v_count end
  );
end;
$$;

create or replace function public.list_department_trophy_history(
  p_department text,
  p_limit integer default 50
)
returns table(
  id uuid,
  department text,
  kind text,
  tier text,
  title text,
  description text,
  earned_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_department text := public.recognition_normalize_department(p_department);
  v_relationship text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  v_relationship := public.recognition_department_relationship(v_department);
  if v_relationship is null then
    return;
  end if;

  return query
  select
    a.id,
    public.recognition_normalize_department(a.department),
    a.kind,
    a.tier,
    a.title,
    a.description,
    a.earned_at
  from public.department_achievements a
  where public.recognition_normalize_department(a.department) = v_department
  order by a.earned_at desc, a.id desc
  limit v_limit;
end;
$$;

revoke all on function public.get_authorized_department_trophy_context(text) from public, anon;
revoke all on function public.list_department_trophy_history(text, integer) from public, anon;
grant execute on function public.get_authorized_department_trophy_context(text) to authenticated;
grant execute on function public.list_department_trophy_history(text, integer) to authenticated;

-- Browser access is RPC-only. Policies remain defense in depth for service-side
-- maintenance paths, but authenticated clients have no direct table privilege.
revoke all on public.department_achievements from anon, authenticated;
revoke all on public.department_achievement_seen from anon, authenticated;
grant all on public.department_achievements, public.department_achievement_seen to service_role;

commit;
