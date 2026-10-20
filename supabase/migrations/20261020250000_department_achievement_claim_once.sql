-- Claim department achievements before display so a refresh or second tab cannot replay them.
-- The persistent trophy history remains independent from ceremony seen-state.

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
volatile
security definer
set search_path = public, pg_temp
as $$
  with candidate as (
    select a.id
    from public.department_achievements a
    where auth.uid() is not null
      and public.can_view_department_achievement(a.department)
      and a.earned_at > now() - interval '3 days'
      and not exists (
        select 1
        from public.department_achievement_seen s
        where s.achievement_id = a.id
          and s.user_id = auth.uid()
      )
    order by a.earned_at desc
    limit 1
  ),
  claimed as (
    insert into public.department_achievement_seen(achievement_id, user_id)
    select candidate.id, auth.uid()
    from candidate
    on conflict do nothing
    returning achievement_id
  )
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
  join claimed on claimed.achievement_id = a.id;
$$;

revoke all on function public.unseen_department_achievements() from public, anon;
grant execute on function public.unseen_department_achievements() to authenticated;
