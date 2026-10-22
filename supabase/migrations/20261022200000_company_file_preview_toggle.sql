-- Company Files: let admin and legal show or hide ONE file's preview.
--
-- WHY THIS EXISTS
-- The table workspace_files has SELECT revoked from the signed-in role on
-- purpose (people read the catalogue through list_workspace_files(), which
-- hides the protected storage path). Postgres also needs SELECT on any column
-- used in an UPDATE ... WHERE clause, so the browser's
--   update workspace_files set preview_path = null where id = ...
-- fails with "permission denied" even for an admin. Insert worked because it
-- has no WHERE clause.
--
-- This function does that one update on the caller's behalf, after checking
-- that the caller is an active admin or legal user. It can only set the
-- preview path to the fixed value for that file, or clear it. It cannot touch
-- any other column, so it cannot expose the protected original.

create or replace function public.set_company_file_preview(target_file uuid, show_preview boolean)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  new_path text;
begin
  if not public.can_upload_company_files() then
    raise exception 'Only admin or legal can change previews' using errcode='42501';
  end if;
  new_path := case when show_preview then 'company/'||target_file::text||'/preview.webp' else null end;
  update public.workspace_files
     set preview_path=new_path, updated_at=now()
   where id=target_file;
  if not found then
    raise exception 'File not found' using errcode='P0002';
  end if;
  return new_path;
end;
$$;

revoke all on function public.set_company_file_preview(uuid,boolean) from public;
grant execute on function public.set_company_file_preview(uuid,boolean) to authenticated;
