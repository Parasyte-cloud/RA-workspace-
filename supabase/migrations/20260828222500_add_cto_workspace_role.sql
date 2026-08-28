-- Keep the database role constraint aligned with the existing CTO workspace UI.

begin;

alter table public.employee_profiles
  drop constraint if exists employee_profiles_role_check;

alter table public.employee_profiles
  add constraint employee_profiles_role_check
  check (
    role in (
      'employee',
      'support',
      'engineer',
      'cto',
      'manager',
      'hr',
      'legal',
      'operations',
      'finance',
      'marketing',
      'partnerships',
      'admin'
    )
  );

commit;
