# RA Workspace

RideArrivo's internal ops tool: Support, CRM, Engineering, People and HR, Operations, Finance and Accounting, Marketing, Partnerships, Legal and Administration in one place. Separate product from the rider/driver-facing Arrivo apps.

## Stack

React + TypeScript + Vite, deployed to Cloudflare Pages. Supabase for Auth, Postgres (with RLS), Realtime, Storage and Edge Functions. Calls run on Cloudflare RealtimeKit. PWA service worker.

## Run it

```bash
npm install
cp .env.example .env   # fill in the Supabase project values
npm run dev
```

## Build

```bash
npm run build     # runs prepare-brand, then tsc, then vite build
npm run preview    # serve the production build locally
```

`npm run build` rewrites the generated `public/ridearrivo-wordmark-*.png` files. Run `git checkout -- public` before committing so those do not end up in a pull request.

## Env vars

See `.env.example` for the full, commented list. The required ones: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ALLOWED_EMAIL_DOMAINS` (who's allowed to sign in, defaults to `ridearrivo.com`). Everything under `VITE_PARASYTE_*` is optional and only matters if you're touching the embedded intranet browser (see `PARASYTE_BROWSER_V2_1_CHANGELOG.md` before setting those).

## Structure

- `src/` is the app itself, organized by module (one per ops area). Chat lives in `src/chat/`, including the confidential-message vault in `src/chat/vault/`.
- `supabase/` holds database migrations (`supabase/migrations/`), Edge Functions (`supabase/functions/`), seed data (`supabase/seed/`) and SQL checks (`supabase/checks/`).
- `gateway/` is the Linux engineering terminal backend (separate build/test: `npm run gateway:build`, `npm run gateway:test`).
- `scripts/` holds the Node-only test suites and build helpers.
- `docs/` holds the feature notes and audit write-ups listed below.

## Chat, calls and confidential messages

Chat (direct and group) handles text, photos, files and voice notes. Calls start from a chat and open a FaceTime style screen. Phone alerts ring or notify when the app is closed. A lock beside the attach button sends a message or document as confidential: one-time key, timed view, and only an administrator can open it again.

Each piece needs a database migration, an Edge Function and, for two of them, secrets:

| Feature | Edge Function | Secrets (names only) |
|---|---|---|
| Chat calls | `room-session` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_REALTIMEKIT_API_TOKEN`, `CLOUDFLARE_REALTIMEKIT_APP_ID`, `CLOUDFLARE_REALTIMEKIT_HOST_PRESET`, `CLOUDFLARE_REALTIMEKIT_PARTICIPANT_PRESET` |
| Phone alerts | `push-dispatch` (deploy with `--no-verify-jwt`) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET`; `VITE_VAPID_PUBLIC_KEY` in Cloudflare Pages |
| Confidential messages | `confidential-vault` (keep the JWT check on) | `VAULT_MASTER_KEY`, `VAULT_PEPPER` |

Release order, every time: run the new SQL migration first (all of them are safe to run twice), deploy the matching Edge Function, then merge. The app is written so that shipping before the SQL breaks nothing: for example the lock button stays hidden until the vault tables exist.

Back up `VAULT_MASTER_KEY` and `VAULT_PEPPER`. Losing the master key makes locked texts unreadable, and changing the pepper invalidates keys that were not used yet. Generate them once:

```bash
supabase secrets set VAULT_MASTER_KEY="$(openssl rand -base64 32)" VAULT_PEPPER="$(openssl rand -base64 48)" --project-ref <ref>
```

Be clear with staff about one limit: a web page cannot stop a screenshot or a photo of the screen. The viewer hides on focus loss, blocks copy, print and save, and puts the viewer's name across the content, which deters and traces but does not prevent.

## Docs map

| Topic | File |
|---|---|
| Confidential messages: design, limits, deploy, device checklist | `docs/confidential-messages.md` |
| Calls in Chat: behaviour and rules | `docs/chat-calls.md` |
| Call join failures (ERR0002) | `docs/call-join-failure-2026-10-18.md` |
| Chat and call audit, round 3 | `docs/chat-call-audit-round3-2026-10-18.md` |
| Chat sound and notification audit | `docs/chat-audio-notifications-audit-2026-10-18.md` |
| Phone alerts (push) | `docs/push-notifications.md` |
| In-app Knowledge Base and the AI Knowledge Manager | `docs/ai-knowledge-manager.md` |
| ROOM 7 | `docs/room7-user-guide.pdf`, `docs/room7-passcode-events.md` |
| Deployment, architecture, security | `DEPLOYMENT_GUIDE.md`, `ARCHITECTURE_AUDIT.md`, `ENGINEERING_SECURITY_AUDIT.md` |

Older release notes and one-off audit logs live in `docs/archive/`.

## Knowledge Base

Staff-facing help lives in the app under Knowledge Base, stored in the `workspace_knowledge_articles` table. Starter articles are seeded by migrations named `*_seed_*knowledge*.sql`, with the same text kept in `supabase/seed/knowledge-articles.json`. A seed never overwrites an article an admin has edited (`on conflict (slug) do nothing`), so to ship new articles add a new migration and append to the JSON, never edit an old seed. `scripts/knowledge-ai.test.mjs` fails if the two drift apart. Corrections to existing articles go through Administration, then AI Management, or by editing the article in the app.

## Analytics (public forms only)

Google Tag Manager / GA4 is wired into the public form sites (forms, bookings,
membership, move, boat, air, easybook) and never into the internal workspace.
It is off until you set `VITE_GTM_ID` (or `VITE_GA4_MEASUREMENT_ID`) in the
Cloudflare Pages build environment. Consent Mode v2 starts denied, nothing is
requested from Google until a visitor accepts, and only `page_view`,
`form_view`, `form_step` and `form_submit` events are sent, with a whitelist of
non-personal parameters. Code: `src/lib/analytics.ts`,
`src/forms-public/AnalyticsConsent.tsx`.

## Checks

- `npm run typecheck` and `npm test` (every Node-only suite in `scripts/`, run one by one by `scripts/run-tests.mjs`) run in CI on every PR
  (`.github/workflows/ci.yml`), together with `npm run build` and a high-severity
  dependency audit. `npm run test:supabase` needs the Supabase CLI and runs the suites that drive a local stack.
- Several suites read source files and migrations and fail if a security rule is weakened (for example the vault suite checks that the browser has no access to the secret tables). If one fails after an edit, read what it pins before changing the test.
- `public/_headers` sets baseline security headers. The CSP on the forms host is
  report-only: check the console for violations, then rename it to
  `Content-Security-Policy` to enforce.
- Nothing about calls, audio or the lock is proven on a real phone by the tests. The device checklists at the end of the docs above are part of every release that touches them.
