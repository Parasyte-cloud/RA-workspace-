# Critical bug sweep 2026-10-16: what was fixed

Source commit audited: 37a82aa. Migration: `20261016320000_bug_sweep_fixes.sql`.
Tests: `scripts/bug-sweep.test.mjs` (in `npm test`) and `supabase/checks/bug-sweep-behaviour.sql`.

| ID | Fix | Where |
|---|---|---|
| RA-001 | CI job "Supabase security suites" boots a local stack and runs `npm run test:supabase` | `.github/workflows/ci.yml` |
| RA-002 | `can_use_room_chat` requires an active employee; delete moderation requires an active admin | migration |
| RA-003 | Decision: no silent admin read. Admins must be in the room (joining already notifies the host) | migration |
| RA-004 | One shared wrong-passcode limiter, same counter key as `room-guest-session`, on documents and engagement | `_shared/room7Limit.ts` |
| RA-005 | 32 KB body cap, 8 per hour per address, 300 per hour overall on investor submissions | `ridearrivo-public-forms` |
| RA-006 | Cron jobs still on the old key are rewritten to the Vault secret, only if they still use the old key | migration |
| RA-007 | Department, Marketing, Shared Workspaces read the newest page | the three modules |
| RA-008 | WhatsApp reads newest messages and most recently active conversations | `SupportWhatsAppPanel` |
| RA-009 | Exact unread count and server-side mark-all-read | `NotificationsContext` |
| RA-010 | Status filter applied before the limit, plus "Show older" | `AdminDownloadAccessManager` |
| RA-011 | Cursor paging (100 per page) and "Load older enquiries" | `ridearrivo-public-forms`, `InvestorEnquiriesPanel` |
| RA-012 | Busy callee returns NULL, records a missed call, serialised per callee | migration, `ChatShell` |
| RA-013 | End is database first, provider close is idempotent and retried on a second End | `room-session` |
| RA-014 | Participant preset re-asserted on every rejoin, fails closed | `room-session` |
| RA-015 | Poll order rotates by least recently polled (`mail_poll_cursor`) | `mail-notify-poll` |
| RA-016 | Forwarded file must match the original size and eTag | migration |
| RA-017 | Failed shell start releases the active marker and schedules a stop | `gateway/src/container.ts` |
| RA-018 | Enforced script/object/base/frame policy on the six customer hosts, rest report-only | `public/_headers` |
| RA-019 | Not fixable in the frontend. Needs an HttpOnly cookie or token exchange on the Arrivo backend. CSP in RA-018 is the mitigation for now | n/a |
| RA-020 | Per-service manifests and title via `service-host.js`. No service worker yet | `public/` |
| RA-021 | `legal_contracts` and `compliance_items` readable by Legal and admin only | migration |
| RA-023 | Test runner comment corrected | `scripts/run-tests.mjs` |
| RA-024 | `X-Robots-Tag: noindex` on the intranet host | `public/_headers` |
| RA-025 | `audit-fixes.bundle` removed from the tree (history is not rewritten) | repo |

## One-time setup after deploying

1. `supabase db push`
2. Create the Vault secret used by the two cron jobs, with the same value as the function secret `CRON_DISPATCH_SECRET`:
   `select vault.create_secret('<value>', 'cron_dispatch_secret');`
   then run `supabase/checks/reauth-cron-jobs.sql` in the SQL editor once. Check with the read-only query in the sweep report.
3. Redeploy: `room-session`, `room-event-documents`, `room-event-engagement`, `ridearrivo-public-forms`, `mail-notify-poll`.
