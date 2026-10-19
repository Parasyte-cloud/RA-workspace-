# Alignment with the two engineering briefs

PArAsYtE | RA-Workspace support module

Compared against `Telephony Platform Research Brief` and `Engineering Workstreams Brief` (October 2026).

## Read this first

The briefs describe building a **telephony platform**: a SIP proxy, media servers, carrier trunks and a customer billing system, sold to other businesses. The Support Command Centre is a **contact centre for RideArrivo's own support team, built on Twilio**. That is the "Buy" end of the briefs' own build, buy or combine table, and it matches their "Option A: application layer on a licensed carrier".

So the comparison splits three ways:

- **Built or added here**: the parts of the briefs that apply to a contact centre (routing by time, voicemail, recording consent and retention, caller ID control, do-not-call, spend and fraud guards, quality measurement).
- **Provided by Twilio**: the carrier, signalling, media and WebRTC layers (workstreams 1 to 4). We configure them; we do not run them.
- **Out of scope, or a decision for leadership**: things that only make sense if RideArrivo resells telephony to customers.

If leadership decides to build the full platform, this module becomes the first customer of it. The carrier layer is already behind one seam (`TWILIO_BYOC_TRUNK_SID`, the number registry and `chooseCarrierRoute`), which is the "clean interface" the research brief asks for.

## Status legend

| Mark | Meaning |
|---|---|
| Built | In the module before this comparison |
| Added | Added in migration `20261020100000_support_telephony_controls` and the code that goes with it |
| Twilio | Delivered by Twilio, configured by us |
| Gap | Applies to us, not built yet, reason given |
| Decision | Needs a leadership or legal answer, no code can settle it |
| N/A | Only applies to a platform that resells telephony |

## Research brief

| Brief item | Status | Where / note |
|---|---|---|
| Routing by time of day and public holidays | Added | `support_business_hours`, `support_closures`, `support_line_status`. Off until you switch on "Enforce opening hours". Fails open if no hours are set. |
| Voicemail, voicemail in the app | Added | After-hours calls record a message; stored, ticketed, and a callback is booked for the next opening. Played from the ticket. |
| Voicemail by email, transcription | Gap | In-app only. Email needs a mail relay decision; transcription needs a provider and NDPA review. |
| Recording with consent announcement | Added | `announcement` mode plays a notice to the person an officer dials. Consent mode stored per call (`recording_consent`). Inbound calls are not recorded yet (see Honest limits). |
| Recording: role-based access, audited | Added | `support-recording` function: supervisor or the handling officer only; every play is written to the audit log. Audio is streamed through the server, never a public URL. |
| Recording: encrypted storage | Twilio | Recordings stay on Twilio's platform. Confirm Twilio's encryption at rest and whether you need customer-managed keys (Twilio Public Key Encryption, not enabled here); NDPA counsel should decide. |
| Retention schedule, delete when period ends | Added | Per-setting retention days; the maintenance job deletes at Twilio and marks the call. Each purge is audited. |
| Number inventory, one owner per number | Added | `support_numbers`: label, direction, route, default outbound, active. Unique per E.164. |
| Caller ID only from numbers we own | Added | Caller ID is picked from the registry (same country first, then default, then settings). Officers cannot type a caller ID. Twilio itself also rejects unverified ones. |
| Failover to a second carrier, retry on failure | Added | If the BYOC leg fails (not busy, not no-answer) the call retries once over Twilio's network. Audited as `carrier_fallback`. Two-carrier least-cost routing across contracts is a Gap (needs a second trunk). |
| Click-to-call | Built | Call button in the ticket drawer and the softphone dial pad. |
| Dialer modes: manual, preview, progressive | Gap | Manual and callback queue only. Preview and progressive need campaign lists and an abandoned-call ceiling. Not needed for support, build only if outbound campaigns are planned. |
| Answering-machine detection | Gap | Not built. Twilio offers it as a Dial option; only needed for campaigns. |
| Do-not-call / do-not-disturb | Added | `support_do_not_contact`: enforced for manual dials and scheduled callbacks; officers add from the ticket; only supervisors remove. |
| Destinations blocked by default | Built | Dial rules: no match means deny, longest prefix wins. |
| Spend caps that cut off in real time, alert at thresholds | Added | Daily alert and daily cap. The cap blocks new calls on the next dial. Spend is read from Twilio call prices, which arrive minutes after a call ends, so a burst can overshoot by a few minutes of calls. |
| Anomaly rules: calls per minute, new countries, bursts | Added | Fraud scan every minute: calls per hour, many destinations in 24 hours, bursts of very short calls, spend. Alerts shown to supervisors with a resolve button. |
| Per-account call caps | Built | Outbound limit per officer per 10 minutes. |
| Quality targets (delay 150 ms, jitter 30 ms, loss 1%, MOS 4.0) | Added | The softphone samples the live call and sends averages every 15 seconds; supervisors see average MOS, jitter, RTT and loss for 24 hours. Targets match the brief. This is the officer's browser leg only. |
| ASR and ACD | Added | Outbound ASR and ACD on the control tower. Inbound answer rate already existed. |
| PDD (post-dial delay), call setup success rate | Gap | Twilio does not give PDD per call through the API we use. Would need SIP-level data (Voice Insights, a paid add-on). |
| Opus for apps, G.711 for carriers | Twilio | The SDK is configured Opus first, PCMU fallback. |
| TLS signalling, SRTP media | Twilio | Voice SDK uses TLS and DTLS-SRTP. Recording playback is HTTPS. |
| ICE, STUN, TURN | Twilio | Twilio Network Traversal is used by the SDK. |
| DTMF RFC 4733 | Twilio | Handled by Twilio. |
| Hosted PBX, trunk mode for customer PBXs, desk phones, mobile app with push | N/A | Platform features. Our officers use the browser softphone. A mobile softphone is a possible later addition, not a brief requirement for support. |
| Queues: round robin, longest idle, skills | Built | TaskRouter with skills, sticky agent, longest idle. |
| Transfer, hold, park, conference | Gap | Hold and mute exist in the softphone. Transfer, park and conference need TaskRouter conferences (same change as listen/whisper/barge). |
| Prepaid balance check before each call | Partly | Twilio prepaid balance stops calls when it is empty; our daily cap is in addition. |
| CDRs for every attempt | Built | `support_calls` and `support_call_events` capture every attempt including failures, with price added. A rating engine, VAT invoicing and reconciliation tool are N/A (we are not billing customers for calls). |
| Reconciliation against carrier invoice | Gap | Prices are stored per call, so a monthly export is a simple query. A tool is not built. |
| NDPA: consent proof | Added | Consent mode stored on each call. For `announcement` mode the notice plays on every recorded outbound call. |
| NDPA: role-based access, audit | Added | See recordings above; all admin changes are audited. |
| NDPA: breach process, data residency | Decision | Company process. Recordings live in Twilio's default region unless a regional setup is configured, and Twilio has no Nigerian region; confirm with counsel whether storage inside Nigeria is required. |
| Licensing (UASL, NCC) | Decision | Design follows Option A: Twilio, and the Nigerian BYOC carrier, hold the licences. Confirm with counsel that using Twilio numbers and a local carrier for support calls needs nothing further from RideArrivo. |

