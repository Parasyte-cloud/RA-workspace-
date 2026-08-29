-- RideArrivo annual KPI evaluation + monthly recognition foundation.
-- KPI scores are transparent operational coaching signals only. This migration
-- does not automate discipline, compensation, promotion or termination.

begin;

-- -------------------------------------------------------------------------
-- Annual / year-to-date KPI snapshots
-- -------------------------------------------------------------------------
create table if not exists public.employee_annual_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  evaluation_year integer not null check (evaluation_year between 2020 and 2200),
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
  is_final boolean not null default false,
  finalised_at timestamptz,
  unique(employee_id,evaluation_year)
);

create index if not exists employee_annual_kpi_employee_year_idx
on public.employee_annual_kpi_snapshots(employee_id,evaluation_year desc);

alter table public.employee_annual_kpi_snapshots enable row level security;

drop policy if exists "annual kpi self manager hr admin read" on public.employee_annual_kpi_snapshots;
create policy "annual kpi self manager hr admin read"
on public.employee_annual_kpi_snapshots
for select to authenticated
using (
  employee_id=auth.uid()
  or public.current_workspace_role() in ('hr','admin')
  or (
    public.current_workspace_role()='manager'
    and exists (
      select 1
      from public.employee_profiles e
      where e.id=employee_annual_kpi_snapshots.employee_id
        and e.manager_id=auth.uid()
    )
  )
);

revoke all on public.employee_annual_kpi_snapshots from anon;
grant select on public.employee_annual_kpi_snapshots to authenticated;

create or replace function public.refresh_workspace_annual_kpis(
  p_year integer default extract(year from current_date)::integer,
  p_as_of date default current_date
)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  affected integer:=0;
  v_start_date date:=make_date(p_year,1,1);
  v_end_date date:=least(p_as_of,make_date(p_year,12,31));
