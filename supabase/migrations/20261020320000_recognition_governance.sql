begin;

create table public.recognition_governance_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.employee_profiles(id) on delete restrict,
  action text not null check (action in (
    'RECOGNITION_CEREMONY_REISSUED','AWARD_ISSUED',
    'AWARD_VISIBILITY_CHANGED','AWARD_REVOKED'
  )),
  entity_type text not null check (entity_type in ('ceremony_delivery','employee_award')),
  entity_id uuid not null,
  target_employee_id uuid references public.employee_profiles(id) on delete set null,
  request_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 8 and 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (actor_id, request_id, action)
);

create index recognition_governance_audit_entity_idx
  on public.recognition_governance_audit_events(entity_type, entity_id, created_at desc);

alter table public.recognition_governance_audit_events enable row level security;
alter table public.recognition_governance_audit_events force row level security;
revoke all on public.recognition_governance_audit_events from public, anon, authenticated;
grant all on public.recognition_governance_audit_events to service_role;

create or replace function public.can_govern_recognition()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_employee()
    and (
      public.is_workspace_admin()
      or public.has_workstation_access(array['people','administration']::text[])
    );
$$;
revoke all on function public.can_govern_recognition() from public, anon;
grant execute on function public.can_govern_recognition() to authenticated;


create or replace function public.list_recognition_award_candidates()
returns table(
  employee_id uuid,
  full_name text,
  department text,
  job_title text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_govern_recognition() then
    raise exception 'Recognition governance access required';
  end if;
  return query
  select p.id, p.full_name, p.department, p.job_title
  from public.employee_profiles p
  where p.active = true
  order by lower(coalesce(p.full_name, '')), p.id;
end;
$$;

create or replace function public.list_recognition_governance_audit(
  p_limit integer default 100
)
returns table(
  event_id bigint,
  action text,
  entity_type text,
  entity_id uuid,
  actor_id uuid,
  actor_name text,
  target_employee_id uuid,
  target_name text,
  reason text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_govern_recognition() then
    raise exception 'Recognition governance access required';
  end if;
  return query
  select
    e.id,
    e.action,
    e.entity_type,
    e.entity_id,
    e.actor_id,
    actor.full_name,
    e.target_employee_id,
    target.full_name,
    e.reason,
    e.metadata,
    e.created_at
  from public.recognition_governance_audit_events e
  left join public.employee_profiles actor on actor.id = e.actor_id
  left join public.employee_profiles target on target.id = e.target_employee_id
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 250));
end;
$$;

