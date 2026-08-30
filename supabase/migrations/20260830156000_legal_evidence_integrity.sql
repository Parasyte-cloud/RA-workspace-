begin;

-- ============================================================
-- CASE LAW REPORT INTEGRITY
-- ============================================================

create or replace function public.enforce_legal_report_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_workspace_role();
  v_substantive_changed boolean;
  v_has_source boolean;
begin
  if v_actor is null then
    raise exception 'Authentication is required';
  end if;

  if v_role not in ('legal','admin') then
    raise exception 'Legal or administrator access is required';
  end if;

  if TG_OP = 'INSERT' then
    new.verification_status := 'draft';
    new.prepared_by := v_actor;

    new.source_verified_by := null;
    new.source_verified_at := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.approved_by := null;
    new.approved_at := null;

    return new;
  end if;

  v_substantive_changed :=
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
    or new.confidentiality is distinct from old.confidentiality;

  new.prepared_by := old.prepared_by;

  if old.verification_status in ('superseded','archived') then
    raise exception 'Closed legal reports cannot be modified';
  end if;

  if old.verification_status = 'approved' then
    if new.verification_status not in ('superseded','archived') then
      raise exception 'Approved legal reports may only be superseded or archived';
    end if;

    if v_substantive_changed then
      raise exception 'Approved legal report content is immutable';
    end if;

    new.source_verified_by := old.source_verified_by;
    new.source_verified_at := old.source_verified_at;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;

    return new;
  end if;

  if old.verification_status in ('source_verified','reviewed')
     and v_substantive_changed
     and new.verification_status <> 'draft'
  then
    raise exception
      'Return the legal report to draft before changing verified or reviewed content';
  end if;

  if new.verification_status is distinct from old.verification_status then

    if new.verification_status = 'draft'
       and old.verification_status in ('source_verified','reviewed')
    then
      new.source_verified_by := null;
      new.source_verified_at := null;
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.approved_by := null;
      new.approved_at := null;

    elsif old.verification_status = 'draft'
       and new.verification_status = 'source_verified'
    then
      select
        (
          nullif(trim(coalesce(new.source_url,'')), '') is not null
          or exists (
            select 1
            from public.legal_law_report_sources s
            where s.report_id = new.id
              and s.verification_status = 'verified'
          )
        )
      into v_has_source;

      if not v_has_source then
        raise exception
          'Source verification requires an official source URL or verified source evidence';
      end if;

      new.source_verified_by := v_actor;
      new.source_verified_at := now();
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.approved_by := null;
      new.approved_at := null;

    elsif old.verification_status = 'source_verified'
       and new.verification_status = 'reviewed'
    then
      new.source_verified_by := old.source_verified_by;
      new.source_verified_at := old.source_verified_at;
      new.reviewed_by := v_actor;
      new.reviewed_at := now();
      new.approved_by := null;
      new.approved_at := null;

    elsif old.verification_status = 'reviewed'
       and new.verification_status = 'approved'
    then
      new.source_verified_by := old.source_verified_by;
      new.source_verified_at := old.source_verified_at;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.approved_by := v_actor;
      new.approved_at := now();

    else
      raise exception
        'Invalid legal report workflow transition from % to %',
        old.verification_status,
        new.verification_status;
    end if;

  else
    new.source_verified_by := old.source_verified_by;
    new.source_verified_at := old.source_verified_at;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;

  return new;
end;
$$;


-- ============================================================
-- SOURCE EVIDENCE INTEGRITY
-- ============================================================

create or replace function public.enforce_legal_source_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_workspace_role();
  v_report_status text;
  v_content_changed boolean;
begin
  if v_actor is null then
    raise exception 'Authentication is required';
  end if;

  if v_role not in ('legal','admin') then
    raise exception 'Legal or administrator access is required';
  end if;

  select verification_status
  into v_report_status
  from public.legal_law_reports
  where id = new.report_id;

  if v_report_status is null then
    raise exception 'Parent legal report was not found';
  end if;

  if TG_OP = 'INSERT' then
    if v_report_status <> 'draft' then
      raise exception
        'Source evidence may only be added while the legal report is in draft';
    end if;

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

  if new.report_id is distinct from old.report_id then
    raise exception 'Legal source evidence cannot be moved between reports';
  end if;

  new.created_by := old.created_by;

  if v_report_status <> 'draft' then
    raise exception
      'Return the legal report to draft before changing its source evidence';
  end if;

  v_content_changed :=
       new.source_type is distinct from old.source_type
    or new.title is distinct from old.title
    or new.citation is distinct from old.citation
    or new.source_url is distinct from old.source_url
    or new.is_primary is distinct from old.is_primary
    or new.notes is distinct from old.notes;

  if old.verification_status = 'verified'
     and v_content_changed
  then
    raise exception
      'Verified legal source content cannot be edited. Mark it unverified first';
  end if;

  if new.verification_status is distinct from old.verification_status then
    if new.verification_status = 'verified' then
      new.verified_by := v_actor;
      new.verified_at := now();

    elsif new.verification_status = 'unverified' then
      new.verified_by := null;
      new.verified_at := null;

    else
      raise exception 'Invalid legal source verification status';
    end if;

  else
    new.verified_by := old.verified_by;
    new.verified_at := old.verified_at;
  end if;

  return new;
end;
$$;

-- ============================================================
-- STATUTE / REGULATION INTEGRITY
-- ============================================================

