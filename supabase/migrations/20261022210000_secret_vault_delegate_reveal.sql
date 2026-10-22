-- Secret Vault: an administrator can name a person who may be given vault
-- items without each owner approving.
--
-- WHAT CHANGES
-- The capability 'vault.reveal' already existed (an admin can grant it from
-- Administration, Delegated authority) but nothing ever checked it, so the
-- button did nothing. can_access_secret_vault_item() now also says yes for
-- REVEAL when the caller holds an active, unexpired 'vault.reveal' grant.
--
-- WHAT DOES NOT CHANGE
--  * Reveal only. 'manage' (edit metadata, share, delete) still needs the
--    owner or an admin, so a delegate cannot delete or re-share anything.
--  * Every reveal rule still applies: a purpose, the item's capped viewing
--    window, one use per token, and an audit entry written before the value
--    is shown. The item's owner can read those audit entries.
--  * Only an active administrator can grant it (admin_set_workspace_capability),
--    it can carry an end date, the grant itself is audited, and revoking it
--    takes effect on the next request.
--  * Inactive accounts get nothing: the outer join on an active profile stays.
--
-- WHAT THE DELEGATE CAN SEE
-- The vault list is filtered by this same function, so a delegate sees the
-- label and kind of every item, which is how they know what to ask to reveal.
-- They still cannot see the value without going through a reveal.

create or replace function public.can_access_secret_vault_item(target_item uuid, need_manage boolean default false)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.secret_vault_items i
    join public.employee_profiles p on p.id=auth.uid() and p.active=true
    where i.id=target_item and (
      i.owner_id=auth.uid()
      or public.is_active_workspace_admin()
      or (not need_manage and public.has_workspace_capability('vault.reveal'))
      or exists(
        select 1 from public.secret_vault_acl a
        where a.item_id=i.id and a.employee_id=auth.uid()
          and a.revoked_at is null
          and (a.expires_at is null or a.expires_at>now())
          and (case when need_manage then a.can_manage else a.can_reveal end)
      )
    )
  );
$$;

revoke all on function public.can_access_secret_vault_item(uuid,boolean) from public;
grant execute on function public.can_access_secret_vault_item(uuid,boolean) to authenticated;
