-- RideArrivo workstation assignment + transparent KPI foundation.
-- Adds explicit admin-managed primary workstations without weakening RLS,
-- and a daily, evidence-based 30-day delivery KPI snapshot per employee.

begin;

create table if not exists public.workspace_workstation_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  workstation text not null check (workstation in (
    'support','operations','people','engineering','finance','marketing',
    'partnerships','legal','executive','administration'
  )),
  is_primary boolean not null default true,
  active boolean not null default true,
  assigned_by uuid references public.employee_profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id,workstation)
);

create unique index if not exists workspace_workstation_one_primary_idx
on public.workspace_workstation_assignments(employee_id)
where active=true and is_primary=true;

alter table public.workspace_workstation_assignments enable row level security;

drop policy if exists "workstation own or admin read" on public.workspace_workstation_assignments;
create policy "workstation own or admin read"
on public.workspace_workstation_assignments
for select to authenticated
using (
  employee_id=auth.uid()
  or public.current_workspace_role()='admin'
);

drop policy if exists "workstation admin write" on public.workspace_workstation_assignments;
create policy "workstation admin write"
on public.workspace_workstation_assignments
for all to authenticated
using (public.current_workspace_role()='admin')
with check (public.current_workspace_role()='admin');

revoke all on public.workspace_workstation_assignments from anon;
grant select,insert,update,delete on public.workspace_workstation_assignments to authenticated;

create or replace function public.workstation_role(p_workstation text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_workstation,''))
    when 'people' then 'hr'
    when 'executive' then 'manager'
    when 'administration' then 'admin'
    else lower(coalesce(p_workstation,''))
  end;
$$;

create or replace function public.has_workstation_access(workstations text[])
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists (
    select 1
    from public.workspace_workstation_assignments a
    join public.employee_profiles p on p.id=a.employee_id
    where a.employee_id=auth.uid()
      and a.active=true
      and p.active=true
      and a.workstation=any(workstations)
  );
$$;

revoke all on function public.has_workstation_access(text[]) from public,anon;
grant execute on function public.has_workstation_access(text[]) to authenticated;

-- Preserve the existing role model while allowing an explicitly assigned
-- workstation to grant the equivalent department RLS capability.
create or replace function public.has_workspace_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists (
    select 1
    from public.employee_profiles p
    where p.id=auth.uid()
      and p.active=true
      and (
        p.role=any(roles)
        or exists (
          select 1
          from public.workspace_workstation_assignments a
          where a.employee_id=p.id
            and a.active=true
            and public.workstation_role(a.workstation)=any(roles)
        )
      )
  );
$$;

revoke all on function public.has_workspace_role(text[]) from public,anon;
grant execute on function public.has_workspace_role(text[]) to authenticated;

