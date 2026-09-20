-- ============================================================
-- Employee HR details: enter-once, then locked to the employee
--
-- People & HR collects contact info (My Profile), a date of
-- birth and KYC document uploads, but there was nowhere for an
-- employee to record standard HR biodata (home address, state
-- of origin, marital status, next of kin, bank/statutory IDs
-- for payroll). Requested behaviour: every employee can see and
-- fill this in themselves, but once submitted the whole form
-- locks for them - only HR, a manager or an admin can change it
-- after that.
--
-- One row per employee, keyed by employee_profiles.id.
-- submitted_at is the lock: null means the employee can still
-- edit every field (including setting submitted_at itself, once,
-- to lock it); once it is set, the "self" half of the update
-- policy's USING clause stops matching, so only hr/manager/admin
-- can update the row from then on. Read access is the employee's
-- own row, or hr/manager/admin for any row (they need to see it
-- to act on it).
-- ============================================================

begin;

create table if not exists public.employee_hr_details(
  id uuid primary key references public.employee_profiles(id) on delete cascade,

  home_address text,
  state_of_origin text,
  marital_status text
    check (marital_status in ('single','married','divorced','widowed')),

  next_of_kin_name text,
  next_of_kin_relationship text,
  next_of_kin_phone text,

  bank_name text,
  bank_account_number text,
  bvn text,
  tax_identification_number text,
  pension_pin text,

  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.employee_hr_details
  enable row level security;

revoke all
on public.employee_hr_details
from anon;

grant select, insert, update
on public.employee_hr_details
to authenticated;

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
  or public.has_workspace_role(array['hr','manager','admin'])
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
  or public.has_workspace_role(array['hr','manager','admin'])
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
  or public.has_workspace_role(array['hr','manager','admin'])
)
with check (
  id = auth.uid()
  or public.has_workspace_role(array['hr','manager','admin'])
);

create or replace function
public.set_employee_hr_details_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists
  employee_hr_details_updated_at
on public.employee_hr_details;

create trigger
  employee_hr_details_updated_at
before update
on public.employee_hr_details
for each row
execute function public.set_employee_hr_details_updated_at();

commit;
