begin;

-- ============================================================
-- RIDEARRIVO LEGAL INTELLIGENCE / LAW REPORTS
-- ============================================================

create table if not exists public.legal_law_reports (
  id uuid primary key default gen_random_uuid(),

  report_title text not null,
  case_name text not null,
  citation text,
  neutral_citation text,

  court text not null,
  jurisdiction text not null default 'Nigeria',
  decision_date date,

  judges text[] not null default '{}'::text[],
  practice_areas text[] not null default '{}'::text[],

  material_facts text,
  issues_for_determination text,
  parties_arguments text,

  statutes_considered text,
  authorities_considered text,

  holding text,
  ratio_decidendi text,
  obiter_dicta text,
  orders_made text,
  legal_principle text,

  appeal_status text,

  ridearrivo_relevance text,
  operational_impact text,
  recommendation text,

  risk_rating text not null default 'low'
    check (
      risk_rating in (
        'low',
        'medium',
        'high',
        'critical'
      )
    ),

  source_url text,
  secondary_source_url text,

  verification_status text not null default 'draft'
    check (
      verification_status in (
        'draft',
        'source_verified',
        'reviewed',
        'approved',
        'superseded',
        'archived'
      )
    ),

  confidentiality text not null default 'internal'
    check (
      confidentiality in (
        'internal',
        'privileged'
      )
    ),

  prepared_by uuid
    references public.employee_profiles(id),

  source_verified_by uuid
    references public.employee_profiles(id),

  reviewed_by uuid
    references public.employee_profiles(id),

  approved_by uuid
    references public.employee_profiles(id),

  source_verified_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create table if not exists public.legal_law_report_sources (
  id uuid primary key default gen_random_uuid(),

  report_id uuid not null
    references public.legal_law_reports(id)
    on delete cascade,

  source_type text not null
    check (
      source_type in (
        'judgment',
        'statute',
        'regulation',
        'official_notice',
        'gazette',
        'secondary'
      )
    ),

  title text not null,
  citation text,
  source_url text,

  is_primary boolean not null default false,

  verification_status text not null default 'unverified'
    check (
      verification_status in (
        'unverified',
        'verified'
      )
    ),

  notes text,

  created_by uuid
    references public.employee_profiles(id),

  verified_by uuid
    references public.employee_profiles(id),

  verified_at timestamptz,

  created_at timestamptz not null default now()
);


create table if not exists public.legal_statutes_regulations (
  id uuid primary key default gen_random_uuid(),

  title text not null,

  instrument_type text not null
    check (
      instrument_type in (
        'act',
        'law',
        'regulation',
        'rule',
        'guideline',
        'circular',
        'notice',
        'order',
        'directive',
        'gazette',
        'other'
      )
    ),

  regulator text,
  jurisdiction text not null default 'Nigeria',
  reference_number text,

  commencement_date date,

  status text not null default 'in_force'
    check (
      status in (
        'proposed',
        'in_force',
        'amended',
        'repealed',
        'superseded'
      )
    ),

  summary text,
  key_provisions text,

  ridearrivo_impact text,
  required_action text,

  risk_rating text not null default 'low'
    check (
      risk_rating in (
        'low',
        'medium',
        'high',
        'critical'
      )
    ),

  source_url text,

  verification_status text not null default 'draft'
    check (
      verification_status in (
        'draft',
        'source_verified',
        'reviewed',
        'approved',
        'superseded',
        'archived'
      )
    ),

  created_by uuid
    references public.employee_profiles(id),

  reviewed_by uuid
    references public.employee_profiles(id),

  approved_by uuid
    references public.employee_profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create table if not exists public.legal_research_opinions (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  question_presented text not null,
  background text,

  applicable_law text,
  authorities text,
  analysis text,
  conclusion text,
  recommendation text,

  risk_rating text not null default 'low'
    check (
      risk_rating in (
        'low',
        'medium',
        'high',
        'critical'
      )
    ),

  privileged boolean not null default true,

  status text not null default 'draft'
    check (
      status in (
        'draft',
        'in_review',
        'approved',
        'superseded',
        'archived'
      )
    ),

  author_id uuid
    references public.employee_profiles(id),

  reviewer_id uuid
    references public.employee_profiles(id),

  approved_by uuid
    references public.employee_profiles(id),

  reviewed_at timestamptz,
  approved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ============================================================
-- VERSION HISTORY
-- ============================================================

create table if not exists public.legal_law_report_versions (
  id bigint generated always as identity primary key,

  report_id uuid not null
    references public.legal_law_reports(id)
    on delete cascade,

  version_number integer not null,

  snapshot jsonb not null,

  created_by uuid
    references public.employee_profiles(id),

  created_at timestamptz not null default now(),

  unique(report_id, version_number)
);


-- ============================================================
-- IMMUTABLE LEGAL AUDIT
-- ============================================================

create table if not exists public.legal_law_report_audit (
  id bigint generated always as identity primary key,

  entity_type text not null,
  entity_id uuid not null,

  action text not null
    check (
      action in (
        'INSERT',
        'UPDATE',
        'DELETE'
      )
    ),

  actor_id uuid
    references public.employee_profiles(id),

  previous_data jsonb,
  new_data jsonb,

  created_at timestamptz not null default now()
);


-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_legal_reports_case
on public.legal_law_reports(case_name);

create index if not exists idx_legal_reports_citation
on public.legal_law_reports(citation);

create index if not exists idx_legal_reports_court_date
on public.legal_law_reports(
  court,
  decision_date desc
);

create index if not exists idx_legal_reports_status
on public.legal_law_reports(
  verification_status,
  updated_at desc
);

create index if not exists idx_legal_reports_risk
on public.legal_law_reports(risk_rating);

create index if not exists idx_legal_report_sources_report
on public.legal_law_report_sources(
  report_id,
  created_at
);

create index if not exists idx_legal_statutes_status
on public.legal_statutes_regulations(
  status,
  updated_at desc
);

create index if not exists idx_legal_statutes_regulator
on public.legal_statutes_regulations(regulator);

create index if not exists idx_legal_opinions_status
on public.legal_research_opinions(
  status,
  updated_at desc
);

create index if not exists idx_legal_report_versions_report
on public.legal_law_report_versions(
  report_id,
  version_number desc
);

create index if not exists idx_legal_report_audit_entity
on public.legal_law_report_audit(
  entity_type,
  entity_id,
  created_at desc
);


-- ============================================================
-- UPDATED-AT CONTROL
-- ============================================================

create or replace function public.legal_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


drop trigger if exists legal_reports_touch_updated_at
on public.legal_law_reports;

create trigger legal_reports_touch_updated_at
before update
on public.legal_law_reports
for each row
execute function public.legal_touch_updated_at();


drop trigger if exists legal_statutes_touch_updated_at
on public.legal_statutes_regulations;

create trigger legal_statutes_touch_updated_at
before update
on public.legal_statutes_regulations
for each row
execute function public.legal_touch_updated_at();


drop trigger if exists legal_opinions_touch_updated_at
on public.legal_research_opinions;

create trigger legal_opinions_touch_updated_at
before update
on public.legal_research_opinions
for each row
execute function public.legal_touch_updated_at();


-- ============================================================
-- LAW REPORT REVIEW / APPROVAL WORKFLOW
-- ============================================================

create or replace function public.enforce_legal_report_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_has_source boolean := false;
begin
  if v_actor is null then
    raise exception
      'Authentication is required for legal report changes';
  end if;

  if TG_OP = 'INSERT' then
    if new.verification_status <> 'draft' then
      raise exception
        'New law reports must begin as draft';
    end if;

    if new.prepared_by is null then
      new.prepared_by := v_actor;
    end if;

    new.source_verified_by := null;
    new.source_verified_at := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.approved_by := null;
    new.approved_at := null;

    return new;
  end if;


  -- Approved reports cannot be edited in place.
  -- They may only move to superseded or archived.
  if old.verification_status = 'approved' then
    if new.verification_status not in (
      'superseded',
      'archived'
    ) then
      raise exception
        'Approved law reports are immutable. Supersede or archive the approved report instead.';
    end if;

    return new;
  end if;


  -- Superseded and archived reports are terminal records.
  if old.verification_status in (
    'superseded',
    'archived'
  ) then
    raise exception
      'Superseded or archived law reports cannot be modified';
  end if;


  if new.verification_status
     is distinct from old.verification_status then

    if new.verification_status = 'draft' then

      new.source_verified_by := null;
      new.source_verified_at := null;
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.approved_by := null;
      new.approved_at := null;


    elsif new.verification_status = 'source_verified' then

      if old.verification_status <> 'draft' then
        raise exception
          'Only draft law reports can be source verified';
      end if;

      select (
        nullif(trim(new.source_url), '') is not null
        or exists (
          select 1
          from public.legal_law_report_sources s
          where s.report_id = old.id
            and (
              s.is_primary = true
              or s.verification_status = 'verified'
            )
        )
      )
      into v_has_source;

      if not v_has_source then
        raise exception
          'A primary or verified source must be recorded before source verification';
      end if;

      new.source_verified_by := v_actor;
      new.source_verified_at := now();

      new.reviewed_by := null;
      new.reviewed_at := null;
      new.approved_by := null;
      new.approved_at := null;


    elsif new.verification_status = 'reviewed' then

      if old.verification_status <> 'source_verified' then
        raise exception
          'A law report must be source verified before review';
      end if;

      if old.source_verified_at is null then
        raise exception
          'Source verification evidence is required before review';
      end if;

      new.reviewed_by := v_actor;
      new.reviewed_at := now();

      new.approved_by := null;
      new.approved_at := null;


    elsif new.verification_status = 'approved' then

      if old.verification_status <> 'reviewed' then
        raise exception
          'A law report must be reviewed before approval';
      end if;

      if old.reviewed_at is null then
        raise exception
          'Review evidence is required before approval';
      end if;

      new.approved_by := v_actor;
      new.approved_at := now();


    elsif new.verification_status in (
      'superseded',
      'archived'
    ) then

      raise exception
        'Only approved law reports can be superseded or archived';

    end if;

  end if;

  return new;
end;
$$;


drop trigger if exists enforce_legal_report_workflow_trigger
on public.legal_law_reports;

create trigger enforce_legal_report_workflow_trigger
before insert or update
on public.legal_law_reports
for each row
execute function public.enforce_legal_report_workflow();


-- ============================================================
-- IMMUTABLE AUDIT CAPTURE
-- ============================================================

create or replace function public.capture_legal_record_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_id := old.id;

    insert into public.legal_law_report_audit(
      entity_type,
      entity_id,
      action,
      actor_id,
      previous_data,
      new_data
    )
    values(
      TG_TABLE_NAME,
      v_id,
      TG_OP,
      auth.uid(),
      to_jsonb(old),
      null
    );

    return old;
  end if;

  v_id := new.id;

  insert into public.legal_law_report_audit(
    entity_type,
    entity_id,
    action,
    actor_id,
    previous_data,
    new_data
  )
  values(
    TG_TABLE_NAME,
    v_id,
    TG_OP,
    auth.uid(),
    case
      when TG_OP = 'UPDATE'
      then to_jsonb(old)
      else null
    end,
    to_jsonb(new)
  );

  return new;
end;
$$;


drop trigger if exists legal_reports_audit
on public.legal_law_reports;

create trigger legal_reports_audit
after insert or update or delete
on public.legal_law_reports
for each row
execute function public.capture_legal_record_audit();


drop trigger if exists legal_sources_audit
on public.legal_law_report_sources;

create trigger legal_sources_audit
after insert or update or delete
on public.legal_law_report_sources
for each row
execute function public.capture_legal_record_audit();


drop trigger if exists legal_statutes_audit
on public.legal_statutes_regulations;

create trigger legal_statutes_audit
after insert or update or delete
on public.legal_statutes_regulations
for each row
execute function public.capture_legal_record_audit();


drop trigger if exists legal_opinions_audit
on public.legal_research_opinions;

create trigger legal_opinions_audit
after insert or update or delete
on public.legal_research_opinions
for each row
execute function public.capture_legal_record_audit();


-- ============================================================
-- AUTOMATIC LAW REPORT VERSION HISTORY
-- ============================================================

create or replace function public.capture_legal_report_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next integer;
begin
  select coalesce(
    max(v.version_number),
    0
  ) + 1
  into v_next
  from public.legal_law_report_versions v
  where v.report_id = new.id;

  insert into public.legal_law_report_versions(
    report_id,
    version_number,
    snapshot,
    created_by
  )
  values(
    new.id,
    v_next,
    to_jsonb(new),
    auth.uid()
  );

  return new;
end;
$$;


drop trigger if exists legal_report_version_history
on public.legal_law_reports;

create trigger legal_report_version_history
after insert or update
on public.legal_law_reports
for each row
execute function public.capture_legal_report_version();


-- Trigger functions are internal implementation details.

revoke all
on function public.legal_touch_updated_at()
from public, anon;

revoke all
on function public.enforce_legal_report_workflow()
from public, anon;

revoke all
on function public.capture_legal_record_audit()
from public, anon;

revoke all
on function public.capture_legal_report_version()
from public, anon;


-- ============================================================
-- APPROVED-RECORD IMMUTABILITY HARDENING
-- ============================================================

create or replace function public.enforce_legal_report_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_has_source boolean := false;
begin
  if v_actor is null then
    raise exception
      'Authentication is required for legal report changes';
  end if;


  -- ----------------------------------------------------------
  -- NEW REPORTS
  -- ----------------------------------------------------------

  if TG_OP = 'INSERT' then
    if new.verification_status <> 'draft' then
      raise exception
        'New law reports must begin as draft';
    end if;

    new.prepared_by := v_actor;

    new.source_verified_by := null;
    new.source_verified_at := null;

    new.reviewed_by := null;
    new.reviewed_at := null;

    new.approved_by := null;
    new.approved_at := null;

    return new;
  end if;


  -- ----------------------------------------------------------
  -- TERMINAL RECORDS
  -- ----------------------------------------------------------

  if old.verification_status in (
    'superseded',
    'archived'
  ) then
    raise exception
      'Superseded or archived law reports cannot be modified';
  end if;


  -- ----------------------------------------------------------
  -- APPROVED RECORDS
  --
  -- Only the lifecycle status may change.
  -- The legal substance must remain byte-for-byte preserved.
  -- ----------------------------------------------------------

  if old.verification_status = 'approved' then

    if new.verification_status not in (
      'superseded',
      'archived'
    ) then
      raise exception
        'Approved law reports are immutable. Supersede or archive the approved report instead.';
    end if;

    if
      new.report_title is distinct from old.report_title
      or new.case_name is distinct from old.case_name
      or new.citation is distinct from old.citation
      or new.neutral_citation is distinct from old.neutral_citation
      or new.court is distinct from old.court
      or new.jurisdiction is distinct from old.jurisdiction
      or new.decision_date is distinct from old.decision_date
      or new.judges is distinct from old.judges
      or new.practice_areas is distinct from old.practice_areas
      or new.material_facts is distinct from old.material_facts
      or new.issues_for_determination is distinct from old.issues_for_determination
      or new.parties_arguments is distinct from old.parties_arguments
      or new.statutes_considered is distinct from old.statutes_considered
      or new.authorities_considered is distinct from old.authorities_considered
      or new.holding is distinct from old.holding
      or new.ratio_decidendi is distinct from old.ratio_decidendi
      or new.obiter_dicta is distinct from old.obiter_dicta
      or new.orders_made is distinct from old.orders_made
      or new.legal_principle is distinct from old.legal_principle
      or new.appeal_status is distinct from old.appeal_status
      or new.ridearrivo_relevance is distinct from old.ridearrivo_relevance
      or new.operational_impact is distinct from old.operational_impact
      or new.recommendation is distinct from old.recommendation
      or new.risk_rating is distinct from old.risk_rating
      or new.source_url is distinct from old.source_url
      or new.secondary_source_url is distinct from old.secondary_source_url
      or new.confidentiality is distinct from old.confidentiality
      or new.prepared_by is distinct from old.prepared_by
      or new.source_verified_by is distinct from old.source_verified_by
      or new.source_verified_at is distinct from old.source_verified_at
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
    then
      raise exception
        'Approved law report content cannot be edited';
    end if;

    return new;
  end if;


  -- ----------------------------------------------------------
  -- STATUS TRANSITIONS
  -- ----------------------------------------------------------

  if new.verification_status
     is distinct from old.verification_status then

    case new.verification_status

      when 'draft' then

        new.source_verified_by := null;
        new.source_verified_at := null;

        new.reviewed_by := null;
        new.reviewed_at := null;

        new.approved_by := null;
        new.approved_at := null;


      when 'source_verified' then

        if old.verification_status <> 'draft' then
          raise exception
            'Only draft law reports can be source verified';
        end if;

        select (
          nullif(trim(new.source_url), '') is not null
          or exists (
            select 1
            from public.legal_law_report_sources s
            where s.report_id = old.id
              and (
                s.is_primary = true
                or s.verification_status = 'verified'
              )
          )
        )
        into v_has_source;

        if not v_has_source then
          raise exception
            'A primary or verified source must be recorded before source verification';
        end if;

        new.source_verified_by := v_actor;
        new.source_verified_at := now();

        new.reviewed_by := null;
        new.reviewed_at := null;

        new.approved_by := null;
        new.approved_at := null;


      when 'reviewed' then

        if old.verification_status <> 'source_verified' then
          raise exception
            'A law report must be source verified before review';
        end if;

        if old.source_verified_at is null then
          raise exception
            'Source verification evidence is required before review';
        end if;

        new.reviewed_by := v_actor;
        new.reviewed_at := now();

        new.approved_by := null;
        new.approved_at := null;


      when 'approved' then

        if old.verification_status <> 'reviewed' then
          raise exception
            'A law report must be reviewed before approval';
        end if;

        if old.reviewed_at is null then
          raise exception
            'Review evidence is required before approval';
        end if;

        new.approved_by := v_actor;
        new.approved_at := now();


      when 'superseded' then
        raise exception
          'Only an approved law report can be superseded';


      when 'archived' then
        raise exception
          'Only an approved law report can be archived';


      else
        raise exception
          'Invalid law report workflow transition';

    end case;

  end if;

  return new;
end;
$$;


-- ============================================================
-- LEGAL REPORT READ-ACCESS HELPER
-- ============================================================

create or replace function public.can_read_legal_law_report(
  p_report_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.legal_law_reports r
      where r.id = p_report_id
        and (
          public.has_workspace_role(
            array['legal','admin']
          )
          or (
            r.confidentiality = 'internal'
            and public.has_workspace_role(
              array['manager']
            )
          )
        )
    );
$$;


revoke all
on function public.can_read_legal_law_report(uuid)
from public, anon;

grant execute
on function public.can_read_legal_law_report(uuid)
to authenticated;


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.legal_law_reports
enable row level security;

alter table public.legal_law_report_sources
enable row level security;

alter table public.legal_statutes_regulations
enable row level security;

alter table public.legal_research_opinions
enable row level security;

alter table public.legal_law_report_versions
enable row level security;

alter table public.legal_law_report_audit
enable row level security;


-- ============================================================
-- LAW REPORTS
-- ============================================================

drop policy if exists "legal reports read"
on public.legal_law_reports;

create policy "legal reports read"
on public.legal_law_reports
for select
to authenticated
using (
  public.has_workspace_role(
    array['legal','admin']
  )
  or (
    confidentiality = 'internal'
    and public.has_workspace_role(
      array['manager']
    )
  )
);


drop policy if exists "legal reports insert"
on public.legal_law_reports;

create policy "legal reports insert"
on public.legal_law_reports
for insert
to authenticated
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
);


drop policy if exists "legal reports update"
on public.legal_law_reports;

create policy "legal reports update"
on public.legal_law_reports
for update
to authenticated
using (
  public.has_workspace_role(
    array['legal','admin']
  )
)
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
);


-- No DELETE policy is created.
-- Legal reports are retained and lifecycle-controlled.


-- ============================================================
-- LAW REPORT SOURCES
-- ============================================================

drop policy if exists "legal report sources read"
on public.legal_law_report_sources;

create policy "legal report sources read"
on public.legal_law_report_sources
for select
to authenticated
using (
  public.can_read_legal_law_report(report_id)
);


drop policy if exists "legal report sources insert"
on public.legal_law_report_sources;

create policy "legal report sources insert"
on public.legal_law_report_sources
for insert
to authenticated
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
  and public.can_read_legal_law_report(report_id)
);


