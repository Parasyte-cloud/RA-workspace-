# RA Support Command Centre

PArAsYtE | RA-Workspace support module

One workstation for every way a customer reaches RideArrivo Support: phone, WhatsApp, SMS, email, web chat and website forms. Each contact becomes a ticket automatically, is routed to an officer who is actually on shift and actually reachable, and is tracked against an SLA until it is resolved.

## What is in the box

| Area | What it does |
|---|---|
| Voice | Twilio Voice JS softphone in the browser. Inbound calls go through TaskRouter (skill, longest idle, sticky officer). Outbound is policy checked and rate limited. |
| Messaging | WhatsApp, SMS, web chat, email and forms are ingested idempotently and load balanced by a Postgres allocator (skill, sticky customer, lowest load, longest idle, capacity). |
| Tickets | Customer identity resolution, SLA clocks per priority, audit trail, notes, reopen-on-reply, internal notes. |
| Callbacks | Queue callback offer after a wait, missed-call callbacks, scheduled callbacks, retry with backoff, one live callback per number. |
| Shifts | Day (07:00 to 19:00) and Night (19:00 to 07:00, Africa/Lagos) evaluated live, including overnight shifts. Officers can only go Available on shift. |
| Head of Support | Control tower: KPIs for today, live calls, officer board, SLA breaches, channel load, assign and reassign. |
| Administration | Provision officers (skills, capacity, shift, Twilio worker), voice settings and IVR, dial rules (toll fraud policy), opening hours and closures, voicemail, number registry, do-not-contact list, spend and fraud limits, recording retention. |
| Line quality and safety | Softphone sends latency, jitter and loss samples; the control tower shows MOS, outbound ASR and ACD, spend today and open fraud alerts. |

## Where it plugs in

- `SupportWorkspaceRoute` renders `<SupportCommandCentre/>` at the top of the Support workstation.
- `AdministrationControlPlane` gains a **Support Routing** tab.
- Access reuses the repo's existing model: `employee_profiles.role`, `workspace_workstation_assignments` and job title. Anyone with the `support`, `manager` or `admin` role, or the Support or Administration workstation, can open it. Admins and managers are supervisors.
- Existing `support_whatsapp_messages` and `intake_submissions` (destination `support`) feed tickets through triggers, so nothing in the WhatsApp or forms code had to change.

## What changed from the earlier phases, and why it matters

These are the defects found in the Phase 1 and Phase 2 drafts and what would have happened if they had shipped.

1. **Twilio signature check sorted parameters with `localeCompare`.** Twilio signs the parameters in code point order. `localeCompare` orders `a`, `B`, `c` differently, so any request with mixed case parameter names (`CallSid`, `CallStatus`, `From`, `Digits`, `ParentCallSid`) could fail validation intermittently. Calls would drop to the error path at random. Fixed with code point ordering and a regression test.
2. **The signed URL was assumed.** Inside an Edge Function the runtime can see a different host or scheme than the one Twilio signed. Validation now tries the configured public URL, the Supabase functions URL and the received URL, with and without `:443`.
3. **Presence came from a stored flag.** `active_shift` was written once and went stale, so an officer could be routed calls after their shift ended, or be refused at 07:00 on a night shift that started at 19:00 the day before. Shift state is now computed live from the schedule in the database (overnight shifts belong to the weekday they start on), in the routing gate, the views and the Available check.
4. **A ringing reservation was treated as "on a call".** An unanswered call marked the officer busy and the next customer waited. Only `reservation.accepted` means on a call. A rejected or timed out reservation moves the officer to Away so a single missed call does not become ten.
5. **The assignment callback trusted TaskRouter's view of the worker.** It is now the last gate and re-checks enabled, voice enabled, Twilio worker id, Available, on shift, heartbeat under 120 seconds and a registered softphone against live data. Otherwise it answers `reject`, which also moves the worker Offline in TaskRouter.
6. **Heartbeat.** The browser checks in every 30 seconds. Past 120 seconds the officer is treated as Offline by routing and the views, and `support-maintenance` makes it permanent and mirrors it to TaskRouter. A closed laptop no longer keeps receiving calls.
7. **Messaging was never load balanced.** Tickets sat unassigned. Added a locked allocator and a requeue for tickets held by an officer who vanished.
8. **No toll fraud control.** Any signed in officer could dial anywhere through the TwiML App. Outbound and callback legs now go through `support_check_dial`: longest prefix allow or deny, plus a per officer rate limit, plus an audit row for every block. Unknown devices are refused.
9. **Withheld caller ids** (for example `+266696687`, `anonymous`, `restricted`) were treated as real phone numbers and merged every anonymous caller into one customer. They are now detected and each call gets its own ticket with no phone number.
10. **Webhook retries.** Twilio retries on timeout. Provider events are recorded with a unique key; the row is marked processed only after the work succeeded, so a retry after a crash runs again but a retry after success is ignored.
11. **Migration timestamp collision.** The Phase 1 migration was named `20261019130000_...`, the same timestamp as the repo's `20261019130000_confidential_grants.sql`. Supabase keys migrations by timestamp, so the second one to apply would be rejected or skipped. All migrations now start at `20261019200000`, after the repo's latest, and are idempotent (applied twice in testing).
12. **Officers could write their own presence and device rows.** The earlier policies let any signed in officer update `support_agent_presence` and `support_agent_voice_devices` directly, so a browser console could set `active_shift = true` and skip the shift rule, or point the voice device at another identity. Now the browser can only read through views and call RPCs that re-check the caller; every write goes through a function or the service role.
13. **Errors leaked provider detail** to the browser. Twilio response bodies are logged server side only.

## Honest limits

- **Listen, whisper and barge** are not implemented. TaskRouter conferences are needed for those and would change the call topology; it is a separate piece of work.
- **Email** is ingest only. `support-ingest` accepts signed messages from a mail relay, but sending replies from the workstation is not built. The Email button opens the officer's mail client.
- **SMS and WhatsApp replies** are not sent from the new drawer. WhatsApp keeps using the existing panel; SMS outbound is not built.
- **Recording** covers outbound calls and voicemail, with a consent notice, audited playback and a retention purge. Inbound calls are not recorded. Do not enable it before legal sign off on disclosure and retention.
- The SQL logic is tested on Postgres 16 with a Supabase-shaped stub, not against a live Supabase project. Run it against staging first.
- Twilio, the BYOC trunk and a real browser softphone could not be exercised from the build environment. First call testing is a deployment step.

## Documents

- `ARCHITECTURE.md` how it works, including call flow, routing rules and network notes
- `BRIEF-ALIGNMENT.md` how this build compares with the telephony research and engineering workstream briefs, what was added, and what is a decision
- `DEPLOYMENT.md` step by step install, secrets, Twilio, cron, go-live checks and troubleshooting
