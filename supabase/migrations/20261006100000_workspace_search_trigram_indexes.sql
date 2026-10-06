-- Speeds up the contains-match (ILIKE '%term%') that global search runs on
-- title and name columns. Each index is created only if its table and column
-- exist, so a schema difference cannot fail the whole migration.
-- Indexes only add read speed; they change no data and no permissions.
create extension if not exists pg_trgm with schema extensions;

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('work_items','title'),
      ('workspace_knowledge_articles','title'),
      ('workspace_files','name'),
      ('workspace_announcements','title'),
      ('workspace_events','title'),
      ('collaboration_spaces','name'),
      ('brand_assets','name'),
      ('crm_accounts','name'),
      ('crm_contacts','full_name'),
      ('crm_contacts','email'),
      ('legal_statutes_regulations','title'),
      ('legal_research_opinions','title'),
      ('legal_contracts','title'),
      ('workspace_rooms','title')
    ) as v(tbl, col)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = item.tbl
        and column_name = item.col
    ) then
      execute format(
        'create index if not exists %I on public.%I using gin (%I extensions.gin_trgm_ops)',
        'idx_search_trgm_' || item.tbl || '_' || item.col, item.tbl, item.col
      );
    end if;
  end loop;
end $$;
