-- ============================================================
-- Reusable Intake Platform
-- Role-aware assignment candidate directory
-- ============================================================
--
-- Ordinary employees never need a company-wide candidate list:
-- they may only claim an unassigned submission for themselves.
--
-- Manager/Admin need a constrained directory containing only
-- employees eligible for the submission destination workstation.
-- ============================================================

create or replace function public.list_intake_assignment_candidates(
  p_workstation text
)
returns table (
  employee_id uuid,
  full_name text,
  job_title text,
  department text,
  employee_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workstation text :=
    lower(
      btrim(
        coalesce(
          p_workstation,
          ''
        )
      )
    );

  v_role text :=
    coalesce(
      public.current_workspace_role(),
      ''
    );
begin
  if v_workstation = '' then
    raise exception
      'Destination workstation is required'
      using errcode = '22023';
  end if;

  if not public.intake_is_active_employee()
    or v_role not in ('manager', 'admin')
  then
    raise exception
      'Only Management or Administration can list intake assignment candidates'
      using errcode = '42501';
  end if;

  return query
  select
    ep.id,
    ep.full_name,
    ep.job_title,
    ep.department,
    ep.role
  from public.employee_profiles ep
  where public.intake_employee_can_receive_route(
    ep.id,
    v_workstation
  )
  order by
    lower(ep.full_name),
    ep.id;
end;
$$;

revoke all
on function public.list_intake_assignment_candidates(text)
from public, anon, authenticated;

grant execute
on function public.list_intake_assignment_candidates(text)
to authenticated;
