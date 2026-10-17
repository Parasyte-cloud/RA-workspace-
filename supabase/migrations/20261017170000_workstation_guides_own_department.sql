-- Each person can read only their own workstation's README.
--
-- Before this, the read policy on the workstation-guides bucket let any active
-- employee read ANY '<slug>/readme.pdf'. The app only showed a person their own
-- guide, but the files themselves were readable by every signed-in employee
-- through the storage API. This ties read access to the same rule the app uses to
-- decide who can open a workstation page:
--
--   * the person's role is allowed on that workstation (sectionAccess in App.tsx), or
--   * they have an ACTIVE assignment to that workstation in
--     workspace_workstation_assignments.
--
-- 'canonical' is the general workspace guide and stays readable by every active
-- employee. Unknown slugs are readable by nobody. Administrators have access to
-- every workstation page already, so they can read every guide.
--
-- The table inside the function below must match sectionAccess in
-- src/App.tsx; scripts/workstation-guide-access.test.mjs fails if they drift.
begin;

create or replace function public.can_read_workstation_guide(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  my_role text;
  slug text;
  allowed boolean;
begin
  if me is null or p_object_name is null then
    return false;
  end if;

  -- Only '<slug>/readme.pdf' or '<slug>/readme-dark.pdf', one folder deep.
  if p_object_name !~ '^[a-z][a-z0-9-]{1,40}/readme(-dark)?\.pdf$' then
    return false;
  end if;
  slug := split_part(p_object_name, '/', 1);

  select lower(coalesce(role, '')) into my_role
  from public.employee_profiles
  where id = me and active = true;
  if not found then
    return false;
  end if;

  if slug = 'canonical' then
    return true;
  end if;

  select exists (
    select 1
    from (values
      ('support',        array['support','manager','admin'],            'support'),
      ('operations',     array['operations','manager','admin'],         'operations'),
      ('driver-guide',   array['operations','manager','admin'],         'operations'),
      ('people',         array['hr','operations','manager','admin'],    'people'),
      ('engineering',    array['engineer','cto','manager','admin'],     'engineering'),
      ('linux',          array['engineer','admin'],                     'engineering'),
      ('finance',        array['finance','manager','admin'],            'finance'),
      ('marketing',      array['marketing','manager','admin'],          'marketing'),
      ('partnerships',   array['partnerships','manager','admin'],       'partnerships'),
      ('legal',          array['legal','manager','admin'],              'legal'),
      ('executive',      array['manager','admin'],                      'executive'),
      ('administration', array['admin'],                                'administration')
    ) as g(guide_slug, roles, workstation)
    where g.guide_slug = slug
      and (
        my_role = any (g.roles)
        or exists (
          select 1 from public.workspace_workstation_assignments a
          where a.employee_id = me and a.active = true and a.workstation = g.workstation
        )
      )
  ) into allowed;

  return coalesce(allowed, false);
end;
$$;

revoke all on function public.can_read_workstation_guide(text) from public, anon;
grant execute on function public.can_read_workstation_guide(text) to authenticated;

drop policy if exists "workstation guide active employee read" on storage.objects;
drop policy if exists "workstation guide own workstation read" on storage.objects;

create policy "workstation guide own workstation read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'workstation-guides'
  and public.can_read_workstation_guide(name)
);

commit;
