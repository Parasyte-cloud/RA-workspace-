# Deployment

PArAsYtE | RA-Workspace support module

Nothing here has been run for you. Do it on staging first. The order matters: database, then functions, then Twilio, then cron, then people.

## 0. Prerequisites

- A Supabase project (staging first) and the Supabase CLI logged in
- A Twilio account with Voice and TaskRouter, a number (or a Nigerian number on a BYOC trunk)
- Node 22 locally
- Repo on a feature branch, clean working tree

## 1. Install into the repo

```bash
node scripts/install-support-command-centre.mjs /path/to/RA-workspace            # dry run
node scripts/install-support-command-centre.mjs /path/to/RA-workspace --apply
cd /path/to/RA-workspace
npm install
npm run typecheck && npm test && npm run build
```

The installer copies files, patches `SupportWorkspaceRoute`, `AdministrationControlPlane`, `package.json`, `supabase/config.toml` and `.gitignore` by anchor, and refuses to overwrite a file you edited. It does not commit, push or deploy.

## 2. Database

```bash
supabase db push --linked          # staging project first
```

Nine migrations apply in order: core, voice and TaskRouter, omnichannel ingest, messaging routing, telephony controls, workstation safety (20261020200000), staff invites (20261020210000), teams (20261020220000), notifications (20261020230000). If v3.2 has not been applied yet, one `db push` applies all of them in order. They are idempotent, so re-running is safe. To rehearse locally on plain Postgres 16:

```bash
PGT_DIR=/tmp/pgtest PGT_PORT=54399 bash scripts/support-sql-tests/run.sh "$PWD"
```

Check after pushing:

```sql
select count(*) from support_queues;          -- 8
select name, starts_at, ends_at from support_shifts;   -- Day Shift, Night Shift
select * from support_dial_rules order by prefix;      -- review the allow list now
```

## 3. Twilio

```bash
export TWILIO_ACCOUNT_SID=AC...
export TWILIO_AUTH_TOKEN=...            # shell only, never in a file or chat
node scripts/provision-twilio-support.mjs --functions-url https://<ref>.supabase.co/functions/v1            # shows the plan
node scripts/provision-twilio-support.mjs --functions-url https://<ref>.supabase.co/functions/v1 --apply --create-api-key
```

This creates the TaskRouter workspace, five activities, four queues, the routing workflow, the callbacks and the TwiML App, and writes the ids (and the new API key secret) to `.env.support.generated` with mode 600. Nothing secret is printed.

Then, in the Twilio console:

1. Phone number, **A call comes in**: Webhook, HTTP POST, `https://<ref>.supabase.co/functions/v1/support-voice-webhook?action=inbound`.
2. Phone number, **A message comes in** (if you use SMS): `.../support-sms-webhook`.
3. Confirm the TwiML App voice URL ends `?action=outbound`.
4. BYOC: attach the trunk and note its `BY...` SID.

## 4. Secrets and functions

```bash
cp .env.support.example .env.support.private      # fill TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID, TWILIO_BYOC_TRUNK_SID
cat .env.support.generated >> .env.support.private
openssl rand -hex 32          # use for SUPPORT_CRON_SECRET, then again for SUPPORT_INGEST_SECRET and SUPPORT_SOS_SECRET
supabase secrets set --env-file .env.support.private
rm .env.support.generated .env.support.private      # secrets now live only in Supabase

supabase functions deploy support-voice-token support-taskrouter-control support-voice-webhook \
  support-taskrouter-webhook support-sms-webhook support-ingest support-maintenance support-recording \
  support-sos-ingest support-location support-invite
```

`verify_jwt = false` on the webhook functions is intentional: Twilio does not carry a Supabase JWT. They authenticate by signature. `config.toml` is already patched.

## 5. Cron

`support-maintenance` must run every minute. With pg_cron and pg_net (Supabase Dashboard, Database, Extensions):

```sql
select cron.schedule('support-maintenance', '* * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/support-maintenance',
    headers := jsonb_build_object('x-support-cron-secret', '<SUPPORT_CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb);
$$);
```

Store the secret in Vault rather than inline if your policy requires it. Without cron: an unacknowledged SOS never escalates and location sessions never expire on their own (the gate still refuses expired ones), stale officers stay Available in TaskRouter until the next assignment rejects them, waiting tickets are only assigned when a message arrives or capacity frees, and scheduled callbacks never fire. Alert if the function returns 207 or stops being called.

## 6. People

