-- Two hardening fixes from the 6 Oct 2026 audit. Safe to run twice.
--
-- 1. The role guard stopped anyone but an admin changing a role, but a non
--    admin (HR included) could still edit their OWN active, department and
--    manager_id columns through the API. Department and manager feed access
--    decisions elsewhere, so a person must not be able to move themselves.
--    HR can still manage other people's profiles; admins and the service
--    role are unaffected.
--
-- 2. Audit tables should be append only. The blanket service role grant gave
--    update, delete and truncate on every table, and the original baseline
--    gave the same to signed in users on workspace_audit_log. Row level
--    security hides those rows from most people, but a trail that can be
--    edited is not evidence. Only inserts and reads remain.

create or replace function public.guard_employee_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  caller_role text;
begin
  if caller is null then
    return new;
  end if;

  select lower(role) into caller_role
  from public.employee_profiles
  where id = caller and active = true;

  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role and coalesce(caller_role, '') <> 'admin' then
      raise exception 'Only an administrator can change a role.' using errcode = '42501';
    end if;
    if old.id = caller
       and coalesce(caller_role, '') <> 'admin'
       and (new.active is distinct from old.active
            or new.department is distinct from old.department
            or new.manager_id is distinct from old.manager_id) then
      raise exception 'You cannot change your own status, department or manager.' using errcode = '42501';
    end if;
  elsif tg_op = 'INSERT' then
    if lower(coalesce(new.role, 'employee')) in ('admin', 'manager', 'cto', 'hr', 'finance', 'legal')
       and coalesce(caller_role, '') <> 'admin'
       and new.id is distinct from caller then
      raise exception 'Only an administrator can create a privileged profile.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_employee_profile_role() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_audit_log',
    'workspace_audit_log',
    'legal_law_report_audit',
    'operations_receipt_audit',
    'marketing_wallet_audit_events',
    'zoho_mail_audit_events'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke update, delete, truncate on public.%I from service_role', t);
      execute format('revoke update, delete, truncate on public.%I from authenticated', t);
    end if;
  end loop;
end $$;
