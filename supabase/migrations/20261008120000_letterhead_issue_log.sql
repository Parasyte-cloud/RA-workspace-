-- Letterhead: who may issue documents on the RideArrivo letterhead, and a
-- record of every document issued. Safe to run twice.
--
-- Default access: the admin, legal, operations and finance roles.
-- Extra access: an administrator adds individual people in
-- Administration > Letterhead (table workspace_letterhead_access).
-- The same rule is enforced here, so hiding the menu item in the app is not
-- the only control: a person outside the rule cannot write to the issue log.

begin;

create table if not exists public.workspace_letterhead_access (
  employee_id uuid primary key
    references public.employee_profiles(id) on delete cascade,
  granted_by uuid default auth.uid()
    references public.employee_profiles(id),
  granted_at timestamptz not null default now()
);

alter table public.workspace_letterhead_access enable row level security;

drop policy if exists "letterhead access own or admin read" on public.workspace_letterhead_access;
create policy "letterhead access own or admin read"
on public.workspace_letterhead_access
for select to authenticated
using (
  employee_id = auth.uid()
  or public.current_workspace_role() = 'admin'
);

drop policy if exists "letterhead access admin write" on public.workspace_letterhead_access;
create policy "letterhead access admin write"
on public.workspace_letterhead_access
for all to authenticated
using (public.current_workspace_role() = 'admin')
with check (public.current_workspace_role() = 'admin');

revoke all on public.workspace_letterhead_access from anon;
grant select, insert, delete on public.workspace_letterhead_access to authenticated;


-- One place that answers "may this signed in person issue letterhead
-- documents?". Keep the role list in step with src/lib/letterheadAccess.ts.
create or replace function public.can_issue_letterhead()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employee_profiles p
    where p.id = auth.uid()
      and p.active = true
      and lower(p.role) in ('admin', 'legal', 'operations', 'finance')
  )
  or exists (
    select 1
    from public.workspace_letterhead_access a
    join public.employee_profiles p on p.id = a.employee_id
    where a.employee_id = auth.uid()
      and p.active = true
  );
$$;

revoke all on function public.can_issue_letterhead() from public, anon;
grant execute on function public.can_issue_letterhead() to authenticated;


create table if not exists public.letterhead_issues (
  id uuid primary key default gen_random_uuid(),
  issued_by uuid not null default auth.uid()
    references public.employee_profiles(id),
  issued_at timestamptz not null default now(),
  doc_type text not null
    check (doc_type in ('letter', 'email', 'memo', 'notice')),
  reference text,
  subject text,
  recipient text,
  page_count integer check (page_count is null or page_count > 0)
);

create index if not exists letterhead_issues_issued_at_idx
  on public.letterhead_issues (issued_at desc);
create index if not exists letterhead_issues_issued_by_idx
  on public.letterhead_issues (issued_by);

alter table public.letterhead_issues enable row level security;

drop policy if exists "letterhead issues insert" on public.letterhead_issues;
create policy "letterhead issues insert"
on public.letterhead_issues
for insert to authenticated
with check (
  issued_by = auth.uid()
  and public.can_issue_letterhead()
);

drop policy if exists "letterhead issues read" on public.letterhead_issues;
create policy "letterhead issues read"
on public.letterhead_issues
for select to authenticated
using (
  issued_by = auth.uid()
  or public.current_workspace_role() = 'admin'
);

-- Append only: the log is evidence of what was issued, so nobody edits it.
revoke all on public.letterhead_issues from anon;
revoke all on public.letterhead_issues from authenticated;
grant select, insert on public.letterhead_issues to authenticated;
grant select, insert on public.letterhead_issues to service_role;
revoke update, delete, truncate on public.letterhead_issues from service_role;

commit;
