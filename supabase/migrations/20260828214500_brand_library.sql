begin;

create table if not exists public.brand_assets (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  description text,

  category text not null
    check (
      category in (
        'logos',
        'brand-guidelines',
        'templates',
        'social-media',
        'photography',
        'icons',
        'other'
      )
    ),

  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null
    check (file_size >= 0),

  uploaded_by uuid not null
    references public.employee_profiles(id)
    on delete restrict,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists
  brand_assets_category_idx
on public.brand_assets(category);

create index if not exists
  brand_assets_created_at_idx
on public.brand_assets(created_at desc);

alter table public.brand_assets
  enable row level security;


/* =========================================================
   METADATA ACCESS
   Every active employee can read.
   Marketing / Manager / Admin can maintain.
   ========================================================= */

drop policy if exists
  "brand assets active employees read"
on public.brand_assets;

create policy
  "brand assets active employees read"
on public.brand_assets
for select
to authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
  )
);


drop policy if exists
  "brand assets approved roles insert"
on public.brand_assets;

create policy
  "brand assets approved roles insert"
on public.brand_assets
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
      and ep.role in (
        'marketing',
        'manager',
        'admin'
      )
  )
);


drop policy if exists
  "brand assets approved roles update"
on public.brand_assets;

create policy
  "brand assets approved roles update"
on public.brand_assets
for update
to authenticated
using (
  exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
      and ep.role in (
        'marketing',
        'manager',
        'admin'
      )
  )
)
with check (
  exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
      and ep.role in (
        'marketing',
        'manager',
        'admin'
      )
  )
);


drop policy if exists
  "brand assets approved roles delete"
on public.brand_assets;

create policy
  "brand assets approved roles delete"
on public.brand_assets
for delete
to authenticated
using (
  exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
      and ep.role in (
        'marketing',
        'manager',
        'admin'
      )
  )
);


grant select
on public.brand_assets
to authenticated;

grant insert, update, delete
on public.brand_assets
to authenticated;


/* =========================================================
   PRIVATE STORAGE BUCKET
   ========================================================= */

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'brand-assets',
  'brand-assets',
  false,
  20971520,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
    'application/pdf'
  ]::text[]
)
on conflict (id)
do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


/* =========================================================
   STORAGE ACCESS
   ========================================================= */

drop policy if exists
  "brand storage active employees read"
on storage.objects;

create policy
  "brand storage active employees read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'brand-assets'
  and exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
  )
);


drop policy if exists
  "brand storage approved roles insert"
on storage.objects;

create policy
  "brand storage approved roles insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'brand-assets'
  and exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
      and ep.role in (
        'marketing',
        'manager',
        'admin'
      )
  )
);


drop policy if exists
  "brand storage approved roles update"
on storage.objects;

create policy
  "brand storage approved roles update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'brand-assets'
  and exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
      and ep.role in (
        'marketing',
        'manager',
        'admin'
      )
  )
)
with check (
  bucket_id = 'brand-assets'
  and exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
      and ep.role in (
        'marketing',
        'manager',
        'admin'
      )
  )
);


drop policy if exists
  "brand storage approved roles delete"
on storage.objects;

create policy
  "brand storage approved roles delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'brand-assets'
  and exists (
    select 1
    from public.employee_profiles ep
    where ep.id = auth.uid()
      and ep.active = true
      and ep.role in (
        'marketing',
        'manager',
        'admin'
      )
  )
);

commit;
