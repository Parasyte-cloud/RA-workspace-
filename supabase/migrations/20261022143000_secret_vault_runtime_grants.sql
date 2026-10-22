begin;

grant select, insert, update
on table public.secret_vault_items
to authenticated;

grant select
on table public.secret_vault_acl
to authenticated;

grant select
on table public.secret_vault_reveal_sessions
to authenticated;

grant select
on table public.secret_vault_audit_events
to authenticated;

grant select
on table public.workspace_capability_grants
to authenticated;

-- Keep all sensitive mutations RPC/Edge-Function controlled.
revoke delete
on table public.secret_vault_items
from authenticated;

revoke insert, update, delete
on table public.secret_vault_acl
from authenticated;

revoke insert, update, delete
on table public.secret_vault_reveal_sessions
from authenticated;

revoke insert, update, delete
on table public.secret_vault_audit_events
from authenticated;

revoke insert, update, delete
on table public.workspace_capability_grants
from authenticated;

commit;
