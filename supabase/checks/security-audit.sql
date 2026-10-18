-- Live security audit for the RA-workspace database. Read-only: run the whole
-- file in the Supabase SQL editor. Every query should return ZERO rows; any row
-- is a gap to fix. (The migrations enable row level security in loops, so the
-- files alone cannot prove the live state. This does.)

-- 1. Tables in public with row level security OFF.
select 'RLS off' as problem, c.relname as object
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 2;

-- 2. RLS on but no policy at all (nobody but the service role can use it:
--    fine for server-only tables, a bug if the app reads it directly).
select 'RLS on, no policy' as problem, c.relname as object
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
order by 2;

-- 3. Policies that let everyone in (using true) for write commands.
select 'policy allows all writes' as problem, schemaname || '.' || tablename || ' :: ' || policyname as object
from pg_policies
where schemaname = 'public'
  and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  and coalesce(qual, 'true') in ('true', '(true)')
  and coalesce(with_check, 'true') in ('true', '(true)')
  and 'authenticated' = any(roles::text[]) or 'anon' = any(roles::text[]) or 'public' = any(roles::text[])
order by 2;

-- 4. Tables the anonymous (signed-out) role can touch.
select 'anon has table privilege' as problem, table_name || ' :: ' || string_agg(privilege_type, ',') as object
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
group by table_name
order by 2;

-- 5. SECURITY DEFINER functions callable by anon or PUBLIC without a pinned search_path.
select 'definer function without search_path' as problem, p.oid::regprocedure::text as object
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
order by 2;

select 'definer function executable by anon/public' as problem, p.oid::regprocedure::text as object
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))
order by 2;

-- 6. Views that run with the owner's rights (bypass the caller's RLS).
select 'view without security_invoker' as problem, c.relname as object
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false)
order by 2;

-- 7. Public storage buckets (anyone with the link can read every file in them).
select 'public storage bucket' as problem, id as object from storage.buckets where public order by 2;

-- 8. Storage objects policies that allow anonymous access.
select 'storage policy for anon/public' as problem, policyname as object
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and ('anon' = any(roles::text[]) or 'public' = any(roles::text[]))
order by 2;
