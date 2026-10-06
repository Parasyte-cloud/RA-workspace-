-- The "admins manage employee profiles" policy lets the hr role update any
-- employee_profiles row, including the role column. An HR user could call the
-- API directly and set their own role (or anyone's) to admin.
-- This trigger lets only admins change role or create a profile with a
-- privileged role. Service-role calls (edge functions, auth.uid() is null)
-- and the database owner are unaffected. Safe to run twice.

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

drop trigger if exists employee_profiles_role_guard on public.employee_profiles;
create trigger employee_profiles_role_guard
before insert or update on public.employee_profiles
for each row execute function public.guard_employee_profile_role();
