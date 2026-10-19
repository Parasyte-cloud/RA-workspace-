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

Five migrations apply in order: core, voice and TaskRouter, omnichannel ingest, messaging routing, telephony controls. They are idempotent, so re-running is safe. To rehearse locally on plain Postgres 16:

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
openssl rand -hex 32          # use for SUPPORT_CRON_SECRET, then again for SUPPORT_INGEST_SECRET
supabase secrets set --env-file .env.support.private
rm .env.support.generated .env.support.private      # secrets now live only in Supabase

supabase functions deploy support-voice-token support-taskrouter-control support-voice-webhook \
  support-taskrouter-webhook support-sms-webhook support-ingest support-maintenance support-recording
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

Store the secret in Vault rather than inline if your policy requires it. Without cron: stale officers stay Available in TaskRouter until the next assignment rejects them, waiting tickets are only assigned when a message arrives or capacity frees, and scheduled callbacks never fire. Alert if the function returns 207 or stops being called.

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

## 10. Rollback

The module is additive. To switch it off without touching data: remove `<SupportCommandCentre/>` from the route, point the number back at its old webhook, and stop the cron job. Tables and tickets remain. Do not drop the tables; the audit log and tickets are your record.
