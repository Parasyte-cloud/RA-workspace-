-- ============================================================
-- Reusable Intake Platform
-- Assignment / destination-workstation authorization hardening
-- ============================================================

-- An assignment must never create workstation access by itself.
--
-- Manager and Admin remain globally eligible because the intake
-- authorization model already grants those roles global oversight.
--
-- Other employees require an active explicit workstation assignment.

create or replace function public.intake_employee_can_receive_route(
  p_employee_id uuid,
  p_workstation text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.employee_profiles ep
      where ep.id = p_employee_id
        and ep.active = true
        and (
          ep.role in ('manager', 'admin')
          or exists (
            select 1
            from public.workspace_workstation_assignments a
            where a.employee_id = ep.id
              and a.active = true
              and a.workstation =
                lower(
                  btrim(
                    coalesce(
                      p_workstation,
                      ''
                    )
                  )
                )
          )
        )
    ),
    false
  );
$$;

revoke all
on function public.intake_employee_can_receive_route(uuid, text)
from public, anon, authenticated;


-- ------------------------------------------------------------
-- Harden route access.
--
-- Direct assignment is no longer an authorization bypass.
-- A directly assigned employee must still be eligible for the
-- destination workstation.
-- ------------------------------------------------------------

create or replace function public.can_access_intake_route(
  p_workstation text,
  p_assignee uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.intake_is_active_employee()
    and (
      public.current_workspace_role()
        in ('manager', 'admin')

      or public.has_workstation_access(
        array[
          lower(
            btrim(
              coalesce(
                p_workstation,
                ''
              )
            )
          )
        ]
      )

      or (
        auth.uid() = p_assignee
        and public.intake_employee_can_receive_route(
          p_assignee,
          p_workstation
        )
      )
    ),
    false
  );
$$;

revoke all
on function public.can_access_intake_route(text, uuid)
from public, anon;

grant execute
on function public.can_access_intake_route(text, uuid)
to authenticated;


-- ------------------------------------------------------------
-- Prevent invalid form defaults.
--
-- A form default assignee must be active and eligible for the
-- form's destination workstation.
-- ------------------------------------------------------------

create or replace function public.intake_enforce_form_default_assignee_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.default_assignee_id is not null
    and not public.intake_employee_can_receive_route(
      new.default_assignee_id,
      new.destination_workstation
    )
  then
    raise exception
      'Intake form default assignee must be eligible for the destination workstation'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all
on function public.intake_enforce_form_default_assignee_route()
from public, anon, authenticated;

drop trigger if exists
  intake_forms_default_assignee_route_guard
on public.intake_forms;

create trigger intake_forms_default_assignee_route_guard
before insert
  or update of default_assignee_id, destination_workstation
on public.intake_forms
for each row
execute function public.intake_enforce_form_default_assignee_route();


-- ------------------------------------------------------------
-- Final submission-level enforcement.
--
-- UPDATE:
-- Reject an assignee outside the destination workstation.
--
-- INSERT:
-- The existing preparation trigger resolves the form's default
-- assignee first. If a legacy form contains an invalid default,
-- fail closed by leaving the new submission unassigned.
--
-- The zz_ prefix ensures this BEFORE trigger runs after the
-- existing intake submission preparation trigger.
-- ------------------------------------------------------------

create or replace function public.intake_enforce_submission_assignee_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.assigned_employee_id
      is not distinct from old.assigned_employee_id
  then
    return new;
  end if;

  if public.intake_employee_can_receive_route(
    new.assigned_employee_id,
    new.destination_workstation
  )
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.assigned_employee_id := null;
    return new;
  end if;

  raise exception
    'Intake submission assignee must be eligible for the destination workstation'
    using errcode = '42501';
end;
$$;

revoke all
on function public.intake_enforce_submission_assignee_route()
from public, anon, authenticated;

drop trigger if exists
  zz_intake_submissions_assignee_route_guard
on public.intake_submissions;

create trigger zz_intake_submissions_assignee_route_guard
before insert
  or update of assigned_employee_id
on public.intake_submissions
for each row
execute function public.intake_enforce_submission_assignee_route();
