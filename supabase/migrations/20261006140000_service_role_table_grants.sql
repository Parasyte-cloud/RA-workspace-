-- Many tables were created without any grant to the service role, so edge
-- functions that use the service key got "permission denied" on them
-- (found when the admin audit log refused reads). The service role is only
-- ever used server side and bypasses row level security by design, so this
-- restores the standard Supabase default for it. Anon and authenticated are
-- not touched. Safe to run twice.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Tables created by future migrations get the same default.
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;

-- Keep deliberate restrictions: the Zoho mail audit trail is append only.
do $$
begin
  if to_regclass('public.zoho_mail_audit_events') is not null then
    revoke update, delete, truncate on public.zoho_mail_audit_events from service_role;
  end if;
end $$;