create or replace function public.list_recognition_delivery_health(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table(
  source_kind text,
  state text,
  delivery_count bigint,
  oldest_eligible_at timestamptz,
  newest_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_govern_recognition() then
    raise exception 'Recognition governance access required';
  end if;
  return query
  select d.source_kind, d.state, count(*)::bigint,
    min(d.eligible_at), max(d.updated_at)
  from public.recognition_ceremony_deliveries d
  where (p_from is null or d.created_at >= p_from)
    and (p_to is null or d.created_at < p_to)
  group by d.source_kind, d.state
  order by d.source_kind, d.state;
end;
$$;

create or replace function public.reissue_recognition_ceremony(
  p_delivery_id uuid,
  p_reason text,
  p_request_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivery public.recognition_ceremony_deliveries%rowtype;
  v_existing uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not public.can_govern_recognition() then raise exception 'Recognition governance access required'; end if;
  if v_reason is null or char_length(v_reason) < 8 then raise exception 'A reason of at least 8 characters is required'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id::text || ':RECOGNITION_CEREMONY_REISSUED', 0));

  select entity_id into v_existing
  from public.recognition_governance_audit_events
  where actor_id = auth.uid() and request_id = p_request_id
    and action = 'RECOGNITION_CEREMONY_REISSUED';
  if found then return v_existing; end if;

  select * into v_delivery
  from public.recognition_ceremony_deliveries
  where id = p_delivery_id
  for update;
  if not found then raise exception 'Ceremony delivery not found'; end if;
  if v_delivery.state = 'revoked' then raise exception 'Revoked ceremony delivery cannot be reissued'; end if;
  if v_delivery.source_kind = 'personal_award' and not exists (
    select 1 from public.employee_recognition_awards a
    where a.id = v_delivery.source_id and a.revoked_at is null
  ) then raise exception 'The source award is no longer available'; end if;
  if v_delivery.source_kind = 'company_recognition' and not exists (
    select 1 from public.employee_recognition_awards a
    where a.id = v_delivery.source_id
      and a.revoked_at is null
      and a.visibility = 'company_recognition'
  ) then raise exception 'Company recognition is no longer published'; end if;

  update public.recognition_ceremony_deliveries
  set state = 'pending', revision = revision + 1,
      eligible_at = now(), claimed_at = null, presented_at = null,
      dismissed_at = null, expires_at = null, revoked_at = null,
      revocation_reason = null, updated_at = now()
  where id = p_delivery_id;

  insert into public.recognition_governance_audit_events(
    actor_id, action, entity_type, entity_id, target_employee_id,
    request_id, reason, metadata
  ) values (
    auth.uid(), 'RECOGNITION_CEREMONY_REISSUED', 'ceremony_delivery',
    p_delivery_id, v_delivery.recipient_id, p_request_id, v_reason,
    jsonb_build_object(
      'prior_state', v_delivery.state,
      'prior_revision', v_delivery.revision,
      'prior_claimed_at', v_delivery.claimed_at,
      'prior_presented_at', v_delivery.presented_at,
      'prior_dismissed_at', v_delivery.dismissed_at,
      'new_revision', v_delivery.revision + 1
    )
  );
  return p_delivery_id;
end;
$$;

create or replace function public.issue_employee_award(
  p_payload jsonb,
  p_request_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing uuid;
  v_employee_id uuid;
  v_award_id uuid;
  v_category text := coalesce(nullif(btrim(p_payload->>'award_category'), ''), 'other');
  v_title text := nullif(btrim(p_payload->>'title'), '');
  v_description text := nullif(btrim(p_payload->>'description'), '');
  v_badge_code text := coalesce(nullif(btrim(p_payload->>'badge_code'), ''), v_category);
  v_badge_label text := coalesce(nullif(btrim(p_payload->>'badge_label'), ''), v_title);
  v_issue_reason text := nullif(btrim(p_payload->>'issue_reason'), '');
  v_company_title text := nullif(btrim(p_payload->>'company_title'), '');
  v_company_message text := nullif(btrim(p_payload->>'company_message'), '');
  v_source_kind text := 'administration_manual';
  v_source_key text := 'admin:' || p_request_id::text;
  v_awarded_at timestamptz := coalesce(nullif(p_payload->>'awarded_at','')::timestamptz, now());
begin
  if not public.can_govern_recognition() then raise exception 'Recognition governance access required'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id::text || ':AWARD_ISSUED', 0));

  select entity_id into v_existing
  from public.recognition_governance_audit_events
  where actor_id = auth.uid() and request_id = p_request_id and action = 'AWARD_ISSUED';
  if found then return v_existing; end if;

  begin v_employee_id := (p_payload->>'employee_id')::uuid;
  exception when others then raise exception 'A valid employee is required'; end;

  if not exists(select 1 from public.employee_profiles where id = v_employee_id and active = true) then
    raise exception 'An active employee is required';
  end if;
  if v_category not in (
    'monthly_kpi_excellence','annual_kpi_excellence','golden_of_week',
    'major_project_contribution','clean_overdue_record','customer_commendation',
    'team_commendation','service_anniversary','training_compliance',
    'identity_compliance_milestone','other'
  ) then raise exception 'Unsupported award category'; end if;
  if v_title is null or char_length(v_title) not between 3 and 180 then raise exception 'Award title must be 3 to 180 characters'; end if;
  if v_issue_reason is null or char_length(v_issue_reason) < 8 then raise exception 'An issue reason of at least 8 characters is required'; end if;
  if v_description is not null and char_length(v_description) > 2000 then raise exception 'Award description is too long'; end if;
  if v_company_title is not null and char_length(v_company_title) > 180 then raise exception 'Company title is too long'; end if;
  if v_company_message is not null and char_length(v_company_message) > 1000 then raise exception 'Company message is too long'; end if;
  if v_category in ('monthly_kpi_excellence','annual_kpi_excellence') then
    raise exception 'KPI awards cannot be issued manually';
  end if;

  insert into public.employee_recognition_awards(
    employee_id, award_month, performance_month, badge_code, badge_label,
    score, award_category, title, description, visibility,
    company_title, company_message, source_kind, source_key,
    issued_by, issue_reason, active, awarded_at
  ) values (
    v_employee_id, date_trunc('month', v_awarded_at)::date, null,
    left(v_badge_code, 120), left(v_badge_label, 180), null,
    v_category, v_title, v_description, 'private', v_company_title,
    v_company_message, left(v_source_kind, 120), left(v_source_key, 240),
    auth.uid(), v_issue_reason, true, v_awarded_at
  ) returning id into v_award_id;

  perform public.materialize_personal_award_delivery(v_award_id);

  insert into public.recognition_governance_audit_events(
    actor_id, action, entity_type, entity_id, target_employee_id,
    request_id, reason, metadata
  ) values (
    auth.uid(), 'AWARD_ISSUED', 'employee_award', v_award_id,
    v_employee_id, p_request_id, v_issue_reason,
    jsonb_build_object('award_category', v_category, 'visibility', 'private')
  );
  return v_award_id;
