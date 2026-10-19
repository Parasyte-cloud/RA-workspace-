-- Confidential messages: say who may touch each table, out loud.
--
-- 20261019100000 decided who may read and write each vault table with row rules,
-- and revoked what must stay closed, but it relied on the project's default table
-- permissions to give the app (role authenticated) and the Edge Function (role
-- service_role) their basic access. A project whose defaults do not grant new
-- tables to those roles answers 403 (permission denied) to the app, which then
-- hides the lock button, and to the Edge Function, which then cannot open a message.
--
-- This file grants exactly what is needed and nothing more. Safe to run twice.
-- Run it after 20261019100000.

grant usage on schema public to authenticated, service_role;

-- The app may read the settings (view time ceiling) and the state of locked cards
-- in chats it belongs to (the row rules on those tables still decide which rows).
-- It never gets insert, update or delete, and it never gets the secret tables.
grant select on public.confidential_settings to authenticated;
grant select on public.confidential_items to authenticated;

-- The Edge Function (service_role) is the only door to the secret tables.
grant select, insert, update, delete on
  public.confidential_settings,
  public.confidential_items,
  public.confidential_secrets,
  public.confidential_grants,
  public.confidential_requests,
  public.confidential_audit
to service_role;

-- Make the API notice right away instead of on its next schema refresh.
notify pgrst, 'reload schema';
