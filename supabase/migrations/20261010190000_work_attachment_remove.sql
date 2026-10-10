-- ============================================================
-- Remove a task attachment
--
-- Until now an attachment could be added but never removed: the
-- storage bucket allowed the uploader or a manager/admin to delete
-- the file, but public.work_item_attachments had no DELETE grant or
-- policy and the task screen had no button, so a wrong upload stayed
-- on the task for good.
--
-- This adds one function, in the same style as remove_work_assignee:
--   * the uploader, or a manager/admin, may remove an attachment
--   * the person must be able to read the work item
--   * the removal is written to work_item_activity (who, which file,
--     how big, who uploaded it), so removing evidence leaves a trace
--   * it returns the storage path so the app can delete the file
--     itself under the existing storage delete policy
--
-- Direct DELETE on the table stays closed on purpose.
-- ============================================================

begin;

create or replace function public.remove_work_attachment(
  target_attachment uuid
)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid;
  att record;
begin
  actor := auth.uid();

  if actor is null then
    raise exception 'Not signed in';
  end if;

  select
    id,
    work_item_id,
    uploaded_by,
    file_name,
    file_size,
    storage_path
  into att
  from public.work_item_attachments
  where id = target_attachment;

  if not found then
    raise exception 'Attachment not found';
  end if;

  if not public.can_read_work_item(att.work_item_id) then
    raise exception 'You cannot access this work item';
  end if;

  if not (
    att.uploaded_by = actor
    or public.has_workspace_role(
      array['manager','admin']
    )
  ) then
    raise exception
      'Only the person who uploaded this file, or a manager, can remove it';
  end if;

  delete from public.work_item_attachments
  where id = target_attachment;

  insert into public.work_item_activity(
    work_item_id,
    actor_id,
    action,
    metadata
  )
  values(
    att.work_item_id,
    actor,
    'attachment_removed',
    jsonb_build_object(
      'attachment_id', att.id,
      'file_name', att.file_name,
      'file_size', att.file_size,
      'uploaded_by', att.uploaded_by
    )
  );

  return att.storage_path;
end;
$$;

revoke all
on function public.remove_work_attachment(uuid)
from public;

grant execute
on function public.remove_work_attachment(uuid)
to authenticated;

commit;
