begin;

-- Durable department achievements. team_milestones remains the event layer.
create table if not exists public.department_achievements (
  id uuid primary key default gen_random_uuid(),
  department text not null check (length(trim(department)) between 2 and 120),
  kind text not null check (kind in ('dept_overdue_clear', 'project_complete')),
  title text not null,
  description text not null,
  tier text not null default 'gold' check (tier in ('bronze', 'silver', 'gold', 'platinum')),
  project_id uuid null,
  source_milestone_id uuid null references public.team_milestones(id) on delete set null,
  earned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.department_achievement_seen (
  achievement_id uuid not null references public.department_achievements(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (achievement_id, user_id)
);

create index if not exists department_achievements_department_earned_idx
  on public.department_achievements ((lower(trim(department))), earned_at desc);

create unique index if not exists department_achievements_project_unique
  on public.department_achievements (kind, project_id, (lower(trim(department))))
  where kind = 'project_complete' and project_id is not null;

create unique index if not exists department_achievements_source_unique
  on public.department_achievements (source_milestone_id, (lower(trim(department))))
  where source_milestone_id is not null;

alter table public.department_achievements enable row level security;
alter table public.department_achievement_seen enable row level security;

revoke all on public.department_achievements from anon, authenticated;
revoke all on public.department_achievement_seen from anon, authenticated;
grant select on public.department_achievements to authenticated;
grant select on public.department_achievement_seen to authenticated;
grant all on public.department_achievements, public.department_achievement_seen to service_role;

-- Central authorization predicate. It deliberately reads the caller's current
-- employee profile so transfers take effect immediately.
create or replace function public.can_view_department_achievement(p_department text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_employee()
    and (
      public.is_workspace_admin()
      or exists (
        select 1
        from public.employee_profiles ep
        where ep.id = auth.uid()
          and ep.active = true
          and lower(trim(coalesce(ep.department, ''))) = lower(trim(coalesce(p_department, '')))
          and nullif(trim(coalesce(ep.department, '')), '') is not null
      )
    );
$$;

revoke all on function public.can_view_department_achievement(text) from public, anon;
grant execute on function public.can_view_department_achievement(text) to authenticated;

-- Achievement rows are persistent; visibility follows current department.
drop policy if exists "department achievements authorised read" on public.department_achievements;
create policy "department achievements authorised read"
on public.department_achievements
for select
to authenticated
using (public.can_view_department_achievement(department));

-- Seen state is personal and never broadens achievement visibility.
drop policy if exists "department achievement seen own read" on public.department_achievement_seen;
create policy "department achievement seen own read"
on public.department_achievement_seen
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.department_achievements a
    where a.id = achievement_id
      and public.can_view_department_achievement(a.department)
  )
);

drop policy if exists "department achievement seen authorised insert" on public.department_achievement_seen;
create policy "department achievement seen authorised insert"
on public.department_achievement_seen
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.department_achievements a
    where a.id = achievement_id
      and public.can_view_department_achievement(a.department)
  )
);

