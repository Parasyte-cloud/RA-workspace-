-- ============================================================
-- Move Booking form: v2 of the field schema.
--
-- Adds an idempotency_key field so MoveApp.tsx's client-side
-- double-submit guard (getMoveIdempotencyKey(), a sessionStorage-
-- persisted UUID mirroring EasyBookApp's pattern) can actually be
-- sent. It was built already but deliberately left unwired -- v1's
-- schema didn't declare the field, and validateSubmission() rejects
-- any payload key it doesn't recognize (see validation.mjs's
-- "Unknown field" check), so sending it would have 422'd every
-- submission. See MoveApp.tsx's comment on getMoveIdempotencyKey()
-- for the full context.
--
-- Without this, a network hiccup after the backend has already
-- recorded a move request (client never sees the success response,
-- retries) creates a second, duplicate move-booking record with no
-- way for the backend to dedupe it. With the key sent and Support
-- tooling checking for a pre-existing submission with the same
-- idempotency_key before creating a new one, a retried submission
-- can be recognized as the same request instead of a second one.
--
-- idempotency_key is intentionally not required: older cached page
-- loads or any client that doesn't send it should still be accepted
-- (silently skip dedup) rather than break submissions outright.
--
-- Same pattern as 20260923220000_charter_booking_v2.sql: a new
-- form_version instead of editing v1 (which may already have real
-- submissions against it), published directly since this is a
-- migration/SQL session, not an authenticated admin session that
-- publish_intake_form_version() needs.
-- ============================================================

begin;

with form as (
  select id from public.intake_forms where slug = 'move-booking'
),
next_version as (
  select coalesce(max(version_number), 0) + 1 as n
  from public.intake_form_versions v
  join form on v.form_id = form.id
),
version as (
  insert into public.intake_form_versions(
    form_id, version_number, title, description, field_schema, published_at
  )
  select
    form.id,
    next_version.n,
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
        jsonb_build_object('key','estimated_price','label','Estimated Price Shown to Customer','type','text','required',false,'maxLength',100),
        jsonb_build_object('key','idempotency_key','label','Idempotency Key','type','text','required',false,'maxLength',100,
          'helpText','Client-generated, used to detect a retried duplicate submission. Not shown to the customer.')
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