1. Administration, **Support Routing**, Officers: pick each employee, set skills, capacity, shift and weekdays, Save. A warning means the DB row saved but Twilio did not (voice will not ring them until fixed).
2. Give your Head of Support the `manager` or `admin` role, or the Administration workstation, or tick **Team lead**.
3. Voice and IVR: set caller ID, greeting (put any recording disclosure here), whether the press-a-number menu is on, callback offer timing.
4. Dial rules: trim the allow list to countries you really call.
5. Hours and voicemail: set the weekly hours and holidays, then tick Enforce opening hours. Leave it off until you have tested a call outside hours.
6. Numbers: register each number you own, with its route (pstn or byoc) and, for outbound numbers, the destination prefix it should be used for.
7. Limits and retention: set a daily spend alert and cap, agree the recording and voicemail retention with legal, keep the do-not-contact list enforced.

## 7. Go-live checks

Do these on staging with two test accounts.

| Check | Expected |
|---|---|
| Officer A: Start softphone, set Available | status shows Available; board shows seen under a minute |
| Call the number | A's softphone rings once, shows the customer; ticket appears with SLA clock |
| A declines | A moves to Away (`rejected_call`), caller goes on to hold or another officer |
| Close A's laptop for 3 minutes | A shows Offline; next call does not ring A |
| Call while nobody is Available | hold message; after the offer time, callback offer; press 1; a callback appears |
| WhatsApp message in | ticket created and assigned to an Available, on-shift officer |
| Same customer messages again | goes to the same officer |
| Dial `+1900...` from the softphone | refused with a spoken message; `dial_blocked` in audit log |
| Withheld caller | a ticket with no phone number; second withheld call is a separate ticket |
| Officer outside shift hours tries Available | refused with a clear message |
| Replay a Twilio webhook with a changed body | 403 |
| Hours enforced, call at a time the line is closed | closed message, then voicemail beep; after leaving a message the ticket shows it with a Play button and a callback is scheduled for the next opening |
| Play that voicemail as a supervisor, then as an officer who did not handle it | supervisor plays it; the other officer is refused; the audit log shows `recording_played` once |
| Add a number to Do not contact from a ticket, then dial it | spoken refusal; `dial_blocked` with reason `do_not_contact` |
| Set the daily spend cap to a tiny amount after one priced call | next dial refused with the budget message; a `spend_cap` alert appears on the control tower |
| Register a byoc number, disable the trunk at the carrier, place a call | call still connects over Twilio; audit shows `carrier_fallback` |
| Place a 1 minute test call | within a minute the control tower shows quality samples and an average MOS |
| Open Insights, Reports | numbers load, no error banner; CSV downloads and an `export` row appears in the audit log |
| Look up a code you issued, as an officer who is not handling that person | contact details partly hidden; a successful lookup is in the audit log; five misses in ten minutes are blocked and logged |
| Send a signed test SOS (see `API-CONTRACTS.md`) | within seconds a red banner appears for every officer on shift; the tab title shows `(SOS 1)`; the same event sent again changes nothing but the repeat counter |
| Leave that SOS alone for 90 seconds, with `support-maintenance` running | level goes to 1, status Escalated, timeline says why; it is still on screen after a page reload |
| Acknowledge, record a contact, try Resolve with no notes | acknowledge keeps the alert open; resolve is refused until notes and an outcome are given; "emergency services contacted" is refused until a contact is logged |
| Mark yourself Offline while assigned to an SOS | within a minute it moves to an available officer, or the next level comes forward |
| Open a location session on a case, wait for the time to pass, or resolve the case | position stops showing; the session says expired or ended |
| Open a location session while the location service is not connected | the card says NOT CONNECTED; for an emergency it shows the SOS position labelled LAST KNOWN with its age |
| As a Watcher, open Emergency | you see the alert and its status, not who, where or the actions |

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every webhook returns 403 | Signed URL differs from the one Twilio has. Set `TWILIO_WEBHOOK_BASE_URL` to exactly the base Twilio is configured with, or fix the console URL. Check function logs for which URL candidates were tried. |
| Caller hears "application error" | Webhook returned 5xx or timed out. Twilio actions here always answer TwiML; check logs for the first error. |
| Officer Available but calls never ring | Worker not linked (Support Routing shows "Not linked to call routing"), softphone not registered, heartbeat stale, or off shift. The assignment callback logs the reject reason. |
| Calls ring but no audio | Office firewall blocking UDP. See network notes in `ARCHITECTURE.md`. |
| Officer keeps going Away | Reservation timeouts (not answering inside 25 s) or softphone unregistering because the token refresh failed. |
| Outbound call says not permitted | Destination prefix not on the allow list, or officer hit the per-10-minute limit. |
| Tickets stay unassigned | No officer Available and on shift under capacity, or cron is not running. |
| Voicemail never arrives | The `voicemail-recording` callback is failing signature checks (same cause as every webhook returning 403), or the call dropped before the beep. |
| Spend today stays at 0 | Prices appear only after Twilio finalises the call (a few minutes); check `support-maintenance` is running and returns `pricing` in its report. |
| Recordings will not play | Officer is not the handler or a supervisor (the message says so), the recording was purged after the retention period, or `TWILIO_AUTH_TOKEN` is missing on `support-recording`. |
| Provisioning says routing not ready | `TWILIO_*` secrets missing on the function; set them and press Save officer again. |

