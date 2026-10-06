-- Workspace search safety check. Run in the Supabase SQL Editor (production).
-- Expected result: ZERO rows. Any row is a problem to fix before relying on
-- workspace-search, because those tables are read with the caller's own
-- permissions and must be protected by row level security.
with searched(tbl) as (
  values
    ('work_items'),('workspace_knowledge_articles'),('workspace_files'),
    ('workspace_announcements'),('workspace_events'),('collaboration_spaces'),
    ('brand_assets'),('crm_accounts'),('crm_contacts'),
    ('legal_statutes_regulations'),('legal_research_opinions'),
    ('legal_contracts'),('workspace_rooms')
)
select s.tbl as table_name,
       case
         when c.oid is null then 'table does not exist'
         when not c.relrowsecurity then 'RLS is OFF'
         when has_table_privilege('anon', c.oid, 'SELECT') then 'anon can SELECT'
         when not exists (select 1 from pg_policies p
                          where p.schemaname = 'public' and p.tablename = s.tbl)
              then 'RLS on but no policies (nobody can read)'
       end as problem
from searched s
left join pg_class c
  on c.relname = s.tbl
 and c.relnamespace = 'public'::regnamespace
where c.oid is null
   or not c.relrowsecurity
   or has_table_privilege('anon', c.oid, 'SELECT')
   or not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = s.tbl);
