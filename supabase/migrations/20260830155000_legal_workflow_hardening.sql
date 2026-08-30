begin;

-- ============================================================
-- RIDEARRIVO LEGAL WORKFLOW HARDENING
-- ============================================================

-- ------------------------------------------------------------
-- STATUTE / REGULATION REVIEW METADATA
-- ------------------------------------------------------------

alter table public.legal_statutes_regulations
  add column if not exists source_verified_by uuid
    references public.employee_profiles(id),
  add column if not exists source_verified_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists approved_at timestamptz;


-- ------------------------------------------------------------
-- RESEARCH OPINION REVIEW STATUS
-- ------------------------------------------------------------

alter table public.legal_research_opinions
  drop constraint if exists legal_research_opinions_status_check;

alter table public.legal_research_opinions
  add constraint legal_research_opinions_status_check
  check (
    status in (
      'draft',
      'in_review',
      'reviewed',
      'approved',
      'superseded',
      'archived'
    )
  );


-- ============================================================
-- SOURCE VERIFICATION
-- ============================================================

create or replace function public.enforce_legal_source_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_report_status text;
begin
  if v_actor is null then
    raise exception
      'Authentication is required for legal source changes';
  end if;

  if not public.has_workspace_role(
    array['legal','admin']
  ) then
    raise exception
      'Legal or administrator access is required';
  end if;

  select r.verification_status
  into v_report_status
  from public.legal_law_reports r
  where r.id = new.report_id;

  if v_report_status in (
    'approved',
    'superseded',
    'archived'
  ) then
    raise exception
      'Source evidence for an approved or closed law report is immutable';
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := v_actor;

    if new.verification_status = 'verified' then
      new.verified_by := v_actor;
      new.verified_at := now();
    else
      new.verification_status := 'unverified';
      new.verified_by := null;
      new.verified_at := null;
    end if;

    return new;
  end if;

  if new.verification_status
     is distinct from old.verification_status then

    if new.verification_status = 'verified' then
      new.verified_by := v_actor;
      new.verified_at := now();

    elsif new.verification_status = 'unverified' then
      new.verified_by := null;
      new.verified_at := null;

    end if;
  else
    new.verified_by := old.verified_by;
    new.verified_at := old.verified_at;
  end if;

  new.created_by := old.created_by;

  return new;
end;
$$;


drop trigger if exists legal_source_workflow
on public.legal_law_report_sources;

create trigger legal_source_workflow
before insert or update
on public.legal_law_report_sources
for each row
execute function public.enforce_legal_source_workflow();


-- ============================================================
-- STATUTE / REGULATION WORKFLOW
-- ============================================================

create or replace function public.enforce_legal_statute_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception
      'Authentication is required for legal instrument changes';
  end if;

  if not public.has_workspace_role(
    array['legal','admin']
  ) then
    raise exception
      'Legal or administrator access is required';
  end if;


  if TG_OP = 'INSERT' then
    new.created_by := v_actor;
    new.verification_status := 'draft';

    new.source_verified_by := null;
    new.source_verified_at := null;

    new.reviewed_by := null;
    new.reviewed_at := null;

    new.approved_by := null;
    new.approved_at := null;

    return new;
  end if;


  if old.verification_status in (
    'superseded',
    'archived'
  ) then
    raise exception
      'Superseded or archived legal instruments cannot be modified';
  end if;


  if old.verification_status = 'approved' then
    if new.verification_status not in (
      'superseded',
      'archived'
    ) then
      raise exception
        'Approved legal instruments are immutable';
    end if;

    if
      new.title is distinct from old.title
      or new.instrument_type is distinct from old.instrument_type
      or new.regulator is distinct from old.regulator
      or new.jurisdiction is distinct from old.jurisdiction
      or new.reference_number is distinct from old.reference_number
      or new.commencement_date is distinct from old.commencement_date
      or new.status is distinct from old.status
      or new.summary is distinct from old.summary
      or new.key_provisions is distinct from old.key_provisions
      or new.ridearrivo_impact is distinct from old.ridearrivo_impact
      or new.required_action is distinct from old.required_action
      or new.risk_rating is distinct from old.risk_rating
      or new.source_url is distinct from old.source_url
    then
      raise exception
        'Approved legal instrument content cannot be edited';
    end if;

    return new;
  end if;


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
            'Only draft legal instruments can be source verified';
        end if;

        if nullif(trim(new.source_url), '') is null then
          raise exception
            'An official source URL is required before source verification';
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
            'A legal instrument must be source verified before review';
        end if;

        new.reviewed_by := v_actor;
        new.reviewed_at := now();

        new.approved_by := null;
        new.approved_at := null;


      when 'approved' then
        if old.verification_status <> 'reviewed' then
          raise exception
            'A legal instrument must be reviewed before approval';
        end if;

        new.approved_by := v_actor;
        new.approved_at := now();


      when 'superseded' then
        raise exception
          'Only an approved legal instrument can be superseded';


      when 'archived' then
        raise exception
          'Only an approved legal instrument can be archived';


      else
        raise exception
          'Invalid legal instrument workflow transition';

    end case;
  end if;

  return new;
