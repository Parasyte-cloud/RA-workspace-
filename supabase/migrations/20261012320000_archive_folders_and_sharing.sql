-- Archive, part 2: folder limits per department, and links for people outside
-- the company.
--
-- Builds on 20261012310000_archive.sql (run that first).
--
--   * An administrator can limit a folder to chosen departments. A file in a
--     limited folder is seen only by those departments, its uploader and
--     administrators, whatever the file's own visibility says. The same rule
--     applies to uploading into the folder and moving a file into it.
--   * The uploader or an administrator can make a link that works without
--     signing in. It expires (1 to 30 days), can be revoked, dies with the file,
--     and only a hash of it is stored. The archive-share edge function serves it.
--
-- Safe to run twice. Run it BEFORE the matching app release.

begin;

create index if not exists archive_files_folder_lower_idx on public.archive_files(lower(folder));

-- Folders limited to some departments. No row means the folder is open to all.
create table if not exists public.archive_folder_access (
  folder_key text primary key check (folder_key = lower(btrim(folder_key))),
  folder text not null check (char_length(btrim(folder)) between 1 and 60),
  departments text[] not null check (cardinality(departments) between 1 and 40),
  updated_by uuid references public.employee_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.archive_folder_access enable row level security;
revoke all on public.archive_folder_access from public, anon, authenticated;
grant all on public.archive_folder_access to service_role;

-- Links that work outside the company. Only a hash of the link is kept.
create table if not exists public.archive_shares (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.archive_files(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  download_count integer not null default 0,
  last_accessed_at timestamptz
);

create index if not exists archive_shares_file_idx on public.archive_shares(file_id);

alter table public.archive_shares enable row level security;
revoke all on public.archive_shares from public, anon, authenticated;
grant all on public.archive_shares to service_role;

-- Helpers ----------------------------------------------------------------

-- Is the folder open to the signed-in person's department?
create or replace function public.archive_folder_allows(p_folder text)
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
        me.role = 'admin'
        or not exists (
          select 1 from public.archive_folder_access a where a.folder_key = lower(btrim(p_folder))
        )
        or exists (
          select 1 from public.archive_folder_access a
          where a.folder_key = lower(btrim(p_folder)) and me.department = any (a.departments)
        )
      )
  );
$$;

-- Who may see a file that is not in the bin.
-- (Older copies of this file had three arguments; the policy has to go before the function.)
drop policy if exists archive_files_select on public.archive_files;
drop function if exists public.archive_can_see(uuid, text, text);
create or replace function public.archive_can_see(p_uploader uuid, p_visibility text, p_department text, p_folder text)
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
        or (
          public.archive_folder_allows(p_folder)
          and (
            p_visibility = 'company'
            or (p_visibility = 'department' and p_department is not null and p_department <> 'Unassigned' and p_department = me.department)
          )
        )
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

revoke all on function public.archive_folder_allows(text) from public, anon;
revoke all on function public.archive_can_see(uuid, text, text, text) from public, anon;
revoke all on function public.archive_can_manage(uuid) from public, anon;
grant execute on function public.archive_folder_allows(text) to authenticated;
grant execute on function public.archive_can_see(uuid, text, text, text) to authenticated;
grant execute on function public.archive_can_manage(uuid) to authenticated;

drop policy if exists archive_files_select on public.archive_files;
create policy archive_files_select on public.archive_files
  for select to authenticated
  using (
    case
      when deleted_at is null then public.archive_can_see(uploaded_by, visibility, department, folder)
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
    and public.archive_folder_allows(folder)
    and split_part(storage_path, '/', 1) = auth.uid()::text
  );

drop policy if exists archive_files_update on public.archive_files;
create policy archive_files_update on public.archive_files
  for update to authenticated
  using (public.archive_can_manage(uploaded_by))
  with check (public.archive_can_manage(uploaded_by) and public.archive_folder_allows(folder));

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
    -- A deleted file must not stay reachable through an old outside link.
    update public.archive_shares set revoked_at = now() where file_id = new.id and revoked_at is null;
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
          else f.deleted_at is null and public.archive_can_see(f.uploaded_by, f.visibility, f.department, f.folder)
        end
  order by f.created_at desc
  limit 2000;
$$;

revoke all on function public.list_archive_files(boolean) from public, anon;
grant execute on function public.list_archive_files(boolean) to authenticated;

-- Folder limits -------------------------------------------------------------

