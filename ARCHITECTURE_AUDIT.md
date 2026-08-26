# RA Workspace — Senior Engineering & Software Audit

## Senior software engineer assessment
The starter had a useful shell, but it was not production-ready. The main gaps were: no working authentication UI, no company-domain enforcement at the database boundary, no CRM, mostly placeholder workstations, limited HR/legal data modelling, weak application integration strategy, no device-bootstrap downloads, a generic visual treatment rather than the requested RideArrivo liquid-glass system, and PWA icons that did not use the supplied brand assets.

This revision establishes a production-shaped internal control plane with these modules:
- Overview / command centre
- CRM for riders, travellers, corporate accounts, hotels and partners
- Support station for booking intake, cases, rider/driver context, live-trip support and safety escalation
- Engineering workstation with macOS/Windows bootstrap packages, mobile tooling and delivery-control architecture
- People & HR
- Operations
- Legal & compliance
- Applications workspace
- Admin / IAM / audit / device policy

Authentication uses Supabase when configured and defaults to `ridearrivo.com` only. The restriction exists both in the UI and in the database trigger, so it is not merely cosmetic client validation.

## Senior auditor findings and corrections
### Critical findings corrected
1. **Authentication was incomplete** — added Supabase sign-in/sign-up UI and session handling.
2. **Email restriction was client-only / absent** — added a database trigger rejecting non-`ridearrivo.com` identities.
3. **Role model lacked real access controls** — added helper role functions and RLS policies by function.
4. **No CRM** — added accounts, contacts, leads, opportunities and activities.
5. **No support-case model** — added support cases and incident register.
6. **HR model too small** — added leave, HR requests and onboarding tasks.
7. **Legal/compliance absent from data layer** — added contracts and compliance register.
8. **PWA brand mismatch** — replaced generic icon with supplied RideArrivo assets and generated 192/512 icons.
9. **Engineering install promise was technically unsafe** — replaced the idea of browser-side silent installs with auditable bootstrap scripts and an MDM-ready approach.
10. **Iframe-only strategy is not sufficient** — preserved in-workspace framing for owned apps, but documents that third-party CSP/X-Frame-Options must be handled with native API integrations rather than insecure workarounds.

### Production controls still required before go-live
- Turn off open self-signup if you want invitation-only onboarding; use Supabase admin invites or SSO.
- Configure SMTP with a RideArrivo sender domain and email verification.
- Create the first admin account through a controlled SQL/admin process, not through client code.
- Connect Support/Operations modules to the real Arrivo backend APIs and booking database.
- Connect CRM identities to rider/customer records using stable backend IDs, not just email/phone.
- Add audit writes via server-side functions for privileged mutations.
- Put sensitive HR/legal documents in private Storage buckets with signed URLs and separate RLS.
- Add rate limiting / abuse controls at Cloudflare and Supabase.
- Add Sentry or equivalent error monitoring and CI security scanning.
- Implement MDM (Intune/Jamf) for laptops if automatic tool provisioning is required.
- For "everything in one app", prefer native API-backed panels over framing SaaS products.

## Public RideArrivo workflow alignment
The public service currently presents airport pickup, vehicle selection, payment, live tracking, ride sharing, driver verification and rider/driver flows. The internal workspace mirrors those operational needs into Support, CRM and Operations rather than making staff work from the customer-facing site.
