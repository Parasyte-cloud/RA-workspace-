begin;

alter table public.employee_recognition_awards
  add column if not exists award_category text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists visibility text,
  add column if not exists company_title text,
  add column if not exists company_message text,
  add column if not exists source_kind text,
  add column if not exists source_key text,
  add column if not exists issued_by uuid references public.employee_profiles(id) on delete set null,
  add column if not exists issue_reason text,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.employee_profiles(id) on delete set null,
  add column if not exists revocation_reason text,
  add column if not exists updated_at timestamptz;

alter table public.employee_recognition_awards alter column score drop not null;
alter table public.employee_recognition_awards alter column performance_month drop not null;

alter table public.employee_recognition_awards
  drop constraint if exists employee_recognition_awards_award_month_key;
drop index if exists public.employee_recognition_one_active_idx;

update public.employee_recognition_awards
set
  award_category = case
    when badge_code in ('monthly_top_performer','monthly_kpi') then 'monthly_kpi_excellence'
    when badge_code = 'golden_of_week' then 'golden_of_week'
    when badge_code like 'major_project%' then 'major_project_contribution'
    when badge_code like 'clean_overdue%' then 'clean_overdue_record'
    when badge_code like 'customer%' then 'customer_commendation'
    when badge_code like 'team%' then 'team_commendation'
    when badge_code like 'service_anniversary%' then 'service_anniversary'
    when badge_code like 'training%' then 'training_compliance'
    when badge_code like 'identity%' then 'identity_compliance_milestone'
    else 'other'
  end,
  title = coalesce(nullif(btrim(title), ''), nullif(btrim(badge_label), ''), 'Recognition award'),
  visibility = 'private',
  source_kind = coalesce(nullif(source_kind, ''), case when badge_code in ('monthly_top_performer','monthly_kpi') then 'kpi_monthly_winner' else 'legacy' end),
  source_key = coalesce(nullif(source_key, ''), case when badge_code in ('monthly_top_performer','monthly_kpi') then to_char(award_month, 'YYYY-MM') else id::text end),
  updated_at = coalesce(updated_at, awarded_at, now())
where award_category is null
   or title is null
   or visibility is null
   or source_kind is null
   or source_key is null
   or updated_at is null;

alter table public.employee_recognition_awards
  alter column award_category set default 'other',
  alter column award_category set not null,
  alter column title set default 'Recognition award',
  alter column title set not null,
  alter column visibility set default 'private',
  alter column visibility set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.employee_recognition_awards
  drop constraint if exists employee_recognition_awards_award_category_check,
  add constraint employee_recognition_awards_award_category_check check (award_category in (
    'monthly_kpi_excellence','annual_kpi_excellence','golden_of_week',
    'major_project_contribution','clean_overdue_record','customer_commendation',
    'team_commendation','service_anniversary','training_compliance',
    'identity_compliance_milestone','other'
  )),
  drop constraint if exists employee_recognition_awards_visibility_check,
  add constraint employee_recognition_awards_visibility_check check (visibility in ('private','company_recognition')),
  drop constraint if exists employee_recognition_awards_company_copy_check,
  add constraint employee_recognition_awards_company_copy_check check (
    visibility = 'private'
    or (
      nullif(btrim(company_title), '') is not null
      and nullif(btrim(company_message), '') is not null
    )
  ),
  drop constraint if exists employee_recognition_awards_kpi_evidence_check,
  add constraint employee_recognition_awards_kpi_evidence_check check (
    award_category <> 'monthly_kpi_excellence'
    or (performance_month is not null and score is not null)
  ),
  drop constraint if exists employee_recognition_awards_revocation_check,
  add constraint employee_recognition_awards_revocation_check check (
    revoked_at is null
    or (revoked_by is not null and nullif(btrim(revocation_reason), '') is not null)
  );

create unique index if not exists employee_recognition_monthly_winner_unique
  on public.employee_recognition_awards(award_month)
  where revoked_at is null
    and award_category = 'monthly_kpi_excellence';

create unique index if not exists employee_recognition_source_unique
  on public.employee_recognition_awards(source_kind, source_key)
  where source_kind is not null and source_key is not null;

create index if not exists employee_recognition_employee_awarded_idx
  on public.employee_recognition_awards(employee_id, awarded_at desc, id desc)
  where revoked_at is null;

create or replace function public.touch_employee_recognition_award_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_employee_recognition_award_updated_at() from public, anon, authenticated;

drop trigger if exists employee_recognition_awards_touch_updated_at on public.employee_recognition_awards;
create trigger employee_recognition_awards_touch_updated_at
before update on public.employee_recognition_awards
for each row execute function public.touch_employee_recognition_award_updated_at();

-- Monthly KPI awards are private by default. Existing automatically-published
-- announcements are retired; Administration may publish sanitized company copy
-- explicitly through the governed visibility workflow introduced later.
update public.workspace_announcements
set published = false, updated_at = now()
where source_type = 'kpi_monthly_winner' and published = true;

