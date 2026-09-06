begin;

-- The workstation guide is an internal company document that every active
-- RideArrivo employee may read. It is deliberately separate from Company
-- Files because Company Files originals require explicit download approval.
--
-- The logical path stays stable. Replacing this one object updates the guide
-- everywhere without changing dashboard code.

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values(
  'workstation-guides',
  'workstation-guides',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists
  "workstation guide active employee read"
on storage.objects;

create policy
  "workstation guide active employee read"
on storage.objects
for select
to authenticated
using (
  bucket_id='workstation-guides'
  and name='canonical/readme.pdf'
  and exists(
    select 1
    from public.employee_profiles ep
    where ep.id=auth.uid()
      and ep.active=true
  )
);

drop policy if exists
  "workstation guide legal admin insert"
on storage.objects;

create policy
  "workstation guide legal admin insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id='workstation-guides'
  and name='canonical/readme.pdf'
  and public.can_upload_company_files()
);

drop policy if exists
  "workstation guide legal admin update"
on storage.objects;

create policy
  "workstation guide legal admin update"
on storage.objects
for update
to authenticated
using (
  bucket_id='workstation-guides'
  and name='canonical/readme.pdf'
  and public.can_upload_company_files()
)
with check (
  bucket_id='workstation-guides'
  and name='canonical/readme.pdf'
  and public.can_upload_company_files()
);

drop policy if exists
  "workstation guide legal admin delete"
on storage.objects;

create policy
  "workstation guide legal admin delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id='workstation-guides'
  and name='canonical/readme.pdf'
  and public.can_upload_company_files()
);

commit;
