# Workspace audit, 15 October 2026

Scope: database migrations, 31 edge functions, front end, headers, build health.
Method: static review of the repository at origin/main 3a0b148 plus automated scans. Nothing was run against the live Supabase project, so live settings (Vault secrets, dashboard auth options, bucket settings) are listed as things to verify, not as findings.

## Baseline
- Type check clean. 75 of 75 test suites passed before this audit. Production build succeeds.
- npm audit: 0 known vulnerabilities.
- No service-role key or secret is referenced from src. Only the anon key and public URLs reach the browser.

## What was checked and held up
- Row-level security: 201 tables are created in migrations. A first scan flagged about 120 as unprotected, but that was the scanner missing multi-line statements and loop-based enabling. After reading the loops, every table has RLS enabled and policies.
- Function execution: a blanket revoke from public and anon runs in 20260904203000, and default privileges are revoked for later functions. All security-definer functions set search_path. Only one definer function has no auth check in its body (get_controlled_text_asset) and it checks download approval itself.
- Direct messages: social_messages and conversation tables are limited to conversation members. Only feed tables (posts, reactions, polls, communities) are readable by every employee, which is intended.
- Edge functions: every function that skips platform JWT verification (verify_jwt false) has its own check: webhook signatures, shared secrets, guest tokens or getUser. Functions missing from config.toml default to JWT required.
- Front end: one dangerouslySetInnerHTML (mail reader), sanitized. window.open calls to external URLs use noopener. No eval, no innerHTML assignments.

## Findings

### Fixed in this branch
1. Medium. Mail reader sanitized scripts but left links without rel noopener, allowed remote images (read receipts and tracking pixels), forms and style blocks (phishing look-alikes, restyling the page). Now handled by src/lib/mailHtml.ts. Trade-off: remote images in emails no longer load.
2. Low. Cron secrets in notifications-email-dispatch and ridearrivo-bookings-poll were compared with !==, which is not constant time. Replaced with a constant-time compare, matching push-dispatch.

### Open, recommended
3. Medium. PARTLY FIXED. A report-only Content-Security-Policy is now sent for intranet.ridearrivo.com. It blocks nothing; review the console for violations, then enforce. Before: no policy on the workspace host. public/_headers only has a report-only policy for the public forms hosts. A CSP is the main backstop against any future XSS. Roll out report-only on the workspace first, then enforce.
4. Medium. The manager role can read every department table (support, operations, people, executive). Confirm that is intended. People candidates, performance reviews and executive decisions are sensitive.
5. Low. FIXED. social_hashtags insert policy was with check (true). Migration 20261015200000 now only accepts lowercase letters, digits and underscores, 1 to 50 characters.
6. Low. FIXED. Window.open for PROVIDUS_URL now sets noopener.
7. Withdrawn. An earlier draft said authenticated functions allow any origin. On re-check every function restricts CORS to the workspace or an allow-list.
8. Performance. PARTLY FIXED. Six logo PNGs were downscaled (about 3 MB saved). On re-check the 2.3 MB Room 7 chunk is the video meeting SDK (617 KB over the wire), and it was already lazy: the entry page never loads it, only the meeting screens do. It now warms up in the background while the Room 7 module or the guest lobby is open, so joining feels instant. Pinning the SDK into its own chunk was tried and rejected: it made the entry page preload 3.8 MB.
9. Maintainability. PARTLY FIXED. The self-contained helpers (CORS, request parsing, hashing, validators, constants) of room-event-control, room-event-documents and ridearrivo-support moved into sibling files, cutting room-event-control by about 560 lines and room-event-documents by about 700. Request handling and mutable state stay in index.ts so behavior and order are unchanged. The action handlers (configure, invitations, documents) are the next candidates but need live testing.

### Verify in the live project (cannot be seen from the repo)
- Vault secrets for push (push_dispatch_url, push_dispatch_secret) match PUSH_DISPATCH_SECRET.
- CRON_DISPATCH_SECRET is set and the cron jobs send it.
- Storage buckets are private, including archive, and mime allow-lists applied.
- Auth settings: leaked-password protection, email confirmation, allowed redirect URLs.
- Both Archive migrations (310000, 320000) have been run.
