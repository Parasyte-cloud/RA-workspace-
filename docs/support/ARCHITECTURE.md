# Architecture

PArAsYtE | RA-Workspace support module

## Components

```
Customer ──PSTN/BYOC──> Twilio Voice ──> support-voice-webhook ──> TaskRouter ──> support-taskrouter-webhook (assignment)
                                              │                                          │
WhatsApp / SMS / forms / email / web chat     │                              reject / dequeue / call
        │                                     ▼                                          ▼
        └─────────> Postgres (tickets, interactions, SLA, presence, shifts) <──── Browser softphone (Voice JS SDK)
                         ▲            │ realtime
        support-ingest ──┘            ▼
        support-sms-webhook      Support Command Centre (React)
        support-maintenance (cron: presence hygiene, requeue, callbacks)
```

Postgres is the source of truth for tickets, presence and shifts. TaskRouter is a mirror used only to decide who rings; if the two disagree the database wins and the assignment callback re-checks it.

## Edge Functions

| Function | JWT | Auth | Purpose |
|---|---|---|---|
| support-voice-token | yes | user session | Voice access token; identity derived from the user id |
| support-taskrouter-control | yes | user session; supervisor for admin actions | presence, device registration, callbacks, call quality samples, do-not-contact add, provisioning, voice settings, dial rules, hours, closures, number registry, alerts |
| support-voice-webhook | no | Twilio signature | inbound (with opening hours and voicemail), IVR, hold loop, callback offer, queue exit, outbound (caller ID from the number registry, BYOC with PSTN fallback), callback leg, status, recording, voicemail |
| support-recording | yes | user session; supervisor or the handling officer | audited playback of a recording or voicemail, streamed from Twilio |
| support-taskrouter-webhook | no | Twilio signature | assignment gate and reservation events |
| support-sms-webhook | no | Twilio signature | inbound SMS to ticket |
| support-ingest | no | HMAC-SHA256, 5 minute window | email relay, web chat widget, forms |
| support-maintenance | no | shared secret header | presence hygiene, requeue, due callbacks, call price backfill, fraud and spend scan, recording retention purge |

Pure logic (phone normalisation, signatures, TwiML builders, assignment gate, presence state machine, workflow definition) lives in `_shared/supportCore.ts` so it is unit tested without Deno or the network. `_shared/supportTwilio.ts` is the thin network and environment layer.

## Who may receive a call

TaskRouter picks a worker. Before it rings, `support-taskrouter-webhook` answers `reject` unless all of these hold right now:

1. agent exists, is enabled and has voice enabled
2. the Twilio worker id matches the one stored for that officer
3. presence is `available`
4. the shift is running (computed from the schedule at this moment)
5. last heartbeat is under 120 seconds old
6. a browser device identity exists

`reject` also moves the worker Offline in TaskRouter so it is not offered the next task, and the officer's presence is set Offline with the reason (`stale_heartbeat`, `off_shift`, `no_device`).

## Presence state machine

Officer chosen: `available`, `break`, `away`, `offline`. System set: `on_call`, `wrap_up`, `busy`.

| Event | Result |
|---|---|
| `reservation.accepted` | `on_call` |
| `reservation.rejected` / `reservation.timeout` while `available` | `away` (reason `rejected_call` / `missed_call`) |
| `reservation.completed` while `on_call` | `wrap_up` |
| no heartbeat for 90 s (maintenance) | `offline` |
| shift ended while `available` | `offline` |
| `wrap_up` for 15 minutes | `away` (the officer must press Available to take more work) |
| softphone unregistered while `available` | `away` |

Going `available` requires: on shift, and for voice officers a registered softphone. If TaskRouter cannot be updated when going Available the officer is returned to Away and told, because "Available in the UI, invisible to routing" leaves customers waiting while the board shows free staff.

## Messaging allocation

`support_try_assign_ticket` runs under a global advisory lock and picks, among eligible officers: specialist for the ticket category, then the officer already handling this customer, then lowest open load, then longest idle. Eligible means enabled for that channel, Available, heartbeat fresh, on shift, under capacity. It runs when a customer message lands, when capacity frees up, and on every maintenance tick. Tickets held by an officer who has gone away for 5 minutes with no activity go back to the queue.

## Shifts

`support_shifts` rows hold start and end time in Africa/Lagos. An overnight shift (end earlier than start) is attached to the weekday it starts on, with Sunday as 0. At 02:00 Tuesday, the Night shift that started Monday 19:00 is the one that counts. `support_agents.shift_override_until` is honoured by the shift check (set it in SQL for a one-off cover shift); there is no screen for it yet.

## Tickets and SLA

Priorities P0 to P4 carry a first-response and resolution clock (P0 2/120 min, P1 5/240, P2 15/480, P3 60/1440, P4 240/4320). A customer reply wakes `waiting_customer`; a reply within 7 days of resolution reopens the ticket. Interactions are idempotent on (provider, external id), so webhook retries create nothing new.

