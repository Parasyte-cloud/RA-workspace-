-- Read-only checks to run in the Supabase SQL Editor. Nothing here changes data.
-- Each query should return ZERO rows unless a note says otherwise. Send me any rows it returns.

-- 1. Tables in public without row level security. (Any row here is readable by every signed-in user.)
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1;

-- 2. Tables with RLS on but no policy at all. (Locked to everyone except the service role. Fine only if intended.)
select c.relname as table_with_rls_but_no_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
order by 1;

-- 3. Policies that allow everything.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and (trim(coalesce(qual, '')) in ('true', '(true)') or trim(coalesce(with_check, '')) in ('true', '(true)'))
order by 1, 2;

-- 4. Functions the anonymous (signed-out) role can run. Public form functions are expected here; anything else is not.
select p.proname as function_callable_by_anon, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
order by 1;

-- 5. Security definer functions without a fixed search_path.
select p.proname as definer_without_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
order by 1;

-- 6. Tables the anonymous role can read or write directly.
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
order by 1, 2;

-- 7. Storage buckets that are public. (Expected: only brand or website images, never staff or customer files.)
select id as public_bucket from storage.buckets where public order by 1;

-- 8. Views that bypass row level security (they run as their owner).
select c.relname as view_bypassing_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') <> 'true'
order by 1;