-- Administrators see every limit. Everyone else sees only the limited folders
-- they belong to (so they get a lock mark), never the ones they cannot open.
create or replace function public.list_archive_folders()
returns table (folder text, departments text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.folder, a.departments
  from public.archive_folder_access a
  where public.archive_folder_allows(a.folder)
  order by lower(a.folder);
$$;

create or replace function public.list_archive_departments()
returns table (department text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct ep.department
  from public.employee_profiles ep
  where ep.active = true
    and ep.department is not null
    and btrim(ep.department) <> ''
    and ep.department <> 'Unassigned'
    and exists (select 1 from public.employee_profiles me where me.id = auth.uid() and me.active = true and me.role = 'admin')
  order by ep.department;
$$;

-- An empty list opens the folder to everyone again.
create or replace function public.set_archive_folder_access(p_folder text, p_departments text[])
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  clean_name text := btrim(coalesce(p_folder, ''));
  clean_deps text[];
begin
  if not exists (select 1 from public.employee_profiles me where me.id = auth.uid() and me.active = true and me.role = 'admin') then
    raise exception 'Only an administrator can limit a folder';
  end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 60 or clean_name ~ '[/\\]' then
    raise exception 'Invalid folder name';
  end if;

  select coalesce(array_agg(distinct btrim(d)) filter (where btrim(d) <> ''), '{}')
  into clean_deps
  from unnest(coalesce(p_departments, '{}')) as d;

  if cardinality(clean_deps) = 0 then
    delete from public.archive_folder_access where folder_key = lower(clean_name);
    return;
  end if;

  insert into public.archive_folder_access(folder_key, folder, departments, updated_by, updated_at)
  values (lower(clean_name), clean_name, clean_deps, auth.uid(), now())
  on conflict (folder_key) do update
    set folder = excluded.folder,
        departments = excluded.departments,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

revoke all on function public.list_archive_folders() from public, anon;
revoke all on function public.list_archive_departments() from public, anon;
revoke all on function public.set_archive_folder_access(text, text[]) from public, anon;
grant execute on function public.list_archive_folders() to authenticated;
grant execute on function public.list_archive_departments() to authenticated;
grant execute on function public.set_archive_folder_access(text, text[]) to authenticated;

-- Links for people outside the company -------------------------------------------

-- Returns the raw link code ONCE. Only its hash is stored, so a lost link
-- cannot be looked up again: make a new one.
create or replace function public.create_archive_share(p_file uuid, p_days integer default 7)
returns table (share_id uuid, token text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  me uuid := auth.uid();
  f public.archive_files%rowtype;
  raw text;
  days integer := least(greatest(coalesce(p_days, 7), 1), 30);
  new_id uuid;
  expiry timestamptz;
  active_count integer;
begin
  select * into f from public.archive_files where id = p_file;
  if not found or f.deleted_at is not null or not public.archive_can_manage(f.uploaded_by) then
    raise exception 'File not found';
  end if;

  select count(*) into active_count from public.archive_shares s
  where s.file_id = f.id and s.revoked_at is null and s.expires_at > now();
  if active_count >= 10 then
    raise exception 'This file already has 10 active links. Revoke one first.';
  end if;

  raw := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  expiry := now() + make_interval(days => days);

  insert into public.archive_shares(file_id, token_hash, created_by, expires_at)
  values (f.id, encode(digest(raw, 'sha256'), 'hex'), me, expiry)
  returning id into new_id;

  return query select new_id, raw, expiry;
end;
$$;

create or replace function public.list_archive_shares(p_file uuid)
returns table (
  id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  download_count integer,
  last_accessed_at timestamptz,
  created_by_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.created_at, s.expires_at, s.revoked_at, s.download_count, s.last_accessed_at,
         coalesce(nullif(btrim(u.full_name), ''), 'Former employee')
  from public.archive_shares s
  join public.archive_files f on f.id = s.file_id
  left join public.employee_profiles u on u.id = s.created_by
  where s.file_id = p_file
    and public.archive_can_manage(f.uploaded_by)
  order by s.created_at desc
  limit 50;
$$;

create or replace function public.revoke_archive_share(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.archive_shares s
  set revoked_at = now()
  from public.archive_files f
  where s.id = p_id and f.id = s.file_id and s.revoked_at is null
    and public.archive_can_manage(f.uploaded_by);
end;
$$;

revoke all on function public.create_archive_share(uuid, integer) from public, anon;
revoke all on function public.list_archive_shares(uuid) from public, anon;
revoke all on function public.revoke_archive_share(uuid) from public, anon;
grant execute on function public.create_archive_share(uuid, integer) to authenticated;
grant execute on function public.list_archive_shares(uuid) to authenticated;
grant execute on function public.revoke_archive_share(uuid) to authenticated;

commit;
