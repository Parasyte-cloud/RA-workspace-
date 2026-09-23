-- ============================================================
-- Charter & Outskirts Destination Booking form: v2 of the
-- field schema, requested after the form went live on
-- bookings.ridearrivo.com.
--
-- Changes from v1 (20260923120000_public_site_forms.sql):
--   - "Flagged" renamed to "Outskirts" in the form's title and
--     description (form itself was never named "Flagged" in the
--     UI copy users see; this is just the internal/public title).
--   - Rental Duration changed from a free-text field to a select
--     of exactly two options (12 hours / 24 hours), since Support
--     only ever bills one of the two.
--   - New "Which State?" field, shown only when Area of Use is
--     "Interstate" (via the new showIf mechanism added to the
--     intake platform in this same change - see validation.mjs
--     and PublicIntakeForm.tsx).
--   - New "Number of Passengers" (integer) and "Luggage Weight
--     (kg)" (number) fields.
--
-- This creates version 2 of the charter-booking form and
-- activates + publishes it the same way v1's publish step did
-- (see that migration's comment on why this is done directly
-- rather than via publish_intake_form_version(), which needs an
-- authenticated admin session that a migration/SQL session does
-- not have). intake_form_versions has no guard on INSERT (only
-- on UPDATE), so published_at can be set directly at insert time;
-- intake_forms.published_version_id is then repointed at the new
-- version, which satisfies intake_guard_form_publish_pointer()
-- because the new version's published_at is already set.
-- ============================================================

begin;

with form as (
  select id from public.intake_forms where slug = 'charter-booking'
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
    'Charter & Outskirts Destination Booking',
    'Requests for outskirts/special-area destinations that need Support to arrange directly.',
    jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object('key','rental_date','label','Rental Date','type','date','required',true),
        jsonb_build_object('key','pickup_time','label','Pick-up Time','type','text','required',true,'placeholder','e.g. 9:00 AM','maxLength',40),
        jsonb_build_object('key','pickup_address','label','Pick-up Address','type','text','required',true,'maxLength',300),
        jsonb_build_object('key','area_of_use','label','Area of Use','type','select','required',true,
          'options', jsonb_build_array('Ajah','Lekki-Epe','Festac','Makoko','Interstate','Other')),
        jsonb_build_object('key','interstate_state','label','Which State?','type','text','required',true,
          'placeholder','e.g. Ogun, Oyo, Osun','maxLength',80,
          'showIf', jsonb_build_object('field','area_of_use','equals','Interstate')),
        jsonb_build_object('key','dropoff_address','label','Drop-off Address','type','text','required',true,'maxLength',300),
        jsonb_build_object('key','rental_duration','label','Rental Duration','type','select','required',true,
          'options', jsonb_build_array('12 hours (e.g. 9:00 AM - 9:00 PM)','24 hours (overnight / full day)'),
          'helpText','Day trips within a 9am-9pm window are 12 hours; anything longer is billed as 24 hours.'),
        jsonb_build_object('key','passenger_count','label','Number of Passengers','type','integer','required',true,'min',1,'max',30,'placeholder','e.g. 4'),
        jsonb_build_object('key','luggage_weight_kg','label','Luggage Weight (kg)','type','number','required',true,'min',0,'max',1000,'placeholder','e.g. 20','helpText','Approximate total weight of all bags/luggage.'),
        jsonb_build_object('key','car_preference','label','Car Preference','type','select','required',true,
          'options', jsonb_build_array('Standard Sedan','SUV','Luxury','Van / Bus','No preference')),
        jsonb_build_object('key','full_name','label','Your Name','type','text','required',true,'maxLength',160),
        jsonb_build_object('key','contact_number','label','Contact Number','type','phone','required',true,'maxLength',40)
      )
    ),
    now()
  from form, next_version
  returning id, form_id
)
update public.intake_forms f
set published_version_id = version.id,
    lifecycle_status = 'published',
    internal_name = 'Charter & Outskirts Destination Booking Request'
from version
where f.id = version.form_id;

-- confirm
select f.slug, f.internal_name, f.lifecycle_status, v.version_number, v.title, v.published_at
from public.intake_forms f
join public.intake_form_versions v on v.id = f.published_version_id
where f.slug = 'charter-booking';

commit;
