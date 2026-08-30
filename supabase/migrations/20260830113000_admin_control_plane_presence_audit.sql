-- RideArrivo Administration control plane: transparent sign-in location records,
-- privileged audit trail and administrator presence intelligence.
--
-- Precise browser geolocation is recorded only after the employee explicitly opts in.
-- The existing employee_device_sessions table continues to expose only coarse location
-- to Support/Admin. Exact coordinates, reverse-geocoded addresses and source-network
-- data live in employee_sign_in_locations and are readable only by the employee and Admin.

begin;

create table if not exists public.employee_sign_in_locations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  session_key text not null,
  auth_session_hash text,
  browser_device_id text not null,
  browser_name text,
  operating_system text,
  platform text,
  user_agent text,
  source_ip text,
  timezone text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  location_accuracy_m integer,
  location_consent boolean not null default false,
  location_sharing_active boolean not null default false,
  consent_version text,
  address_full text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postcode text,
  country text,
  country_code text,
  geocoding_provider text,
  geocoding_attribution text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  location_captured_at timestamptz,
  unique(employee_id,session_key)
);

create index if not exists employee_sign_in_locations_employee_seen_idx
on public.employee_sign_in_locations(employee_id,last_seen_at desc);

create index if not exists employee_sign_in_locations_seen_idx
on public.employee_sign_in_locations(last_seen_at desc);

alter table public.employee_sign_in_locations enable row level security;

drop policy if exists "sign in locations self admin read" on public.employee_sign_in_locations;
create policy "sign in locations self admin read"
on public.employee_sign_in_locations
for select to authenticated
using (
  employee_id=auth.uid()
  or public.current_workspace_role()='admin'
);

-- Writes are intentionally server-side only through workspace-presence.
revoke all on public.employee_sign_in_locations from anon,authenticated;
grant select on public.employee_sign_in_locations to authenticated;

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.employee_profiles(id) on delete set null,
  target_employee_id uuid references public.employee_profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  source text not null default 'database',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
on public.admin_audit_log(created_at desc);

create index if not exists admin_audit_log_target_idx
on public.admin_audit_log(target_employee_id,created_at desc)
where target_employee_id is not null;

alter table public.admin_audit_log enable row level security;

drop policy if exists "admin audit admin read" on public.admin_audit_log;
create policy "admin audit admin read"
on public.admin_audit_log
for select to authenticated
using (public.current_workspace_role()='admin');

revoke all on public.admin_audit_log from anon,authenticated;
grant select on public.admin_audit_log to authenticated;

create or replace function public.record_admin_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_target_employee_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'database'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_id uuid;
  v_actor uuid:=auth.uid();
