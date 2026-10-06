# RideArrivo Administration Control Plane Release

Date: 2026-08-30

## Purpose

Turn the Administration workstation into an authoritative but auditable company control plane without weakening the existing server-side authorization boundary.

## Delivered

- Tabbed Administration workstation: Command, People, Access, Workstations, Performance, Assets & Support, Downloads, Applications, Audit and Operations.
- People Intelligence view covering account state, reporting manager, primary workstation, rolling KPI, annual KPI, current recognition, browser presence, company equipment and recent sign-in sessions.
- Browser-reported sign-in location history with employee-visible transparency.
- Optional reverse geocoding through a server-side Geoapify key. The browser never receives the provider key.
- Exact location readable only by the employee and Admin. The existing Support device-presence view remains deliberately coarse.
- Exact location capture requires an explicit employee opt-in plus the browser's geolocation permission.
- Sign-in telemetry captures source network address, browser/OS/platform/timezone and last-seen information for account security.
- Raw authentication session IDs are not persisted; an SHA-256-derived opaque session key is used for correlation.
- 90-day sign-in telemetry retention and 365-day administrator audit retention.
- Read-only administrator audit trail for privileged workspace actions and sensitive People Intelligence views.
- Identity/access manager now supports reporting-manager assignment and sending an employee a secure password-recovery email.
- Service-role administrative changes are logged explicitly with the real administrator ID to avoid anonymous/duplicate trigger entries.
- Administration no longer iframe-embeds the external operational console; it opens it separately to avoid cross-origin failures and nested scrolling.
- Employee Profile now includes My sign-in activity so employees can see the security/location data retained for their own account.

## Security boundary

Administrator authority does not bypass RLS or server-side authorization. Sensitive functions re-check the current active Admin role in the database. Exact browser location is not silently collected and is not treated as cryptographic proof of physical presence; it is browser-reported security telemetry.

## New migration

`supabase/migrations/20260830113000_admin_control_plane_presence_audit.sql`

## Edge Functions to deploy

- `workspace-presence`
- `workspace-user-admin`

The existing `ridearrivo-support` function should also be redeployed from the current source if the critical Support runtime/security release has not yet been deployed after its source update.

## Optional server secret for full address resolution

`GEOAPIFY_API_KEY`

Without this key, consented coordinates and sign-in security telemetry still work, but the nearest mapped full address will not be populated.

## Release gates

1. `git diff --check`
2. `npm run build`
3. `npm run gateway:test`
4. `supabase db push --linked --dry-run`
5. Apply the migration only if the dry run shows exactly the expected new migration.
6. `supabase db lint --linked --schema public --level error`
7. Deploy the Edge Functions.
8. Test with Admin plus at least one non-admin employee.
