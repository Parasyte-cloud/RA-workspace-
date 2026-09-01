-- RideArrivo Operations company-wide work delegation.
--
-- Delegation authority and work-item visibility are intentionally separate.
--
-- Manager/Admin:
--   may assign work to any active employee.
--
-- Operations:
--   may assign work to any active employee.
--
-- CTO:
--   retains Engineering-only delegation authority.
--
-- Everybody else:
--   may assign work to themselves only.
--
-- create_work_assignment() and add_work_assignee() both continue to use
-- this function as the server-side authorization boundary.

create or replace function public.can_assign_work(
  target_user uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.employee_profiles me
    join public.employee_profiles target
      on target.id = target_user
    where
      me.id = auth.uid()
      and me.active = true
      and target.active = true
      and (
        me.role in (
          'manager',
          'admin',
          'operations'
        )
        or (
          me.role = 'cto'
          and (
            target.role in (
              'cto',
              'engineer'
            )
            or lower(
              coalesce(
                target.department,
                ''
              )
            ) = 'engineering'
          )
        )
        or target.id = me.id
      )
  );
$$;

revoke all
on function public.can_assign_work(uuid)
from public, anon;

grant execute
on function public.can_assign_work(uuid)
to authenticated;