begin
  if v_actor is not null and public.current_workspace_role()<>'admin' then
    raise exception 'Administrator access is required';
  end if;

  insert into public.admin_audit_log(
    actor_id,target_employee_id,action,entity_type,entity_id,source,metadata
  ) values (
    v_actor,p_target_employee_id,btrim(p_action),btrim(p_entity_type),p_entity_id,
    coalesce(nullif(btrim(p_source),''),'database'),coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_admin_audit(text,text,text,uuid,jsonb,text) from public,anon;
grant execute on function public.record_admin_audit(text,text,text,uuid,jsonb,text) to authenticated,service_role;

create or replace function public.audit_sensitive_workspace_change()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_action text;
  v_entity_id text;
  v_target uuid;
  v_metadata jsonb:='{}'::jsonb;
begin
  -- Service-role writes do not carry auth.uid(). Those administrative changes
  -- are logged explicitly by the Edge Function with the real administrator ID,
  -- which prevents duplicate or anonymous audit entries.
  if v_actor is null then
    if TG_OP='DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Employee self-service profile edits are not privileged administration.
  -- Admin changes are logged; ordinary profile edits remain outside this audit trail.
  if TG_TABLE_NAME='employee_profiles' and public.current_workspace_role()<>'admin' then
    if TG_OP='DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_action:=TG_TABLE_NAME||'.'||lower(TG_OP);

  if TG_OP='DELETE' then
    v_entity_id:=old.id::text;
  else
    v_entity_id:=new.id::text;
  end if;

  if TG_TABLE_NAME='employee_profiles' then
    v_target:=case when TG_OP='DELETE' then old.id else new.id end;
    v_metadata:=jsonb_build_object(
      'before',case when TG_OP in ('UPDATE','DELETE') then jsonb_build_object(
        'role',old.role,'department',old.department,'job_title',old.job_title,'active',old.active,'manager_id',old.manager_id
      ) else null end,
      'after',case when TG_OP in ('INSERT','UPDATE') then jsonb_build_object(
        'role',new.role,'department',new.department,'job_title',new.job_title,'active',new.active,'manager_id',new.manager_id
      ) else null end
    );
  elsif TG_TABLE_NAME='workspace_workstation_assignments' then
    v_target:=case when TG_OP='DELETE' then old.employee_id else new.employee_id end;
    v_metadata:=jsonb_build_object(
      'workstation',case when TG_OP='DELETE' then old.workstation else new.workstation end,
      'active',case when TG_OP='DELETE' then old.active else new.active end,
      'is_primary',case when TG_OP='DELETE' then old.is_primary else new.is_primary end
    );
  elsif TG_TABLE_NAME='company_devices' then
    v_target:=case when TG_OP='DELETE' then old.assigned_employee_id else new.assigned_employee_id end;
    v_metadata:=jsonb_build_object(
      'asset_tag',case when TG_OP='DELETE' then old.asset_tag else new.asset_tag end,
      'device_type',case when TG_OP='DELETE' then old.device_type else new.device_type end,
      'status',case when TG_OP='DELETE' then old.status else new.status end
    );
  elsif TG_TABLE_NAME='workspace_download_requests' then
    v_target:=case when TG_OP='DELETE' then old.requester_id else new.requester_id end;
    v_metadata:=jsonb_build_object(
      'resource_type',case when TG_OP='DELETE' then old.resource_type else new.resource_type end,
      'resource_key',case when TG_OP='DELETE' then old.resource_key else new.resource_key end,
      'status',case when TG_OP='DELETE' then old.status else new.status end
    );
  end if;

  insert into public.admin_audit_log(
    actor_id,target_employee_id,action,entity_type,entity_id,source,metadata
  ) values (
    v_actor,v_target,v_action,TG_TABLE_NAME,v_entity_id,'trigger',v_metadata
  );

  if TG_OP='DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_sensitive_workspace_change() from public;

DROP TRIGGER IF EXISTS employee_profiles_admin_audit ON public.employee_profiles;
create trigger employee_profiles_admin_audit
after insert or update or delete on public.employee_profiles
for each row execute function public.audit_sensitive_workspace_change();

DROP TRIGGER IF EXISTS workstation_assignments_admin_audit ON public.workspace_workstation_assignments;
create trigger workstation_assignments_admin_audit
after insert or update or delete on public.workspace_workstation_assignments
for each row execute function public.audit_sensitive_workspace_change();

DROP TRIGGER IF EXISTS company_devices_admin_audit ON public.company_devices;
create trigger company_devices_admin_audit
after insert or update or delete on public.company_devices
for each row execute function public.audit_sensitive_workspace_change();

DROP TRIGGER IF EXISTS workspace_download_requests_admin_audit ON public.workspace_download_requests;
create trigger workspace_download_requests_admin_audit
after insert or update or delete on public.workspace_download_requests
for each row execute function public.audit_sensitive_workspace_change();

create or replace function public.admin_employee_presence_summary()
returns table(
  employee_id uuid,
  full_name text,
  email text,
  department text,
  job_title text,
  role text,
  active boolean,
  manager_id uuid,
  workstation text,
  rolling_score numeric,
  rolling_status text,
  annual_score numeric,
  annual_status text,
  current_badge text,
  device_count bigint,
  browser_device_count bigint,
  last_seen_at timestamptz,
  browser_name text,
  operating_system text,
  timezone text,
  source_ip text,
  address_full text,
  city text,
  state text,
  country text,
  location_accuracy_m integer,
  location_consent boolean,
  location_sharing_active boolean,
  geocoding_provider text,
  geocoding_attribution text
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if public.current_workspace_role()<>'admin' then
    raise exception 'Administrator access is required';
  end if;

  return query
  select
    p.id,p.full_name,p.email,p.department,p.job_title,p.role,p.active,p.manager_id,
    wa.workstation,
    ks.score,ks.status,
    ya.score,ya.status,
    ra.badge_label,
    (select count(*) from public.company_devices d where d.assigned_employee_id=p.id and d.status not in ('returned','retired')),
    (select count(*) from public.employee_device_sessions s where s.employee_id=p.id),
    loc.last_seen_at,loc.browser_name,loc.operating_system,loc.timezone,loc.source_ip,
    loc.address_full,loc.city,loc.state,loc.country,loc.location_accuracy_m,loc.location_consent,loc.location_sharing_active,
    loc.geocoding_provider,loc.geocoding_attribution
  from public.employee_profiles p
  left join lateral (
    select a.workstation
    from public.workspace_workstation_assignments a
    where a.employee_id=p.id and a.active=true and a.is_primary=true
    order by a.assigned_at desc limit 1
  ) wa on true
  left join lateral (
    select s.score,s.status
    from public.employee_kpi_snapshots s
    where s.employee_id=p.id
    order by s.snapshot_date desc limit 1
  ) ks on true
  left join public.employee_annual_kpi_snapshots ya
    on ya.employee_id=p.id and ya.evaluation_year=extract(year from current_date)::integer
  left join lateral (
    select a.badge_label
    from public.employee_recognition_awards a
    where a.employee_id=p.id and a.active=true
    order by a.awarded_at desc limit 1
  ) ra on true
  left join lateral (
    select l.last_seen_at,l.browser_name,l.operating_system,l.timezone,l.source_ip,
           l.address_full,l.city,l.state,l.country,l.location_accuracy_m,l.location_consent,l.location_sharing_active,
           l.geocoding_provider,l.geocoding_attribution
    from public.employee_sign_in_locations l
    where l.employee_id=p.id
    order by l.last_seen_at desc limit 1
  ) loc on true
  order by p.active desc,lower(coalesce(p.full_name,p.email)),p.email;
end;
$$;

revoke all on function public.admin_employee_presence_summary() from public,anon;
grant execute on function public.admin_employee_presence_summary() to authenticated;

create or replace function public.admin_employee_presence_history(
  p_employee_id uuid,
  p_limit integer default 25
)
returns table(
  id uuid,
  session_key text,
  browser_device_id text,
  browser_name text,
  operating_system text,
  platform text,
  source_ip text,
  timezone text,
  latitude numeric,
  longitude numeric,
  location_accuracy_m integer,
  location_consent boolean,
  location_sharing_active boolean,
  address_full text,
  city text,
  state text,
  postcode text,
  country text,
  country_code text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  location_captured_at timestamptz,
  geocoding_provider text,
  geocoding_attribution text
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if public.current_workspace_role()<>'admin' then
    raise exception 'Administrator access is required';
  end if;

  return query
  select
    l.id,l.session_key,l.browser_device_id,l.browser_name,l.operating_system,l.platform,
    l.source_ip,l.timezone,l.latitude,l.longitude,l.location_accuracy_m,l.location_consent,l.location_sharing_active,
    l.address_full,l.city,l.state,l.postcode,l.country,l.country_code,
    l.first_seen_at,l.last_seen_at,l.location_captured_at,l.geocoding_provider,l.geocoding_attribution
  from public.employee_sign_in_locations l
  where l.employee_id=p_employee_id
  order by l.last_seen_at desc
  limit greatest(1,least(coalesce(p_limit,25),100));
end;
$$;

revoke all on function public.admin_employee_presence_history(uuid,integer) from public,anon;
grant execute on function public.admin_employee_presence_history(uuid,integer) to authenticated;

-- Employees can inspect the sign-in-location data recorded for their own account.
create or replace function public.my_sign_in_location_history(p_limit integer default 10)
returns setof public.employee_sign_in_locations
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select l.*
  from public.employee_sign_in_locations l
  where l.employee_id=auth.uid()
  order by l.last_seen_at desc
  limit greatest(1,least(coalesce(p_limit,10),50));
$$;

revoke all on function public.my_sign_in_location_history(integer) from public,anon;
grant execute on function public.my_sign_in_location_history(integer) to authenticated;

-- Exact sign-in location is security telemetry, not an indefinite movement archive.
-- Keep 90 days by default; audit metadata is retained for one year.
do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname='ridearrivo-admin-telemetry-retention';

  perform cron.schedule(
    'ridearrivo-admin-telemetry-retention',
    '37 3 * * *',
    $cron$
      delete from public.employee_sign_in_locations where last_seen_at < now() - interval '90 days';
      delete from public.admin_audit_log where created_at < now() - interval '365 days';
    $cron$
  );
exception when others then
  raise notice 'Admin telemetry retention cron schedule skipped: %',sqlerrm;
end;
$$;

commit;
