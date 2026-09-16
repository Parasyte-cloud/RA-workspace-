-- ============================================================
-- Workspace Calendar + Knowledge Base
--
-- Bug fix: the Calendar and Knowledge Base sidebar sections
-- (CalendarModule / KnowledgeBaseModule in Phase2Modules.tsx)
-- have queried public.workspace_events and
-- public.workspace_knowledge_articles since they were built,
-- but neither table has ever existed in any migration. Every
-- employee clicking either nav item has always seen an empty
-- page. This migration creates both tables to match exactly
-- what the existing frontend already expects, so both pages
-- work end to end. No frontend changes needed for reads.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- WORKSPACE EVENTS (Calendar)
-- ------------------------------------------------------------

create table if not exists public.workspace_events (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  description text,
  event_type text,
  location text,
  meeting_url text,

  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,

  created_by uuid references public.employee_profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (ends_at is null or ends_at >= starts_at)
);

create index if not exists idx_workspace_events_starts_at
on public.workspace_events(starts_at);

alter table public.workspace_events enable row level security;

drop policy if exists "workspace events read" on public.workspace_events;
create policy "workspace events read"
on public.workspace_events
for select
to authenticated
using (true);

drop policy if exists "workspace events manage" on public.workspace_events;
create policy "workspace events manage"
on public.workspace_events
for all
to authenticated
using (public.has_workspace_role(array['hr','admin','manager']))
with check (public.has_workspace_role(array['hr','admin','manager']));

grant select,insert,update,delete
on public.workspace_events
to authenticated;

revoke all on public.workspace_events from anon;

drop trigger if exists workspace_events_set_updated_at on public.workspace_events;
create trigger workspace_events_set_updated_at
before update on public.workspace_events
for each row
execute function public.set_updated_at();


-- ------------------------------------------------------------
-- WORKSPACE KNOWLEDGE ARTICLES (Knowledge Base)
-- ------------------------------------------------------------

create table if not exists public.workspace_knowledge_articles (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  slug text not null unique,
  summary text,
  content text not null,
  category text not null default 'General',
  tags text[] not null default '{}',

  status text not null default 'draft'
    check (status in ('draft','published','archived')),

  created_by uuid references public.employee_profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workspace_knowledge_status_category
on public.workspace_knowledge_articles(status,category);

alter table public.workspace_knowledge_articles enable row level security;

drop policy if exists "knowledge articles read published" on public.workspace_knowledge_articles;
create policy "knowledge articles read published"
on public.workspace_knowledge_articles
for select
to authenticated
using (
  status = 'published'
  or public.has_workspace_role(array['hr','admin','legal'])
);

drop policy if exists "knowledge articles manage" on public.workspace_knowledge_articles;
create policy "knowledge articles manage"
on public.workspace_knowledge_articles
for all
to authenticated
using (public.has_workspace_role(array['hr','admin','legal']))
with check (public.has_workspace_role(array['hr','admin','legal']));

grant select,insert,update,delete
on public.workspace_knowledge_articles
to authenticated;

revoke all on public.workspace_knowledge_articles from anon;

drop trigger if exists workspace_knowledge_articles_set_updated_at on public.workspace_knowledge_articles;
create trigger workspace_knowledge_articles_set_updated_at
before update on public.workspace_knowledge_articles
for each row
execute function public.set_updated_at();

commit;
