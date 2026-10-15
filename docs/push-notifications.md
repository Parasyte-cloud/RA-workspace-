# Phone alerts (push notifications)

Rings a call and delivers notifications to a phone or browser whose RideArrivo app is closed.

## How it works

1. A person taps **Phone alerts, Turn on** in the bell menu. The browser asks permission and
   creates a *subscription*: a private address on the browser maker's push service.
2. The subscription is saved in `push_subscriptions` (own rows only).
3. When any row is added to `notifications` (a call, a task, a mention), a database trigger asks the
   `push-dispatch` edge function to send it.
4. The function builds a short message and sends it to each of that person's subscriptions.
5. The service worker (`public/sw.js`) shows it, even with the app closed. Tapping opens the workspace.

Calls use urgency high and a 45 second lifetime, and stay on screen until tapped. The missed call that
follows replaces the ring (same tag). If the workspace is open and visible, nothing extra is shown,
because the app already rings.

## Why it is built this way

- Push goes through the browser maker's servers (Google, Apple, Mozilla). We never hold a connection to
  the phone. The message is encrypted for that one subscription.
- The database trigger, not the browser, starts the send, so it works when nobody has the app open.
- The trigger swallows its own errors. If push is down, the call or task still happens.
- Dead subscriptions (uninstalled app, revoked permission) answer 404 or 410 and are deleted.

## Limits to know

- **iPhone** only allows push for an app added to the Home Screen (iOS 16.4 or later). The toggle says so.
- A phone on silent, or with Focus or Do Not Disturb on, will not sound. That is the phone's choice.
- Android may delay low-priority push to save battery. Calls are sent as high priority.
- This is a notification, not a phone call screen. It cannot take over a locked screen like a real
  call (that needs a native app).

## One-time setup (admin)

1. Make the keys (once, on any computer with Node): `npx web-push generate-vapid-keys`
2. Supabase dashboard, Edge Functions, Secrets:
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (from step 1)
   - `VAPID_SUBJECT` = `mailto:admin@ridearrivo.com`
   - `PUSH_DISPATCH_SECRET` = a long random string (for example `openssl rand -hex 32`)
3. Run `supabase/migrations/20261012260000_web_push.sql` in the SQL editor.
4. In the SQL editor, store the same two values the trigger needs (Vault):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url');
   select vault.create_secret('<the same PUSH_DISPATCH_SECRET>', 'push_dispatch_secret');
   ```
5. Deploy the function: `supabase functions deploy push-dispatch --no-verify-jwt`
6. Cloudflare Pages, Settings, Variables: `VITE_VAPID_PUBLIC_KEY` = the public key. Redeploy.

Until step 6 is done the Phone alerts row is hidden, so nothing half-working is shown.

## Checking it works

- Turn on Phone alerts on a phone, close the app, and from another account start a call. It should ring.
- Decline or let it go unanswered: the ring is replaced by "Missed call".
- If nothing arrives: `select * from push_subscriptions;` (is the phone listed?), the function logs in
  Supabase, and `select * from net._http_response order by id desc limit 5;` (did the trigger call out?).

## Ringing when the app is closed (added Oct 2026)

- A closed web app cannot loop its own ringtone. The device plays its normal
  notification sound. To make a call feel like a ring, `push-dispatch` sends the
  call again every 8 seconds (up to 5 times) while the call is still `ringing`.
  Each repeat has the same tag, so it replaces the last one and re-alerts.
- The ringtone picked in Settings (7 choices, Cricket by default) plays only
  while the app is open, because browsers cannot play audio from a closed app.
- iPhone and iPad: push works only for the app added to the Home Screen
  (iOS 16.4 or newer). Laptops: the browser must be running in the background.
- Redeploy after merging: `supabase functions deploy push-dispatch --no-verify-jwt --project-ref fkkxcivxnwshahnbatnp`
