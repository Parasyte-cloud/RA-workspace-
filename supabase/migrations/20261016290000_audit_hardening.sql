-- Audit hardening.
--
-- 1. The staff directory was readable by ANY signed-in user. The policy only
--    looked at the row (active = true), never at who is asking, so a pending
--    or unconfirmed account could read every active employee. It now also
--    requires the caller to be an active employee.
-- 2. Social, holiday, schedule and festival tables used using (true) for any
--    signed-in user. Same hole, same fix.
-- 3. The anon role held table privileges on public tables. RLS already stopped
--    it, but one forgotten policy would have exposed data. Take the grants
--    away and stop new tables inheriting them.
-- 4. KYC uploads and work attachments: only active employees may upload, and
--    work attachments get a file type allow-list.

-- 1. staff directory
drop policy if exists "employees read directory" on public.employee_profiles;
create policy "employees read directory"
on public.employee_profiles
for select
to authenticated
using (
  id = auth.uid()
  or (active = true and public.is_active_employee())
);

-- 2. broad read policies
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and cmd = 'SELECT'
      and qual = 'true'
      and roles::text like '%authenticated%'
  loop
    execute format(
      'alter policy %I on %I.%I using (public.is_active_employee())',
      p.policyname, p.schemaname, p.tablename
    );
  end loop;
end $$;

-- 3. anon grants
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- 4. uploads
drop policy if exists "kyc storage owner upload" on storage.objects;
create policy "kyc storage owner upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'employee-kyc-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active_employee()
);

update storage.buckets
set allowed_mime_types = array[
  'image/png','image/jpeg','image/webp','image/gif','application/pdf',
  'text/plain','text/csv','application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
where id = 'work-attachments' and allowed_mime_types is null;
