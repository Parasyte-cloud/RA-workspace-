-- ============================================================
-- Membership signup form for membership.ridearrivo.com, seeded
-- the same direct way contact-us/charter-booking were (see
-- 20260923120000_public_site_forms.sql's comment on why: no
-- admin UI to create intake forms yet, and publish_intake_form_
-- version() needs an authenticated admin session a migration/
-- SQL session doesn't have).
--
-- MembershipApp.tsx (a custom plan-picker page, not the generic
-- PublicIntakeForm renderer) submits here on its "confirm" step,
-- so a new membership request lands in Support's queue exactly
-- like any other intake submission, with the chosen plan and the
-- rider's identity captured on the site before they could pick a
-- plan.
-- ============================================================

begin;

-- Idempotent: an earlier partial run of this migration already left a
-- 'membership-signup' row in intake_forms (draft, no published version),
-- so this reuses that row instead of re-inserting it (which previously
-- hit intake_forms_slug_key). Safe to run again in any environment.

do $$
declare
  v_form_id uuid;
  v_cat_id uuid;
  v_version_id uuid;
begin
  select id into v_cat_id
  from public.intake_categories
  where slug = 'website-inquiries';

  select id into v_form_id
  from public.intake_forms
  where slug = 'membership-signup';

  if v_form_id is null then
    insert into public.intake_forms(
      category_id, slug, internal_name, public_slug,
      destination_workstation, default_assignee_id,
      visibility, lifecycle_status
    ) values (
      v_cat_id,
      'membership-signup',
      'Membership Signup Request',
      'membership-signup',
      'support',
      null,
      'public',
      'draft'
    )
    returning id into v_form_id;
  end if;

  insert into public.intake_form_versions(
    form_id, version_number, title, description, field_schema, published_at
  )
  select
    v_form_id,
    coalesce(
      (select max(version_number) from public.intake_form_versions where form_id = v_form_id),
      0
    ) + 1,
    'Membership Signup',
    'New RideArrivo Membership sign-ups from membership.ridearrivo.com, awaiting activation and billing setup.',
    jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','plan','label','Plan','type','select','required',true,
          'options', jsonb_build_array('RideArrivo Plus','RideArrivo Plus+','RideArrivo Premium','RideArrivo Executive','RideArrivo Corporate')),
        jsonb_build_object('key','full_name','label','Full Name','type','text','required',true,'maxLength',160),
        jsonb_build_object('key','phone','label','Phone Number','type','phone','required',true,'maxLength',40),
        jsonb_build_object('key','email','label','Email','type','email','required',false,'maxLength',200),
        jsonb_build_object('key','organization_name','label','Organization Name','type','text','required',true,'maxLength',200,
          'showIf', jsonb_build_object('field','plan','equals','RideArrivo Corporate')),
        jsonb_build_object('key','seats_estimate','label','Estimated Seats','type','integer','required',false,'min',1,'max',5000,
          'showIf', jsonb_build_object('field','plan','equals','RideArrivo Corporate')),
        jsonb_build_object('key','notes','label','Notes','type','textarea','required',false,'maxLength',1000,'placeholder','Anything else we should know?')
      )
    ),
    now()
  returning id into v_version_id;

  update public.intake_forms
  set published_version_id = v_version_id,
      lifecycle_status = 'published'
  where id = v_form_id;
end $$;

-- confirm
select f.slug, f.internal_name, f.lifecycle_status, v.version_number, v.published_at
from public.intake_forms f
join public.intake_form_versions v on v.id = f.published_version_id
where f.slug = 'membership-signup';

commit;
