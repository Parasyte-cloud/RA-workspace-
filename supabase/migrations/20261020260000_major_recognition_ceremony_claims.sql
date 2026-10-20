-- Durable one-time ceremony claims for monthly KPI and other major personal recognition.
-- Recognition history remains independent from this consumption state.

create table if not exists public.employee_recognition_award_seen (
  award_id uuid not null references public.employee_recognition_awards(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  unique (award_id, user_id)
);

alter table public.employee_recognition_award_seen enable row level security;

drop policy if exists "recognition award seen read own" on public.employee_recognition_award_seen;
create policy "recognition award seen read own"
on public.employee_recognition_award_seen
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "recognition award seen insert own" on public.employee_recognition_award_seen;
create policy "recognition award seen insert own"
on public.employee_recognition_award_seen
for insert to authenticated
with check (user_id = auth.uid());

revoke all on public.employee_recognition_award_seen from public, anon;
grant select, insert on public.employee_recognition_award_seen to authenticated;

create or replace function public.unseen_major_recognition_award()
returns table (
  id uuid,
  employee_id uuid,
  award_month date,
  performance_month date,
  badge_code text,
  badge_label text,
  score numeric,
  awarded_at timestamptz
)
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with candidate as (
    select a.id
    from public.employee_recognition_awards a
    join public.employee_profiles p on p.id = auth.uid()
    where auth.uid() is not null
      and p.active = true
      and a.employee_id = auth.uid()
      and a.active = true
      and (
        a.badge_code in ('monthly_top_performer', 'monthly_kpi', 'major_achievement', 'golden_of_the_month')
        or left(a.badge_code, 6) = 'major_'
        or left(a.badge_code, 4) = 'kpi_'
      )
      and not exists (
        select 1
        from public.employee_recognition_award_seen s
        where s.award_id = a.id
          and s.user_id = auth.uid()
      )
    order by a.awarded_at desc
    limit 1
  ),
  claimed as (
    insert into public.employee_recognition_award_seen(award_id, user_id)
    select candidate.id, auth.uid()
    from candidate
    on conflict do nothing
    returning award_id
  )
  select
    a.id,
    a.employee_id,
    a.award_month,
    a.performance_month,
    a.badge_code,
    a.badge_label,
    a.score,
    a.awarded_at
  from public.employee_recognition_awards a
  join claimed on claimed.award_id = a.id;
$$;

revoke all on function public.unseen_major_recognition_award() from public, anon;
grant execute on function public.unseen_major_recognition_award() to authenticated;
