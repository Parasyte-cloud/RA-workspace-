# RideArrivo Workspace Deployment Guide

## 1. Supabase first
Open RideArrivo Workspace -> SQL Editor -> New query.
Paste the complete contents of `supabase/schema.sql` and run it.

Expected successful result: `Success. No rows returned` (plus any harmless NOTICE messages about policies/constraints that did not previously exist).

Then run every file in `supabase/migrations` in filename order. Do not skip the approval/deadline completion or ParAsYtE authorization migrations. `20260828222000_complete_work_approval_workflow.sql` enables `pg_cron` and schedules the idempotent deadline processor every five minutes.

## 2. Assign your first admin role
After your user has signed up and verified, open Table Editor -> `employee_profiles` and set your own `role` to `admin`.
Or run, replacing the email:

```sql
update public.employee_profiles
set role = 'admin', department = 'Administration'
where lower(email) = lower('YOUR@ridearrivo.com');
```

## 3. Create departmental test users
Use separate test accounts and assign roles `finance`, `marketing`, `partnerships`, plus one ordinary `employee`. Verify that unauthorized modules are not visible and direct table access is denied by RLS.

## 4. Build locally
```bash
cd ~/RA-workspace
npm ci
npm run build
npm run gateway:test
```
Do not push if the build fails.

## 5. Apply this release to the repo
Back up the current repo first. Copy this package over the repo while preserving `.git` and `.env`.
Then:
```bash
git status
git add src gateway supabase README.md ARCHITECTURE_AUDIT.md DEPLOYMENT_GUIDE.md package.json package-lock.json vite.config.ts
git commit -m "Complete workspace workflows and ParAsYtE gateway"
git push origin main
```

## 6. Cloudflare
Cloudflare Pages should deploy automatically from `main`.
Build command: `npm run build`
Output: `dist`
Root directory: blank

## 7. Production smoke test
- OTP sign-up and sign-in
- sign-out and session restoration
- Finance create/read with finance user
- Marketing create/read with marketing user
- Partnerships create/read with partnerships user
- employee cannot access those tables
- Admin can see admin application registry
- CRM, support, HR, operations and legal still load
- mobile navigation and forms work at 390px width
- PWA install still works and favicon remains transparent
- written RideArrivo wordmark is complete at desktop and mobile widths in light and dark modes
- approval request, approval, rejection, cancellation and a second approval round
- due-soon/overdue cron events appear once and escalation occurs after 24 hours overdue
- engineer/admin can open ParAsYtE Linux; employee/manager/CTO accounts are rejected by the server
- each engineer reconnects to the same `/workspace`, while another engineer receives a different volume

## 8. ParAsYtE Linux server

Follow `gateway/README.md` on a dedicated Linux host/account. The deployment requires Node.js 22, rootless Docker, the included tooling image, Nginx/TLS and the exact Cloudflare Pages origin in `PARASYTE_ALLOWED_ORIGINS`.

Only the publishable/anon Supabase key belongs in the gateway environment. Do not copy a service-role key, production database password, deployment token or production application credential to the gateway or engineer containers.

After the gateway health check passes, set this in the Cloudflare Pages production environment and redeploy:

```text
VITE_PARASYTE_LINUX_WS=wss://linux.ridearrivo.com/ws
```

## RideArrivo Pulse migration

Before deploying the Pulse frontend, run the latest `supabase/schema.sql` in the Supabase SQL Editor. This creates the social tables, RLS policies and the private `social-media` Storage bucket. The module uses signed media URLs and does not make employee media public.

After the SQL succeeds, run `npm install` and `npm run build`, then push the source to `main`. Cloudflare Pages will deploy automatically. Test with at least two employee accounts: create a post, reply, like, repost, bookmark, follow, upload an image and confirm RLS prevents anonymous access.

## Enterprise workstation and file-governance release

After the base migrations, apply these migrations in order:

- `20260829003000_private_employee_headshots.sql`
- `20260829014000_shared_workspace_hub.sql`
- `20260829031500_download_access_governance.sql`
- `20260829032000_department_operating_systems.sql`
- `20260829033500_company_files_legal_admin_upload.sql`

`Company Files` uses the private `company-files` Supabase Storage bucket. Only active `legal` and `admin` roles can upload/update/delete company files. Active employees can discover file metadata, but protected storage locations are not exposed by the catalog RPC. Downloads require a recorded administrator approval; the storage SELECT policy checks the active grant before a signed URL can be created.

The legacy `public/bootstrap` directory must not be deployed after download governance is enabled. Engineering bootstrap scripts are served only through the controlled-download RPC after administrator approval.

Department names remain the primary sidebar entries. Employees click their department and work inside the department surface, where Workspace, Collaboration, Operations and Team views are available. The CEO/Manager surface includes live priorities, decision log and enterprise risk records plus cross-functional navigation.

## Personalized dashboard, workstations, KPI and recognition release

Apply these migrations after `20260829041000_company_file_visibility_hardening.sql`:

- `20260829103000_workstations_kpi_personal_dashboard.sql`
- `20260829110000_annual_kpi_recognition_payments.sql`

The first migration creates Admin-managed primary workstation assignments and transparent 30-day KPI snapshots. The second adds year-to-date/annual KPI snapshots, monthly Top Performer recognition, winner notifications and the company recognition announcement. KPI cron jobs run after the existing daily KPI refresh.

After deployment verify:

- an Admin receives/has an `Administration` primary workstation;
- Admin can assign and reassign employee workstations;
- an assigned workstation appears in the employee sidebar without changing their job title;
- Dashboard greets the employee by first name and shows the daily note;
- rolling and annual KPI cards do not show a synthetic zero when no work exists;
- a current recognition winner sees the badge and all employees see the recognition announcement;
- the prior winner remains active until a new eligible winner is generated.

## Finance payments Edge Function

Set provider credentials as Supabase Edge Function secrets, never frontend variables:

```bash
supabase secrets set PAYSTACK_SECRET_KEY='YOUR_PAYSTACK_SECRET'
supabase secrets set FLUTTERWAVE_SECRET_KEY='YOUR_FLUTTERWAVE_SECRET'
```

Do not paste live secrets into shell history on shared machines; use your organisation's approved secret-management process when available.

Deploy the function:

```bash
supabase functions deploy finance-payments
```

The function validates the employee session and requires Finance, Manager/Admin, or an explicit Finance workstation assignment. It returns read-only transaction/settlement data to the Finance workstation. Do not add refund/transfer actions without a separate approval and audit design.

## Release verification

Before pushing `main`:

```bash
git diff --check
npm ci
npm run build
npm run gateway:test
supabase db push --linked --dry-run
```

The dry run for this release should show only migrations that have not yet been applied to the linked project. Review that list before running a real `supabase db push --linked`.

### Annual KPI finalisation

The annual KPI refresh runs daily for the current year. A separate 1 January cron finalises the previous calendar year after 31 December has fully closed. Monthly recognition evaluates the previous calendar month and will not replace the currently active badge unless at least one employee has enough recorded evidence to produce an eligible winner.
