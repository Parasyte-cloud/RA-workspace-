begin;

create table public.recognition_ceremony_deliveries (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in (
    'department_achievement','personal_award','company_recognition','seasonal_campaign','birthday'
  )),
  source_id uuid,
  source_key text,
  recipient_id uuid not null references public.employee_profiles(id) on delete cascade,
  audience_type text not null check (audience_type in ('department','individual','company')),
  priority integer not null default 50 check (priority between 0 and 1000),
  department_snapshot text,
  state text not null default 'pending' check (state in ('pending','claimed','presented','dismissed','expired','revoked')),
  eligible_at timestamptz not null default now(),
  claimed_at timestamptz,
  presented_at timestamptz,
  dismissed_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  revision integer not null default 1 check (revision > 0),
  presentation jsonb not null default '{}'::jsonb check (jsonb_typeof(presentation) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recognition_ceremony_delivery_source_check check (
    (source_id is not null and source_key is null)
    or (source_id is null and source_key is not null)
  ),
  constraint recognition_ceremony_delivery_time_check check (
    expires_at is null or expires_at > eligible_at
  )
);

create unique index recognition_ceremony_delivery_source_id_unique
  on public.recognition_ceremony_deliveries(source_kind, source_id, recipient_id)
  where source_id is not null;

create unique index recognition_ceremony_delivery_source_key_unique
  on public.recognition_ceremony_deliveries(source_kind, source_key, recipient_id)
  where source_key is not null;

create index recognition_ceremony_delivery_recipient_queue_idx
  on public.recognition_ceremony_deliveries(
    recipient_id, state, priority desc, eligible_at, created_at, id
  );

alter table public.recognition_ceremony_deliveries enable row level security;
alter table public.recognition_ceremony_deliveries force row level security;

create policy "recognition delivery recipient read"
on public.recognition_ceremony_deliveries
for select to authenticated
using (recipient_id = auth.uid() and public.is_active_employee());

revoke all on public.recognition_ceremony_deliveries from public, anon, authenticated;
grant all on public.recognition_ceremony_deliveries to service_role;

create or replace function public.touch_recognition_ceremony_delivery_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_recognition_ceremony_delivery_updated_at() from public, anon, authenticated;

create trigger recognition_ceremony_delivery_touch_updated_at
before update on public.recognition_ceremony_deliveries
for each row execute function public.touch_recognition_ceremony_delivery_updated_at();

