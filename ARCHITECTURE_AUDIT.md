# RideArrivo Workspace Engineering & Controls Audit

## Release scope
This release adds Finance & Accounting, Marketing and Partnerships as native Supabase-backed applications and hardens the existing workspace without removing the current authentication, branding, PWA or Cloudflare deployment model.

## Findings corrected
1. **Role model incomplete**: added `finance`, `marketing` and `partnerships` roles to frontend and database authorization.
2. **Navigation exposed privileged modules**: added role-aware navigation. RLS remains the authoritative security boundary.
3. **Duplicate logo processing**: removed runtime canvas-based logo conversion from active navigation and use the already prepared transparent brand asset.
4. **Supabase schema ordering bug**: role helper functions were defined before `employee_profiles`; reordered so a fresh schema run can resolve the table.
5. **Schema re-run risk**: policy creation is preceded by `DROP POLICY IF EXISTS` so repeated deployments do not fail on policy-name collisions.
6. **Automatic Data API exposure disabled**: added explicit authenticated table/function grants and kept anonymous table access revoked.
7. **Dead static business buttons**: new Finance, Marketing and Partnerships workbenches use real Supabase reads/inserts, refresh and search instead of placeholder buttons.
8. **Existing CRM/support/HR/operations/legal/admin gaps**: added live Supabase workbenches for CRM leads/accounts, support cases, incidents, employee directory/leave requests, contracts/compliance and app registry.
9. **Mobile workflow risk**: added responsive module tabs, single-column forms, horizontally safe data tables and mobile-friendly workbench actions.

## Finance controls included
- chart-of-accounts foundation
- journal headers and debit/credit line model
- customer invoices / AR
- vendor bills / AP
- expense claims
- budgets
- fixed assets
- tax obligations
- month-end/year-end close tasks
- finance-only write RLS, finance/manager/admin read RLS

### Finance production controls still requiring organizational configuration
- approval limits and segregation-of-duties matrix
- bank-feed integration and automated reconciliation
- payment authorization workflow
- tax rules/rates and statutory filing calendar approved by RideArrivo finance/tax advisers
- immutable posted-period locking
- automated P&L/balance-sheet/cash-flow views
- payment gateway and booking-ledger integration
These require company accounting policy and external-system integration; they should not be guessed in frontend code.

## Marketing controls included
- campaign register
- objective/channel/budget/status governance
- content calendar and approval states
- UTM attribution records
- spend/leads/bookings/revenue data model
- growth experiment register
- creative asset register
- marketing RLS

## Partnerships controls included
- partner master records
- commercial pipeline
- agreements, effective/expiry dates and commissions
- relationship activities and next actions
- booking/referral attribution
- partner onboarding workstreams
- cross-functional read access for legal, finance, marketing and operations where required

## Existing application audit
### Authentication
- Supabase Auth remains intact.
- 6-digit verification UX remains intact.
- SMTP/template configuration remains external to this repository.
- Company-domain enforcement remains in frontend and database trigger.

### CRM
Now has live lead and account CRUD foundations. Contacts, activities and opportunities exist in schema and can be expanded into dedicated subviews.

### Support
Support-case intake is live. Production ride/order feeds should be integrated from RideArrivo APIs rather than manually copied.

### Engineering
Bootstrap scripts remain appropriate. Browser applications cannot silently install native developer tools. GitHub and deployment providers should be integrated through APIs when iframe restrictions apply.

### People & HR
Directory is live and leave requests are written with the authenticated employee ID. Sensitive payroll/bank/medical data is intentionally not placed in the general employee profile table.

### Operations
Incident register is live. Dispatch, fleet and trip state remain API-integration work because the RideArrivo production backend must remain the operational source of truth.

### Legal
Contract and compliance registers are live. Document storage should use a private Supabase Storage bucket with corresponding object policies before confidential documents are uploaded.

### Admin
Application registry is live; privileged access is restricted by RLS. User role changes should be exposed through a dedicated audited admin workflow before broad use.

## Security review
- No service-role key is required by the browser.
- Anonymous table privileges are revoked by schema.
- Business modules have RLS.
- Finance writes: finance/admin.
- Marketing writes: marketing/admin.
- Partnership writes: partnerships/admin.
- Manager role receives read visibility where operationally justified, not unrestricted writes.
- UI hiding is not treated as authorization.

## Deployment order
1. Back up/export the Supabase project if it contains production data.
2. Run `supabase/schema.sql` in Supabase SQL Editor.
3. Assign the initial admin/department roles in `employee_profiles`.
4. Test RLS using separate finance, marketing, partnerships and ordinary employee test users.
5. Run `npm run build` locally.
6. Commit and push to `main`.
7. Let Cloudflare Pages deploy automatically.
8. Test desktop, tablet, mobile and installed-PWA views.
9. Test create/read operations in each role-specific module.

## Build-validation note
The source was statically checked for TypeScript/JSX syntax. A complete local `npm ci` could not be completed in the isolated audit container because package installation timed out, so the final deployment gate remains `npm run build` on the user's normal development machine/Cloudflare build environment before production promotion.

## RideArrivo Pulse (social/news)

Added an employee-only X-style social/news layer named **RideArrivo Pulse**. The implemented production-facing surface includes feed tabs, author identity, posts, news/announcement types, replies, likes, reposts, bookmarks, following, hashtags/trends, media attachments in a private Supabase Storage bucket with signed URLs, search, scheduling metadata and mobile layouts.

The database foundation also includes mentions, polls/options/votes, notifications, moderation reports, lists, communities, direct-message conversations/messages and Spaces metadata. These tables are protected with RLS and explicit authenticated grants. Live audio/video transport for Spaces, push-notification delivery, full recommendation ML, and external-public federation are intentionally not faked inside the frontend; they require dedicated realtime/media/notification infrastructure before being exposed as production controls.
