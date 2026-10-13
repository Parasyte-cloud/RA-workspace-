-- Identity and per-person editorial authorization ONLY.
-- Article content and media remain in Cloudflare D1 / R2.
-- Apply in the EXISTING RA-Workspace project, not a new blog Supabase project.
begin;
create table if not exists public.workspace_blog_access (
  employee_id uuid primary key references public.employee_profiles(id) on delete cascade,
  role text not null check (role in ('writer','editor','blog_admin')),
  granted_by uuid references public.employee_profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);
create table if not exists public.workspace_blog_access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.employee_profiles(id) on delete set null,
  target_id uuid references public.employee_profiles(id) on delete set null,
  actor_name text not null,
  target_name text not null,
  previous_role text,
  new_role text,
  happened_at timestamptz not null default now()
);
create index if not exists workspace_blog_access_audit_time on public.workspace_blog_access_audit(happened_at desc);
alter table public.workspace_blog_access enable row level security;
alter table public.workspace_blog_access_audit enable row level security;
revoke all on public.workspace_blog_access from public, anon, authenticated, service_role;
revoke all on public.workspace_blog_access_audit from public, anon, authenticated, service_role;
grant select on public.workspace_blog_access to authenticated, service_role;
grant select on public.workspace_blog_access_audit to authenticated, service_role;

-- Called with the staff JWT: auth.uid() is verified by the existing Auth/Data API.
-- No role is derived from user_metadata, email domain, or a caller-supplied ID.
create or replace function public.workspace_blog_identity()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'employee_id',p.id,'full_name',p.full_name,'active',p.active,
    'role',a.role,'can_manage_access',(p.role = 'admin' or coalesce(a.role = 'blog_admin',false))
  )
  from public.employee_profiles p
  left join public.workspace_blog_access a on a.employee_id = p.id
  where p.id = auth.uid() and p.active = true;
$$;

drop policy if exists "blog access own or manager read" on public.workspace_blog_access;
create policy "blog access own or manager read" on public.workspace_blog_access for select to authenticated
using (
  (employee_id = auth.uid() and public.workspace_blog_identity() is not null)
  or coalesce((public.workspace_blog_identity()->>'can_manage_access')::boolean,false)
);
drop policy if exists "blog access audit manager read" on public.workspace_blog_access_audit;
create policy "blog access audit manager read" on public.workspace_blog_access_audit for select to authenticated
using (coalesce((public.workspace_blog_identity()->>'can_manage_access')::boolean,false));

create or replace function public.workspace_blog_people(p_query text default '')
returns table(employee_id uuid, full_name text, email text, department text, active boolean, workspace_role text, blog_role text, granted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((public.workspace_blog_identity()->>'can_manage_access')::boolean,false) then
    raise exception 'Blog access administrator required' using errcode = '42501';
  end if;
  return query
    select p.id,p.full_name,p.email,p.department,p.active,p.role,a.role,a.granted_at
    from public.employee_profiles p left join public.workspace_blog_access a on a.employee_id=p.id
    where (p.active = true or a.employee_id is not null)
      and (coalesce(p_query,'') = '' or p.full_name ilike '%' || left(p_query,100) || '%' or p.email ilike '%' || left(p_query,100) || '%')
    order by p.full_name,p.id limit 50;
end;
$$;

create or replace function public.workspace_blog_set_access(p_employee_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_profile public.employee_profiles%rowtype;
  target_profile public.employee_profiles%rowtype;
  previous_role text;
begin
  -- Serialize grant changes; permission is checked AFTER acquiring this lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ridearrivo.workspace_blog_access')::bigint);
  if actor is null or not coalesce((public.workspace_blog_identity()->>'can_manage_access')::boolean,false) then
    raise exception 'Blog access administrator required' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('writer','editor','blog_admin') then
    raise exception 'Invalid blog role' using errcode = '22023';
  end if;
  select * into actor_profile from public.employee_profiles where id=actor and active=true;
  select * into target_profile from public.employee_profiles where id=p_employee_id for update;
  if not found or (p_role is not null and target_profile.active is not true) then
    raise exception 'An existing active employee is required' using errcode = '22023';
  end if;
  select role into previous_role from public.workspace_blog_access where employee_id=p_employee_id;
  if actor=p_employee_id and previous_role='blog_admin' and p_role is distinct from 'blog_admin' and actor_profile.role<>'admin' then
    raise exception 'Ask another administrator to change your own administrator access' using errcode = '22023';
  end if;
  if previous_role is not distinct from p_role then return jsonb_build_object('ok',true,'changed',false); end if;
  if p_role is null then
    delete from public.workspace_blog_access where employee_id=p_employee_id;
  else
    insert into public.workspace_blog_access(employee_id,role,granted_by,granted_at)
      values(p_employee_id,p_role,actor,now())
      on conflict(employee_id) do update set role=excluded.role,granted_by=excluded.granted_by,granted_at=excluded.granted_at;
  end if;
  insert into public.workspace_blog_access_audit(actor_id,target_id,actor_name,target_name,previous_role,new_role)
    values(actor,p_employee_id,actor_profile.full_name,target_profile.full_name,previous_role,p_role);
  return jsonb_build_object('ok',true,'changed',true);
end;
$$;

create or replace function public.workspace_blog_access_log()
returns table(id uuid, actor_name text, target_name text, previous_role text, new_role text, happened_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((public.workspace_blog_identity()->>'can_manage_access')::boolean,false) then
    raise exception 'Blog access administrator required' using errcode = '42501';
  end if;
  return query select a.id,a.actor_name,a.target_name,a.previous_role,a.new_role,a.happened_at
    from public.workspace_blog_access_audit a order by a.happened_at desc,a.id limit 50;
end;
$$;
revoke all on function public.workspace_blog_identity() from public, anon, authenticated, service_role;
revoke all on function public.workspace_blog_people(text) from public, anon, authenticated, service_role;
revoke all on function public.workspace_blog_set_access(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.workspace_blog_access_log() from public, anon, authenticated, service_role;
grant execute on function public.workspace_blog_identity() to authenticated;
grant execute on function public.workspace_blog_people(text) to authenticated;
grant execute on function public.workspace_blog_set_access(uuid,text) to authenticated;
grant execute on function public.workspace_blog_access_log() to authenticated;
commit;