drop policy if exists "legal report sources update"
on public.legal_law_report_sources;

create policy "legal report sources update"
on public.legal_law_report_sources
for update
to authenticated
using (
  public.has_workspace_role(
    array['legal','admin']
  )
)
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
);


-- No DELETE policy is created for source evidence.


-- ============================================================
-- STATUTES / REGULATIONS
-- ============================================================

drop policy if exists "legal statutes read"
on public.legal_statutes_regulations;

create policy "legal statutes read"
on public.legal_statutes_regulations
for select
to authenticated
using (
  public.has_workspace_role(
    array['legal','manager','admin']
  )
);


drop policy if exists "legal statutes insert"
on public.legal_statutes_regulations;

create policy "legal statutes insert"
on public.legal_statutes_regulations
for insert
to authenticated
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
);


drop policy if exists "legal statutes update"
on public.legal_statutes_regulations;

create policy "legal statutes update"
on public.legal_statutes_regulations
for update
to authenticated
using (
  public.has_workspace_role(
    array['legal','admin']
  )
)
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
);


-- ============================================================
-- PRIVILEGED RESEARCH / LEGAL OPINIONS
-- ============================================================

drop policy if exists "legal opinions read"
on public.legal_research_opinions;

create policy "legal opinions read"
on public.legal_research_opinions
for select
to authenticated
using (
  public.has_workspace_role(
    array['legal','admin']
  )
  or (
    privileged = false
    and public.has_workspace_role(
      array['manager']
    )
  )
);


