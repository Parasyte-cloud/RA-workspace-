# Deployment Guide - Finance, Marketing & Partnerships Release

## 1. Supabase first
Open RideArrivo Workspace -> SQL Editor -> New query.
Paste the complete contents of `supabase/schema.sql` and run it.

Expected successful result: `Success. No rows returned` (plus any harmless NOTICE messages about policies/constraints that did not previously exist).

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
npm install
npm run build
```
Do not push if the build fails.

## 5. Apply this release to the repo
Back up the current repo first. Copy this package over the repo while preserving `.git` and `.env`.
Then:
```bash
git status
git add src supabase README.md ARCHITECTURE_AUDIT.md DEPLOYMENT_GUIDE.md
git commit -m "Add finance marketing partnerships and harden workspace"
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

## RideArrivo Pulse migration

Before deploying the Pulse frontend, run the latest `supabase/schema.sql` in the Supabase SQL Editor. This creates the social tables, RLS policies and the private `social-media` Storage bucket. The module uses signed media URLs and does not make employee media public.

After the SQL succeeds, run `npm install` and `npm run build`, then push the source to `main`. Cloudflare Pages will deploy automatically. Test with at least two employee accounts: create a post, reply, like, repost, bookmark, follow, upload an image and confirm RLS prevents anonymous access.
