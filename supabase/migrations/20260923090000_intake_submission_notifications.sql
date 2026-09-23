-- ============================================================
-- RideArrivo Workspace: notify Support (and any other
-- workstation) when a new intake submission is routed to them,
-- not just when it appears on their workstation dashboard.
--
-- intake_prepare_submission() (see 20260906171000) already
-- resolves destination_workstation and, when the form has a
-- default_assignee_id, assigned_employee_id, on every insert.
-- Most public-site forms (bookings included) have no default
-- assignee, so most submissions land unassigned and would not
-- have triggered the existing single-recipient notification
-- pattern (notify_support_case_assignment and friends, see
-- 20260915093000) at all. This adds the missing coverage:
--
--   - unassigned submission  -> notify every active employee
--     currently assigned to that destination workstation
--   - submission with a default (or later manually set)
--     assignee -> notify that employee only, same as the
--     existing single-recipient triggers
--
-- Reuses the same public.notifications table + email dispatch
-- pipeline already in place, so this also emails Support the
-- same way support case / HR / incident assignments already
-- do.
-- ============================================================

begin;

-- Support a workstation-filtered lookup of active assignments.
create index if not exists
  idx_workstation_assignments_active_workstation
on public.workspace_workstation_assignments(workstation)
where active = true;

create or replace function public.notify_intake_submission_routed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body text;
begin
  v_title :=
    'New ' || new.category_title_snapshot || ' submission';

  v_body :=
    new.form_title_snapshot
    || case
         when nullif(btrim(new.source_reference), '') is not null
           then ' — ' || new.source_reference
         else ''
       end;

  if tg_op = 'INSERT' then
    if new.assigned_employee_id is not null then
      insert into public.notifications(
        user_id, type, title, body, entity_type, entity_id
      )
      values(
        new.assigned_employee_id,
        'intake_submission_assigned',
        'Assigned to you: ' || new.form_title_snapshot,
        v_body,
        'intake_submission',
        new.id
      );
    else
      insert into public.notifications(
        user_id, type, title, body, entity_type, entity_id
      )
      select
        a.employee_id,
        'intake_submission_received',
        v_title,
        v_body,
        'intake_submission',
        new.id
      from public.workspace_workstation_assignments a
      join public.employee_profiles p
        on p.id = a.employee_id
      where a.workstation = new.destination_workstation
        and a.active = true
        and p.active = true;
    end if;

    return new;
  end if;

  -- tg_op = 'UPDATE' of assigned_employee_id: a manager/admin
  -- (or the routing default) has assigned an until-now
  -- unassigned submission, or reassigned it. Notify the new
  -- assignee directly, same as support_cases/hr_requests do.
  if new.assigned_employee_id is not null
    and new.assigned_employee_id is distinct from old.assigned_employee_id
  then
    insert into public.notifications(
      user_id, type, title, body, entity_type, entity_id
    )
    values(
      new.assigned_employee_id,
      'intake_submission_assigned',
      'Assigned to you: ' || new.form_title_snapshot,
      v_body,
      'intake_submission',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists
  notify_intake_submission_routed
on public.intake_submissions;

create trigger
  notify_intake_submission_routed
after insert or update of assigned_employee_id
on public.intake_submissions
for each row
execute function public.notify_intake_submission_routed();

revoke all
on function public.notify_intake_submission_routed()
from public, anon, authenticated;

commit;
