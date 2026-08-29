begin;

-- Employees may view reduced, watermarked preview derivatives while originals stay
-- behind the existing Admin download-approval policies.
alter table public.workspace_files add column if not exists preview_path text;
alter table public.brand_assets add column if not exists preview_path text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'workspace-previews',
  'workspace-previews',
  false,
  5242880,
  array['image/webp']::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "workspace previews active employee read" on storage.objects;
drop policy if exists "workspace previews approved uploader insert" on storage.objects;
drop policy if exists "workspace previews approved uploader update" on storage.objects;
drop policy if exists "workspace previews approved uploader delete" on storage.objects;

create policy "workspace previews active employee read"
on storage.objects
for select
to authenticated
using (
  bucket_id='workspace-previews'
  and exists(
    select 1
    from public.employee_profiles ep
    where ep.id=auth.uid() and ep.active=true
  )
);

create policy "workspace previews approved uploader insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id='workspace-previews'
  and (
    (
      (storage.foldername(name))[1]='company'
      and public.can_upload_company_files()
    )
    or
    (
      (storage.foldername(name))[1]='brand'
      and exists(
        select 1
        from public.employee_profiles ep
        where ep.id=auth.uid()
          and ep.active=true
          and ep.role in ('marketing','manager','admin')
      )
    )
  )
);

create policy "workspace previews approved uploader update"
on storage.objects
for update
to authenticated
using (
  bucket_id='workspace-previews'
  and (
    ((storage.foldername(name))[1]='company' and public.can_upload_company_files())
    or
    ((storage.foldername(name))[1]='brand' and exists(
      select 1 from public.employee_profiles ep
      where ep.id=auth.uid() and ep.active=true and ep.role in ('marketing','manager','admin')
    ))
  )
)
with check (
  bucket_id='workspace-previews'
  and (
    ((storage.foldername(name))[1]='company' and public.can_upload_company_files())
    or
    ((storage.foldername(name))[1]='brand' and exists(
      select 1 from public.employee_profiles ep
      where ep.id=auth.uid() and ep.active=true and ep.role in ('marketing','manager','admin')
    ))
  )
);

create policy "workspace previews approved uploader delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id='workspace-previews'
  and (
    ((storage.foldername(name))[1]='company' and public.can_upload_company_files())
    or
    ((storage.foldername(name))[1]='brand' and exists(
      select 1 from public.employee_profiles ep
      where ep.id=auth.uid() and ep.active=true and ep.role in ('marketing','manager','admin')
    ))
  )
);

-- The catalog exposes preview_path, never the protected original storage location.
drop function if exists public.list_workspace_files();
create function public.list_workspace_files()
returns table (
  id text,
  name text,
  description text,
  provider text,
  folder_path text,
  department text,
  file_type text,
  size_bytes bigint,
  preview_path text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path=public
as $$
  select
    wf.id::text,
    wf.name,
    wf.description,
    wf.provider,
    wf.folder_path,
    wf.department,
    wf.file_type,
    wf.size_bytes,
    wf.preview_path,
    wf.created_at
  from public.workspace_files wf
  where wf.is_active=true
    and exists(
      select 1
      from public.employee_profiles ep
      where ep.id=auth.uid() and ep.active=true
    )
  order by wf.created_at desc;
$$;

grant execute on function public.list_workspace_files() to authenticated;

commit;