create or replace function public.materialize_department_achievement_deliveries(p_achievement_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_achievement public.department_achievements%rowtype;
  v_department text;
  v_count integer := 0;
begin
  select * into v_achievement
  from public.department_achievements
  where id = p_achievement_id;

  if not found then return 0; end if;
  v_department := public.recognition_normalize_department(v_achievement.department);
  if v_department is null then return 0; end if;

  insert into public.recognition_ceremony_deliveries(
    source_kind, source_id, recipient_id, audience_type, priority,
    department_snapshot, presentation, eligible_at
  )
  select
    'department_achievement', v_achievement.id, ep.id, 'department', 60,
    v_department,
    jsonb_build_object(
      'title', v_achievement.title,
      'message', v_achievement.description,
      'department', v_department,
      'tier', v_achievement.tier,
      'achievement_kind', v_achievement.kind,
      'earned_at', v_achievement.earned_at
    ),
    v_achievement.earned_at
  from public.employee_profiles ep
  where ep.active = true
    and public.recognition_normalize_department(ep.department) = v_department
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.materialize_department_achievement_deliveries(uuid) from public, anon, authenticated;
grant execute on function public.materialize_department_achievement_deliveries(uuid) to service_role;

create or replace function public.materialize_personal_award_delivery(p_award_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_award public.employee_recognition_awards%rowtype;
  v_delivery_id uuid;
begin
  select a.* into v_award
  from public.employee_recognition_awards a
  join public.employee_profiles ep on ep.id = a.employee_id and ep.active = true
  where a.id = p_award_id
    and a.revoked_at is null
    and a.award_category in (
      'monthly_kpi_excellence','annual_kpi_excellence','golden_of_week',
      'major_project_contribution','clean_overdue_record','customer_commendation',
      'team_commendation','service_anniversary','training_compliance',
      'identity_compliance_milestone'
    );

  if not found then return null; end if;

  insert into public.recognition_ceremony_deliveries(
    source_kind, source_id, recipient_id, audience_type, priority,
    presentation, eligible_at
  ) values (
    'personal_award', v_award.id, v_award.employee_id, 'individual', 70,
    jsonb_build_object(
      'title', v_award.title,
      'message', coalesce(v_award.description, v_award.badge_label),
      'award_category', v_award.award_category,
      'badge_label', v_award.badge_label,
      'awarded_at', v_award.awarded_at,
      'visibility', v_award.visibility
    ),
    v_award.awarded_at
  )
  on conflict (source_kind, source_id, recipient_id) where source_id is not null
  do update set presentation = excluded.presentation, updated_at = now()
  returning id into v_delivery_id;

  return v_delivery_id;
end;
$$;
revoke all on function public.materialize_personal_award_delivery(uuid) from public, anon, authenticated;
grant execute on function public.materialize_personal_award_delivery(uuid) to service_role;

create or replace function public.trigger_materialize_department_ceremony_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.materialize_department_achievement_deliveries(new.id);
  return new;
end;
$$;
revoke all on function public.trigger_materialize_department_ceremony_deliveries() from public, anon, authenticated;

create trigger department_achievement_materialize_ceremony_deliveries
after insert on public.department_achievements
for each row execute function public.trigger_materialize_department_ceremony_deliveries();

create or replace function public.trigger_materialize_personal_award_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.materialize_personal_award_delivery(new.id);
  return new;
end;
$$;
revoke all on function public.trigger_materialize_personal_award_delivery() from public, anon, authenticated;

create trigger employee_recognition_materialize_ceremony_delivery
after insert on public.employee_recognition_awards
for each row execute function public.trigger_materialize_personal_award_delivery();

-- Existing personal major awards have an authoritative recipient, so they can
-- be migrated safely. Existing department achievements are intentionally not
-- backfilled because their original recipient snapshot is unknowable.
insert into public.recognition_ceremony_deliveries(
  source_kind, source_id, recipient_id, audience_type, priority, state,
  eligible_at, claimed_at, presented_at, dismissed_at, presentation
)
select
  'personal_award', a.id, a.employee_id, 'individual', 70,
  case when s.award_id is not null then 'dismissed' else 'pending' end,
  a.awarded_at,
  s.seen_at,
  s.seen_at,
  s.seen_at,
  jsonb_build_object(
    'title', a.title,
    'message', coalesce(a.description, a.badge_label),
    'award_category', a.award_category,
    'badge_label', a.badge_label,
    'awarded_at', a.awarded_at,
    'visibility', a.visibility
  )
from public.employee_recognition_awards a
join public.employee_profiles ep on ep.id = a.employee_id and ep.active = true
left join public.employee_recognition_award_seen s
  on s.award_id = a.id and s.user_id = a.employee_id
where a.revoked_at is null
  and a.award_category in (
    'monthly_kpi_excellence','annual_kpi_excellence','golden_of_week',
    'major_project_contribution','clean_overdue_record','customer_commendation',
    'team_commendation','service_anniversary','training_compliance',
    'identity_compliance_milestone'
  )
on conflict do nothing;

create or replace function public.revoke_unpresented_recognition_deliveries_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.active = true and new.active = false then
    update public.recognition_ceremony_deliveries
    set
      state = 'revoked',
      revoked_at = now(),
      revocation_reason = 'employee_deactivated',
      updated_at = now()
    where recipient_id = new.id
      and state in ('pending','claimed');
  end if;
  return new;
end;
$$;
revoke all on function public.revoke_unpresented_recognition_deliveries_on_deactivation() from public, anon, authenticated;

drop trigger if exists employee_profile_revoke_recognition_deliveries on public.employee_profiles;
create trigger employee_profile_revoke_recognition_deliveries
after update of active on public.employee_profiles
for each row execute function public.revoke_unpresented_recognition_deliveries_on_deactivation();

create or replace function public.claim_next_recognition_ceremony()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivery public.recognition_ceremony_deliveries%rowtype;
begin
  if not public.is_active_employee() then
    return null;
  end if;

  update public.recognition_ceremony_deliveries
  set state = 'expired', updated_at = now()
  where recipient_id = auth.uid()
    and state = 'pending'
    and expires_at is not null
    and expires_at <= now();

  select d.* into v_delivery
  from public.recognition_ceremony_deliveries d
  where d.recipient_id = auth.uid()
    and d.state = 'pending'
    and d.eligible_at <= now()
    and (d.expires_at is null or d.expires_at > now())
  order by d.priority desc, d.eligible_at asc, d.created_at asc, d.id asc
  limit 1
  for update skip locked;

  if not found then return null; end if;

  update public.recognition_ceremony_deliveries
  set state = 'claimed', claimed_at = now(), updated_at = now()
  where id = v_delivery.id
    and recipient_id = auth.uid()
    and state = 'pending'
  returning * into v_delivery;

  if not found then return null; end if;

  return v_delivery.presentation || jsonb_build_object(
    'delivery_id', v_delivery.id,
    'source_kind', v_delivery.source_kind,
    'source_id', v_delivery.source_id,
    'source_key', v_delivery.source_key,
    'audience_type', v_delivery.audience_type,
    'priority', v_delivery.priority,
    'department', v_delivery.department_snapshot,
    'revision', v_delivery.revision
  );
end;
$$;

create or replace function public.mark_recognition_ceremony_presented(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_active_employee() then raise exception 'Active employee required'; end if;
  update public.recognition_ceremony_deliveries
  set state = 'presented', presented_at = coalesce(presented_at, now()), updated_at = now()
  where id = p_delivery_id
    and recipient_id = auth.uid()
    and state = 'claimed';
  if not found then raise exception 'Ceremony delivery is unavailable'; end if;
end;
$$;

create or replace function public.mark_recognition_ceremony_dismissed(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_active_employee() then raise exception 'Active employee required'; end if;
  update public.recognition_ceremony_deliveries
  set
    state = 'dismissed',
    presented_at = coalesce(presented_at, now()),
    dismissed_at = coalesce(dismissed_at, now()),
    updated_at = now()
  where id = p_delivery_id
    and recipient_id = auth.uid()
    and state in ('claimed','presented');
  if not found then raise exception 'Ceremony delivery is unavailable'; end if;
end;
$$;

revoke all on function public.claim_next_recognition_ceremony() from public, anon;
revoke all on function public.mark_recognition_ceremony_presented(uuid) from public, anon;
revoke all on function public.mark_recognition_ceremony_dismissed(uuid) from public, anon;
grant execute on function public.claim_next_recognition_ceremony() to authenticated;
grant execute on function public.mark_recognition_ceremony_presented(uuid) to authenticated;
grant execute on function public.mark_recognition_ceremony_dismissed(uuid) to authenticated;

-- New clients use the durable delivery ledger. These legacy claim RPCs stay in
-- the schema for audit compatibility but cannot race the new queue.
revoke execute on function public.unseen_department_achievements() from authenticated;
revoke execute on function public.unseen_major_recognition_award() from authenticated;

-- Realtime payloads are refresh signals only. The browser always claims through
-- the authenticated RPC before rendering protected ceremony data.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'recognition_ceremony_deliveries'
  ) then
    execute 'alter publication supabase_realtime add table public.recognition_ceremony_deliveries';
  end if;
end;
$$;

commit;
