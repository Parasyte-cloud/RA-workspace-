-- Let people who are assigned to the Operations workstation use the Vendors
-- module, not only people whose role is operations, finance or admin.
-- Safe to run twice.
--
-- Why: the workspace already lets an explicit workstation assignment grant the
-- department capability (see has_workstation_access and has_workspace_role).
-- The Vendors module skipped that and checked the role only, so a manager who
-- runs Operations could open the Operations workstation but not Vendors.
--
-- Every vendor table policy goes through can_manage_vendors(), so changing
-- this one function is the whole database change. Finance still comes in by
-- role only, and the vendor audit trail stays admin only.

create or replace function public.can_manage_vendors()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_workspace_role() in ('operations', 'finance', 'admin'),
    false
  )
  or public.has_workstation_access(array['operations']);
$$;

revoke all on function public.can_manage_vendors() from public, anon;
grant execute on function public.can_manage_vendors() to authenticated;
