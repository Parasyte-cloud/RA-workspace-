# RideArrivo IT Asset & Device Presence Release

## What this adds

- Company device inventory for laptops, desktops, phones, tablets and accessories.
- Support/Admin assignment of each asset to an employee.
- Employee Dashboard "My Company Equipment" cards with asset tag, model, serial, IMEI/mobile identifier, memory, storage and OS when registered.
- Signed-in device presence on login: browser, OS guess, platform, screen size, CPU-thread hint, browser-exposed memory hint, timezone and last-seen time.
- Optional employee-consented coarse geolocation (2 decimal places) shown in the lower-left sidebar and visible to Support/Admin.
- Support Command Library for approved copy-only troubleshooting commands. Commands never auto-execute.
- RLS: assigned employee sees their own assets/sessions; Support/Admin manage assets; Support/Engineering/Admin can read approved command snippets; Support/Admin write commands.

## Hardware detection boundary

Normal web browsers deliberately cannot read BIOS serial numbers, phone serial numbers, IMEI values or company asset tags. RideArrivo therefore uses two layers:

1. Browser presence is automatically registered after sign-in for the information the browser safely exposes.
2. Hardware identifiers are entered/verified in the controlled asset registry. A later MDM/native agent can populate them automatically if RideArrivo adopts managed-device tooling.

Location is not silently collected. The first use requires browser permission. After permission is granted, RideArrivo stores only coarse coordinates and refreshes last-seen presence periodically.

## Pixel 6 label supplied for onboarding

The supplied packaging identifies a Google Pixel 6, White, 12 GB RAM and 128 GB ROM/storage. The 15-digit number under the upper barcode appears to be a mobile equipment identifier (IMEI), not a phone serial number. Enter it in the IMEI field only after verifying it on the handset/packaging; leave Serial Number blank until the actual serial is confirmed. Do not commit device identifiers into source code or migrations.

## Deployment order

1. Apply this overlay.
2. `npm run build`
3. `npm run gateway:test`
4. `supabase db push --linked --dry-run`
5. Expect only `20260829120000_it_assets_device_presence_support_commands.sql` pending.
6. `supabase db push --linked`
7. `supabase db lint --linked --schema public --level error`
8. Re-run production build/tests, then commit/rebase/push.
