begin;

-- ============================================================
-- Per-workstation guides
--
-- The workstation guide system originally served exactly one
-- shared PDF for the entire app (bucket path
-- 'canonical/readme.pdf'), because every workstation rendered
-- the same <WorkstationGuideCard/> with no way to tell it apart
-- from another. Every "Open Guide" button, on every department
-- workstation, opened the identical file.
--
-- The frontend now passes a workstation-specific slug (support,
-- operations, people, engineering, finance, marketing,
-- partnerships, legal, executive, linux) and stores/reads each
-- guide at '<slug>/readme.pdf'. The 'canonical/readme.pdf'
-- object keeps working unchanged for the two surfaces that still
-- intentionally use it (the personal dashboard and the
-- Administration control plane), and existing RLS already
-- protects it.
--
-- This migration only widens the object-name match from one
-- exact literal to any object that ends in '/readme.pdf', so the
-- same read/insert/update/delete policies now cover every
-- workstation's guide instead of just the single canonical one.
-- Nothing else about the access rules changes: read stays open to
-- every active employee, and insert/update/delete stay gated to
-- legal/admin via the existing can_upload_company_files() check.
-- ============================================================

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
  and name like '%/readme.pdf'
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
  and name like '%/readme.pdf'
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
  and name like '%/readme.pdf'
  and public.can_upload_company_files()
)
with check (
  bucket_id='workstation-guides'
  and name like '%/readme.pdf'
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
  and name like '%/readme.pdf'
  and public.can_upload_company_files()
);

commit;
