-- Phase 2B cron authentication operator check.
--
-- Run in the Supabase SQL Editor as an administrator/service role.
-- This script never prints secret values and never falls back to service-role auth.
-- If a row reports missing_secret, configure the Vault secret named
-- cron_dispatch_secret outside source control, then run this script again.

-- 1. Read-only preflight. Expected eventual state: both rows are ok.
select * from public.cron_authentication_status();

-- 2. Repair only the two governed legacy jobs. This fails closed with
-- missing_secret if cron_dispatch_secret is unavailable, and returns
-- misconfigured instead of guessing for unknown commands.
select * from public.repair_cron_authentication();

-- 3. Read-only verification. Do not consider deployment complete until both
-- ridearrivo-dispatch-notification-emails and ridearrivo-poll-bookings are ok.
select * from public.cron_authentication_status();
