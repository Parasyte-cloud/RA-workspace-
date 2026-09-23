-- ============================================================
-- RideArrivo Workspace: first two public-site intake forms.
--
-- The reusable intake platform has never had a published form
-- (confirmed: intake_forms was empty in production), and there
-- is no admin UI yet to create one (src/lib/intake.ts has the
-- library functions, but nothing calls them). This seeds the
-- first two forms directly via SQL, using the exact same shape
-- the library/edge function expect, so a future admin UI (or
-- the existing intake edge function) works against them with
-- no changes needed.
--
-- publish_intake_form_version() requires an authenticated admin
-- session (auth.uid()), which a raw SQL session doesn't have, so
-- this does exactly what that function does, directly.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- CATEGORY
-- ------------------------------------------------------------

insert into public.intake_categories(
  slug, title, description, default_workstation, active
)
values (
  'website-inquiries',
  'Website Inquiries',
  'Public-site contact and booking-request forms routed to Support.',
  'support',
  true
)
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- FORM 1: General contact / inquiry form
-- ------------------------------------------------------------

with cat as (
  select id from public.intake_categories where slug = 'website-inquiries'
),
form as (
  insert into public.intake_forms(
    category_id, slug, internal_name, public_slug,
    destination_workstation, default_assignee_id,
    visibility, lifecycle_status
  )
  select
    cat.id,
    'contact-us',
    'General Contact Form',
    'contact-us',
    'support',
    null,
    'public',
    'draft'
  from cat
  returning id
),
version as (
  insert into public.intake_form_versions(
    form_id, version_number, title, description, field_schema
  )
  select
    form.id,
    1,
    'Contact Us',
    'General inquiries from the public website.',
    jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','full_name','label','Your Name','type','text','required',true,'maxLength',160),
        jsonb_build_object('key','email','label','Email','type','email','required',true,'maxLength',200),
        jsonb_build_object('key','phone','label','Contact Number','type','phone','required',true,'maxLength',40),
        jsonb_build_object('key','message','label','Message','type','textarea','required',true,'maxLength',3000,'placeholder','How can we help?')
      )
    )
  from form
  returning id, form_id
)
update public.intake_forms f
set published_version_id = version.id,
    lifecycle_status = 'published'
from version
where f.id = version.form_id;

update public.intake_form_versions v
set published_at = coalesce(published_at, now())
from public.intake_forms f
where f.published_version_id = v.id
  and f.slug = 'contact-us';

-- ------------------------------------------------------------
-- FORM 2: Charter / flagged-destination booking request
-- ------------------------------------------------------------

with cat as (
  select id from public.intake_categories where slug = 'website-inquiries'
),
form as (
  insert into public.intake_forms(
    category_id, slug, internal_name, public_slug,
    destination_workstation, default_assignee_id,
    visibility, lifecycle_status
  )
  select
    cat.id,
    'charter-booking',
    'Charter & Flagged Destination Booking Request',
    'charter-booking',
    'support',
    null,
    'public',
    'draft'
  from cat
  returning id
),
version as (
  insert into public.intake_form_versions(
    form_id, version_number, title, description, field_schema
  )
  select
    form.id,
    1,
    'Charter & Flagged Destination Booking',
    'Requests for flagged/special-area destinations that need Support to arrange directly.',
    jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','rental_date','label','Rental Date','type','date','required',true),
        jsonb_build_object('key','pickup_time','label','Pick-up Time','type','text','required',true,'placeholder','e.g. 9:00 AM','maxLength',40),
        jsonb_build_object('key','pickup_address','label','Pick-up Address','type','text','required',true,'maxLength',300),
        jsonb_build_object('key','area_of_use','label','Area of Use','type','select','required',true,
          'options', jsonb_build_array('Ajah','Lekki-Epe','Festac','Makoko','Interstate','Other')),
        jsonb_build_object('key','dropoff_address','label','Drop-off Address','type','text','required',true,'maxLength',300),
        jsonb_build_object('key','rental_duration','label','Rental Duration','type','text','required',true,'placeholder','e.g. 4 hours, Full day','maxLength',80),
        jsonb_build_object('key','car_preference','label','Car Preference','type','select','required',true,
          'options', jsonb_build_array('Standard Sedan','SUV','Luxury','Van / Bus','No preference')),
        jsonb_build_object('key','full_name','label','Your Name','type','text','required',true,'maxLength',160),
        jsonb_build_object('key','contact_number','label','Contact Number','type','phone','required',true,'maxLength',40)
      )
    )
  from form
  returning id, form_id
)
update public.intake_forms f
set published_version_id = version.id,
    lifecycle_status = 'published'
from version
where f.id = version.form_id;

update public.intake_form_versions v
set published_at = coalesce(published_at, now())
from public.intake_forms f
where f.published_version_id = v.id
  and f.slug = 'charter-booking';

commit;