begin
  if p_year<2020 or p_year>2200 then
    raise exception 'Invalid KPI evaluation year';
  end if;

  insert into public.employee_annual_kpi_snapshots(
    employee_id,evaluation_year,period_start,period_end,
    total_assigned,total_completed,completed_with_due_date,completed_on_time,
    acknowledged,overdue_open,completion_rate,on_time_rate,
    acknowledgement_rate,score,status,calculated_at,is_final,finalised_at
  )
  with per_employee as (
    select
      p.id employee_id,
      count(a.id) filter (where w.status<>'cancelled')::int total_assigned,
      count(a.id) filter (where w.status='completed' and w.completed_at < (v_end_date + 1)::timestamptz)::int total_completed,
      count(a.id) filter (where w.status='completed' and w.completed_at < (v_end_date + 1)::timestamptz and w.due_at is not null)::int completed_with_due_date,
      count(a.id) filter (
        where w.status='completed' and w.due_at is not null
          and w.completed_at is not null
          and w.completed_at < (v_end_date + 1)::timestamptz
          and w.completed_at<=w.due_at
      )::int completed_on_time,
      count(a.id) filter (where a.acknowledged_at is not null and a.acknowledged_at < (v_end_date + 1)::timestamptz and w.status<>'cancelled')::int acknowledged,
      count(a.id) filter (
        where w.status<>'cancelled'
          and w.due_at is not null
          and w.due_at < (v_end_date + 1)::timestamptz
          and (w.completed_at is null or w.completed_at >= (v_end_date + 1)::timestamptz)
      )::int overdue_open
    from public.employee_profiles p
    left join public.work_item_assignees a
      on a.assignee_id=p.id
      and a.assigned_at >= v_start_date::timestamptz
      and a.assigned_at < (v_end_date + 1)::timestamptz
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
    employee_id,p_year,v_start_date,v_end_date,
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
    now(),
    (p_as_of > make_date(p_year,12,31)),
    case when p_as_of > make_date(p_year,12,31) then now() else null end
  from scored
  on conflict(employee_id,evaluation_year)
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
    calculated_at=excluded.calculated_at,
    is_final=excluded.is_final,
    finalised_at=coalesce(employee_annual_kpi_snapshots.finalised_at,excluded.finalised_at);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.refresh_workspace_annual_kpis(integer,date) from public,anon,authenticated;
grant execute on function public.refresh_workspace_annual_kpis(integer,date) to service_role;

-- -------------------------------------------------------------------------
-- Recognition awards. Only one award is active at a time; the active badge
-- remains until a new winner is successfully generated.
-- -------------------------------------------------------------------------
create table if not exists public.employee_recognition_awards (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  award_month date not null,
  performance_month date not null,
  badge_code text not null default 'monthly_top_performer',
  badge_label text not null default 'Top Performer',
  score numeric(6,2) not null,
  total_assigned integer not null default 0,
  total_completed integer not null default 0,
  completed_on_time integer not null default 0,
  overdue_open integer not null default 0,
  active boolean not null default true,
  awarded_at timestamptz not null default now(),
  unique(award_month)
);

create index if not exists employee_recognition_active_idx
on public.employee_recognition_awards(active,awarded_at desc);

create unique index if not exists employee_recognition_one_active_idx
on public.employee_recognition_awards ((1))
where active=true;

alter table public.employee_recognition_awards enable row level security;

drop policy if exists "recognition active employees read" on public.employee_recognition_awards;
create policy "recognition active employees read"
on public.employee_recognition_awards
for select to authenticated
using (
  exists (
    select 1 from public.employee_profiles p
    where p.id=auth.uid() and p.active=true
  )
);

revoke all on public.employee_recognition_awards from anon;
grant select on public.employee_recognition_awards to authenticated;

-- Ensure the existing Announcements UI has a durable database source.
create table if not exists public.workspace_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  category text not null default 'Company',
  priority text not null default 'normal',
  published boolean not null default false,
  published_at timestamptz not null default now(),
  audience_roles text[] not null default '{}'::text[],
  audience_departments text[] not null default '{}'::text[],
  source_type text,
  source_key text,
  employee_id uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_announcements add column if not exists title text not null default 'Announcement';
alter table public.workspace_announcements add column if not exists body text not null default '';
alter table public.workspace_announcements add column if not exists category text not null default 'Company';
alter table public.workspace_announcements add column if not exists priority text not null default 'normal';
alter table public.workspace_announcements add column if not exists published boolean not null default false;
alter table public.workspace_announcements add column if not exists published_at timestamptz not null default now();
alter table public.workspace_announcements add column if not exists source_type text;
alter table public.workspace_announcements add column if not exists source_key text;
alter table public.workspace_announcements add column if not exists employee_id uuid references public.employee_profiles(id) on delete set null;
alter table public.workspace_announcements add column if not exists audience_roles text[] not null default '{}'::text[];
alter table public.workspace_announcements add column if not exists audience_departments text[] not null default '{}'::text[];
alter table public.workspace_announcements add column if not exists created_at timestamptz not null default now();
alter table public.workspace_announcements add column if not exists updated_at timestamptz not null default now();

create index if not exists workspace_announcements_published_idx
on public.workspace_announcements(published,published_at desc);
create index if not exists workspace_announcements_source_idx
on public.workspace_announcements(source_type,source_key);
create unique index if not exists workspace_announcements_source_unique_idx
on public.workspace_announcements(source_type,source_key)
where source_type is not null and source_key is not null;

alter table public.workspace_announcements enable row level security;

drop policy if exists "announcements active employee read" on public.workspace_announcements;
create policy "announcements active employee read"
on public.workspace_announcements
for select to authenticated
using (
  published=true
  and exists (
    select 1 from public.employee_profiles p
    where p.id=auth.uid() and p.active=true
  )
);

drop policy if exists "announcements admin manage" on public.workspace_announcements;
create policy "announcements admin manage"
on public.workspace_announcements
for all to authenticated
using (public.current_workspace_role()='admin')
with check (public.current_workspace_role()='admin');

revoke all on public.workspace_announcements from anon;
grant select,insert,update,delete on public.workspace_announcements to authenticated;

create or replace function public.refresh_monthly_kpi_award(
  p_award_month date default date_trunc('month',current_date)::date
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  target_award_month date:=date_trunc('month',p_award_month)::date;
  performance_start date:=(date_trunc('month',p_award_month)-interval '1 month')::date;
  performance_end date:=date_trunc('month',p_award_month)::date;
  winner_id uuid;
  winner_name text;
  winner_score numeric(6,2);
  winner_assigned integer;
  winner_completed integer;
  winner_on_time integer;
  winner_overdue integer;
  existing_winner uuid;
  new_award_id uuid;
begin
  select a.employee_id into existing_winner
  from public.employee_recognition_awards a
  where a.award_month=target_award_month
  limit 1;

  if existing_winner is not null then
    return existing_winner;
  end if;

  with per_employee as (
    select
      p.id employee_id,
      p.full_name,
      p.email,
      count(a.id) filter (where w.status<>'cancelled')::int total_assigned,
      count(a.id) filter (where w.status='completed' and w.completed_at < performance_end::timestamptz)::int total_completed,
      count(a.id) filter (where w.status='completed' and w.completed_at < performance_end::timestamptz and w.due_at is not null)::int completed_with_due_date,
      count(a.id) filter (
        where w.status='completed' and w.due_at is not null
          and w.completed_at is not null
          and w.completed_at < performance_end::timestamptz
          and w.completed_at<=w.due_at
      )::int completed_on_time,
      count(a.id) filter (where a.acknowledged_at is not null and a.acknowledged_at < performance_end::timestamptz and w.status<>'cancelled')::int acknowledged,
      count(a.id) filter (
        where w.status<>'cancelled'
          and w.due_at is not null and w.due_at < performance_end::timestamptz
          and (w.completed_at is null or w.completed_at >= performance_end::timestamptz)
      )::int overdue_open
    from public.employee_profiles p
    left join public.work_item_assignees a
      on a.assignee_id=p.id
      and a.assigned_at >= performance_start::timestamptz
      and a.assigned_at < performance_end::timestamptz
    left join public.work_items w on w.id=a.work_item_id
    where p.active=true
    group by p.id,p.full_name,p.email
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
    employee_id,
    coalesce(nullif(trim(full_name),''),email),
    score,
    total_assigned,
    total_completed,
    completed_on_time,
    overdue_open
  into
    winner_id,winner_name,winner_score,winner_assigned,winner_completed,winner_on_time,winner_overdue
  from scored
  where total_assigned>=3 and score is not null
  order by score desc,completed_on_time desc,total_completed desc,overdue_open asc,employee_id
  limit 1;

  -- If there is not enough evidence for a fair award, keep the previous badge
  -- active rather than inventing a winner from an undersized sample.
  if winner_id is null then
    return null;
  end if;

  update public.employee_recognition_awards
  set active=false
  where active=true;

  insert into public.employee_recognition_awards(
    employee_id,award_month,performance_month,badge_code,badge_label,score,
    total_assigned,total_completed,completed_on_time,overdue_open,active,awarded_at
  ) values (
    winner_id,target_award_month,performance_start,'monthly_top_performer','Top Performer',winner_score,
    winner_assigned,winner_completed,winner_on_time,winner_overdue,true,now()
  )
  returning id into new_award_id;

  update public.workspace_announcements
  set published=false,updated_at=now()
  where source_type='kpi_monthly_winner' and published=true;

  update public.workspace_announcements
  set
    title=format('Top Performer: %s',winner_name),
    body=format(
      '%s is RideArrivo Top Performer for %s with a transparent delivery KPI of %s%%. The recognition remains featured until the next monthly winner is generated.',
      winner_name,to_char(performance_start,'FMMonth YYYY'),winner_score
    ),
    category='Recognition',
    priority='high',
    published=true,
    published_at=now(),
    employee_id=winner_id,
    updated_at=now()
  where source_type='kpi_monthly_winner'
    and source_key=to_char(target_award_month,'YYYY-MM');

  if not found then
    insert into public.workspace_announcements(
      title,body,category,priority,published,published_at,
      source_type,source_key,employee_id
    ) values (
      format('Top Performer: %s',winner_name),
      format(
        '%s is RideArrivo Top Performer for %s with a transparent delivery KPI of %s%%. The recognition remains featured until the next monthly winner is generated.',
        winner_name,to_char(performance_start,'FMMonth YYYY'),winner_score
      ),
      'Recognition','high',true,now(),
      'kpi_monthly_winner',to_char(target_award_month,'YYYY-MM'),winner_id
    );
  end if;

  insert into public.notifications(user_id,type,title,body,entity_type,entity_id)
  values (
    winner_id,
    'recognition',
    'You are RideArrivo Top Performer',
    format('Congratulations %s. Your %s performance earned this month''s Top Performer badge.',winner_name,to_char(performance_start,'FMMonth YYYY')),
    'employee_recognition_award',
    new_award_id
  );

  return winner_id;
end;
$$;

revoke all on function public.refresh_monthly_kpi_award(date) from public,anon,authenticated;
grant execute on function public.refresh_monthly_kpi_award(date) to service_role;

-- Management summary for coaching and calibration. Managers only see their
-- direct reports; HR and Admin can see all active employees.
create or replace function public.managed_employee_kpi_summary()
returns table(
  employee_id uuid,
  full_name text,
  email text,
  department text,
  job_title text,
  role text,
  workstation text,
  rolling_score numeric,
  rolling_status text,
  annual_score numeric,
  annual_status text,
  current_badge text
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid:=auth.uid();
  actor_role text;
begin
  select lower(coalesce(p.role,'employee')) into actor_role
  from public.employee_profiles p
  where p.id=actor and p.active=true;

  if actor_role not in ('manager','hr','admin') then
    raise exception 'Manager, People & HR, or Admin access is required';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.email,
    p.department,
    p.job_title,
    p.role,
    wa.workstation,
    ks.score,
    ks.status,
    ya.score,
    ya.status,
    ra.badge_label
  from public.employee_profiles p
  left join lateral (
    select a.workstation
    from public.workspace_workstation_assignments a
    where a.employee_id=p.id and a.active=true and a.is_primary=true
    order by a.assigned_at desc
    limit 1
  ) wa on true
  left join lateral (
    select s.score,s.status
    from public.employee_kpi_snapshots s
    where s.employee_id=p.id
    order by s.snapshot_date desc
    limit 1
  ) ks on true
  left join public.employee_annual_kpi_snapshots ya
    on ya.employee_id=p.id
    and ya.evaluation_year=extract(year from current_date)::integer
  left join lateral (
    select a.badge_label
    from public.employee_recognition_awards a
    where a.employee_id=p.id and a.active=true
    order by a.awarded_at desc
    limit 1
  ) ra on true
  where p.active=true
    and (
      actor_role in ('hr','admin')
      or p.id=actor
      or p.manager_id=actor
    )
  order by lower(coalesce(p.full_name,p.email)),p.email;
end;
$$;

revoke all on function public.managed_employee_kpi_summary() from public,anon;
grant execute on function public.managed_employee_kpi_summary() to authenticated;

-- Refresh current annual KPI now. Recognition generation is safe and
-- idempotent; it only replaces the existing badge after a fair new winner is found.
select public.refresh_workspace_annual_kpis(extract(year from current_date)::integer,current_date);
select public.refresh_monthly_kpi_award(date_trunc('month',current_date)::date);

-- Daily annual refresh at 06:10 WAT (05:10 UTC) and monthly recognition at
-- 06:15 WAT on the first day of each month (05:15 UTC).
do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname='ridearrivo-annual-kpi-refresh';

    perform cron.schedule(
      'ridearrivo-annual-kpi-refresh',
      '10 5 * * *',
      'select public.refresh_workspace_annual_kpis(extract(year from current_date)::integer,current_date);'
    );

    perform cron.unschedule(jobid)
    from cron.job
    where jobname='ridearrivo-annual-kpi-finalise';

    perform cron.schedule(
      'ridearrivo-annual-kpi-finalise',
      '12 5 1 1 *',
      'select public.refresh_workspace_annual_kpis(extract(year from current_date - interval ''1 day'')::integer,current_date);'
    );

    perform cron.unschedule(jobid)
    from cron.job
    where jobname='ridearrivo-monthly-kpi-recognition';

    perform cron.schedule(
      'ridearrivo-monthly-kpi-recognition',
      '15 5 1 * *',
      'select public.refresh_monthly_kpi_award(date_trunc(''month'',current_date)::date);'
    );
  end if;
exception when others then
  raise notice 'KPI recognition cron schedule skipped: %',sqlerrm;
end;
$$;

commit;