create or replace function public.unseen_department_achievements()
returns table (
  id uuid,
  department text,
  kind text,
  title text,
  description text,
  tier text,
  project_id uuid,
  earned_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id,
    a.department,
    a.kind,
    a.title,
    a.description,
    a.tier,
    a.project_id,
    a.earned_at
  from public.department_achievements a
  where public.can_view_department_achievement(a.department)
    and a.earned_at > now() - interval '3 days'
    and not exists (
      select 1
      from public.department_achievement_seen s
      where s.achievement_id = a.id
        and s.user_id = auth.uid()
    )
  order by a.earned_at desc
  limit 5;
$$;

create or replace function public.mark_department_achievements_seen(p_ids uuid[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.department_achievement_seen(achievement_id, user_id)
  select a.id, auth.uid()
  from public.department_achievements a
  where a.id = any(coalesce(p_ids, array[]::uuid[]))
    and public.can_view_department_achievement(a.department)
  on conflict do nothing;
$$;

create or replace function public.department_achievement_history(p_department text)
returns table (
  id uuid,
  department text,
  kind text,
  title text,
  description text,
  tier text,
  project_id uuid,
  earned_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id,
    a.department,
    a.kind,
    a.title,
    a.description,
    a.tier,
    a.project_id,
    a.earned_at
  from public.department_achievements a
  where lower(trim(a.department)) = lower(trim(coalesce(p_department, '')))
    and public.can_view_department_achievement(a.department)
  order by a.earned_at desc;
$$;

revoke all on function public.unseen_department_achievements() from public, anon;
revoke all on function public.mark_department_achievements_seen(uuid[]) from public, anon;
revoke all on function public.department_achievement_history(text) from public, anon;
grant execute on function public.unseen_department_achievements() to authenticated;
grant execute on function public.mark_department_achievements_seen(uuid[]) to authenticated;
grant execute on function public.department_achievement_history(text) to authenticated;


create or replace function public.materialize_department_achievement(p_milestone_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.team_milestones%rowtype;
  v_department text;
begin
  select * into m
  from public.team_milestones
  where id = p_milestone_id;

  if not found then
    return;
  end if;

  if m.kind = 'dept_overdue_clear' then
    v_department := lower(trim(coalesce(m.department, '')));
    if v_department = '' or v_department = 'unassigned' then
      return;
    end if;

    insert into public.department_achievements(
      department, kind, title, description, tier,
      project_id, source_milestone_id, earned_at
    ) values (
      v_department,
      'dept_overdue_clear',
      trim(coalesce(m.title, v_department)) || ' cleared its overdue list',
      'Nothing overdue. This department earned a clean-slate trophy through teamwork.',
      'gold',
      null,
      m.id,
      m.created_at
    )
    on conflict do nothing;

  elsif m.kind = 'project_complete' and m.project_id is not null then
    insert into public.department_achievements(
      department, kind, title, description, tier,
      project_id, source_milestone_id, earned_at
    )
    select
      d.department,
      'project_complete',
      trim(coalesce(m.title, 'Project')) || ' completed',
      'Every task is complete. This department helped deliver the project.',
      'gold',
      m.project_id,
      m.id,
      m.created_at
    from (
      select distinct lower(trim(ep.department)) as department
      from public.collaboration_space_members csm
      join public.employee_profiles ep on ep.id = csm.user_id
      where csm.space_id = m.project_id
        and ep.active = true
        and nullif(trim(coalesce(ep.department, '')), '') is not null
        and lower(trim(ep.department)) <> 'unassigned'

      union

      select distinct lower(trim(csd.department)) as department
      from public.collaboration_space_departments csd
      where csd.space_id = m.project_id
        and nullif(trim(coalesce(csd.department, '')), '') is not null
        and lower(trim(csd.department)) <> 'unassigned'

      union

      select lower(trim(cs.home_department)) as department
      from public.collaboration_spaces cs
      where cs.id = m.project_id
        and nullif(trim(coalesce(cs.home_department, '')), '') is not null
        and lower(trim(cs.home_department)) <> 'unassigned'
    ) d
    where nullif(trim(d.department), '') is not null
      and d.department <> 'unassigned'
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.materialize_department_achievement(uuid) from public, anon, authenticated;

create or replace function public.trigger_materialize_department_achievement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.materialize_department_achievement(new.id);
  return new;
end;
$$;

revoke all on function public.trigger_materialize_department_achievement() from public, anon, authenticated;

drop trigger if exists team_milestones_materialize_department_achievement on public.team_milestones;
create trigger team_milestones_materialize_department_achievement
after insert on public.team_milestones
for each row execute function public.trigger_materialize_department_achievement();

-- Backfill only recent milestone events whose department ownership can be
-- resolved safely. The materializer intentionally creates no global fallback.
select public.materialize_department_achievement(m.id)
from public.team_milestones m
where m.created_at > now() - interval '7 days';


-- Legacy milestone events remain available to internal automation, but broad
-- employee reads and ceremony RPC access are removed. Department achievements
-- are now the authorised employee-facing projection.
drop policy if exists "milestones read active" on public.team_milestones;
drop policy if exists "milestones read admin" on public.team_milestones;
create policy "milestones read admin"
on public.team_milestones
for select
to authenticated
using (public.is_workspace_admin());

revoke execute on function public.unseen_team_milestones() from authenticated;
revoke execute on function public.mark_team_milestones_seen(uuid[]) from authenticated;
revoke execute on function public.unseen_team_milestones() from public, anon;
revoke execute on function public.mark_team_milestones_seen(uuid[]) from public, anon;


-- Realtime delivers only a signal; clients always refetch through authorised RPCs.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'department_achievements'
     ) then
    alter publication supabase_realtime add table public.department_achievements;
  end if;
exception when others then
  raise notice 'Department achievements realtime publication was not changed: %', sqlerrm;
end $$;

commit;
