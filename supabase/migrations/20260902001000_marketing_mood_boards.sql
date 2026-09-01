-- =========================================================
-- RideArrivo Marketing Mood Boards
-- Space-scoped collaborative creative direction with private assets.
-- ========================================================

begin;

-- -------------------------------------------------------
-- DATA MODEL
-- -------------------------------------------------------

create table if not exists public.marketing_mood_boards (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null
    references public.collaboration_spaces(id)
    on delete cascade,
  campaign_id uuid
    references public.marketing_campaigns(id)
    on delete set null,
  title text not null
    check(length(trim(title)) between 2 and 160),
  description text
    check(description is null or length(description) <= 5000),
  objective text
    check(objective is null or length(objective) <= 2000),
  audience text
    check(audience is null or length(audience) <= 2000),
  status text not null default 'draft'
    check(status in ('draft','review','approved','archived')),
  created_by uuid not null
    references public.employee_profiles(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists
  marketing_mood_boards_space_idx
on public.marketing_mood_boards(
  space_id,
  status,
  updated_at desc
);

create index if not exists
  marketing_mood_boards_campaign_idx
on public.marketing_mood_boards(campaign_id)
where campaign_id is not null;

create table if not exists public.marketing_mood_board_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null
    references public.marketing_mood_boards(id)
    on delete cascade,
  card_type text not null
    check(card_type in ('image','link','note','copy','colour')),
  title text
    check(title is null or length(title) <= 240),
  body text
    check(body is null or length(body) <= 12000),
  source_url text
    check(source_url is null or length(source_url) <= 4000),
  storage_path text
    check(storage_path is null or length(storage_path) <= 1200),
  alt_text text
    check(alt_text is null or length(alt_text) <= 500),
  colour_value text
    check(colour_value is null or length(colour_value) <= 100),
  tags text[] not null default '{}'::text[],
  position bigint not null default 0,
  created_by uuid not null
    references public.employee_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists
  marketing_mood_board_cards_board_idx
on public.marketing_mood_board_cards(
  board_id,
  position,
  created_at
);

-- -------------------------------------------------------
-- SAFE STORAGE PATH UUID PARSING
-- -------------------------------------------------------

create or replace function
public.try_marketing_mood_board_uuid(
  input_text text
)
returns uuid
language plpgsql
immutable
strict
set search_path=pg_catalog,pg_temp
as $$
begin
  return input_text::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all
on function
public.try_marketing_mood_board_uuid(text)
from public,anon;

grant execute
on function
public.try_marketing_mood_board_uuid(text)
to authenticated;

-- -------------------------------------------------------
-- ACCESS HELPERS
-- Department members can edit their department board.
-- Project/cross-department viewers are read-only.
-- Managers/Admins retain workspace-wide management access.
-- -------------------------------------------------------

create or replace function
public.can_edit_marketing_mood_board_space(
  target_space uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    exists(
      select 1
      from public.employee_profiles me
      where me.id=auth.uid()
        and me.active=true
    )
    and exists(
      select 1
      from public.collaboration_spaces s
      where s.id=target_space
        and s.archived_at is null
        and (
          public.has_workspace_role(
            array['manager','admin']
          )
          or (
            s.space_type='department'
            and lower(
              coalesce(s.home_department,'')
            ) = lower(
              coalesce(
                (
                  select p.department
                  from public.employee_profiles p
                  where p.id=auth.uid()
                    and p.active=true
                  limit 1
                ),
                ''
              )
            )
          or exists(
            select 1
            from public.collaboration_space_members m
            where m.space_id=s.id
              and m.user_id=auth.uid()
              and m.member_role in (
                'owner',
                'admin',
                'member'
              )
          )
        )
      )
    );
$$;

revoke all
on function
public.can_edit_marketing_mood_board_space(uuid)
from public;

grant execute
on function
public.can_edit_marketing_mood_board_space(uuid)
to authenticated;

create or replace function
public.can_access_marketing_mood_board(
  target_board uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.marketing_mood_boards b
    where b.id=target_board
      and public.can_access_collaboration_space(
        b.space_id
      )
  );
$$;

revoke all
on function
public.can_access_marketing_mood_board(uuid)
from public;

grant execute
on function
public.can_access_marketing_mood_board(uuid)
to authenticated;

create or replace function
public.can_edit_marketing_mood_board(
  target_board uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.marketing_mood_boards b
    where b.id=target_board
      and public.can_edit_marketing_mood_board_space(
        b.space_id
      )
  );
$$;

revoke all
on function
public.can_edit_marketing_mood_board(uuid)
from public;

grant execute
on function
public.can_edit_marketing_mood_board(uuid)
to authenticated;

create or replace function
public.can_manage_marketing_mood_board(
  target_board uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.marketing_mood_boards b
    where b.id=target_board
      and public.can_edit_marketing_mood_board_space(
        b.space_id
      )
      and (
        b.created_by=auth.uid()
        or public.can_manage_collaboration_space(
          b.space_id
        )
      )
  );
$$;

revoke all
on function
public.can_manage_marketing_mood_board(uuid)
from public;

grant execute
on function
public.can_manage_marketing_mood_board(uuid)
to authenticated;

-- -------------------------------------------------------
-- IMMUTABLE IDENTITY + ARCHIVE LIFECYCLE
-- -------------------------------------------------------

create or replace function
public.protect_marketing_mood_board_identity()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.id <> old.id
     or new.space_id <> old.space_id
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at
  then
    raise exception
      'Mood board identity fields are immutable';
  end if;

  return new;
end;
$$;

create or replace function
public.protect_marketing_mood_board_card_identity()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.id <> old.id
     or new.board_id <> old.board_id
    or new.created_by <> old.created_by
    or new.created_at <> old.created_at
  then
    raise exception
      'Mood board card identity fields are immutable';
  end if;

  return new;
end;
$$;

create or replace function
public.set_marketing_mood_board_archive()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.status='archived' then
    if tg_op='INSERT' then
      new.archived_at:=coalesce(
        new.archived_at,
        now()
      );
    else
      new.archived_at:=coalesce(
        old.archived_at,
        new.archived_at,
        now()
      );
    end if;
  else
    new.archived_at:=null;
  end if;

  return new;
end;
$$;

drop trigger if exists
  marketing_mood_boards_identity_guard
on public.marketing_mood_boards;

create trigger
  marketing_mood_boards_identity_guard
before update
on public.marketing_mood_boards
for each row
execute function
public.protect_marketing_mood_board_identity();

drop trigger if exists
  marketing_mood_board_cards_identity_guard
on public.marketing_mood_board_cards;

create trigger
  marketing_mood_board_cards_identity_guard
before update
on public.marketing_mood_board_cards
for each row
execute function
public.protect_marketing_mood_board_card_identity();

drop trigger if exists
  marketing_mood_boards_archive_lifecycle
on public.marketing_mood_boards;

create trigger
  marketing_mood_boards_archive_lifecycle
before insert or update
on public.marketing_mood_boards
for each row
execute function
public.set_marketing_mood_board_archive();

drop trigger if exists
  marketing_mood_boards_updated_at
on public.marketing_mood_boards;

create trigger
  marketing_mood_boards_updated_at
before update
on public.marketing_mood_boards
for each row
execute function
public.set_updated_at();

drop trigger if exists
  marketing_mood_board_cards_updated_at
on public.marketing_mood_board_cards;

create trigger
  marketing_mood_board_cards_updated_at
before update
on public.marketing_mood_board_cards
for each row
execute function
public.set_updated_at();

-- -------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------

alter table public.marketing_mood_boards
  enable row level security;

alter table public.marketing_mood_board_cards
  enable row level security;

drop policy if exists
  "marketing mood boards read"
on public.marketing_mood_boards;

create policy "marketing mood boards read"
on public.marketing_mood_boards
for select
to authenticated
using(
  public.can_access_collaboration_space(space_id)
);

drop policy if exists
  "marketing mood boards create"
on public.marketing_mood_boards;

create policy "marketing mood boards create"
on public.marketing_mood_boards
for insert
to authenticated
with check(
  created_by=auth.uid()
  and public.can_edit_marketing_mood_board_space(
    space_id
  )
);

drop policy if exists
  "marketing mood boards update"
on public.marketing_mood_boards;

create policy "marketing mood boards update"
on public.marketing_mood_boards
for update
to authenticated
using(
  public.can_edit_marketing_mood_board_space(
    space_id
  )
)
with check(
  public.can_edit_marketing_mood_board_space(
    space_id
   )
);

drop policy if exists
  "marketing mood boards delete"
on public.marketing_mood_boards;

create policy "marketing mood boards delete"
on public.marketing_mood_boards
for delete
to authenticated
using(
  public.can_edit_marketing_mood_board_space(
    space_id
  )
  and (
    created_by=auth.uid()
    or public.can_manage_collaboration_space(
      space_id
    )
  )
);

drop policy if exists
  "marketing mood board cards read"
on public.marketing_mood_board_cards;

create policy "marketing mood board cards read"
on public.marketing_mood_board_cards
for select
to authenticated
using(
  public.can_access_marketing_mood_board(
    board_id
  )
);

drop policy if exists
  "marketing mood board cards create"
on public.marketing_mood_board_cards;

create policy "marketing mood board cards create"
on public.marketing_mood_board_cards
for insert
to authenticated
with check(
  created_by=auth.uid()
  and public.can_edit_marketing_mood_board(
    board_id
  )
);

drop policy if exists
  "marketing mood board cards update"
on public.marketing_mood_board_cards;

create policy "marketing mood board cards update"
on public.marketing_mood_board_cards
for update
to authenticated
using(
  public.can_edit_marketing_mood_board(
    board_id
  )
)
with check(
  public.can_edit_marketing_mood_board(
    board_id
  )
);

drop policy if exists
  "marketing mood board cards delete"
on public.marketing_mood_board_cards;

create policy "marketing mood board cards delete"
on public.marketing_mood_board_cards
for delete
to authenticated
using(
  public.can_edit_marketing_mood_board(
    board_id
  )
  and (
    created_by=auth.uid()
    or public.can_manage_marketing_mood_board(
      board_id
    )
  )
);

revoke all
on table
public.marketing_mood_boards,
public.marketing_mood_board_cards
from public,anon;

grant
  select,
  insert,
  update,
  delete
on table
public.marketing_mood_boards,
public.marketing_mood_board_cards
to authenticated;

-- -------------------------------------------------------
-- PRIVATE MOOD BOARD ASSETS
-- Path:
--   <board_uuid>/<uploader_uuid>/<filename>
-- -------------------------------------------------------

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values(
  'marketing-mood-board-assets',
  'marketing-mood-board-assets',
  false,
  15728640,
  array['image/jpeg','image/png','image/webp','image/gif']::text[]
)
on conflict(id)
do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists
  "marketing mood board assets read"
on storage.objects;

create policy "marketing mood board assets read"
on storage.objects
for select
to authenticated
using(
  bucket_id='marketing-mood-board-assets'
  and public.can_access_marketing_mood_board(
    public.try_marketing_mood_board_uuid((storage.foldername(name))[1])
  )
);

drop policy if exists
  "marketing mood board assets create"
on storage.objects;

create policy "marketing mood board assets create"
on storage.objects
for insert
to authenticated
with check(
  bucket_id='marketing-mood-board-assets'
  and (
    storage.foldername(name)
  )[2]=auth.uid()::text
  and public.can_edit_marketing_mood_board(
    public.try_marketing_mood_board_uuid((storage.foldername(name))[1])
  )
);

drop policy if exists
  "marketing mood board assets delete"
on storage.objects;

create policy "marketing mood board assets delete"
on storage.objects
for delete
to authenticated
using(
  bucket_id='marketing-mood-board-assets'
  and public.can_edit_marketing_mood_board(
    public.try_marketing_mood_board_uuid((storage.foldername(name))[1])
  )
  and (
    (
      storage.foldername(name)
    )[2]=auth.uid()::text
    or public.can_manage_marketing_mood_board(
      public.try_marketing_mood_board_uuid((storage.foldername(name))[1])
    )
  )
);

commit;