## Engineering workstreams

| Workstream | Status | What applies to us |
|---|---|---|
| 1 Carrier connectivity and edge | Twilio, partly Added | Twilio Elastic SIP / BYOC provide trunks, SBC and failover. Added: PSTN fallback when the BYOC leg fails, a registry that says which route each number uses. Gap: two-carrier least-cost routing and SIP OPTIONS health checks apply only if you run your own trunks. |
| 2 Signalling and registration | Twilio | Twilio is the registrar. Officers authenticate with short-lived tokens issued per employee; one officer cannot call as another (`support-voice-token` derives the identity from the login). |
| 3 Media and call logic | Twilio, partly Added | IVR, queues, recording, MOS target. Added: time conditions, voicemail, consent notice, retention. Gap: transfer, park, conference. |
| 4 Client apps | Built / Gap | Browser softphone with token refresh, unregister detection and quality warnings. Gap: mobile apps with push, desk phones, PBX trunk mode. Tests on the main Nigerian mobile networks are a deployment task. |
| 5 Numbers and routing | Added | Number registry, routing by time and holidays, verified caller ID, audit of every change. Gap: porting workflow (a carrier process, not code). |
| 6 Outbound and dialer | Added / Gap | Do-not-call enforced in every outbound path. Gap: preview and progressive dialers, AMD, campaign lists (see above). |
| 7 Billing and metering | Added / N/A | Call prices stored, spend alert and cap. Rating, VAT invoices, customer dashboards and reconciliation are N/A or a Gap, as above. |
| 8 Security and fraud | Added / Decision | Destinations blocked by default (Built), anomaly rules and alerts (Added), audit of admin actions (Built). Multi-factor sign-in for admins is a Supabase Auth setting: enable it. Penetration test and fraud incident runbook are Decisions for the security owner. A simulated premium-destination burst is covered by the dial rules (blocked at the first call) and the fraud scan (alert within about a minute). |
| 9 APIs, portals, integrations | Built / N/A | Admin screens are the portal. Signed webhooks in are validated; webhooks out to customers and a public REST API are N/A. |
| 10 Operations and testing | Partly | Tests: 34 JS tests, 3 SQL suites (each migration applied twice). Metrics: call quality, ASR/ACD, fraud and spend on the control tower. Gap: SIP tracing (HOMER), load tests (SIPp) and failover drills apply to a self-run platform. For Twilio, run a load test of the softphone and a failover drill (disable the BYOC trunk, confirm fallback) before go-live. |

## What leadership and legal must decide

1. Licensing route. Confirm Option A is enough for support calling.
2. Whether recording is on at launch. The code is ready; the legal sign-off is not ours to give.
3. Retention periods for recordings and voicemails (defaults are 90 days; this is a placeholder, not advice).
4. Whether recordings must be stored inside Nigeria.
5. Carrier shortlist for the BYOC route and whether a second carrier is wanted at launch.
6. Spend alert and cap amounts (left empty, so no limit until set).
7. Whether RideArrivo will ever resell telephony. If yes, most N/A rows above become a real project.

## Honest limits of what was added

- Inbound calls are not recorded. Only outbound calls (and voicemail) are, because the inbound leg is bridged by TaskRouter and needs a conference to record both sides. Recording inbound is a follow-up with the same change as listen/whisper/barge.
- Quality samples cover the officer's browser leg. For inbound calls the sample is stored without a link to the call record, because the browser reports the child call id; the 24-hour averages are unaffected.
- Prices arrive from Twilio several minutes after a call ends. The spend cap is therefore approximate by a few minutes of traffic.
- Voice Insights (PDD, per-route scorecards) is not enabled.
- The new SQL is tested on Postgres 16 with the same Supabase-shaped stub as before, not on a live Supabase project. Twilio, the voicemail flow and the BYOC fallback could not be exercised from the build environment. Test them on staging with the go-live checks in `DEPLOYMENT.md`.
