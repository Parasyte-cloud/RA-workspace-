-- Archive: one shared place where every employee can upload and find files.
--
-- Rules (agreed with the owner):
--   * Every active employee can upload and download.
--   * Visibility per file: company (default), my department, or only me.
--   * The uploader and administrators can edit or delete a file. Delete moves it
--     to a bin for 30 days; the app clears older bin items when someone who can
--     delete them opens the bin.
--   * Files live in a PRIVATE bucket, 'archive'. Nobody reads a file except
--     through a short-lived signed link, and the storage rules below only allow
--     that for files the person can see in the table.
--
-- This is separate from Company Files (Legal and Admin upload, approval needed
-- to download). Nothing there changes.
--
-- Run it BEFORE the matching app release. Safe to run twice.

begin;

create table if not exists public.archive_files (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (description is null or char_length(description) <= 1000),
  folder text not null default 'General' check (char_length(btrim(folder)) between 1 and 60 and folder !~ '[/\\]'),
  storage_path text not null unique check (char_length(storage_path) between 10 and 600),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  uploaded_by uuid references public.employee_profiles(id) on delete set null,
  visibility text not null default 'company' check (visibility in ('company', 'department', 'private')),
  department text,
  deleted_at timestamptz,
  deleted_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists archive_files_created_idx on public.archive_files(created_at desc);
create index if not exists archive_files_folder_idx on public.archive_files(folder);
create index if not exists archive_files_uploader_idx on public.archive_files(uploaded_by);

alter table public.archive_files enable row level security;
revoke all on public.archive_files from public, anon;
grant select, insert, update, delete on public.archive_files to authenticated;
grant all on public.archive_files to service_role;

-- Who may see a file that is not in the bin.
create or replace function public.archive_can_see(p_uploader uuid, p_visibility text, p_department text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employee_profiles me
    where me.id = auth.uid() and me.active = true
      and (
        p_uploader = me.id
        or me.role = 'admin'
        or p_visibility = 'company'
        or (p_visibility = 'department' and p_department is not null and p_department <> 'Unassigned' and p_department = me.department)
      )
  );
$$;

create or replace function public.archive_can_manage(p_uploader uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employee_profiles me
    where me.id = auth.uid() and me.active = true
      and (p_uploader = me.id or me.role = 'admin')
  );
$$;

revoke all on function public.archive_can_see(uuid, text, text) from public, anon;
revoke all on function public.archive_can_manage(uuid) from public, anon;
grant execute on function public.archive_can_see(uuid, text, text) to authenticated;
grant execute on function public.archive_can_manage(uuid) to authenticated;

drop policy if exists archive_files_select on public.archive_files;
create policy archive_files_select on public.archive_files
  for select to authenticated
  using (
    case
      when deleted_at is null then public.archive_can_see(uploaded_by, visibility, department)
      else public.archive_can_manage(uploaded_by)   -- the bin is for the owner and admins only
    end
  );

drop policy if exists archive_files_insert on public.archive_files;
create policy archive_files_insert on public.archive_files
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and deleted_at is null
    and public.archive_can_manage(auth.uid())
    and split_part(storage_path, '/', 1) = auth.uid()::text
  );

drop policy if exists archive_files_update on public.archive_files;
create policy archive_files_update on public.archive_files
  for update to authenticated
  using (public.archive_can_manage(uploaded_by))
  with check (public.archive_can_manage(uploaded_by));

-- Only an item already in the bin can be removed for good.
drop policy if exists archive_files_delete on public.archive_files;
create policy archive_files_delete on public.archive_files
  for delete to authenticated
  using (deleted_at is not null and public.archive_can_manage(uploaded_by));

-- Keeps a few things honest whatever the app sends.
create or replace function public.archive_files_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.name := btrim(new.name);
    new.folder := btrim(new.folder);
    -- The department is copied from the uploader, never typed by the client.
    select ep.department into new.department from public.employee_profiles ep where ep.id = new.uploaded_by;
    return new;
  end if;

  if new.uploaded_by is distinct from old.uploaded_by
     or new.storage_path is distinct from old.storage_path
     or new.size_bytes is distinct from old.size_bytes
     or new.mime_type is distinct from old.mime_type
     or new.department is distinct from old.department
     or new.created_at is distinct from old.created_at then
    raise exception 'That part of a file cannot be changed';
  end if;

  new.name := btrim(new.name);
  new.folder := btrim(new.folder);
  new.updated_at := now();

  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := auth.uid();
  elsif new.deleted_at is null and old.deleted_at is not null then
    new.deleted_by := null;
  end if;
  return new;
end;
$$;

revoke all on function public.archive_files_guard() from public, anon, authenticated;

drop trigger if exists archive_files_guard_trg on public.archive_files;
create trigger archive_files_guard_trg
  before insert or update on public.archive_files
  for each row execute function public.archive_files_guard();

-- The list the page shows: everything visible, with the uploader's name.
drop function if exists public.list_archive_files(boolean);
create function public.list_archive_files(p_bin boolean default false)
returns table (
  id uuid,
  name text,
  description text,
  folder text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  visibility text,
  uploaded_by uuid,
  uploader_name text,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  can_manage boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.id, f.name, f.description, f.folder, f.storage_path, f.mime_type, f.size_bytes, f.visibility,
         f.uploaded_by,
         coalesce(nullif(btrim(u.full_name), ''), 'Former employee') as uploader_name,
         f.deleted_at, f.created_at, f.updated_at,
         public.archive_can_manage(f.uploaded_by) as can_manage
  from public.archive_files f
  left join public.employee_profiles u on u.id = f.uploaded_by
  where case
          when p_bin then f.deleted_at is not null and public.archive_can_manage(f.uploaded_by)
          else f.deleted_at is null and public.archive_can_see(f.uploaded_by, f.visibility, f.department)
        end
  order by f.created_at desc
  limit 2000;
$$;

revoke all on function public.list_archive_files(boolean) from public, anon;
grant execute on function public.list_archive_files(boolean) to authenticated;

-- The private bucket ---------------------------------------------------
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'archive',
  'archive',
  false,
  52428800,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/rtf',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Read: only a file the person can see (the subquery runs under their own rules).
drop policy if exists "archive read" on storage.objects;
create policy "archive read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'archive'
  and exists (select 1 from public.archive_files f where f.storage_path = storage.objects.name)
);

-- Upload: into your own folder only.
drop policy if exists "archive upload" on storage.objects;
create policy "archive upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'archive'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.archive_can_manage(auth.uid())
);

-- Remove: a file that is in the bin (owner or admin), or a leftover from a
-- failed upload that has no row (own folder only).
drop policy if exists "archive remove" on storage.objects;
create policy "archive remove"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'archive'
  and (
    exists (
      select 1 from public.archive_files f
      where f.storage_path = storage.objects.name
        and f.deleted_at is not null
        and public.archive_can_manage(f.uploaded_by)
    )
    or (
      split_part(name, '/', 1) = auth.uid()::text
      and not exists (select 1 from public.archive_files f where f.storage_path = storage.objects.name)
    )
  )
);

commit;
