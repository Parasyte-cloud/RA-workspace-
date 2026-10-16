-- Admin screen support for Zoho mailboxes (up to 10 per person).
--
-- Two admin-only functions:
--   admin_zoho_mailbox_overview()  -> every mailbox, every employee, every grant
--   admin_set_zoho_mailbox_access() -> give or take away one person's access
--
-- Only workspace admins pass zoho_mailbox_is_admin(). Everyone else gets
-- is_admin=false and no data. Every change is written to the audit table.
-- Safe to run more than once.

begin;

create or replace function public.admin_zoho_mailbox_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.zoho_mailbox_is_admin() then
    return jsonb_build_object('is_admin', false);
  end if;

  return jsonb_build_object(
    'is_admin', true,
    'max_per_person', 10,
    'mailboxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'address', m.primary_address,
        'display_name', m.display_name,
        'type', m.mailbox_type,
        'active', m.active,
        'connection_status', c.status
      ) order by m.primary_address)
      from public.zoho_mailboxes m
      left join public.zoho_mail_oauth_connections c on c.id = m.connection_id
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.full_name,
        'email', p.email
      ) order by p.full_name)
      from public.employee_profiles p
      where p.active = true
    ), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mailbox_id', a.mailbox_id,
        'employee_id', a.employee_id,
        'can_read', a.can_read,
        'can_send', a.can_send,
        'is_default', a.is_default
      ))
      from public.zoho_mailbox_access a
      where a.active = true
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_set_zoho_mailbox_access(
  p_mailbox_id uuid,
  p_employee_id uuid,
  p_can_read boolean,
  p_can_send boolean,
  p_is_default boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
  v_default boolean := coalesce(p_is_default, false);
begin
  if v_actor is null or not public.zoho_mailbox_is_admin() then
    raise exception 'Only an administrator can change mailbox access';
  end if;

  if not exists (select 1 from public.zoho_mailboxes where id = p_mailbox_id and active = true) then
    raise exception 'That mailbox is not available';
  end if;
  if not exists (select 1 from public.employee_profiles where id = p_employee_id and active = true) then
    raise exception 'That person is not an active employee';
  end if;

  -- Neither read nor send means access is removed.
  if not coalesce(p_can_read, false) and not coalesce(p_can_send, false) then
    update public.zoho_mailbox_access
       set active = false,
           is_default = false,
           can_read = false,
           can_send = false,
           can_send_as = false,
           can_send_on_behalf = false,
           revoked_at = now()
     where mailbox_id = p_mailbox_id and employee_id = p_employee_id;

    insert into public.zoho_mail_audit_events(mailbox_id, actor_id, action, target_employee_id)
    values (p_mailbox_id, v_actor, 'admin_access_revoked', p_employee_id);
    return;
  end if;

  -- A default mailbox must be readable.
  if v_default and not coalesce(p_can_read, false) then
    v_default := false;
  end if;

  select count(*) into v_count
  from public.zoho_mailbox_access
  where employee_id = p_employee_id
    and active = true
    and mailbox_id <> p_mailbox_id;
  if v_count >= 10 then
    raise exception 'A person can have at most 10 mailboxes';
  end if;

  if v_default then
    update public.zoho_mailbox_access
       set is_default = false
     where employee_id = p_employee_id and is_default = true and mailbox_id <> p_mailbox_id;
  end if;

  insert into public.zoho_mailbox_access(
    mailbox_id, employee_id, can_read, can_send, is_default, active, granted_by, granted_at, revoked_at
  ) values (
    p_mailbox_id, p_employee_id, coalesce(p_can_read, false), coalesce(p_can_send, false),
    v_default, true, v_actor, now(), null
  )
  on conflict (mailbox_id, employee_id) do update
    set can_read = excluded.can_read,
        can_send = excluded.can_send,
        can_send_as = case when excluded.can_send then public.zoho_mailbox_access.can_send_as else false end,
        can_send_on_behalf = case when excluded.can_send then public.zoho_mailbox_access.can_send_on_behalf else false end,
        is_default = excluded.is_default,
        active = true,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = null;

  insert into public.zoho_mail_audit_events(mailbox_id, actor_id, action, target_employee_id, metadata)
  values (p_mailbox_id, v_actor, 'admin_access_granted', p_employee_id,
          jsonb_build_object('can_read', p_can_read, 'can_send', p_can_send, 'is_default', v_default));
end;
$$;

revoke all on function public.admin_zoho_mailbox_overview() from public, anon;
revoke all on function public.admin_set_zoho_mailbox_access(uuid, uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_zoho_mailbox_overview() to authenticated;
grant execute on function public.admin_set_zoho_mailbox_access(uuid, uuid, boolean, boolean, boolean) to authenticated;

commit;