create or replace function public.list_my_awards(
  p_limit integer default 20,
  p_before timestamptz default null
)
returns table(
  award_id uuid,
  category text,
  title text,
  description text,
  badge_code text,
  badge_label text,
  performance_month date,
  score numeric,
  awarded_at timestamptz,
  visibility text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id,
    a.award_category,
    a.title,
    a.description,
    a.badge_code,
    a.badge_label,
    a.performance_month,
    a.score,
    a.awarded_at,
    a.visibility
  from public.employee_recognition_awards a
  join public.employee_profiles caller on caller.id = auth.uid() and caller.active = true
  where a.employee_id = auth.uid()
    and a.revoked_at is null
    and (p_before is null or a.awarded_at < p_before)
  order by a.awarded_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

create or replace function public.list_company_recognition_awards(
  p_limit integer default 20,
  p_before timestamptz default null
)
returns table(
  award_id uuid,
  employee_id uuid,
  employee_name text,
  category text,
  title text,
  message text,
  awarded_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id,
    a.employee_id,
    coalesce(nullif(btrim(ep.full_name), ''), 'RideArrivo team member'),
    a.award_category,
    a.company_title,
    a.company_message,
    a.awarded_at
  from public.employee_recognition_awards a
  join public.employee_profiles ep on ep.id = a.employee_id
  join public.employee_profiles caller on caller.id = auth.uid() and caller.active = true
  where a.visibility = 'company_recognition'
    and a.revoked_at is null
    and (p_before is null or a.awarded_at < p_before)
  order by a.awarded_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.list_my_awards(integer, timestamptz) from public, anon;
revoke all on function public.list_company_recognition_awards(integer, timestamptz) from public, anon;
grant execute on function public.list_my_awards(integer, timestamptz) to authenticated;
grant execute on function public.list_company_recognition_awards(integer, timestamptz) to authenticated;

-- Preserve the evidence-based KPI calculation while limiting deactivation to
-- monthly KPI rows and keeping newly generated awards private by default.
create or replace function public.refresh_monthly_kpi_award(
  p_award_month date default date_trunc('month', current_date)::date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_award_month date := date_trunc('month', p_award_month)::date;
  performance_start date := (date_trunc('month', p_award_month) - interval '1 month')::date;
  performance_end date := date_trunc('month', p_award_month)::date;
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
  where a.award_month = target_award_month
    and a.award_category = 'monthly_kpi_excellence'
    and a.revoked_at is null
  limit 1;

  if existing_winner is not null then return existing_winner; end if;

  with per_employee as (
    select p.id employee_id, p.full_name, p.email,
      count(a.id) filter (where w.status <> 'cancelled')::int total_assigned,
      count(a.id) filter (where w.status = 'completed' and w.completed_at < performance_end::timestamptz)::int total_completed,
      count(a.id) filter (where w.status = 'completed' and w.completed_at < performance_end::timestamptz and w.due_at is not null)::int completed_with_due_date,
      count(a.id) filter (where w.status = 'completed' and w.due_at is not null and w.completed_at is not null and w.completed_at < performance_end::timestamptz and w.completed_at <= w.due_at)::int completed_on_time,
      count(a.id) filter (where a.acknowledged_at is not null and a.acknowledged_at < performance_end::timestamptz and w.status <> 'cancelled')::int acknowledged,
      count(a.id) filter (where w.status <> 'cancelled' and w.due_at is not null and w.due_at < performance_end::timestamptz and (w.completed_at is null or w.completed_at >= performance_end::timestamptz))::int overdue_open
    from public.employee_profiles p
    left join public.work_item_assignees a on a.assignee_id = p.id and a.assigned_at >= performance_start::timestamptz and a.assigned_at < performance_end::timestamptz
    left join public.work_items w on w.id = a.work_item_id
    where p.active = true
    group by p.id, p.full_name, p.email
  ), rates as (
    select *,
      case when total_assigned > 0 then round(total_completed * 100.0 / total_assigned, 2) end completion_rate,
      case when completed_with_due_date > 0 then round(completed_on_time * 100.0 / completed_with_due_date, 2) end on_time_rate,
      case when total_assigned > 0 then round(acknowledged * 100.0 / total_assigned, 2) end acknowledgement_rate
    from per_employee
  ), scored as (
    select *, case when total_assigned = 0 then null else round((completion_rate * 60 + acknowledgement_rate * 10 + coalesce(on_time_rate, 0) * case when completed_with_due_date > 0 then 30 else 0 end) / (70 + case when completed_with_due_date > 0 then 30 else 0 end), 2) end score
    from rates
  )
  select employee_id, coalesce(nullif(btrim(full_name), ''), email), score, total_assigned, total_completed, completed_on_time, overdue_open
  into winner_id, winner_name, winner_score, winner_assigned, winner_completed, winner_on_time, winner_overdue
  from scored
  where total_assigned >= 3 and score is not null
  order by score desc, completed_on_time desc, total_completed desc, overdue_open asc, employee_id
  limit 1;

  if winner_id is null then return null; end if;

  update public.employee_recognition_awards
  set active = false
  where active = true
    and award_category = 'monthly_kpi_excellence'
    and revoked_at is null;

  insert into public.employee_recognition_awards(
    employee_id, award_month, performance_month, badge_code, badge_label,
    score, total_assigned, total_completed, completed_on_time, overdue_open,
    active, awarded_at, award_category, title, visibility, source_kind, source_key
  ) values (
    winner_id, target_award_month, performance_start, 'monthly_top_performer', 'Top Performer',
    winner_score, winner_assigned, winner_completed, winner_on_time, winner_overdue,
    true, now(), 'monthly_kpi_excellence', 'Monthly KPI Excellence', 'private',
    'kpi_monthly_winner', to_char(target_award_month, 'YYYY-MM')
  ) returning id into new_award_id;

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id)
  values (
    winner_id, 'recognition', 'You earned a monthly KPI award',
    format('Congratulations %s. Your %s delivery performance earned a private Monthly KPI Excellence award.', winner_name, to_char(performance_start, 'FMMonth YYYY')),
    'employee_recognition_award', new_award_id
  );

  return winner_id;
end;
$$;

revoke all on function public.refresh_monthly_kpi_award(date) from public, anon, authenticated;
grant execute on function public.refresh_monthly_kpi_award(date) to service_role;

-- Browser callers receive DTOs only; service role retains maintenance authority.
revoke all on public.employee_recognition_awards from public, anon, authenticated;
grant all on public.employee_recognition_awards to service_role;

commit;
