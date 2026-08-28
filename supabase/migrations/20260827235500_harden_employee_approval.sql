begin;

alter table public.employee_profiles
  alter column active set default false;

create or replace function
public.handle_new_workspace_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  domain text;
begin
  domain :=
    lower(
      split_part(
        coalesce(new.email,''),
        '@',
        2
      )
    );

  if domain <> 'ridearrivo.com' then
    raise exception
      'Only RideArrivo company email accounts are allowed';
  end if;

  insert into public.employee_profiles(
    id,
    full_name,
    email,
    active
  )
  values(
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      ''
    ),
    lower(new.email),
    false
  )
  on conflict(id) do nothing;

  return new;
end;
$$;

drop policy if exists
  "employees read directory"
  on public.employee_profiles;

create policy
  "employees read directory"
on public.employee_profiles
for select
to authenticated
using(
  id=auth.uid()
  or active=true
);

commit;