end;
$$;

create or replace function public.change_employee_award_visibility(
  p_award_id uuid,
  p_visibility text,
  p_reason text,
  p_request_id uuid default gen_random_uuid()
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_award public.employee_recognition_awards%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_visibility text := lower(btrim(coalesce(p_visibility, '')));
begin
  if not public.can_govern_recognition() then raise exception 'Recognition governance access required'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id::text || ':AWARD_VISIBILITY_CHANGED', 0));
  if exists(select 1 from public.recognition_governance_audit_events where actor_id=auth.uid() and request_id=p_request_id and action='AWARD_VISIBILITY_CHANGED') then return; end if;
  if v_reason is null or char_length(v_reason) < 8 then raise exception 'A reason of at least 8 characters is required'; end if;
  if v_visibility not in ('private','company_recognition') then raise exception 'Unsupported visibility'; end if;

  select * into v_award from public.employee_recognition_awards where id=p_award_id for update;
  if not found or v_award.revoked_at is not null then raise exception 'Unrevoked award not found'; end if;
  if v_award.visibility = v_visibility then raise exception 'Award already has this visibility'; end if;

  if v_visibility = 'company_recognition' then
    if nullif(btrim(v_award.company_title), '') is null or nullif(btrim(v_award.company_message), '') is null then
      raise exception 'Sanitized company title and message are required';
    end if;
    update public.employee_recognition_awards set visibility='company_recognition' where id=p_award_id;
    insert into public.recognition_ceremony_deliveries(
      source_kind, source_id, recipient_id, audience_type, priority, presentation, eligible_at
    )
    select
      'company_recognition', v_award.id, ep.id, 'company', 80,
      jsonb_build_object(
        'title', v_award.company_title,
        'message', v_award.company_message,
        'award_category', v_award.award_category,
        'awarded_at', v_award.awarded_at,
        'recognized_employee_id', v_award.employee_id
      ), now()
    from public.employee_profiles ep
    where ep.active=true
    on conflict (source_kind, source_id, recipient_id) where source_id is not null
    do update set
      presentation=excluded.presentation,
      state=case when recognition_ceremony_deliveries.state='revoked' then 'pending' else recognition_ceremony_deliveries.state end,
      revision=case when recognition_ceremony_deliveries.state='revoked' then recognition_ceremony_deliveries.revision+1 else recognition_ceremony_deliveries.revision end,
      revoked_at=case when recognition_ceremony_deliveries.state='revoked' then null else recognition_ceremony_deliveries.revoked_at end,
      revocation_reason=case when recognition_ceremony_deliveries.state='revoked' then null else recognition_ceremony_deliveries.revocation_reason end,
      updated_at=now();
  else
    update public.employee_recognition_awards set visibility='private' where id=p_award_id;
    update public.recognition_ceremony_deliveries
    set state='revoked', revoked_at=now(), revocation_reason=v_reason, updated_at=now()
    where source_kind='company_recognition' and source_id=p_award_id and state in ('pending','claimed');
  end if;

  insert into public.recognition_governance_audit_events(
    actor_id, action, entity_type, entity_id, target_employee_id,
    request_id, reason, metadata
  ) values (
    auth.uid(), 'AWARD_VISIBILITY_CHANGED', 'employee_award', p_award_id,
    v_award.employee_id, p_request_id, v_reason,
    jsonb_build_object('prior_visibility',v_award.visibility,'new_visibility',v_visibility)
  );
end;
$$;

