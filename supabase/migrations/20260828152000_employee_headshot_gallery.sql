begin;

-- ============================================================
-- EMPLOYEE HEADSHOT GALLERY
-- Private company gallery.
-- Employees upload only to their own storage namespace.
-- Active employees may view company headshots.
-- ============================================================

create table if not exists public.employee_headshots (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null
    references public.employee_profiles(id)
    on delete cascade,

  storage_path text not null unique,

  original_name text,

  mime_type text not null
    check (
      mime_type in (
        'image/jpeg',
        'image/png',
        'image/webp'
      )
    ),

  file_size bigint not null
    check (
      file_size > 0
      and file_size <= 5242880
    ),

  created_at timestamptz not null default now()
);

create index if not exists
  employee_headshots_employee_created_idx
on public.employee_headshots(
  employee_id,
  created_at desc
);

alter table public.employee_headshots
  enable row level security;


-- ------------------------------------------------------------
-- TABLE RLS
-- ------------------------------------------------------------

drop policy if exists
  "active employees read headshots"
on public.employee_headshots;

create policy
  "active employees read headshots"
on public.employee_headshots
for select
to authenticated
using (
  exists (
    select 1
    from public.employee_profiles me
    where me.id = auth.uid()
      and me.active = true
  )
);


drop policy if exists
  "employees upload own headshots"
on public.employee_headshots;

create policy
  "employees upload own headshots"
on public.employee_headshots
for insert
to authenticated
with check (
  employee_id = auth.uid()

  and storage_path like
    auth.uid()::text || '/%'

  and exists (
    select 1
    from public.employee_profiles me
    where me.id = auth.uid()
      and me.active = true
  )
);


drop policy if exists
  "employees delete own headshots"
on public.employee_headshots;

create policy
  "employees delete own headshots"
on public.employee_headshots
for delete
to authenticated
using (
  employee_id = auth.uid()

  and exists (
    select 1
    from public.employee_profiles me
    where me.id = auth.uid()
      and me.active = true
  )
);


revoke all
on public.employee_headshots
from anon;

revoke update
on public.employee_headshots
from authenticated;

grant select, insert, delete
on public.employee_headshots
to authenticated;


-- ------------------------------------------------------------
-- PRIVATE STORAGE BUCKET
-- ------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'employee-headshots',
  'employee-headshots',
  false,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id)
do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ------------------------------------------------------------
-- STORAGE RLS
-- ------------------------------------------------------------

drop policy if exists
  "active employees view headshot files"
on storage.objects;

create policy
  "active employees view headshot files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'employee-headshots'

  and exists (
    select 1
    from public.employee_profiles me
    where me.id = auth.uid()
      and me.active = true
  )
);


drop policy if exists
  "employees upload own headshot files"
on storage.objects;

create policy
  "employees upload own headshot files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'employee-headshots'

  and (
    storage.foldername(name)
  )[1] = auth.uid()::text

  and exists (
    select 1
    from public.employee_profiles me
    where me.id = auth.uid()
      and me.active = true
  )
);


drop policy if exists
  "employees delete own headshot files"
on storage.objects;

create policy
  "employees delete own headshot files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'employee-headshots'

  and (
    storage.foldername(name)
  )[1] = auth.uid()::text

  and exists (
    select 1
    from public.employee_profiles me
    where me.id = auth.uid()
      and me.active = true
  )
);


-- ------------------------------------------------------------
-- REALTIME GALLERY REFRESH
-- ------------------------------------------------------------

do $$
begin

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'employee_headshots'
  ) then

    alter publication supabase_realtime
      add table public.employee_headshots;

  end if;

end
$$;

commit;
