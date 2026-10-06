-- employee_hr_details holds bank account numbers, BVN, tax IDs and pension
-- PINs. The original policies also allowed every user with the 'manager'
-- role to read and edit every employee's row, not just their own reports.
-- That is the same class of data the KYC documents table restricts to the
-- owner plus HR and admin, so this brings the table in line with it.
-- Safe to run twice: each policy is dropped and recreated.

begin;

drop policy if exists "employee hr details read" on public.employee_hr_details;
create policy "employee hr details read"
on public.employee_hr_details
for select to authenticated
using (
  id = auth.uid()
  or public.has_workspace_role(array['hr','admin'])
);

drop policy if exists "employee hr details insert" on public.employee_hr_details;
create policy "employee hr details insert"
on public.employee_hr_details
for insert to authenticated
with check (
  id = auth.uid()
  or public.has_workspace_role(array['hr','admin'])
);

drop policy if exists "employee hr details update" on public.employee_hr_details;
create policy "employee hr details update"
on public.employee_hr_details
for update to authenticated
using (
  (id = auth.uid() and submitted_at is null)
  or public.has_workspace_role(array['hr','admin'])
)
with check (
  id = auth.uid()
  or public.has_workspace_role(array['hr','admin'])
);

commit;