end;
$$;


drop trigger if exists legal_statute_workflow
on public.legal_statutes_regulations;

create trigger legal_statute_workflow
before insert or update
on public.legal_statutes_regulations
for each row
execute function public.enforce_legal_statute_workflow();


-- ============================================================
-- LEGAL RESEARCH OPINION WORKFLOW
-- ============================================================

create or replace function public.enforce_legal_opinion_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception
      'Authentication is required for legal opinion changes';
  end if;

  if not public.has_workspace_role(
    array['legal','admin']
  ) then
    raise exception
      'Legal or administrator access is required';
  end if;


  if TG_OP = 'INSERT' then
    new.author_id := v_actor;
    new.status := 'draft';

    new.reviewer_id := null;
    new.reviewed_at := null;

    new.approved_by := null;
    new.approved_at := null;

    return new;
  end if;


  if old.status in (
    'superseded',
    'archived'
  ) then
    raise exception
      'Superseded or archived legal opinions cannot be modified';
  end if;


  if old.status = 'approved' then
    if new.status not in (
      'superseded',
      'archived'
    ) then
      raise exception
        'Approved legal opinions are immutable';
    end if;

    if
      new.title is distinct from old.title
      or new.question_presented is distinct from old.question_presented
      or new.background is distinct from old.background
      or new.applicable_law is distinct from old.applicable_law
      or new.authorities is distinct from old.authorities
      or new.analysis is distinct from old.analysis
      or new.conclusion is distinct from old.conclusion
      or new.recommendation is distinct from old.recommendation
      or new.risk_rating is distinct from old.risk_rating
      or new.privileged is distinct from old.privileged
      or new.author_id is distinct from old.author_id
      or new.reviewer_id is distinct from old.reviewer_id
      or new.reviewed_at is distinct from old.reviewed_at
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
    then
      raise exception
        'Approved legal opinion content cannot be edited';
    end if;

    return new;
  end if;


  if new.status is distinct from old.status then

    case new.status

      when 'draft' then
        new.reviewer_id := null;
        new.reviewed_at := null;
        new.approved_by := null;
        new.approved_at := null;


      when 'in_review' then
        if old.status <> 'draft' then
          raise exception
            'Only draft legal opinions can enter review';
        end if;

        new.reviewer_id := null;
        new.reviewed_at := null;
        new.approved_by := null;
        new.approved_at := null;


      when 'reviewed' then
        if old.status <> 'in_review' then
          raise exception
            'A legal opinion must be in review before it can be reviewed';
        end if;

        new.reviewer_id := v_actor;
        new.reviewed_at := now();

        new.approved_by := null;
        new.approved_at := null;


      when 'approved' then
        if old.status <> 'reviewed' then
          raise exception
            'A legal opinion must be reviewed before approval';
        end if;

        new.approved_by := v_actor;
        new.approved_at := now();


      when 'superseded' then
        raise exception
          'Only an approved legal opinion can be superseded';


      when 'archived' then
        raise exception
          'Only an approved legal opinion can be archived';


      else
        raise exception
          'Invalid legal opinion workflow transition';

    end case;
  end if;

  return new;
end;
$$;


drop trigger if exists legal_opinion_workflow
on public.legal_research_opinions;

create trigger legal_opinion_workflow
before insert or update
on public.legal_research_opinions
for each row
execute function public.enforce_legal_opinion_workflow();


-- ============================================================
-- TRIGGER FUNCTION PRIVILEGES
-- ============================================================

revoke all
on function public.enforce_legal_source_workflow()
from public, anon;

revoke all
on function public.enforce_legal_statute_workflow()
from public, anon;

revoke all
on function public.enforce_legal_opinion_workflow()
from public, anon;


commit;
