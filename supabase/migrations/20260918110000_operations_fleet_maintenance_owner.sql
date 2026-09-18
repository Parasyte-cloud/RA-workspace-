-- ============================================================
-- Fleet maintenance ownership
--
-- Preparing the Operations workspace for more than one
-- operations person: operations_fleet_maintenance had no way
-- to say which operations employee is handling a given work
-- order, the same gap incidents and support_cases had before
-- the 2026-09-16 fix. Multiple operations staff can already
-- read/write every row ("operations os write" policy, for all
-- operations/manager/admin), so without an owner column two
-- people have no way to tell who is already chasing a vehicle
-- issue. Adds owner_id, matching the incidents/support_cases
-- pattern exactly.
-- ============================================================

begin;

alter table public.operations_fleet_maintenance
  add column if not exists owner_id uuid references public.employee_profiles(id) on delete set null;

create index if not exists idx_operations_fleet_maintenance_owner
on public.operations_fleet_maintenance(owner_id);

commit;
