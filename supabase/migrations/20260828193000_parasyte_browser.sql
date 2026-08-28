begin;

-- ============================================================
-- PArAsYtE
-- Secure RideArrivo lightweight browser foundation.
-- ============================================================


-- ------------------------------------------------------------
-- PERSONAL BOOKMARKS
-- ------------------------------------------------------------

create table if not exists public.parasyte_bookmarks (

  id uuid primary key
    default gen_random_uuid(),

  user_id uuid not null
    references public.employee_profiles(id)
    on delete cascade,

  title text not null
    check (
      char_length(trim(title))
      between 1 and 120
    ),

  url text not null
    check (
      url ~* '^https?://'
    ),

  created_at timestamptz
    not null
    default now(),

  unique(
    user_id,
    url
  )
);

create index if not exists
  parasyte_bookmarks_user_idx
on public.parasyte_bookmarks(
  user_id,
  created_at desc
);

alter table public.parasyte_bookmarks
  enable row level security;


drop policy if exists
  "users read own parasyte bookmarks"
on public.parasyte_bookmarks;

create policy
  "users read own parasyte bookmarks"
on public.parasyte_bookmarks
for select
to authenticated
using (
  user_id = auth.uid()

  and exists (
    select 1
    from public.employee_profiles me
    where
      me.id = auth.uid()
      and me.active = true
  )
);


drop policy if exists
  "users create own parasyte bookmarks"
on public.parasyte_bookmarks;

create policy
  "users create own parasyte bookmarks"
on public.parasyte_bookmarks
for insert
to authenticated
with check (
  user_id = auth.uid()

  and exists (
    select 1
    from public.employee_profiles me
    where
      me.id = auth.uid()
      and me.active = true
  )
);


drop policy if exists
  "users update own parasyte bookmarks"
on public.parasyte_bookmarks;

create policy
  "users update own parasyte bookmarks"
on public.parasyte_bookmarks
for update
to authenticated
using (
  user_id = auth.uid()
)
with check (
  user_id = auth.uid()
);


drop policy if exists
  "users delete own parasyte bookmarks"
on public.parasyte_bookmarks;

create policy
  "users delete own parasyte bookmarks"
on public.parasyte_bookmarks
for delete
to authenticated
using (
  user_id = auth.uid()
);


revoke all
on public.parasyte_bookmarks
from anon;

grant
  select,
  insert,
  update,
  delete
on public.parasyte_bookmarks
to authenticated;


-- ------------------------------------------------------------
-- COMPANY-MANAGED LINKS
-- ------------------------------------------------------------

create table if not exists public.parasyte_managed_links (

  id uuid primary key
    default gen_random_uuid(),

  title text not null,

  url text not null
    check (
      url ~* '^https?://'
    ),

  category text not null
    default 'Company',

  allowed_roles text[]
    not null
    default '{}',

  allowed_departments text[]
    not null
    default '{}',

  active boolean
    not null
    default true,

  sort_order integer
    not null
    default 100,

  created_by uuid
    references public.employee_profiles(id)
    on delete set null,

  created_at timestamptz
    not null
    default now(),

  updated_at timestamptz
    not null
    default now(),

  unique(
    title,
    url
  )
);

alter table public.parasyte_managed_links
  enable row level security;


drop policy if exists
  "employees read permitted parasyte links"
on public.parasyte_managed_links;

create policy
  "employees read permitted parasyte links"
on public.parasyte_managed_links
for select
to authenticated
using (

  active = true

  and exists (

    select 1
    from public.employee_profiles me

    where
      me.id = auth.uid()
      and me.active = true

      and (

        (
          cardinality(
            allowed_roles
          ) = 0

          and cardinality(
            allowed_departments
          ) = 0
        )

        or public.current_workspace_role()
          = any(
              allowed_roles
            )

        or exists (

          select 1

          from unnest(
            allowed_departments
          ) as permitted_department

          where
            lower(
              trim(
                permitted_department
              )
            )
            =
            lower(
              trim(
                coalesce(
                  me.department,
                  ''
                )
              )
            )

        )

      )

  )

);


drop policy if exists
  "admins manage parasyte links"
on public.parasyte_managed_links;

create policy
  "admins manage parasyte links"
on public.parasyte_managed_links
for all
to authenticated
using (
  public.has_workspace_role(
    array['admin']
  )
)
with check (
  public.has_workspace_role(
    array['admin']
  )
);


revoke all
on public.parasyte_managed_links
from anon;

grant
  select
on public.parasyte_managed_links
to authenticated;

grant
  insert,
  update,
  delete
on public.parasyte_managed_links
to authenticated;


-- ------------------------------------------------------------
-- DEFAULT COMPANY LINKS
-- ------------------------------------------------------------

insert into public.parasyte_managed_links(
  title,
  url,
  category,
  allowed_roles,
  allowed_departments,
  sort_order
)
values

(
  'Google',
  'https://www.google.com/',
  'Search',
  '{}',
  '{}',
  10
),

(
  'RideArrivo',
  'https://ridearrivo.com/',
  'Company',
  '{}',
  '{}',
  20
),

(
  'Google Maps',
  'https://maps.google.com/',
  'Operations',
  '{}',
  '{}',
  30
),

(
  'GitHub Engineering',
  'https://github.com/Parasyte-cloud',
  'Engineering',
  array[
    'engineer',
    'cto',
    'manager',
    'admin'
  ],
  array[
    'Engineering'
  ],
  40
),

(
  'Supabase',
  'https://supabase.com/dashboard',
  'Engineering',
  array[
    'engineer',
    'cto',
    'manager',
    'admin'
  ],
  array[
    'Engineering'
  ],
  50
),

(
  'Render',
  'https://dashboard.render.com/',
  'Engineering',
  array[
    'engineer',
    'cto',
    'manager',
    'admin'
  ],
  array[
    'Engineering'
  ],
  60
),

(
  'Canva',
  'https://www.canva.com/',
  'Marketing',
  array[
    'marketing',
    'manager',
    'admin'
  ],
  array[
    'Marketing'
  ],
  70
),

(
  'Google Analytics',
  'https://analytics.google.com/',
  'Marketing',
  array[
    'marketing',
    'manager',
    'admin'
  ],
  array[
    'Marketing'
  ],
  80
),

(
  'ProvidusBank',
  'https://ibank.providusbank.com/provipay#/login',
  'Finance',
  array[
    'finance',
    'manager',
    'admin'
  ],
  array[
    'Finance'
  ],
  90
)

on conflict(
  title,
  url
)
do update set

  category =
    excluded.category,

  allowed_roles =
    excluded.allowed_roles,

  allowed_departments =
    excluded.allowed_departments,

  active = true,

  sort_order =
    excluded.sort_order;


commit;