create or replace function public.assign_primary_workstation(
  target_user uuid,
  new_workstation text
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  actor_role text;
  target_role text;
  clean_workstation text;
begin
  actor_role:=public.current_workspace_role();
  if actor_role<>'admin' then
    raise exception 'Only an administrator can assign workstations';
  end if;

  clean_workstation:=lower(trim(new_workstation));
  if clean_workstation not in (
    'support','operations','people','engineering','finance','marketing',
    'partnerships','legal','executive','administration'
  ) then
    raise exception 'Invalid workstation';
  end if;

  select role into target_role
  from public.employee_profiles
  where id=target_user and active=true;

  if target_role is null then
    raise exception 'Active employee not found';
  end if;

  if clean_workstation='administration' and target_role<>'admin' then
    raise exception 'Administration workstation requires the admin role';
  end if;

  if clean_workstation='executive' and target_role not in ('manager','admin') then
    raise exception 'Executive workstation requires manager or admin role';
  end if;

  update public.workspace_workstation_assignments
  set is_primary=false,active=false,updated_at=now()
  where employee_id=target_user and active=true;

  insert into public.workspace_workstation_assignments(
    employee_id,workstation,is_primary,active,assigned_by,assigned_at,updated_at
  ) values (
    target_user,clean_workstation,true,true,auth.uid(),now(),now()
  )
  on conflict(employee_id,workstation)
  do update set
    is_primary=true,
    active=true,
    assigned_by=excluded.assigned_by,
    assigned_at=now(),
    updated_at=now();
end;
$$;

revoke all on function public.assign_primary_workstation(uuid,text) from public,anon;
grant execute on function public.assign_primary_workstation(uuid,text) to authenticated;

create or replace function public.remove_primary_workstation(target_user uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if public.current_workspace_role()<>'admin' then
    raise exception 'Only an administrator can remove workstation assignments';
  end if;

  update public.workspace_workstation_assignments
  set active=false,is_primary=false,updated_at=now()
  where employee_id=target_user and active=true;
end;
$$;

revoke all on function public.remove_primary_workstation(uuid) from public,anon;
grant execute on function public.remove_primary_workstation(uuid) to authenticated;

-- Seed a sensible primary workstation from the current role. Admins receive
-- Administration; managers receive Executive. Generic employees stay
-- unassigned until Administration chooses a workstation.
insert into public.workspace_workstation_assignments(
  employee_id,workstation,is_primary,active,assigned_by
)
select
  p.id,
  case p.role
    when 'support' then 'support'
    when 'operations' then 'operations'
    when 'hr' then 'people'
    when 'engineer' then 'engineering'
    when 'cto' then 'engineering'
    when 'finance' then 'finance'
    when 'marketing' then 'marketing'
    when 'partnerships' then 'partnerships'
    when 'legal' then 'legal'
    when 'manager' then 'executive'
    when 'admin' then 'administration'
    else null
  end,
  true,
  true,
  null
from public.employee_profiles p
where p.active=true
  and p.role<>'employee'
  and not exists (
    select 1 from public.workspace_workstation_assignments a
    where a.employee_id=p.id and a.active=true and a.is_primary=true
  )
on conflict do nothing;

-- Explicit workstation assignment now also authorizes the engineering gateway.
create or replace function public.authorize_parasyte_linux()
returns table(user_id uuid,email text,role text)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select p.id,p.email,p.role
  from public.employee_profiles p
  where p.id=auth.uid()
    and p.active=true
    and (
      p.role in ('engineer','admin')
      or exists (
        select 1 from public.workspace_workstation_assignments a
        where a.employee_id=p.id
          and a.active=true
          and a.workstation='engineering'
      )
    )
  limit 1;
$$;

revoke all on function public.authorize_parasyte_linux() from public,anon;
grant execute on function public.authorize_parasyte_linux() to authenticated;

-- -------------------------------------------------------------------------
-- KPI snapshots
-- -------------------------------------------------------------------------
create table if not exists public.employee_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  snapshot_date date not null,
  period_start date not null,
  period_end date not null,
  total_assigned integer not null default 0,
  total_completed integer not null default 0,
  completed_with_due_date integer not null default 0,
  completed_on_time integer not null default 0,
  acknowledged integer not null default 0,
  overdue_open integer not null default 0,
  completion_rate numeric(6,2),
  on_time_rate numeric(6,2),
  acknowledgement_rate numeric(6,2),
  score numeric(6,2),
  status text not null default 'insufficient_data' check (
    status in ('insufficient_data','excellent','strong','on_track','needs_focus')
  ),
  calculated_at timestamptz not null default now(),
  unique(employee_id,snapshot_date)
);

create index if not exists employee_kpi_snapshots_employee_date_idx
on public.employee_kpi_snapshots(employee_id,snapshot_date desc);

alter table public.employee_kpi_snapshots enable row level security;

drop policy if exists "kpi self manager admin read" on public.employee_kpi_snapshots;
create policy "kpi self manager admin read"
on public.employee_kpi_snapshots
for select to authenticated
using (
  employee_id=auth.uid()
  or public.current_workspace_role()='admin'
  or (
    public.current_workspace_role()='manager'
    and exists (
      select 1 from public.employee_profiles e
      where e.id=employee_kpi_snapshots.employee_id
        and e.manager_id=auth.uid()
    )
  )
);

revoke all on public.employee_kpi_snapshots from anon;
grant select on public.employee_kpi_snapshots to authenticated;

create or replace function public.refresh_workspace_kpis(
  p_snapshot_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  affected integer:=0;
begin
  insert into public.employee_kpi_snapshots(
    employee_id,snapshot_date,period_start,period_end,
    total_assigned,total_completed,completed_with_due_date,completed_on_time,
    acknowledged,overdue_open,completion_rate,on_time_rate,
    acknowledgement_rate,score,status,calculated_at
  )
  with per_employee as (
    select
      p.id employee_id,
      count(a.id) filter (where w.status<>'cancelled')::int total_assigned,
      count(a.id) filter (where w.status='completed' and w.completed_at < (p_snapshot_date + 1)::timestamptz)::int total_completed,
      count(a.id) filter (where w.status='completed' and w.completed_at < (p_snapshot_date + 1)::timestamptz and w.due_at is not null)::int completed_with_due_date,
      count(a.id) filter (
        where w.status='completed' and w.due_at is not null
          and w.completed_at is not null
          and w.completed_at < (p_snapshot_date + 1)::timestamptz
          and w.completed_at<=w.due_at
      )::int completed_on_time,
      count(a.id) filter (where a.acknowledged_at is not null and a.acknowledged_at < (p_snapshot_date + 1)::timestamptz and w.status<>'cancelled')::int acknowledged,
      count(a.id) filter (
        where w.status<>'cancelled'
          and w.due_at is not null
          and w.due_at < (p_snapshot_date + 1)::timestamptz
          and (w.completed_at is null or w.completed_at >= (p_snapshot_date + 1)::timestamptz)
      )::int overdue_open
    from public.employee_profiles p
    left join public.work_item_assignees a
      on a.assignee_id=p.id
      and a.assigned_at >= (p_snapshot_date - 29)::timestamptz
      and a.assigned_at < (p_snapshot_date + 1)::timestamptz
    left join public.work_items w on w.id=a.work_item_id
    where p.active=true
    group by p.id
  ), rates as (
    select *,
      case when total_assigned>0 then round(total_completed*100.0/total_assigned,2) end completion_rate,
      case when completed_with_due_date>0 then round(completed_on_time*100.0/completed_with_due_date,2) end on_time_rate,
      case when total_assigned>0 then round(acknowledged*100.0/total_assigned,2) end acknowledgement_rate
    from per_employee
  ), scored as (
    select *,
      case when total_assigned=0 then null
        else round(
          (
            completion_rate*60
            + acknowledgement_rate*10
            + coalesce(on_time_rate,0)*case when completed_with_due_date>0 then 30 else 0 end
          ) /
          (70 + case when completed_with_due_date>0 then 30 else 0 end),
          2
        )
      end as score
    from rates
  )
  select
    employee_id,p_snapshot_date,p_snapshot_date-29,p_snapshot_date,
    total_assigned,total_completed,completed_with_due_date,completed_on_time,
    acknowledged,overdue_open,completion_rate,on_time_rate,
    acknowledgement_rate,score,
    case
      when score is null then 'insufficient_data'
      when score>=90 then 'excellent'
      when score>=80 then 'strong'
      when score>=65 then 'on_track'
      else 'needs_focus'
    end,
    now()
  from scored
  on conflict(employee_id,snapshot_date)
  do update set
    period_start=excluded.period_start,
    period_end=excluded.period_end,
    total_assigned=excluded.total_assigned,
    total_completed=excluded.total_completed,
    completed_with_due_date=excluded.completed_with_due_date,
    completed_on_time=excluded.completed_on_time,
    acknowledged=excluded.acknowledged,
    overdue_open=excluded.overdue_open,
    completion_rate=excluded.completion_rate,
    on_time_rate=excluded.on_time_rate,
    acknowledgement_rate=excluded.acknowledgement_rate,
    score=excluded.score,
    status=excluded.status,
    calculated_at=excluded.calculated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.refresh_workspace_kpis(date) from public,anon,authenticated;
grant execute on function public.refresh_workspace_kpis(date) to service_role;

-- Generate the first snapshot immediately.
select public.refresh_workspace_kpis(current_date);

-- Recompute every morning at 06:05 West Africa Time (05:05 UTC).
do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname='ridearrivo-daily-kpi-refresh';

    perform cron.schedule(
      'ridearrivo-daily-kpi-refresh',
      '5 5 * * *',
      'select public.refresh_workspace_kpis(current_date);'
    );
  end if;
exception when others then
  raise notice 'KPI cron schedule skipped: %', sqlerrm;
end;
$$;

commit;
