-- Inactive accounts must not pass admin checks, read staff-only content or
-- register push endpoints that the server will call.
--
-- 1. current_workspace_role() returned NULL for a signed-in user without an
--    active employee profile (a pending signup or a revoked employee). Seven
--    SECURITY DEFINER admin functions guard themselves with
--        if public.current_workspace_role() <> 'admin' then raise ...
--    In SQL, NULL <> 'admin' is NULL, which IF treats as false, so the guard
--    was skipped and the function ran. The helper now returns 'inactive'
--    instead of NULL, so the comparison is true and the guard raises.
--    has_workspace_role() already wrapped the value in coalesce(..., false),
--    so role-list checks behave as before.
--
-- 2. Knowledge articles and the social-media bucket were readable by any
--    signed-in user, including pending and revoked accounts. They now need an
--    active employee profile.
--
-- 3. Any signed-in user could create a Room 7 calendar event, which the public
--    calendar feed then serves. Creating and updating now needs an active
--    employee profile.
--
-- 4. Push subscription endpoints are called by the server. They now have to be
--    https URLs on the known browser push services. The check is NOT VALID so
--    existing rows do not block the migration; it applies to new and changed
--    rows.

-- 1 -------------------------------------------------------------------------
create or replace function public.current_workspace_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select p.role
      from public.employee_profiles p
      where p.id = auth.uid()
        and p.active = true
      limit 1
    ),
    'inactive'
  );
$$;

grant execute on function public.current_workspace_role() to authenticated;

-- 2 -------------------------------------------------------------------------
alter policy "knowledge articles read published"
on public.workspace_knowledge_articles
using (
  (status = 'published' and public.is_active_employee())
  or public.has_workspace_role(array['hr', 'admin', 'legal'])
);

alter policy "social media employee read"
on storage.objects
using (
  bucket_id = 'social-media'
  and public.is_active_employee()
);

alter policy "social media upload own"
on storage.objects
with check (
  bucket_id = 'social-media'
  and public.is_active_employee()
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 3 -------------------------------------------------------------------------
alter policy room7_calendar_events_create
on public.room7_calendar_events
with check (
  created_by = auth.uid()
  and public.is_active_employee()
);

alter policy room7_calendar_events_update
on public.room7_calendar_events
using (
  public.is_active_employee()
  and (
    created_by = auth.uid()
    or public.has_workspace_role(array['manager', 'admin'])
  )
);

-- 4 -------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_subscriptions_endpoint_known_host'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_endpoint_known_host
      check (
        endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)/'
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'support_push_subscriptions_endpoint_known_host'
  ) then
    alter table public.support_push_subscriptions
      add constraint support_push_subscriptions_endpoint_known_host
      check (
        endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)/'
      ) not valid;
  end if;
end $$;
