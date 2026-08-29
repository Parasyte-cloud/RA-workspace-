begin;

-- Company-wide files are visible to every active employee. Department files are
-- visible only to that department plus Legal/Manager/Admin custodians.
create or replace function public.can_view_workspace_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.workspace_files wf
    join public.employee_profiles ep on ep.id=auth.uid()
    where wf.id=p_file_id
      and wf.is_active=true
      and ep.active=true
      and (
        lower(coalesce(nullif(trim(wf.department),''),'company-wide')) in (
          'company-wide','company wide','general','general use','all'
        )
        or lower(trim(wf.department))=lower(trim(ep.department))
        or ep.role in ('legal','manager','admin')
      )
  );
$$;

grant execute on function public.can_view_workspace_file(uuid) to authenticated;

create or replace function public.can_view_workspace_file_key(p_file_id text)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  file_id uuid;
begin
  begin
    file_id:=trim(p_file_id)::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return public.can_view_workspace_file(file_id);
end;
$$;

grant execute on function public.can_view_workspace_file_key(text) to authenticated;

-- Defense in depth on the base table even though employees normally use the
-- safe catalog RPC rather than selecting protected storage locations directly.
drop policy if exists "company files read" on public.workspace_files;
create policy "company files read"
on public.workspace_files
for select
to authenticated
using (public.can_view_workspace_file(id));

-- Catalog contains only metadata/preview references the current employee is
-- entitled to see. It never returns the protected original storage path.
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
  where public.can_view_workspace_file(wf.id)
  order by wf.created_at desc;
$$;

grant execute on function public.list_workspace_files() to authenticated;

-- An employee may request a company-file download only for a file already
-- visible to that employee. This prevents guessed UUIDs from creating grants
-- for another department's private file.
create or replace function public.request_workspace_download(
  p_resource_type text,
  p_resource_key text,
  p_resource_name text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  request_id uuid;
  company_file_id uuid;
begin
  if not exists(select 1 from public.employee_profiles where id=auth.uid() and active=true) then
    raise exception 'Only active employees can request downloads';
  end if;

  if trim(p_resource_type)='company_file' then
    begin
      company_file_id:=trim(p_resource_key)::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid company file';
    end;

    if not public.can_view_workspace_file(company_file_id) then
      raise exception 'This company file is not available to your account';
    end if;
  end if;

  if public.has_workspace_download_access(p_resource_type,p_resource_key) then
    select id into request_id
    from public.workspace_download_requests
    where requester_id=auth.uid()
      and resource_type=p_resource_type
      and resource_key=p_resource_key
      and status='approved'
      and (grant_expires_at is null or grant_expires_at>now())
    order by reviewed_at desc nulls last
    limit 1;
    return request_id;
  end if;

  select id into request_id
  from public.workspace_download_requests
  where requester_id=auth.uid()
    and resource_type=p_resource_type
    and resource_key=p_resource_key
    and status='pending'
  limit 1;

  if request_id is not null then return request_id; end if;

  insert into public.workspace_download_requests(requester_id,resource_type,resource_key,resource_name,reason)
  values(auth.uid(),trim(p_resource_type),trim(p_resource_key),trim(p_resource_name),nullif(trim(coalesce(p_reason,'')),''))
  returning id into request_id;

  return request_id;
end;
$$;

grant execute on function public.request_workspace_download(text,text,text,text) to authenticated;

-- An old grant cannot outlive a later department/access change.
create or replace function public.get_workspace_file_download_location(p_file_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  result jsonb;
  file_id uuid;
begin
  begin
    file_id:=trim(p_file_id)::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid company file';
  end;

  if not public.is_workspace_admin() and not public.can_view_workspace_file(file_id) then
    raise exception 'This company file is not available to your account';
  end if;

  if not public.has_workspace_download_access('company_file',p_file_id) then
    raise exception 'Administrator approval is required before this file can be downloaded';
  end if;

  select jsonb_build_object(
    'provider',wf.provider,
    'provider_url',wf.provider_url,
    'storage_path',wf.storage_path
  )
  into result
  from public.workspace_files wf
  where wf.id=file_id and wf.is_active=true;

  if result is null then
    raise exception 'Company file not found';
  end if;

  return result;
end;
$$;

grant execute on function public.get_workspace_file_download_location(text) to authenticated;

-- Protect originals against stale grants after a role/department change.
drop policy if exists "company files storage approved read" on storage.objects;
create policy "company files storage approved read"
on storage.objects
for select
to authenticated
using (
  bucket_id='company-files'
  and (
    public.is_workspace_admin()
    or (
      public.can_view_workspace_file_key((storage.foldername(name))[1])
      and public.has_workspace_download_access(
        'company_file',
        (storage.foldername(name))[1]
      )
    )
  )
);

-- Brand previews are company-wide. Company-file previews follow the same
-- department visibility rule as the catalog. Preview derivatives remain safe
-- to view; they are never the protected original.
drop policy if exists "workspace previews active employee read" on storage.objects;
create policy "workspace previews active employee read"
on storage.objects
for select
to authenticated
using (
  bucket_id='workspace-previews'
  and exists(
    select 1
    from public.employee_profiles ep
    where ep.id=auth.uid()
      and ep.active=true
  )
  and (
    (storage.foldername(name))[1]='brand'
    or (
      (storage.foldername(name))[1]='company'
      and public.can_view_workspace_file_key((storage.foldername(name))[2])
    )
  )
);

commit;
