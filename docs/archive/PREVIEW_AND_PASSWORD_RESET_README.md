# RideArrivo preview + password reset patch

This overlay adds:

- self-service password reset from the RideArrivo sign-in screen;
- a recovery screen that lets the recovery-session owner choose a new password;
- reduced, watermarked internal preview derivatives for uploaded images;
- preview derivatives are stored in a separate private `workspace-previews` bucket;
- original Company Files and Brand Library objects remain behind Admin download approval;
- Admin can backfill previews for existing Brand Library images using **Build missing previews**;
- fixes the `ExternalLink` import used by calendar meeting links.

## Important security boundary

A browser cannot display pixels to a user and cryptographically prevent that user from screenshotting or extracting those displayed pixels. RideArrivo therefore exposes only a reduced, watermarked preview derivative. The protected original remains inaccessible until an Admin grants download approval.

## Required Supabase Auth setting

Add the production workspace URL to **Authentication -> URL Configuration -> Redirect URLs**. For production this should include:

`https://intranet.ridearrivo.com/`

The password reset button sends recovery links back to the current workspace origin.

## Migration

Apply `20260829035000_internal_previews_protected_originals.sql` after the earlier file-governance migrations.
