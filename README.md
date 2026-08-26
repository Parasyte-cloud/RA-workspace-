# RA Workspace

RideArrivo's private, installable internal workspace for Support, CRM, Engineering, People & HR, Operations, Finance & Accounting, Marketing, Partnerships, Legal and Administration.

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

The schema includes:
- employee directory and roles
- CRM
- support and incidents
- HR / leave / onboarding
- legal and compliance
- Finance & Accounting
- Marketing
- Partnerships
- application registry and audit log
- RLS and explicit authenticated grants

### Roles
```text
employee
support
engineer
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
