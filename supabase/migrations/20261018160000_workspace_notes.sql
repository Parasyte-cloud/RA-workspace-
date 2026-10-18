-- Notes: a private notepad for every person, like Apple Notes.
--
-- Each note belongs to one person and nobody else can read it: not other
-- staff, not administrators, not the chat or HR workstations. Deleting moves a
-- note to "Recently deleted" (deleted_at is set); the app removes it for good
-- after 30 days, or sooner if the person chooses.
--
-- body is plain text. A line may start with "- [ ] " or "- [x] " (a checklist
-- item) or "- " (a bullet). sketch is a small list of pen strokes.
-- Safe to run twice.

begin;

create table if not exists public.workspace_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 200000),
  sketch jsonb check (sketch is null or pg_column_size(sketch) <= 600000),
  pinned boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_notes_owner_idx
  on public.workspace_notes(owner_id, pinned desc, updated_at desc);

create or replace function public.workspace_notes_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  -- A note can never be handed to someone else.
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_notes_touch on public.workspace_notes;
create trigger workspace_notes_touch
  before insert or update on public.workspace_notes
  for each row execute function public.workspace_notes_touch();

alter table public.workspace_notes enable row level security;

drop policy if exists "notes owner read" on public.workspace_notes;
create policy "notes owner read" on public.workspace_notes
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "notes owner insert" on public.workspace_notes;
create policy "notes owner insert" on public.workspace_notes
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "notes owner update" on public.workspace_notes;
create policy "notes owner update" on public.workspace_notes
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "notes owner delete" on public.workspace_notes;
create policy "notes owner delete" on public.workspace_notes
  for delete to authenticated using (owner_id = auth.uid());

revoke all on public.workspace_notes from anon;
grant select, insert, update, delete on public.workspace_notes to authenticated;

commit;
