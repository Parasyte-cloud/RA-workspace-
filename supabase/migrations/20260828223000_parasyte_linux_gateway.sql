-- Server-side authorization boundary for the ParAsYtE Linux Gateway.
-- The gateway calls this RPC with the employee's own Supabase access token.

begin;

create or replace function public.authorize_parasyte_linux()
returns table(
  user_id uuid,
  email text,
  role text
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    profile.id as user_id,
    profile.email,
    profile.role
  from public.employee_profiles profile
  where profile.id=auth.uid()
    and profile.active=true
    and profile.role in ('engineer','admin')
  limit 1;
$$;

revoke all
on function public.authorize_parasyte_linux()
from public;

revoke all
on function public.authorize_parasyte_linux()
from anon;

grant execute
on function public.authorize_parasyte_linux()
to authenticated;

commit;