## 9. Pausing before Twilio is paid for, and seeing the screens

The database, the screens and the supervisor settings work without any Twilio account. Only calling needs it.

```bash
npm install
npm run dev
```

Sign in with a staff account, open Support, then Administration, Support Routing. Without Twilio:

| Works | Needs Twilio |
|---|---|
| Control tower, ticket list, ticket drawer, notes, assignment, SLA clocks | Starting the softphone, taking or placing calls |
| Provisioning officers (the row saves, with a "call routing is not ready" warning) | Linking an officer to TaskRouter |
| Shifts, dial rules, hours and closures, number registry, do-not-contact, limits | Voice webhooks, voicemail, recording, call prices |
| Messaging tickets created by `support-ingest` | Inbound calls, SMS webhook |

When you resume, start at section 3 and carry on in order. Nothing in the database needs redoing.

## 11. Turning on the safety features before Twilio

Emergencies, identity codes, location sessions, reports and the audit viewer need only Supabase, so they can go live first.

1. `supabase db push --linked` (applies `20261020200000_support_workstation_safety.sql`).
2. Set `SUPPORT_SOS_SECRET` and `SUPPORT_CRON_SECRET` (and leave `RA_LOCATION_API_URL` and `RA_LOCATION_API_KEY` empty until the location service exists).
3. Deploy `support-sos-ingest`, `support-location`, `support-maintenance` and `support-taskrouter-control` (it now accepts a role kind when saving an officer).
4. Schedule the one-minute job from section 5. Its Twilio steps may report problems until Twilio is configured; the emergency step runs first and does not depend on them.
5. Give the RideArrivo backend developer `API-CONTRACTS.md`. Until it sends events, the Emergency tab stays empty. Send a signed test event yourself first.
6. Set your own people up in Administration, Support Routing: officers as Agent, you as Supervisor, anyone who should only watch as Watcher.

## 10. Rollback

The module is additive. To switch it off without touching data: remove `<SupportCommandCentre/>` from the route (this also hides the Emergency tab, so first make sure someone else is watching incoming SOS events), point the number back at its old webhook, and stop the cron job. Tables and tickets remain. Do not drop the tables; the audit log and tickets are your record.

## 12. Staff sign-in by invite code (v3.3)

Support staff have no RideArrivo email, so they join with a one-time code that an admin or a delegate issues.

1. Create the account: Administration, Support Routing, **Invite staff**. Enter name, work email, role kind (Agent, Watcher, Supervisor) and optional team. The code is shown once as `XXXXX-XXXXX` and stored only as a salted hash. It is valid for 48 hours, bound to that email, and locks after 5 wrong guesses (use Resend to issue a new one).
2. Delivery, any of three:
   - **Email** from RideArrivo through Resend: set `RESEND_API_KEY` and `SUPPORT_INVITE_FROM_EMAIL` (for example `RideArrivo Support <support@ridearrivo.com>`). The sending domain must be verified in Resend (SPF and DKIM), otherwise mail lands in spam or is refused.
   - **WhatsApp**: set `SUPPORT_INVITE_WA_FROM` and `SUPPORT_INVITE_WA_CONTENT_SID` (template variables: {1} first name, {2} code, {3} join link). Business-initiated WhatsApp needs a Meta-approved template; until it is approved, use email or copy.
   - **Copy once** from the screen and send it yourself.
