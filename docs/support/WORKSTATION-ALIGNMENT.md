# Support Workstation brief: what we built on top of what we had

PArAsYtE | RA-Workspace support module

This compares the "RideArrivo Support Workstation, Product Requirements and Implementation Brief" with the Support Command Centre already in RA-Workspace, and records what was added in migration `20261020200000_support_workstation_safety.sql`.

## Read this first

1. **We did not build a separate service.** The brief asks for a microservice at `support.ridearrivo.com`. We were asked to build on what exists, so everything lives in RA-Workspace and the same Supabase project. The support data is isolated by the `support_` prefix and by row level security, and the Edge Functions deploy independently of the website. The one thing that does not separate is the frontend: it ships with the workspace. Moving it to its own domain later is a second build of the same module and is listed under decisions.
2. **Safety features work without Twilio.** SOS intake, escalation, identity codes, location sessions, reports and the audit viewer need only Supabase. They go live before the phone does.
3. **Three things need work in the main RideArrivo app, which we have not seen:** sending the SOS event, providing the live location feed, and (optionally) showing the identity code to the rider or driver. The contracts are in `API-CONTRACTS.md`. Until they exist, those parts show "not connected" instead of pretending.
4. **Nothing here contacts emergency services.** Staff record that they did. The system never claims it.

Legend: **Built** = already in v3.1. **Added** = new in this change. **Partial** = some of it. **Gap** = not built. **Dependency** = needs the main app or a third party. **Decision** = needs leadership.

## Section by section

| Brief | Status | Notes |
|---|---|---|
| 2 Independent microservice, own domain | **Decision** | Kept inside RA-Workspace by instruction. Functions deploy independently. No `support.ridearrivo.com`. |
| 2 No duplicate rider, driver, booking records | **Added** | Identity codes, incidents and location sessions hold ids that point at the existing records. |
| 2 Realtime with resilient fallback | **Added** | Supabase realtime plus a 10 second poll for emergencies. The screen says when the feed is disconnected. |
| 3 Watcher role | **Added** | `role_kind = watcher`: never routed work, sees queues and that an emergency exists, no private details, no lookups, no locations. |
| 3 Agent, Head of Support, Administrator | **Built** | Agent, supervisor flag, admin role and Head of Support by title. Role kind is now explicit and audited. |
| 3 Supervisor over a defined group | **Gap** | `supervisor_id` exists on officers but supervisors are not yet limited to a team. Today every supervisor sees everything. |
| 3 Configurable roles | **Partial** | Three role kinds plus the existing employee roles. No custom permission editor. |
| 3 New employee onboarded without main-workspace access | **Partial** | They get a workspace login limited to the Support workstation by assignment. A separate support-only login needs the separate domain. |
| 4 Least workload, availability, skills, priority | **Built** | Specialist, then sticky customer, then lowest load, then longest idle, with capacity and shift checks. |
| 4 Automatic reassignment when unavailable | **Built** | Tickets return to the queue after 5 minutes away. Emergencies now reassign within a minute. |
| 4 Team and supervisor pools, hierarchy | **Gap** | Same as the supervisor scoping gap. |
| 4 Manual reassignment with a reason | **Partial** | Emergencies require a reason. Ticket reassignment is recorded but does not ask for one. |
| 4 Unclaimed-ticket escalation by age | **Gap** | SLA clocks flag at risk and breached. Nothing auto-escalates a ticket. Emergencies do. |
| 5 Dashboard | **Built** | Control tower. Missing: saved views and keyboard navigation. Average resolution, reopened and queue by priority are in Insights. |
| 6 Case record, statuses, notes, audit timeline | **Built** | |
| 6 Watchers on a case | **Added** | Watch and Unwatch in the ticket drawer; a supervisor can add someone else. Watching is not ownership. |
| 6 Subcategories, attachments, closure category | **Gap** | Categories are values, not a managed list. No attachments. No closure category. |
| 6 Booking, trip, vehicle on tickets | **Gap** | They are on emergencies. Tickets link to a person, not a booking. |
| 6 Emergency lifecycle separate from tickets | **Added** | Incidents are their own records. Resolving a ticket never closes one. |
| 7 Identity codes | **Added** | Format `RAR-XXXXX-XXXXX` (rider) and `RAD-XXXXX-XXXXX` (driver), about 49 bits, no look-alike letters, stable, exact match, rate limited, failed lookups counted, details masked unless you are handling an open case for them or are a supervisor. A code never returns a position. |
| 7 Backfill codes for existing riders and drivers | **Dependency** | The main backend calls the issue endpoint once per person. A first SOS also issues a code. |
| 7 Location only via session with reason, expiry, audit | **Added** | Case-linked, reason of 10+ characters, default 15 minutes, revocable, ends when the case ends, optional supervisor approval, every read logged. Emergencies are never held up by approval. |
| 8 Live map | **Partial** | Gate, freshness, audit and fallback to the last SOS position are built. The screen shows coordinates with a live or last known label and an OpenStreetMap link. **No map tiles and no route line.** Needs a map provider decision. |
| 8 Search by booking, trip or vehicle | **Gap** | Identity code only. |
| 8 Never show stale as live | **Added** | A position older than the limit (45 seconds by default) is labelled last known with its age. |
| 9 SOS ingest, idempotency, immutable original | **Added** | Signed endpoint, one incident per event id, repeat presses join the live incident, original payload and time cannot be changed, timeline is append-only. |
| 9 Persistent alert until acknowledged | **Added** | Red banner drawn from the database, survives reload, stays until resolved. Acknowledging does not resolve. |
| 9 Escalation and backup | **Added** | Unacknowledged past 60 seconds goes to level 1, then every 2 minutes up to level 3, trying another responder each time. Responder offline hands over. Nobody available keeps the alert open. |
| 9 Notify on-duty staff and Head of Support | **Partial** | They see the banner and tab title. **No push, SMS, WhatsApp or phone call.** |
| 9 Contact actions | **Partial** | Staff record contacts on the timeline. Calling from the emergency screen is not wired. |
| 9 Delivery retries, monitoring, failure alerts | **Partial** | Sender retries are safe by design. No inbox/dead-letter table and no alert when SOS processing fails. |
| 10 Communication | **Built** | Voice, WhatsApp, SMS, email link, internal notes kept separate. Templates and in-app messaging are gaps. |
| 11 PWA, Web Push | **Gap** | Not built. Touching the workspace shell and push keys needs a decision. |
| 12 Administration | **Partial** | Roles, shifts, skills, capacity, voice and telephony settings, safety settings, location approvals. No service on/off switch, team hierarchy or deployment status. |
| 13 RBAC, RLS, audit, secrets, CORS | **Built / Added** | Real-role tests prove an officer cannot read the audit log, forge a session, call the location gate, inject an SOS or promote themselves. |
| 13 Session inactivity and expiry policy | **Gap** | Uses the workspace session settings. |
| 13 Retention | **Added / Decision** | Location access logs 30 days, recordings as before. Incident and audit retention are not set. |
| 14 Reporting | **Added** | Insights: cases by category, priority and officer, first response, resolution, active versus waiting time, SLA met, escalations, reopened, queue aging, emergency acknowledge and resolve times, location availability, CSV export (audited). Missing: filter by team and severity, notification failures. |
| 15 Observability | **Partial** | Structured logs for SOS intake and escalation. No correlation ids, error tracker or health endpoint. |
| 16 Screens | See below | |
| 17 Phases | | Phases 1 to 3 mostly covered. Phase 4: hierarchy, PWA, push open. Phase 5: security tests done; load and failure injection not. |

