-- ============================================================
-- Fix employee_hr_details read/write access: drop 'manager' from
-- the allowed roles.
--
-- 20260920090000_employee_hr_details.sql granted 'manager' the
-- same read/insert/update access as 'hr'/'admin' over every
-- employee's row, with no scoping to their own reports. That
-- table holds bank_account_number, bvn, tax_identification_number
-- and pension_pin, the same class of data the KYC documents table
-- added five days earlier (20260915090000_profile_dob_kyc_documents.sql)
-- deliberately restricts to "Owner: full access to their own
-- documents. HR / Admin: read-only, for onboarding review.
-- Nobody else, including Manager, can see these - this is
-- government ID + bank account + guarantor data."
--
-- employee_hr_details never carried that same restriction, so any
-- employee with role = 'manager' anywhere in the org, not just a
-- person's own manager, could read (and, before submission,
-- write) every colleague's bank account number and BVN. This
-- brings the table's access control in line with the KYC
-- documents precedent: owner + hr/admin only.
-- ============================================================

begin;

drop policy if exists
  "employee hr details read"
on public.employee_hr_details;

create policy
  "employee hr details read"
on public.employee_hr_details
for select
to authenticated
using (
  id = auth.uid()
  or public.has_workspace_role(array['hr','admin'])
);

drop policy if exists
  "employee hr details insert"
on public.employee_hr_details;

create policy
  "employee hr details insert"
on public.employee_hr_details
for insert
to authenticated
with check (
  id = auth.uid()
  or public.has_workspace_role(array['hr','admin'])
);

drop policy if exists
  "employee hr details update"
on public.employee_hr_details;

create policy
  "employee hr details update"
on public.employee_hr_details
for update
to authenticated
using (
  (id = auth.uid() and submitted_at is null)
  or public.has_workspace_role(array['hr','admin'])
)
with check (
  id = auth.uid()
  or public.has_workspace_role(array['hr','admin'])
);

commit;
