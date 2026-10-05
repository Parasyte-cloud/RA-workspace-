# RA Workspace

RideArrivo's internal ops tool — Support, CRM, Engineering, People & HR, Operations, Finance & Accounting, Marketing, Partnerships, Legal, and Administration all in one place. Separate product from the rider/driver-facing Arrivo apps.

## Stack

React + TypeScript + Vite, deployed to Cloudflare Pages. Supabase for Auth, Postgres (with RLS), and Edge Functions. PWA service worker.

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

## Env vars

See `.env.example` for the full, commented list. The required ones: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ALLOWED_EMAIL_DOMAINS` (who's allowed to sign in — defaults to `ridearrivo.com`). Everything under `VITE_PARASYTE_*` is optional and only matters if you're touching the embedded intranet browser (see `PARASYTE_BROWSER_V2_1_CHANGELOG.md` before setting those).

## Structure

- `src/` — the app itself, organized by module (one per ops area)
- `supabase/` — database migrations and Edge Functions (`supabase db push`, `supabase functions deploy <name>`)
- `gateway/` — the Linux engineering terminal backend (separate build/test: `npm run gateway:build`, `npm run gateway:test`)

## More detail

This README is deliberately short. For architecture, past incidents, and deployment specifics, see `DEPLOYMENT_GUIDE.md`, `ARCHITECTURE_AUDIT.md`, and `ENGINEERING_SECURITY_AUDIT.md` in this same directory.

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

- `npm run typecheck` and `npm test` (19 Node-only suites) run in CI on every PR
  (`.github/workflows/ci.yml`), together with `npm run build` and a high-severity
  dependency audit. `npm run test:supabase` needs the Supabase CLI.
- `public/_headers` sets baseline security headers. The CSP on the forms host is
  report-only: check the console for violations, then rename it to
  `Content-Security-Policy` to enforce.
