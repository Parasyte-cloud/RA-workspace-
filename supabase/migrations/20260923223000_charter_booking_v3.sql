-- ============================================================
-- Charter & Outskirts Destination Booking form: v3 of the field
-- schema (v2 was 20260923220000_charter_booking_v2.sql, applied
-- directly via SQL Editor rather than through this migration
-- history, consistent with that migration's own note).
--
-- Changes from v2:
--   - Title changed to "Charter and Extended Destination
--     Booking" (previously "Charter & Outskirts Destination
--     Booking").
--   - New "Trip Type" select: One-way / Round-trip.
--   - New "Which SUV?" field (car_model), shown only when Car
--     Preference is "SUV" - via the existing showIf mechanism -
--     with options Toyota Prado, Ford Edge, Toyota Highlander,
--     Other SUV.
--   - Number of Passengers is now capped per vehicle via the new
--     condLimits mechanism added to the intake platform in this
--     same change (see validation.mjs's effectiveLimits() and
--     PublicIntakeForm.tsx's mirror of it): the specific SUV
--     model if one was chosen, else the general vehicle category.
--     Caps: Standard Sedan 4, Luxury 4, Van/Bus 18, No preference
--     30, Toyota Prado 7, Ford Edge 5, Toyota Highlander 7, Other
--     SUV 6.
--   - Number of Passengers and Luggage Weight (kg) are no longer
--     required (people who don't know an exact figure can skip
--     them).
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
    'Charter and Extended Destination Booking',
    'Requests for extended-distance or outskirts destinations that need Support to arrange directly.',
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
        jsonb_build_object('key','trip_type','label','Trip Type','type','select','required',true,
          'options', jsonb_build_array('One-way','Round-trip'),
          'helpText','Let us know if you will need a return trip the same day.'),
        jsonb_build_object('key','dropoff_address','label','Drop-off Address','type','text','required',true,'maxLength',300),
        jsonb_build_object('key','rental_duration','label','Rental Duration','type','select','required',true,
          'options', jsonb_build_array('12 hours (e.g. 9:00 AM - 9:00 PM)','24 hours (overnight / full day)'),
          'helpText','Day trips within a 9am-9pm window are 12 hours; anything longer is billed as 24 hours.'),
        jsonb_build_object('key','car_preference','label','Car Preference','type','select','required',true,
          'options', jsonb_build_array('Standard Sedan','SUV','Luxury','Van / Bus','No preference')),
        jsonb_build_object('key','car_model','label','Which SUV?','type','select','required',true,
          'options', jsonb_build_array('Toyota Prado','Ford Edge','Toyota Highlander','Other SUV'),
          'showIf', jsonb_build_object('field','car_preference','equals','SUV')),
        jsonb_build_object('key','passenger_count','label','Number of Passengers','type','integer','required',false,
          'min',1,'max',30,'placeholder','e.g. 4',
          'condLimits', jsonb_build_array(
            jsonb_build_object('field','car_model','map', jsonb_build_object(
              'Toyota Prado', jsonb_build_object('min',1,'max',7),
              'Ford Edge', jsonb_build_object('min',1,'max',5),
              'Toyota Highlander', jsonb_build_object('min',1,'max',7),
              'Other SUV', jsonb_build_object('min',1,'max',6)
            )),
            jsonb_build_object('field','car_preference','map', jsonb_build_object(
              'Standard Sedan', jsonb_build_object('min',1,'max',4),
              'SUV', jsonb_build_object('min',1,'max',6),
              'Luxury', jsonb_build_object('min',1,'max',4),
              'Van / Bus', jsonb_build_object('min',1,'max',18),
              'No preference', jsonb_build_object('min',1,'max',30)
            ))
          )),
        jsonb_build_object('key','luggage_weight_kg','label','Luggage Weight (kg)','type','number','required',false,'min',0,'max',1000,'placeholder','e.g. 20','helpText','Approximate total weight of all bags/luggage, if known.'),
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
    internal_name = 'Charter and Extended Destination Booking Request'
from version
where f.id = version.form_id;

-- confirm
select f.slug, f.internal_name, f.lifecycle_status, v.version_number, v.title, v.published_at
from public.intake_forms f
join public.intake_form_versions v on v.id = f.published_version_id
where f.slug = 'charter-booking';

commit;