## Callbacks

A caller waiting beyond `callback_offer_after_seconds` is offered a callback (press 1). Abandoned calls with a visible number become a missed-call callback. At most one live callback per number. A callback becomes a TaskRouter task; the officer's softphone rings first, and when they answer, the customer is dialled. Failures retry after 10, 20 minutes, then fail after 3 attempts.

## Network notes

**Signalling and media.** The softphone uses WebSocket signalling over TCP 443 and WebRTC media over UDP. Officers' networks must allow outbound TCP 443 to Twilio and outbound UDP to Twilio's media ranges, with STUN/TURN on 3478 as fallback. Confirm the current port and address ranges in Twilio's Voice JS SDK network documentation before you give the list to whoever runs the office firewall. If UDP is blocked, calls fall back to TURN over TCP and quality drops sharply.

**Edge selection.** The SDK connects to the nearest Twilio edge. Officers in Nigeria usually do best on a European edge, so the softphone prefers `frankfurt`, then `dublin`, then `ashburn`. Override with `VITE_TWILIO_EDGES` after measuring round trip from your office on the day shift. Edge names must be ones your Twilio account offers.

**Codecs.** Opus first, PCMU as fallback. Opus tolerates loss and variable bitrate; PCMU is what the PSTN leg uses anyway.

**What the softphone tells the officer.** Twilio's `warning` events (high RTT, jitter, packet loss, low MOS, silent mic) show as a banner during the call, so the officer can tell the customer before audio degrades. Treat sustained warnings from one office as a network ticket, not an officer problem.

**Nigerian SIP (BYOC).** Outbound legs use `<Number byoc="BY...">` when `TWILIO_BYOC_TRUNK_SID` is set, so calls to Nigerian numbers leave over your own carrier trunk instead of Twilio's international termination. On the carrier side allow Twilio's signalling and media IP ranges for your region, use TLS and SRTP if the carrier supports them, and agree the caller ID (CLI) presentation rules with the carrier: many Nigerian carriers reject or rewrite a CLI that is not a number you hold on that trunk. `TWILIO_CALLER_ID` must therefore be a number the trunk is allowed to present.

**Inbound Nigerian numbers.** Point the carrier's inbound route at your Twilio Elastic SIP trunk or number and set that number's voice URL to `support-voice-webhook?action=inbound` (HTTP POST). Withheld CLI arrives as an alphanumeric or a placeholder such as `+266696687`; both are treated as withheld.

**Toll fraud.** The dial policy is the control that matters most on an internet-reachable softphone. Keep Allow limited to countries you actually call, keep Deny on premium and fraud-prone prefixes, and watch `dial_blocked` entries in the audit log.

## Security model

- Browser reads only through definer views and RPCs that call `support_is_staff()` or `support_is_supervisor()`; tables have RLS enabled with no direct write grants.
- All functions are `security definer` with a pinned `search_path`, explicitly revoked from `public` and `anon` (Postgres grants EXECUTE to PUBLIC by default) and granted only to the roles that need them.
- Twilio webhooks are signature checked in constant time; ingest uses HMAC with a replay window; maintenance uses a shared secret.
- Twilio response bodies and stack traces stay in function logs. Browsers get short messages.
- The Twilio auth token never reaches the browser. The browser gets a token signed by an API key, scoped to one identity.

## Telephony controls (migration 20261020100000)

- **Opening hours.** `support_line_status()` answers "is the line open now" from `support_business_hours` and `support_closures` in the configured time zone. Enforcement is off by default and the function fails open when nothing is configured. The inbound webhook asks `support_voice_route()` before it creates a ticket. When closed it either records a voicemail or plays the closed message and hangs up. A voicemail stores the recording id, notes the ticket and books a callback for the next opening (never for a withheld caller).
- **Number registry and caller ID.** Outbound calls take their caller ID from `support_pick_caller_id()`: a number registered for the destination prefix, else the default outbound number, else the single caller ID in settings. The registry also says whether a number leaves by Twilio (`pstn`) or the own-carrier trunk (`byoc`). If the BYOC leg fails outright, the `dial-result` action retries once over Twilio.
- **Dial policy order** in `support_check_dial`: valid number, destination rules, do-not-contact, daily spend cap, per-officer rate limit.
- **Quality.** The browser sends 15 second averages to `support_record_call_quality`; the server computes MOS with the same simplified E-model in SQL and TypeScript. `support_telephony_health_view` is supervisor only.
- **Fraud and spend.** `support_fraud_scan()` runs from the maintenance job and writes de-duplicated alerts (one open alert per kind and key). Prices come from Twilio call records a few minutes after a call ends.
- **Recordings.** Outbound recording status goes to the existing `recording` action. Playback goes only through `support-recording`, which checks the role in `support_recording_ref()` and writes an audit row. Retention is enforced by `support_recordings_expired()` plus a Twilio delete, then `support_recording_purged()`.
