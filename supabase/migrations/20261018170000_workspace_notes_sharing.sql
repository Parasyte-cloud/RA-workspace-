-- Notes: share a note with colleagues.
--
-- The owner picks people and gives each one "can view" or "can edit".
-- A person you share with sees the note under "Shared with me". They can never
-- delete it, pin it for you, move it to Recently deleted or share it onward;
-- only the owner can. They can stop seeing it at any time ("Leave").
-- Sharing never exposes any other note of yours.
-- Safe to run twice. Run 20261018160000_workspace_notes.sql first.

begin;

create table if not exists public.note_shares (
  note_id uuid not null references public.workspace_notes(id) on delete cascade,
  user_id uuid not null references public.employee_profiles(id) on delete cascade,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

create index if not exists note_shares_user_idx on public.note_shares(user_id);

-- Helpers read the tables as the function owner, so the two sets of policies
-- below can refer to each other without looping.
create or replace function public.note_owner(p_note uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select owner_id from public.workspace_notes where id = p_note $$;

create or replace function public.note_can_read(p_note uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_notes n
    where n.id = p_note
      and (
        n.owner_id = auth.uid()
        or (
          n.deleted_at is null
          and exists (select 1 from public.note_shares s where s.note_id = n.id and s.user_id = auth.uid())
        )
      )
  )
$$;

create or replace function public.note_can_edit(p_note uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_notes n
    where n.id = p_note
      and (
        n.owner_id = auth.uid()
        or (
          n.deleted_at is null
          and exists (select 1 from public.note_shares s where s.note_id = n.id and s.user_id = auth.uid() and s.can_edit)
        )
      )
  )
$$;

revoke all on function public.note_owner(uuid), public.note_can_read(uuid), public.note_can_edit(uuid) from public, anon;
grant execute on function public.note_owner(uuid), public.note_can_read(uuid), public.note_can_edit(uuid) to authenticated;

-- Notes: owners as before, plus people it is shared with. The owner test is
-- written inline as well as in the helper because a row being inserted is not
-- yet visible to the helper (INSERT ... RETURNING would otherwise fail).
drop policy if exists "notes owner read" on public.workspace_notes;
drop policy if exists "notes read own or shared" on public.workspace_notes;
create policy "notes read own or shared" on public.workspace_notes
  for select to authenticated using (owner_id = auth.uid() or public.note_can_read(id));

drop policy if exists "notes owner update" on public.workspace_notes;
drop policy if exists "notes update own or shared edit" on public.workspace_notes;
create policy "notes update own or shared edit" on public.workspace_notes
  for update to authenticated
  using (owner_id = auth.uid() or public.note_can_edit(id))
  with check (owner_id = auth.uid() or public.note_can_edit(id));

-- Insert and delete stay owner-only (policies from the first migration).

-- An editor changes the words and drawing. Pin, trash and ownership stay the owner's.
create or replace function public.workspace_notes_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    if auth.uid() is distinct from old.owner_id then
      new.pinned := old.pinned;
      new.deleted_at := old.deleted_at;
    end if;
  end if;
  return new;
end;
$$;

alter table public.note_shares enable row level security;

drop policy if exists "shares read" on public.note_shares;
create policy "shares read" on public.note_shares
  for select to authenticated
  using (user_id = auth.uid() or public.note_owner(note_id) = auth.uid());

drop policy if exists "shares owner insert" on public.note_shares;
create policy "shares owner insert" on public.note_shares
  for insert to authenticated
  with check (public.note_owner(note_id) = auth.uid() and user_id <> auth.uid());

drop policy if exists "shares owner update" on public.note_shares;
create policy "shares owner update" on public.note_shares
  for update to authenticated
  using (public.note_owner(note_id) = auth.uid())
  with check (public.note_owner(note_id) = auth.uid() and user_id <> auth.uid());

-- The owner removes anyone; a person removes themselves ("Leave").
drop policy if exists "shares owner or self delete" on public.note_shares;
create policy "shares owner or self delete" on public.note_shares
  for delete to authenticated
  using (user_id = auth.uid() or public.note_owner(note_id) = auth.uid());

revoke all on public.note_shares from anon;
grant select, insert, update, delete on public.note_shares to authenticated;

-- Find colleagues by name or email (2+ letters, active staff only, 8 results).
create or replace function public.notes_find_members(p_query text)
returns table (id uuid, full_name text, email text, job_title text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select e.id, e.full_name, e.email, e.job_title
  from public.employee_profiles e
  where auth.uid() is not null
    and e.active
    and e.id <> auth.uid()
    and char_length(trim(coalesce(p_query, ''))) >= 2
    and (
      e.full_name ilike '%' || replace(replace(trim(p_query), '%', ''), '_', '') || '%'
      or e.email ilike '%' || replace(replace(trim(p_query), '%', ''), '_', '') || '%'
    )
  order by e.full_name
  limit 8
$$;

-- Names for the people on notes you can see: owners of notes shared with you,
-- and people you shared your own notes with. Nobody else.
create or replace function public.notes_people(p_ids uuid[])
returns table (id uuid, full_name text, email text, job_title text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select e.id, e.full_name, e.email, e.job_title
  from public.employee_profiles e
  where auth.uid() is not null
    and e.id = any (coalesce(p_ids, '{}'))
    and (
      e.id = auth.uid()
      or exists (select 1 from public.workspace_notes n where n.owner_id = e.id and public.note_can_read(n.id))
      or exists (
        select 1 from public.note_shares s
        join public.workspace_notes n on n.id = s.note_id
        where s.user_id = e.id and n.owner_id = auth.uid()
      )
    )
$$;

revoke all on function public.notes_find_members(text), public.notes_people(uuid[]) from public, anon;
grant execute on function public.notes_find_members(text), public.notes_people(uuid[]) to authenticated;

-- Tell the person when a note is shared with them.
create or replace function public.note_share_notify()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  who text;
  what text;
begin
  select coalesce(nullif(e.full_name, ''), e.email) into who from public.employee_profiles e where e.id = auth.uid();
  select coalesce(nullif(n.title, ''), 'Untitled note') into what from public.workspace_notes n where n.id = new.note_id;
  insert into public.notifications(user_id, type, title, body, entity_type, entity_id)
  values (
    new.user_id,
    'note_shared',
    coalesce(who, 'A colleague') || ' shared a note with you',
    what || case when new.can_edit then ' (you can edit)' else ' (view only)' end,
    'workspace_note',
    new.note_id
  );
  return new;
end;
$$;

drop trigger if exists note_share_notify on public.note_shares;
create trigger note_share_notify
  after insert on public.note_shares
  for each row execute function public.note_share_notify();

-- Live updates while two people have the same note open.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.workspace_notes;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.note_shares;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

commit;
