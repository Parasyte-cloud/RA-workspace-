-- Links a Partnerships CRM record to the RideArrivo backend's own
-- partner_venues row, so the partnerships team can set/fix the exact
-- "<venue name> x RideArrivo" display name from this workspace once a
-- partner has a signed agreement, instead of needing the separate Arrivo
-- admin dashboard. Arrivo's backend is a different Postgres database
-- (not Supabase), so this is a plain integer reference, not a real
-- foreign key -- it is only ever written by the ridearrivo-partner-venues
-- Edge Function, right after it confirms the write on the Arrivo side.
alter table public.partners
  add column if not exists arrivo_venue_id integer,
  add column if not exists arrivo_venue_synced_at timestamptz;
