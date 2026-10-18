-- AI Knowledge Manager.
--
-- What: an admin-only assistant researches RideArrivo and PROPOSES new or
-- updated Knowledge Base articles. Nothing it writes is visible to staff until
-- an admin approves it. This migration adds the review queue, a run log, one
-- settings row, and the approve/reject function.
--
-- Why a queue and not direct writes: the assistant reads the open web, and web
-- pages are untrusted text. A human approval step means a bad or manipulated
-- page can at worst produce a rejected proposal, never a published article.
--
-- What breaks if changed: if clients could insert into the proposals table they
-- could forge "AI" proposals. Only the service role (the edge function) writes
-- proposals and runs; admins can read them and decide them through the
-- SECURITY DEFINER function below.

begin;

alter table public.workspace_knowledge_articles
  add column if not exists source text not null default 'manual',
  add column if not exists source_links jsonb not null default '[]'::jsonb,
  add column if not exists last_reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_knowledge_articles_source_check'
  ) then
    alter table public.workspace_knowledge_articles
      add constraint workspace_knowledge_articles_source_check
      check (source in ('manual','seed','ai'));
  end if;
end $$;

-- One row of settings. The boolean primary key plus the check makes a second
-- row impossible.
create table if not exists public.knowledge_ai_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  focus text not null default '',
  updated_by uuid references public.employee_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.knowledge_ai_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.knowledge_ai_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references public.employee_profiles(id) on delete set null,
  topic text not null default '',
  status text not null default 'running' check (status in ('running','done','failed')),
  summary text,
  error text,
  model text,
  searches_used integer not null default 0,
  proposals_count integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_knowledge_ai_runs_created on public.knowledge_ai_runs(created_at desc);

create table if not exists public.knowledge_ai_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.knowledge_ai_runs(id) on delete cascade,
  kind text not null check (kind in ('create','update')),
  article_id uuid references public.workspace_knowledge_articles(id) on delete set null,
  slug text not null,
  title text not null,
  summary text,
  content text not null,
  category text not null default 'General',
  tags text[] not null default '{}',
  rationale text,
  source_links jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.employee_profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_knowledge_ai_proposals_status on public.knowledge_ai_proposals(status, created_at desc);

alter table public.knowledge_ai_settings enable row level security;
alter table public.knowledge_ai_runs enable row level security;
alter table public.knowledge_ai_proposals enable row level security;

drop policy if exists "knowledge ai settings admin read" on public.knowledge_ai_settings;
create policy "knowledge ai settings admin read" on public.knowledge_ai_settings
  for select to authenticated using (public.has_workspace_role(array['admin']));

drop policy if exists "knowledge ai settings admin update" on public.knowledge_ai_settings;
create policy "knowledge ai settings admin update" on public.knowledge_ai_settings
  for update to authenticated
  using (public.has_workspace_role(array['admin']))
  with check (public.has_workspace_role(array['admin']));

drop policy if exists "knowledge ai runs admin read" on public.knowledge_ai_runs;
create policy "knowledge ai runs admin read" on public.knowledge_ai_runs
  for select to authenticated using (public.has_workspace_role(array['admin']));

drop policy if exists "knowledge ai proposals admin read" on public.knowledge_ai_proposals;
create policy "knowledge ai proposals admin read" on public.knowledge_ai_proposals
  for select to authenticated using (public.has_workspace_role(array['admin']));

revoke all on public.knowledge_ai_settings, public.knowledge_ai_runs, public.knowledge_ai_proposals from anon, authenticated;
grant select on public.knowledge_ai_runs, public.knowledge_ai_proposals to authenticated;
grant select, update (enabled, focus, updated_by, updated_at) on public.knowledge_ai_settings to authenticated;

-- Approve or reject one proposal. Approving applies it to the Knowledge Base in
-- the same transaction; the row lock stops two admins applying it twice.
create or replace function public.decide_knowledge_ai_proposal(p_id uuid, p_approve boolean)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prop public.knowledge_ai_proposals%rowtype;
  target uuid;
  new_slug text;
begin
  if not public.has_workspace_role(array['admin']) then
    raise exception 'Only an administrator can review AI proposals.' using errcode = '42501';
  end if;

  select * into prop from public.knowledge_ai_proposals where id = p_id for update;
  if not found then
    raise exception 'Proposal not found.' using errcode = 'P0002';
  end if;
  if prop.status <> 'pending' then
    raise exception 'This proposal was already decided.' using errcode = '22023';
  end if;

  if not p_approve then
    update public.knowledge_ai_proposals
       set status = 'rejected', decided_by = auth.uid(), decided_at = now()
     where id = p_id;
    return null;
  end if;

  target := prop.article_id;
  if prop.kind = 'update' and target is not null
     and exists (select 1 from public.workspace_knowledge_articles where id = target) then
    update public.workspace_knowledge_articles
       set title = prop.title,
           summary = prop.summary,
           content = prop.content,
           category = prop.category,
           tags = prop.tags,
           source = 'ai',
           source_links = prop.source_links,
           last_reviewed_at = now()
     where id = target;
  else
    new_slug := prop.slug;
    if exists (select 1 from public.workspace_knowledge_articles where slug = new_slug) then
      new_slug := new_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    end if;
    insert into public.workspace_knowledge_articles
      (title, slug, summary, content, category, tags, status, created_by, source, source_links, last_reviewed_at)
    values
      (prop.title, new_slug, prop.summary, prop.content, prop.category, prop.tags, 'published',
       auth.uid(), 'ai', prop.source_links, now())
    returning id into target;
  end if;

  update public.knowledge_ai_proposals
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), article_id = target
   where id = p_id;
  return target;
end;
$$;

revoke all on function public.decide_knowledge_ai_proposal(uuid, boolean) from public, anon;
grant execute on function public.decide_knowledge_ai_proposal(uuid, boolean) to authenticated;

commit;
