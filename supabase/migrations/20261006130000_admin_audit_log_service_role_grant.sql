-- The admin audit log was created with its privileges revoked from anon and
-- authenticated, but the service role was never granted access. The
-- workspace-user-admin function reads and writes this table with the service
-- role, so every audit write from approve, revoke and delete was failing
-- with "permission denied". Safe to run twice.
grant select, insert on public.admin_audit_log to service_role;
