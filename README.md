# RA Workspace

RideArrivo's private, installable internal workspace for Support, CRM, Engineering, People & HR, Operations, Legal and Administration.

## Brand
Dark navy + amber liquid-glass UI using the supplied RideArrivo mark and wordmark.

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

## Authentication
When Supabase is configured, the workspace requires authentication. The default allowed email domain is:

```text
ridearrivo.com
```

Cloudflare Pages variables:
```text
VITE_ALLOWED_EMAIL_DOMAINS=ridearrivo.com
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_ANON_KEY=<public-anon-key>
```

Never expose a Supabase service-role key to Vite or Cloudflare Pages frontend variables.

## Supabase
Run `supabase/schema.sql` in a dedicated Supabase project. The schema includes employee profiles, RBAC helpers, CRM, support, incidents, HR, legal/compliance, app registry and RLS.

## PWA
The app includes a service worker, SPA fallback, 192px/512px icons and install support.

## Engineering device setup
- `/bootstrap/macos.sh`
- `/bootstrap/windows.ps1`

These scripts install common engineering tools. For corporate automatic provisioning, move to MDM such as Intune or Jamf.

## Deployment
Recommended: Cloudflare Pages Git integration.

Build command:
```text
npm run build
```

Output directory:
```text
dist
```

## Audit
Read `ARCHITECTURE_AUDIT.md` before production rollout.
