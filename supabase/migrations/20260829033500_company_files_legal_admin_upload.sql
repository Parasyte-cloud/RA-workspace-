begin;

create table if not exists public.workspace_files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  provider text not null default 'supabase',
  provider_url text,
  storage_path text,
  folder_path text,
  department text,
  file_type text,
  size_bytes bigint,
  uploaded_by uuid references public.employee_profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_files add column if not exists description text;
alter table public.workspace_files add column if not exists provider text not null default 'supabase';
alter table public.workspace_files add column if not exists provider_url text;
alter table public.workspace_files add column if not exists storage_path text;
alter table public.workspace_files add column if not exists folder_path text;
alter table public.workspace_files add column if not exists department text;
alter table public.workspace_files add column if not exists file_type text;
alter table public.workspace_files add column if not exists size_bytes bigint;
alter table public.workspace_files add column if not exists uploaded_by uuid references public.employee_profiles(id) on delete set null;
alter table public.workspace_files add column if not exists is_active boolean not null default true;
alter table public.workspace_files add column if not exists created_at timestamptz not null default now();
alter table public.workspace_files add column if not exists updated_at timestamptz not null default now();

create index if not exists workspace_files_created_idx on public.workspace_files(created_at desc);
create index if not exists workspace_files_department_idx on public.workspace_files(department);

alter table public.workspace_files enable row level security;

create or replace function public.can_upload_company_files()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.employee_profiles ep
    where ep.id=auth.uid()
      and ep.active=true
      and ep.role in ('legal','admin')
  );
$$;

grant execute on function public.can_upload_company_files() to authenticated;

drop policy if exists "company files read" on public.workspace_files;
drop policy if exists "company files legal admin insert" on public.workspace_files;
drop policy if exists "company files legal admin update" on public.workspace_files;
drop policy if exists "company files legal admin delete" on public.workspace_files;

create policy "company files read"
on public.workspace_files
for select
to authenticated
using (
  is_active=true
  and exists(
    select 1 from public.employee_profiles ep
    where ep.id=auth.uid() and ep.active=true
  )
);

create policy "company files legal admin insert"
on public.workspace_files
for insert
to authenticated
with check (
  public.can_upload_company_files()
  and uploaded_by=auth.uid()
);

create policy "company files legal admin update"
on public.workspace_files
for update
to authenticated
using (public.can_upload_company_files())
with check (public.can_upload_company_files());

create policy "company files legal admin delete"
on public.workspace_files
for delete
to authenticated
using (public.can_upload_company_files());

-- Employees must use the safe catalog RPC; the base table contains protected locations.
revoke all on public.workspace_files from anon;
revoke select,insert,update,delete on public.workspace_files from authenticated;
grant insert,update,delete on public.workspace_files to authenticated;

create or replace function public.list_workspace_files()
returns table (
  id text,
  name text,
  description text,
  provider text,
  folder_path text,
  department text,
  file_type text,
  size_bytes bigint,
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
    wf.created_at
  from public.workspace_files wf
  where wf.is_active=true
    and exists(
      select 1 from public.employee_profiles ep
      where ep.id=auth.uid() and ep.active=true
    )
  order by wf.created_at desc;
$$;

grant execute on function public.list_workspace_files() to authenticated;

create or replace function public.get_workspace_file_download_location(p_file_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  result jsonb;
begin
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
  where wf.id::text=p_file_id and wf.is_active=true;

  if result is null then
    raise exception 'Company file not found';
  end if;

  return result;
end;
$$;

grant execute on function public.get_workspace_file_download_location(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'company-files',
  'company-files',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/zip'
  ]::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "company files storage legal admin insert" on storage.objects;
drop policy if exists "company files storage approved read" on storage.objects;
drop policy if exists "company files storage legal admin update" on storage.objects;
drop policy if exists "company files storage legal admin delete" on storage.objects;

create policy "company files storage legal admin insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id='company-files'
  and public.can_upload_company_files()
);

create policy "company files storage approved read"
on storage.objects
for select
to authenticated
using (
  bucket_id='company-files'
  and (
    public.is_workspace_admin()
    or public.has_workspace_download_access(
      'company_file',
      (storage.foldername(name))[1]
    )
  )
);

create policy "company files storage legal admin update"
on storage.objects
for update
to authenticated
using (bucket_id='company-files' and public.can_upload_company_files())
with check (bucket_id='company-files' and public.can_upload_company_files());

create policy "company files storage legal admin delete"
on storage.objects
for delete
to authenticated
using (bucket_id='company-files' and public.can_upload_company_files());

commit;
