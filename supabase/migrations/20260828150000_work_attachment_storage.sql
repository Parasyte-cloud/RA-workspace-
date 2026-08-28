-- ============================================================
-- RideArrivo Work Attachment Storage
-- Private task files with RLS-backed access
-- ============================================================

begin;

-- ------------------------------------------------------------
-- PRIVATE BUCKET
-- ------------------------------------------------------------

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit
)
values(
  'work-attachments',
  'work-attachments',
  false,
  15728640
)
on conflict(id)
do update set
  public = false,
  file_size_limit = 15728640;


-- Path format:
--
--   <work_item_uuid>/<uploader_uuid>/<filename>
--
-- Example:
--   abc-task-id/employee-id/receipt.pdf
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- READ
-- User may read a file only when they can read its work item.
-- ------------------------------------------------------------

drop policy if exists
  "work attachments storage read"
on storage.objects;

create policy "work attachments storage read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'work-attachments'

  and public.can_read_work_item(
    (
      storage.foldername(name)
    )[1]::uuid
  )
);


-- ------------------------------------------------------------
-- UPLOAD
-- Must:
-- 1. belong to work-attachments bucket
-- 2. reference accessible work item
-- 3. store uploader UUID as second directory
-- ------------------------------------------------------------

drop policy if exists
  "work attachments storage create"
on storage.objects;

create policy "work attachments storage create"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'work-attachments'

  and public.can_read_work_item(
    (
      storage.foldername(name)
    )[1]::uuid
  )

  and (
    storage.foldername(name)
  )[2] = auth.uid()::text
);


-- ------------------------------------------------------------
-- DELETE
-- Uploader may delete their own file.
-- Manager/Admin may also delete.
-- ------------------------------------------------------------

drop policy if exists
  "work attachments storage delete"
on storage.objects;

create policy "work attachments storage delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'work-attachments'

  and (
    (
      storage.foldername(name)
    )[2] = auth.uid()::text

    or public.has_workspace_role(
      array['manager','admin']
    )
  )

  and public.can_read_work_item(
    (
      storage.foldername(name)
    )[1]::uuid
  )
);

commit;