drop policy if exists "legal opinions insert"
on public.legal_research_opinions;

create policy "legal opinions insert"
on public.legal_research_opinions
for insert
to authenticated
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
);


drop policy if exists "legal opinions update"
on public.legal_research_opinions;

create policy "legal opinions update"
on public.legal_research_opinions
for update
to authenticated
using (
  public.has_workspace_role(
    array['legal','admin']
  )
)
with check (
  public.has_workspace_role(
    array['legal','admin']
  )
);


-- ============================================================
-- VERSION HISTORY
-- ============================================================

drop policy if exists "legal report versions read"
on public.legal_law_report_versions;

create policy "legal report versions read"
on public.legal_law_report_versions
for select
to authenticated
using (
  public.can_read_legal_law_report(report_id)
);


-- No client INSERT / UPDATE / DELETE policies.
-- Versions are produced only by the controlled trigger.


-- ============================================================
-- IMMUTABLE LEGAL AUDIT
-- ============================================================

drop policy if exists "legal report audit read"
on public.legal_law_report_audit;

create policy "legal report audit read"
on public.legal_law_report_audit
for select
to authenticated
using (
  public.has_workspace_role(
    array['legal','admin']
  )
);


-- No client INSERT / UPDATE / DELETE policies.
-- Audit events are produced only by controlled triggers.


-- ============================================================
-- DATA API PRIVILEGES
-- ============================================================

grant usage
on schema public
to authenticated;


grant select, insert, update
on public.legal_law_reports
to authenticated;

grant select, insert, update
on public.legal_law_report_sources
to authenticated;

grant select, insert, update
on public.legal_statutes_regulations
to authenticated;

grant select, insert, update
on public.legal_research_opinions
to authenticated;

grant select
on public.legal_law_report_versions
to authenticated;

grant select
on public.legal_law_report_audit
to authenticated;


-- Explicitly remove hard-delete capability from the client.

revoke delete
on public.legal_law_reports
from authenticated;

revoke delete
on public.legal_law_report_sources
from authenticated;

revoke delete
on public.legal_statutes_regulations
from authenticated;

revoke delete
on public.legal_research_opinions
from authenticated;

revoke insert, update, delete
on public.legal_law_report_versions
from authenticated;

revoke insert, update, delete
on public.legal_law_report_audit
from authenticated;


-- Anonymous users receive no access.

revoke all
on public.legal_law_reports,
   public.legal_law_report_sources,
   public.legal_statutes_regulations,
   public.legal_research_opinions,
   public.legal_law_report_versions,
   public.legal_law_report_audit
from anon;


commit;