create or replace function public.revoke_employee_award(
  p_award_id uuid,
  p_reason text,
  p_request_id uuid default gen_random_uuid()
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_award public.employee_recognition_awards%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not public.can_govern_recognition() then raise exception 'Recognition governance access required'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id::text || ':AWARD_REVOKED', 0));
  if exists(select 1 from public.recognition_governance_audit_events where actor_id=auth.uid() and request_id=p_request_id and action='AWARD_REVOKED') then return; end if;
  if v_reason is null or char_length(v_reason) < 8 then raise exception 'A reason of at least 8 characters is required'; end if;

  select * into v_award from public.employee_recognition_awards where id=p_award_id for update;
  if not found then raise exception 'Award not found'; end if;
  if v_award.revoked_at is not null then raise exception 'Award already revoked'; end if;

  update public.employee_recognition_awards
  set active=false, revoked_at=now(), revoked_by=auth.uid(), revocation_reason=v_reason
  where id=p_award_id;

  update public.recognition_ceremony_deliveries
  set state='revoked', revoked_at=now(), revocation_reason=v_reason, updated_at=now()
  where source_id=p_award_id and source_kind in ('personal_award','company_recognition') and state in ('pending','claimed');

  insert into public.recognition_governance_audit_events(
    actor_id, action, entity_type, entity_id, target_employee_id,
    request_id, reason, metadata
  ) values (
    auth.uid(), 'AWARD_REVOKED', 'employee_award', p_award_id,
    v_award.employee_id, p_request_id, v_reason,
    jsonb_build_object('prior_visibility',v_award.visibility,'prior_active',v_award.active)
  );
end;
$$;

create or replace function public.preview_recognition_ceremony(
  p_theme text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_theme text := lower(btrim(coalesce(p_theme,'')));
  v_title text := left(coalesce(nullif(btrim(p_payload->>'title'),''),'A special RideArrivo moment'),180);
  v_message text := left(coalesce(nullif(btrim(p_payload->>'message'),''),'Recognition that deserves to be remembered.'),1000);
  v_department text := left(coalesce(nullif(btrim(p_payload->>'department'),''),'Operations'),120);
  v_source_kind text;
  v_audience text;
begin
  if not public.can_govern_recognition() then raise exception 'Recognition governance access required'; end if;
  if v_theme not in ('department_trophy','personal_award','company_recognition','company_milestone') then
    raise exception 'Unsupported preview theme';
  end if;
  v_source_kind := case v_theme
    when 'department_trophy' then 'department_achievement'
    when 'personal_award' then 'personal_award'
    when 'company_recognition' then 'company_recognition'
    else 'company_milestone'
  end;
  v_audience := case when v_theme='department_trophy' then 'department' when v_theme='personal_award' then 'individual' else 'company' end;
  return jsonb_build_object(
    'delivery_id','preview:'||v_theme,
    'source_kind',v_source_kind,
    'source_key','preview:'||v_theme,
    'audience_type',v_audience,
    'priority',0,
    'revision',1,
    'title',v_title,
    'message',v_message,
    'detail',left(coalesce(nullif(btrim(p_payload->>'detail'),''),'Preview only — no records are written.'),300),
    'department',case when v_theme='department_trophy' then v_department else null end,
    'tier',case when v_theme='department_trophy' then 'gold' else null end,
    'award_category',case when v_theme='personal_award' then 'customer_commendation' else null end,
    'badge_label',case when v_theme='personal_award' then 'Personal Award' else null end
  );
end;
$$;

revoke all on function public.list_recognition_award_candidates() from public, anon;
revoke all on function public.list_recognition_governance_audit(integer) from public, anon;
revoke all on function public.list_recognition_delivery_health(timestamptz, timestamptz) from public, anon;
revoke all on function public.reissue_recognition_ceremony(uuid, text, uuid) from public, anon;
revoke all on function public.issue_employee_award(jsonb, uuid) from public, anon;
revoke all on function public.change_employee_award_visibility(uuid, text, text, uuid) from public, anon;
revoke all on function public.revoke_employee_award(uuid, text, uuid) from public, anon;
revoke all on function public.preview_recognition_ceremony(text, jsonb) from public, anon;
grant execute on function public.list_recognition_award_candidates() to authenticated;
grant execute on function public.list_recognition_governance_audit(integer) to authenticated;
grant execute on function public.list_recognition_delivery_health(timestamptz, timestamptz) to authenticated;
grant execute on function public.reissue_recognition_ceremony(uuid, text, uuid) to authenticated;
grant execute on function public.issue_employee_award(jsonb, uuid) to authenticated;
grant execute on function public.change_employee_award_visibility(uuid, text, text, uuid) to authenticated;
grant execute on function public.revoke_employee_award(uuid, text, uuid) to authenticated;
grant execute on function public.preview_recognition_ceremony(text, jsonb) to authenticated;

commit;
