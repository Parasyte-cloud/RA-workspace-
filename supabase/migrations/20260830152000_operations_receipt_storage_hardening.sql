begin;

-- ============================================================
-- OPERATIONS RECEIPT STORAGE HARDENING
--
-- Required path format:
--   <auth-user-id>/<year>/<month>/<receipt-id>/<filename>
--
-- Example:
--   123e4567-e89b-12d3-a456-426614174000/2026/08/...
-- ============================================================


-- Replace the broad upload policy from the initial receipt
-- migration. Uploaders may write only inside their own folder.

drop policy if exists "operations receipts storage upload"
on storage.objects;

create policy "operations receipts storage upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'operations-receipts'

  and public.has_workspace_role(
    array['operations','finance','admin']
  )

  and split_part(name,'/',1) = auth.uid()::text
);


-- ============================================================
-- ORPHAN CLEANUP
--
-- If file upload succeeds but insertion of the corresponding
-- receipt database row fails, the uploader may remove that
-- unreferenced object.
--
-- Once storage_path is referenced by operations_receipts,
-- client-side deletion is denied.
-- ============================================================

drop policy if exists "operations receipts orphan cleanup"
on storage.objects;

create policy "operations receipts orphan cleanup"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'operations-receipts'

  and public.has_workspace_role(
    array['operations','finance','admin']
  )

  and split_part(name,'/',1) = auth.uid()::text

  and not exists (
    select 1
    from public.operations_receipts r
    where r.storage_path = storage.objects.name
  )
);


commit;
