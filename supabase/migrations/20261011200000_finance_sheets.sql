-- Finance Sheets: spreadsheet workbooks that live inside the Finance workspace.
--
-- One row is one workbook. The tabs, cells, formulas and formats are stored in
-- the `data` column as JSON, so a workbook loads and saves in one round trip.
--
-- Access: Finance and Admin only, for reading and writing. Managers can read
-- the other Finance tables, but a sheet can hold payroll or bank figures, so
-- it is kept narrower on purpose.
--
-- There is no DELETE policy and no DELETE grant. A workbook is archived, not
-- erased, so a finance record cannot disappear by accident or by a bad click.
--
-- Safe to re-run.

create table if not exists public.finance_sheets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  data jsonb not null default '{"sheets":[]}'::jsonb,
  version integer not null default 1,
  archived boolean not null default false,
  created_by uuid references public.employee_profiles(id) on delete set null,
  updated_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A runaway paste must not be able to store an unbounded document.
  constraint finance_sheets_data_size check (pg_column_size(data) <= 6000000)
);

create index if not exists finance_sheets_active_idx
  on public.finance_sheets (archived, updated_at desc);

-- Every save bumps the version and stamps who saved it. The editor sends the
-- version it loaded and the update only matches while that is still current,
-- so two people saving the same workbook can never silently overwrite each
-- other: the second save matches no row and the editor says so.
create or replace function public.finance_sheets_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := auth.uid();
    new.version := 1;
    return new;
  end if;
  if new.data is distinct from old.data
     or new.title is distinct from old.title
     or new.archived is distinct from old.archived then
    new.version := old.version + 1;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  -- Authorship never changes after creation.
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

revoke all on function public.finance_sheets_touch() from public, anon, authenticated;

drop trigger if exists finance_sheets_touch on public.finance_sheets;
create trigger finance_sheets_touch
  before insert or update on public.finance_sheets
  for each row execute function public.finance_sheets_touch();

alter table public.finance_sheets enable row level security;

drop policy if exists "finance sheets read" on public.finance_sheets;
drop policy if exists "finance sheets insert" on public.finance_sheets;
drop policy if exists "finance sheets update" on public.finance_sheets;

create policy "finance sheets read"
on public.finance_sheets
for select to authenticated
using (public.has_workspace_role(array['finance','admin']));

create policy "finance sheets insert"
on public.finance_sheets
for insert to authenticated
with check (public.has_workspace_role(array['finance','admin']));

create policy "finance sheets update"
on public.finance_sheets
for update to authenticated
using (public.has_workspace_role(array['finance','admin']))
with check (public.has_workspace_role(array['finance','admin']));

revoke all on public.finance_sheets from anon, authenticated;
grant select, insert, update on public.finance_sheets to authenticated;
grant all on public.finance_sheets to service_role;
