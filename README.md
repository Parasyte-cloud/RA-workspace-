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
