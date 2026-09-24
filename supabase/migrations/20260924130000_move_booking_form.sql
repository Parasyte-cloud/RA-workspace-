-- ============================================================
-- Move booking form for move.ridearrivo.com, seeded the same
-- direct way contact-us/charter-booking/membership-signup were
-- (see 20260923120000_public_site_forms.sql's comment on why: no
-- admin UI to create intake forms yet, and publish_intake_form_
-- version() needs an authenticated admin session a migration/SQL
-- session doesn't have).
--
-- MoveApp.tsx (a custom multi-step page, not the generic
-- PublicIntakeForm renderer) submits here on its "confirm" step,
-- so a new move request lands in Support's queue exactly like
-- any other intake submission, with the full move details, a
-- client-computed starting estimate (estimated_price, for
-- context only, not authoritative), and the customer's contact
-- info captured on the site.
--
-- pickup_interstate_state and dropoff_interstate_state each use
-- showIf so they are only required when the matching area field
-- is "Interstate", the same pattern charter-booking's
-- interstate_state field uses.
-- ============================================================

begin;

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
    'move-booking',
    'Move Booking Request',
    'move-booking',
    'support',
    null,
    'public',
    'draft'
  from cat
  returning id
),
version as (
  insert into public.intake_form_versions(
    form_id, version_number, title, description, field_schema, published_at
  )
  select
    form.id,
    1,
    'Move Booking',
    'New RideArrivo Moving requests from move.ridearrivo.com, with move details, a starting estimate, and the customer''s contact info.',
    jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','move_date','label','Moving Date','type','date','required',true),
        jsonb_build_object('key','move_window','label','Time Window','type','select','required',true,
          'options', jsonb_build_array('Morning (8am to 12pm)','Afternoon (12pm to 4pm)','Evening (4pm to 8pm)')),
        jsonb_build_object('key','pickup_address','label','Pickup Address','type','text','required',true,'maxLength',240),
        jsonb_build_object('key','pickup_area','label','Pickup Area','type','select','required',true,
          'options', jsonb_build_array('Lekki / Ajah','Victoria Island / Ikoyi','Ikeja / Mainland','Festac / Amuwo','Surulere / Yaba','Makoko','Interstate','Other')),
        jsonb_build_object('key','pickup_access','label','Pickup Floor Access','type','select','required',true,
          'options', jsonb_build_array('Ground floor / drive-up access','Upper floor, elevator available','Upper floor, no elevator (walk-up)')),
        jsonb_build_object('key','pickup_interstate_state','label','Moving From (State)','type','text','required',false,'maxLength',80,
          'showIf', jsonb_build_object('field','pickup_area','equals','Interstate')),
        jsonb_build_object('key','dropoff_address','label','Dropoff Address','type','text','required',true,'maxLength',240),
        jsonb_build_object('key','dropoff_area','label','Dropoff Area','type','select','required',true,
          'options', jsonb_build_array('Lekki / Ajah','Victoria Island / Ikoyi','Ikeja / Mainland','Festac / Amuwo','Surulere / Yaba','Makoko','Interstate','Other')),
        jsonb_build_object('key','dropoff_access','label','Dropoff Floor Access','type','select','required',true,
          'options', jsonb_build_array('Ground floor / drive-up access','Upper floor, elevator available','Upper floor, no elevator (walk-up)')),
        jsonb_build_object('key','dropoff_interstate_state','label','Moving To (State)','type','text','required',false,'maxLength',80,
          'showIf', jsonb_build_object('field','dropoff_area','equals','Interstate')),
        jsonb_build_object('key','property_size','label','Size of the Place','type','select','required',true,
          'options', jsonb_build_array('Single Room / Self-Contain','Studio / 1 Bedroom Flat','2 Bedroom Flat','3 Bedroom Flat','4+ Bedroom / Duplex','Office / Commercial Space')),
        jsonb_build_object('key','packing_help','label','Packing Help','type','checkbox','required',false),
        jsonb_build_object('key','special_items','label','Special Items','type','select','required',false,
          'options', jsonb_build_array('None','Fragile / glass items','Piano or heavy furniture','Large appliances (fridge, washer, etc.)','Other (describe in notes)')),
        jsonb_build_object('key','crew_size','label','Crew Size','type','select','required',false,
          'options', jsonb_build_array('Standard crew (2 movers)','Large crew (4 movers)')),
        jsonb_build_object('key','full_name','label','Full Name','type','text','required',true,'maxLength',160),
        jsonb_build_object('key','phone','label','Phone Number','type','phone','required',true,'maxLength',40),
        jsonb_build_object('key','email','label','Email','type','email','required',false,'maxLength',200),
        jsonb_build_object('key','notes','label','Notes','type','textarea','required',false,'maxLength',1000,'placeholder','Anything else we should know?'),
        jsonb_build_object('key','estimated_price','label','Estimated Price Shown to Customer','type','text','required',false,'maxLength',100)
      )
    ),
    now()
  from form
  returning id, form_id
)
update public.intake_forms f
set published_version_id = version.id,
    lifecycle_status = 'published'
from version
where f.id = version.form_id;

-- confirm
select f.slug, f.internal_name, f.lifecycle_status, v.version_number, v.published_at
from public.intake_forms f
join public.intake_form_versions v on v.id = f.published_version_id
where f.slug = 'move-booking';

commit;
