-- Registers the two new charter intake forms (ArrivoBoat / ArrivoAir) with
-- the reusable intake platform (see 20260906171000_reusable_intake_platform.sql
-- for the intake_categories / intake_forms / intake_form_versions tables).
--
-- The rows for the existing forms (move-booking, membership-signup,
-- charter-booking, contact-us) aren't in any migration in this repo --
-- they were created directly against production, not through version
-- control. This migration seeds boat-charter and private-jet-charter the
-- same way those already work, but does it as a proper, idempotent
-- migration instead of another untracked manual insert, so it's at least
-- reproducible from here on.
--
-- field_schema below must stay in lockstep with the payload keys/values
-- BoatApp.tsx and AirApp.tsx (RA-workspace src/forms-public/) actually
-- send -- the intake edge function's validateSubmission() rejects any
-- payload key not declared here, and rejects any select value not listed
-- in that field's options verbatim. If either app's field options change,
-- this schema needs a matching update (a new published form_version, not
-- an edit to a version that's already been submitted against).

do $$
declare
  v_category_id uuid;
  v_form_id uuid;
  v_version_id uuid;
begin
  insert into public.intake_categories (slug, title, description, default_workstation, active)
  values (
    'charter-services',
    'Charter Services',
    'ArrivoBoat and ArrivoAir charter requests.',
    'support',
    true
  )
  on conflict (slug) do update set active = true
  returning id into v_category_id;

  insert into public.intake_forms (
    category_id, slug, internal_name, public_slug,
    destination_workstation, visibility, lifecycle_status
  )
  values (
    v_category_id,
    'boat-charter',
    'ArrivoBoat charter request',
    'boat-charter',
    'support',
    'public',
    'draft'
  )
  on conflict (slug) do update set category_id = excluded.category_id
  returning id into v_form_id;

  insert into public.intake_form_versions (
    form_id, version_number, title, description, field_schema, published_at
  )
  values (
    v_form_id,
    1,
    'ArrivoBoat charter request',
    'Speedboat, yacht and water-taxi charter requests submitted from boat.ridearrivo.com.',
    jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object(
          'key', 'charter_type', 'label', 'Charter Type', 'type', 'select', 'required', true,
          'options', jsonb_build_array('Point-to-point transfer', 'Day charter / tour', 'Event or celebration', 'Fishing charter')
        ),
        jsonb_build_object('key', 'departure_point', 'label', 'Departure Point', 'type', 'text', 'required', true, 'maxLength', 200),
        jsonb_build_object('key', 'destination', 'label', 'Destination', 'type', 'text', 'required', false, 'maxLength', 200),
        jsonb_build_object('key', 'charter_date', 'label', 'Charter Date', 'type', 'date', 'required', true),
        jsonb_build_object('key', 'charter_time', 'label', 'Charter Time', 'type', 'text', 'required', true, 'maxLength', 20),
        jsonb_build_object(
          'key', 'duration', 'label', 'Duration', 'type', 'select', 'required', false,
          'options', jsonb_build_array('1-2 hours', 'Half day (up to 4 hours)', 'Full day', 'Multi-day')
        ),
        jsonb_build_object(
          'key', 'passengers', 'label', 'Passengers', 'type', 'select', 'required', true,
          'options', jsonb_build_array('1-4', '5-8', '9-15', '16-30', '30+')
        ),
        jsonb_build_object(
          'key', 'vessel_preference', 'label', 'Vessel Preference', 'type', 'select', 'required', false,
          'options', jsonb_build_array('No preference', 'Speedboat', 'Yacht', 'Catamaran', 'Water taxi')
        ),
        jsonb_build_object('key', 'special_requests', 'label', 'Special Requests', 'type', 'textarea', 'required', false, 'maxLength', 2000),
        jsonb_build_object('key', 'full_name', 'label', 'Full Name', 'type', 'text', 'required', true, 'maxLength', 160),
        jsonb_build_object('key', 'phone', 'label', 'Phone Number', 'type', 'phone', 'required', true),
        jsonb_build_object('key', 'email', 'label', 'Email', 'type', 'email', 'required', false),
        jsonb_build_object('key', 'notes', 'label', 'Notes', 'type', 'textarea', 'required', false, 'maxLength', 2000)
      )
    ),
    now()
  )
  returning id into v_version_id;

  update public.intake_forms
  set published_version_id = v_version_id, lifecycle_status = 'published'
  where id = v_form_id;
end $$;

do $$
declare
  v_category_id uuid;
  v_form_id uuid;
  v_version_id uuid;
begin
  select id into v_category_id from public.intake_categories where slug = 'charter-services';

  insert into public.intake_forms (
    category_id, slug, internal_name, public_slug,
    destination_workstation, visibility, lifecycle_status
  )
  values (
    v_category_id,
    'private-jet-charter',
    'ArrivoAir private jet request',
    'private-jet-charter',
    'support',
    'public',
    'draft'
  )
  on conflict (slug) do update set category_id = excluded.category_id
  returning id into v_form_id;

  insert into public.intake_form_versions (
    form_id, version_number, title, description, field_schema, published_at
  )
  values (
    v_form_id,
    1,
    'ArrivoAir private jet request',
    'Private jet charter requests submitted from air.ridearrivo.com.',
    jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object(
          'key', 'trip_type', 'label', 'Trip Type', 'type', 'select', 'required', true,
          'options', jsonb_build_array('One-way', 'Round-trip')
        ),
        jsonb_build_object('key', 'departure_airport', 'label', 'Departure Airport / City', 'type', 'text', 'required', true, 'maxLength', 200),
        jsonb_build_object('key', 'destination_airport', 'label', 'Destination Airport / City', 'type', 'text', 'required', true, 'maxLength', 200),
        jsonb_build_object('key', 'departure_date', 'label', 'Departure Date', 'type', 'date', 'required', true),
        jsonb_build_object('key', 'departure_time', 'label', 'Departure Time', 'type', 'text', 'required', true, 'maxLength', 20),
        jsonb_build_object('key', 'return_date', 'label', 'Return Date', 'type', 'date', 'required', false),
        jsonb_build_object(
          'key', 'passengers', 'label', 'Passengers', 'type', 'select', 'required', true,
          'options', jsonb_build_array('1-3', '4-6', '7-9', '10-14', '15+')
        ),
        jsonb_build_object(
          'key', 'jet_class', 'label', 'Aircraft Class', 'type', 'select', 'required', false,
          'options', jsonb_build_array('No preference', 'Light jet', 'Midsize jet', 'Super-midsize jet', 'Heavy jet')
        ),
        jsonb_build_object('key', 'add_ons', 'label', 'Add-ons', 'type', 'text', 'required', false, 'maxLength', 500),
        jsonb_build_object('key', 'full_name', 'label', 'Full Name', 'type', 'text', 'required', true, 'maxLength', 160),
        jsonb_build_object('key', 'phone', 'label', 'Phone Number', 'type', 'phone', 'required', true),
        jsonb_build_object('key', 'email', 'label', 'Email', 'type', 'email', 'required', false),
        jsonb_build_object('key', 'notes', 'label', 'Notes', 'type', 'textarea', 'required', false, 'maxLength', 2000)
      )
    ),
    now()
  )
  returning id into v_version_id;

  update public.intake_forms
  set published_version_id = v_version_id, lifecycle_status = 'published'
  where id = v_form_id;
end $$;
