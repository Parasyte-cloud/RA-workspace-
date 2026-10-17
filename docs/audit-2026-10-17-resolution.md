# External audit, 17 Oct 2026: what was done

The audit confirmed the earlier major findings are fixed and listed nine remaining items. Status of each:

| # | Finding | Status | Where |
|---|---|---|---|
| 1 | R7 AI recording can lose a chunk if IndexedDB persistence fails silently | Fixed | `src/room7-ai/recorderStore.ts` keeps every chunk in memory until the server confirms it; the recorder warns when the on-device backup fails |
| 2 | Stored chunk SHA-256 never verified | Fixed | `room-ai-finalize` hashes each downloaded chunk and refuses a mismatch (`chunk_checksum_mismatch`) |
| 3 | Cron repair silently skips without the Vault secret | Fixed | `repair_cron_authentication()` and `cron_authentication_status()` (migration 20261017160000). Re-runnable, inspectable, warns loudly. The Vault secret itself still has to be created by a person |
| 4 | `expected_chunks` has no hard maximum | Fixed | Database check (20000), `end_ai_session` refuses more, finalize checks again |
| 5 | Physical-meeting consent needs stronger evidence | Fixed | Exact wording stored by version in an append-only table; each consent row records the version and device user agent; the audit entry snapshots attendees, who attested and the wording |
| 6 | Long transcripts use `.limit(5000)` | Fixed | Read in pages of 1000 (Supabase returns at most 1000 rows per request, so the old limit silently cut long meetings at 1000) |
| 7 | Customer-service PWAs need dedicated service-worker treatment | Partly fixed | Each customer site now registers its own `service-sw.js` and offline page, separate from the workspace worker. Dedicated app icons for Air, Boat, Easybook, Membership and Removals still need brand artwork |
| 8 | Rider JWT lives in `localStorage` | Not changed | Needs a change in the Arrivo backend (see below) |
| 9 | CSP not fully enforced everywhere | Not changed | Script rules are enforced; the rest stays report-only until the browser console is clean (see below) |

## 8. Rider JWT

A token in `localStorage` can be read by any script that runs on the page. The real fix is for the Arrivo backend to set the session as an `HttpOnly; Secure; SameSite=Lax` cookie on login and to accept it instead of the `Authorization` header, with a CSRF check on state-changing calls. That is a backend change, so it cannot be made from this repository. Until then the enforced `script-src` on every customer host is the main defence, and the token should keep a short lifetime.

## 9. CSP

Enforced today on the workspace and customer hosts: `script-src`, `object-src`, `base-uri` and `frame-ancestors`. Report-only: everything else. To promote a directive, open each page with the browser console visible, confirm there are no violations for that directive, then move it into the enforced header. The workspace report-only policy now allows `blob:` frames for the in-workspace guide viewer.
