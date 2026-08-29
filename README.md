# RA Workspace

RideArrivo's private, installable internal workspace for Support, CRM, Engineering, People & HR, Operations, Finance & Accounting, Marketing, Partnerships, Legal and Administration. The workspace includes the authenticated ParAsYtE Linux engineering terminal and complete work approval/deadline controls.

## Stack
React + TypeScript + Vite on Cloudflare Pages, Supabase Auth/Postgres/RLS, PWA service worker and responsive liquid-glass UI.

## Local development
```bash
npm install
cp .env.example .env
npm run dev
```

## Production build
```bash
npm run build
```

## Environment variables
```text
VITE_ALLOWED_EMAIL_DOMAINS=ridearrivo.com
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_ANON_KEY=<publishable-key>
VITE_PARASYTE_LINUX_WS=wss://linux.ridearrivo.com/ws
```
Never expose a Supabase service-role or secret key to Vite or Cloudflare Pages.

## Authentication
- RideArrivo company email enforcement
- Email/password authentication through Supabase
- OTP verification flow supported by the auth UI
- Custom SMTP recommended for production email delivery
- Role-aware navigation with RLS as the real authorization boundary

## Supabase deployment
Run `supabase/schema.sql` in the dedicated RideArrivo Workspace Supabase project using SQL Editor. The file is designed to be safe to re-run and includes explicit grants because automatic table exposure is disabled.

After the base schema, apply every SQL file in `supabase/migrations` in filename order. The schema and migrations include:
- employee directory and roles
- CRM
- support and incidents
- HR / leave / onboarding
- legal and compliance
- Finance & Accounting
- Marketing
- Partnerships
- application registry and audit log
- multi-round work approvals, deadline alerts and scheduled escalation
- server-side ParAsYtE Linux authorization
- RLS and explicit authenticated grants

### Roles
```text
employee
support
engineer
cto
manager
hr
legal
operations
finance
marketing
partnerships
admin
```

After running the schema, assign the first administrator in SQL Editor by updating the relevant `employee_profiles.role` to `admin`.

## Finance & Accounting
Functional Supabase-backed workbenches for invoices, vendor bills, expenses, journal headers, budgets, assets, tax obligations and period-close tasks. The schema also includes chart-of-accounts and journal-line foundations for double-entry accounting.

## Marketing
Functional workbenches for campaigns, content calendar, attribution, experiments and creative assets.

## Partnerships
Functional workbenches for partner directory, commercial pipeline, agreements, relationship activities, referrals and onboarding.

## PWA and mobile
The app includes a service worker, SPA fallback, transparent RideArrivo favicon/PWA icons, install support and responsive layouts for desktop, tablet and mobile.

## ParAsYtE Linux

The Engineering navigation includes an authenticated WebSocket terminal for active `engineer` and `admin` accounts. Each account receives an isolated non-root tooling container and a persistent `/workspace`. The Linux gateway is a separate server component; see `gateway/README.md` for the rootless Docker, TLS proxy and service deployment procedure. It uses the public Supabase publishable/anon key plus the employee's own access token and must never receive a service-role credential.

## Work approvals and deadlines

Creators, Managers and Admins can request approval from another active employee. Approvals are recorded in rounds, cannot be self-approved, and support approve, reject and cancel actions. A Supabase Cron job processes due-soon, overdue and 24-hour escalation events every five minutes without duplicating notifications.

## Deployment
Cloudflare Pages Git integration:
```text
Build command: npm run build
Output directory: dist
Root directory: blank
Production branch: main
```

## Important integration boundary
Dispatch, driver availability, fleet state, booking state and other live product data should come from RideArrivo backend APIs. The workspace should not create a competing source of truth for production ride operations.

## Audit
Read `ARCHITECTURE_AUDIT.md` before production rollout.

### RideArrivo Pulse
The workspace now includes `Pulse`, an internal social/news feed for RideArrivo employees. Core feed interactions are Supabase-backed and media is stored in the private `social-media` bucket. Advanced social primitives (polls, mentions, notifications, moderation, lists, communities, direct messages and Spaces metadata) are included in the schema for phased UI rollout.

## Department operating model

RideArrivo uses department-first navigation. The sidebar names the department (Support, Operations, People & HR, Engineering, Finance, Marketing, Partnerships, Legal, CEO / Management) rather than adding separate department "Workspace" entries. Opening a department reveals its operating workspace, collaboration, execution tools and team context.

Shared project workspaces are invitation-based and do not weaken department boundaries. Employee headshot collections are owner-private. Company Files uploads are restricted to Legal/Admin, and protected downloads require administrator approval before files leave the workspace.