create or replace function public.enforce_legal_statute_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_workspace_role();
  v_changed boolean;
begin
  if v_actor is null then
    raise exception 'Authentication is required';
  end if;

  if v_role not in ('legal','admin') then
    raise exception 'Legal or administrator access is required';
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

  v_changed :=
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
    or new.source_url is distinct from old.source_url;

  new.created_by := old.created_by;

  if old.verification_status in ('superseded','archived') then
    raise exception 'Closed legal instruments cannot be modified';
  end if;

  if old.verification_status = 'approved' then
    if new.verification_status not in ('superseded','archived') then
      raise exception
        'Approved legal instruments may only be superseded or archived';
    end if;

    if v_changed then
      raise exception
        'Approved legal instrument content is immutable';
    end if;

    new.source_verified_by := old.source_verified_by;
    new.source_verified_at := old.source_verified_at;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;

    return new;
  end if;

  if old.verification_status in ('source_verified','reviewed')
     and v_changed
     and new.verification_status <> 'draft'
  then
    raise exception
      'Return the legal instrument to draft before changing verified or reviewed content';
  end if;

  if new.verification_status is distinct from old.verification_status then

    if new.verification_status = 'draft'
       and old.verification_status in ('source_verified','reviewed')
    then
      new.source_verified_by := null;
      new.source_verified_at := null;
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.approved_by := null;
      new.approved_at := null;

    elsif old.verification_status = 'draft'
       and new.verification_status = 'source_verified'
    then
      if nullif(trim(coalesce(new.source_url,'')), '') is null then
        raise exception
          'Source verification requires an official source URL';
      end if;

      new.source_verified_by := v_actor;
      new.source_verified_at := now();
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.approved_by := null;
      new.approved_at := null;

    elsif old.verification_status = 'source_verified'
       and new.verification_status = 'reviewed'
    then
      new.source_verified_by := old.source_verified_by;
      new.source_verified_at := old.source_verified_at;
      new.reviewed_by := v_actor;
      new.reviewed_at := now();
      new.approved_by := null;
      new.approved_at := null;

    elsif old.verification_status = 'reviewed'
       and new.verification_status = 'approved'
    then
      new.source_verified_by := old.source_verified_by;
      new.source_verified_at := old.source_verified_at;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.approved_by := v_actor;
      new.approved_at := now();

    else
      raise exception
        'Invalid legal instrument workflow transition from % to %',
        old.verification_status,
        new.verification_status;
    end if;

  else
    new.source_verified_by := old.source_verified_by;
    new.source_verified_at := old.source_verified_at;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;

  return new;
end;
$$;


-- ============================================================
-- LEGAL RESEARCH OPINION INTEGRITY
-- ============================================================

create or replace function public.enforce_legal_opinion_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.current_workspace_role();
  v_changed boolean;
begin
  if v_actor is null then
    raise exception 'Authentication is required';
  end if;

  if v_role not in ('legal','admin') then
    raise exception 'Legal or administrator access is required';
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

  v_changed :=
       new.title is distinct from old.title
    or new.question_presented is distinct from old.question_presented
    or new.background is distinct from old.background
    or new.applicable_law is distinct from old.applicable_law
    or new.authorities is distinct from old.authorities
    or new.analysis is distinct from old.analysis
    or new.conclusion is distinct from old.conclusion
    or new.recommendation is distinct from old.recommendation
    or new.risk_rating is distinct from old.risk_rating
    or new.privileged is distinct from old.privileged;

  new.author_id := old.author_id;

  if old.status in ('superseded','archived') then
    raise exception 'Closed legal opinions cannot be modified';
  end if;

  if old.status = 'approved' then
    if new.status not in ('superseded','archived') then
      raise exception
        'Approved legal opinions may only be superseded or archived';
    end if;

    if v_changed then
      raise exception
        'Approved legal opinion content is immutable';
    end if;

    new.reviewer_id := old.reviewer_id;
    new.reviewed_at := old.reviewed_at;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;

    return new;
  end if;

  if old.status in ('in_review','reviewed')
     and v_changed
     and new.status <> 'draft'
  then
    raise exception
      'Return the legal opinion to draft before changing reviewed content';
  end if;

  if new.status is distinct from old.status then

    if new.status = 'draft'
       and old.status in ('in_review','reviewed')
    then
      new.reviewer_id := null;
      new.reviewed_at := null;
      new.approved_by := null;
      new.approved_at := null;

    elsif old.status = 'draft'
       and new.status = 'in_review'
    then
      new.reviewer_id := v_actor;
      new.reviewed_at := null;
      new.approved_by := null;
      new.approved_at := null;

    elsif old.status = 'in_review'
       and new.status = 'reviewed'
    then
      new.reviewer_id := old.reviewer_id;
      new.reviewed_at := now();
      new.approved_by := null;
      new.approved_at := null;

    elsif old.status = 'reviewed'
       and new.status = 'approved'
    then
      new.reviewer_id := old.reviewer_id;
      new.reviewed_at := old.reviewed_at;
      new.approved_by := v_actor;
      new.approved_at := now();

    else
      raise exception
        'Invalid legal opinion workflow transition from % to %',
        old.status,
        new.status;
    end if;

  else
    new.reviewer_id := old.reviewer_id;
    new.reviewed_at := old.reviewed_at;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;

  return new;
end;
$$;


revoke all
on function public.enforce_legal_report_workflow()
from public, anon;

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