### The 15 screens

| # | Screen | Status |
|---|---|---|
| 1 | Login and access | Built (workspace login) |
| 2 | Operations dashboard | Built (Control tower) |
| 3 | Support inbox | Built (Queue) |
| 4 | Case workspace | Built (ticket drawer) |
| 5 | Live trip and vehicle map | Partial (position card, no tiles) |
| 6 | Emergency console | **Added** |
| 7 | Rider and driver lookup | **Added** |
| 8 | Agent workspace | Built (My work) |
| 9 | Team and supervisor management | Partial (roles yes, hierarchy no) |
| 10 | Routing configuration | Partial (skills, capacity, shifts; queue rules not editable) |
| 11 | Reports | **Added** |
| 12 | Audit log viewer | **Added** |
| 13 | Notification center | Gap |
| 14 | Service settings | Partial (safety and telephony settings; no integration health page) |
| 15 | Mobile interface | Built (responsive; not installable) |

## Targets we propose (please confirm)

| Measure | Proposed target | What limits it today |
|---|---|---|
| SOS received to alert visible | 5 seconds | Realtime is near instant; polling worst case is 10 seconds. |
| Unacknowledged SOS to escalation | threshold (60 s) plus up to 60 s | The scheduler runs once a minute. |
| Ordinary first response | the existing SLA clocks (P0 2 min to P4 240 min) | |
| SOS intake availability | as good as Supabase and the sender's retries | No second path if Supabase is down. |

## Decisions for leadership

1. Separate domain and installable app, or keep it inside the workspace?
2. Who gets woken for an unacknowledged SOS, and how (push, SMS, WhatsApp, phone call)? Today it is the screen only.
3. Map provider for production tiles (OpenStreetMap is wired for light use).
4. Retention for incidents, audit records and location logs.
5. Should location sessions on ordinary cases need supervisor approval? It is off by default.
6. Supervisors can now be limited to their own team (v3.3, per supervisor setting). Decide who gets scope Team.
7. Is any verified emergency-services integration planned? Until then the product says staff contacted them, never that the system did.

## Honest limits

- The SOS and location contracts are written from the brief. They have not been exercised against the real RideArrivo app. First test: send a signed test event (see `API-CONTRACTS.md`) and watch it appear.
- Escalation now also sends push, SMS, WhatsApp and voice alerts (v3.3), but only through channels that are configured, and only while `support-maintenance` runs every minute.
- "Live" depends entirely on the timestamp the location service sends. If it sends none, the screen says it cannot be treated as live.
- An officer with an open location session sees a position for 15 minutes. Supervisors can end any session from Insights, Safety and approvals.
