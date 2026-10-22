begin;

-- The browser role could UPDATE any column of public.secret_vault_items on a
-- row it manages (the "vault owner manage metadata" policy only decides WHICH
-- rows, not which columns). That let an owner or a delegated manager rewrite
-- owner_id (hand the item to anyone, or take it over), lower the
-- classification, raise reveal_max_seconds, or switch off the owner-approval
-- flag, none of it audited. Nothing in the app updates this table directly:
-- every legitimate change goes through the secret-vault Edge Function (service
-- role) or a governed RPC. So the browser role gets no UPDATE at all.
--
-- What breaks if this is wrong: a future screen that edits item metadata with
-- supabase.from('secret_vault_items').update(...) will get "permission denied".
-- Add an Edge Function action or a SECURITY DEFINER RPC that checks
-- can_access_secret_vault_item(id, true), whitelists the columns and writes an
-- audit event, rather than re-granting UPDATE.
revoke update on table public.secret_vault_items from authenticated;
revoke update on table public.secret_vault_items from anon;

commit;