3. The invitee opens the join page, `https://<your-app>/support-join.html`. Set `SUPPORT_JOIN_URL` to that address so messages link to it. The installer fills in the functions URL from `--functions-url` or `VITE_SUPABASE_URL`. They enter the email, the code and choose a password, then sign in to RA-Workspace.
4. Delegation: Invite staff, **Delegates**. A delegate can invite agents and watchers, never supervisors.
5. Deploy `support-invite`. It has JWT verification off on purpose because the join page is public; the `redeem` action is rate limited and every other action checks the caller's session inside the function.
6. If RideArrivo's Supabase project has a trigger on `auth.users` that restricts email domains, creating the account will fail with an error. That cannot be checked from here; test one invite on staging first.

## 13. Teams and supervisor scope (v3.3)

Administration, Support Routing, **Teams**: create teams, put officers in a team, and set each supervisor to scope **All** or **Team**. A team-scoped supervisor can assign, approve locations, read the audit log, run reports and invite only within their team, and cannot change configuration. Admin, the Administration workstation and the Head of Support title are always unscoped. Emergencies, the shared queues and the floor board are deliberately not scoped, so no SOS is ever hidden from a supervisor.

## 14. Alerts outside the screen (v3.3)

Escalations now reach people who are not looking. Rules live in Administration, Support Routing, **Alerts**: per event kind, audience (responder, supervisors, on duty), channel (push, SMS, WhatsApp, voice), minimum level and delay. Defaults are seeded. Acknowledging or resolving cancels queued SMS, WhatsApp and voice. A failure in the alert path is audited (`notify_failed`) and never blocks an SOS.

**Push (browser notifications).**
```bash
node scripts/generate-vapid-keys.mjs      # writes the private key to a mode-600 file, prints only the public key
supabase secrets set --env-file <that file>
```
The secrets are `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` address). The app fetches the public key from the function, so no build variable is needed. Never paste the private key anywhere. Staff turn push on from the bell, Notification settings.

**SMS.** Set `SUPPORT_ALERT_SMS_FROM` or `SUPPORT_ALERT_MESSAGING_SERVICE_SID`. Sending to Nigerian numbers needs a registered sender ID or a Messaging Service.

**WhatsApp.** Set `SUPPORT_ALERT_WA_FROM` and, for business-initiated messages, `SUPPORT_ALERT_WA_CONTENT_SID` (approved template, {1} headline, {2} detail).

**Voice.** Uses `TWILIO_CALLER_ID` and reads the alert twice. There is no keypad acknowledgement; the person acknowledges in the workstation.

Each person adds their phone and WhatsApp numbers under the bell, Notification settings. Admins can send a test alert and read the delivery report.

**Dependency:** delivery runs on `support-maintenance` every minute (section 5). SOS ingest also dispatches immediately. Without cron, delayed rules never fire.

## 15. Installable app and notifications (v3.3)

The workstation registers `support-sw.js` and a manifest so staff can install it. The service worker caches nothing from the app, only an offline page, so a deploy is never served stale. On iPhone and iPad, push works only after Add to Home Screen. Replace the placeholder "RA" icons in `public/` with the real brand icons before launch.

## 16. Map (v3.3)

Case locations and SOS positions show on a Leaflet map with a route line and a recent trail when the location service sends them (see `API-CONTRACTS.md`). Default tiles are OpenStreetMap, which is for light use only. For production set `VITE_SUPPORT_MAP_TILE_URL` and `VITE_SUPPORT_MAP_ATTRIBUTION` to a paid provider. Tiles are fetched by the officer's browser, so the provider sees the tile coordinates being viewed; weigh that for privacy.

## 17. Release order for v3.3

1. Apply the migrations (`supabase db push --linked`): 20261020200000 if not yet applied, then 210000, 220000, 230000.
2. Set secrets (section 4, 12, 14), then deploy `support-invite` and redeploy `support-sos-ingest`, `support-maintenance`, `support-location`, `support-taskrouter-control`.
3. Confirm the cron job (section 5).
4. Merge the app last, so the new screens never call functions that do not exist yet.

Extra go-live checks:

| Check | Expected |
|---|---|
| Invite yourself with a second email, copy the code, redeem on the join page | account created, you can sign in and see Support |
| Redeem with a wrong code 5 times | locked; Resend issues a new code |
| Redeem after 48 hours or with a different email | refused with the same generic message |
| Team-scoped supervisor opens another team's audit and assigns another team's ticket | refused; own team works |
| Send a test alert to yourself with push on | notification arrives with the tab closed |
| Send a signed test SOS and do nothing | after the delay the SMS or WhatsApp rule fires; acknowledging stops queued ones |
| Open a location session with route data | map shows position, trail and route |
