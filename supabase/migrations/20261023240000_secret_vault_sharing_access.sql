-- Secret Vault: make sharing and requests work end to end.
--
-- WHAT WAS WRONG
-- 1. The requests table was created with row level security but no SELECT
--    grant for signed-in users. Reading it failed with "permission denied",
--    and the sharing panel loaded everything in one go, so that one failure
--    left "Share with", "Ask who" and "Choose item" empty.
-- 2. Nothing told anyone. Asking a person for access created a row and
--    stopped there, so the owner never knew, and approving or declining
--    never reached the requester.
-- 3. The people list had a single route (a direct read of the staff
--    directory). It now has a second one that cannot be broken by a table
--    grant: vault_people().
--
-- WHAT STAYS THE SAME
-- Every sharing rule: only the owner or an admin shares, 5 minutes to 7 days,
-- reveal only (never manage), one active share per item and person, and the
-- audit trail. Notifications carry no item names, no notes and no values, and
-- are never emailed.
--
-- PArAsYtE

begin;

-- 1. Read access for the people involved (RLS still limits it to the
--    requester, the owner and admins). Writes stay behind the functions.
grant select on table public.secret_vault_access_requests to authenticated;
revoke insert, update, delete on table public.secret_vault_access_requests from authenticated;

-- 2. A people list for the pickers. Active staff only, and only for an active
--    employee.
create or replace function public.vault_people()
returns table(id uuid, full_name text, email text)
language sql
stable
security definer
set search_path=public
as $$
  select p.id, p.full_name, p.email
  from public.employee_profiles p
  where p.active = true
    and exists(select 1 from public.employee_profiles me where me.id = auth.uid() and me.active = true)
  order by p.full_name nulls last;
$$;

revoke all on function public.vault_people() from public, anon;
grant execute on function public.vault_people() to authenticated;

-- 3. In-app notifications. Never blocks the action it belongs to.
create or replace function public.vault_notify(
  p_user uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, email_status)
  values (p_user, p_type, p_title, p_body, p_entity_type, p_entity, 'skipped');
exception when others then
  null;
end;
$$;

revoke all on function public.vault_notify(uuid,text,text,text,text,uuid) from public, anon, authenticated;

create or replace function public.vault_display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(nullif(trim(full_name), ''), email, 'A colleague')
  from public.employee_profiles where id = p_user;
$$;

revoke all on function public.vault_display_name(uuid) from public, anon, authenticated;

-- Ask a person for access, and tell them.
create or replace function public.vault_request_access(target_owner uuid, request_note text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if me is null or not exists(select 1 from public.employee_profiles where id=me and active=true) then
    raise exception 'Active employee required' using errcode='42501';
  end if;
  if target_owner is null or target_owner=me
     or not exists(select 1 from public.employee_profiles where id=target_owner and active=true) then
    raise exception 'Choose another active employee' using errcode='22023';
  end if;
  if char_length(trim(coalesce(request_note,''))) < 3 then
    raise exception 'Say what you need and why' using errcode='22023';
  end if;
  if (select count(*) from public.secret_vault_access_requests
      where requester_id=me and status='pending') >= 5 then
    raise exception 'Too many open requests. Wait for a reply or cancel one.' using errcode='54000';
  end if;
  insert into public.secret_vault_access_requests(requester_id,owner_id,note)
  values (me,target_owner,left(trim(request_note),240))
  returning id into new_id;
  insert into public.secret_vault_audit_events(actor_id,event_type,metadata)
  values (me,'access_requested',jsonb_build_object('request_id',new_id,'owner_id',target_owner));

  perform public.vault_notify(
    target_owner, 'vault_access_requested',
    public.vault_display_name(me) || ' asked you for vault access',
    'Open Secret Vault to approve or decline.',
    'secret_vault_request', new_id
  );
  return new_id;
end;
$$;

-- Share one item with one person, and tell them.
create or replace function public.vault_grant_access(
  target_item uuid,
  grantee uuid,
  duration_minutes integer,
  for_request uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  me uuid := auth.uid();
  item_owner uuid;
  new_acl uuid;
  until_ts timestamptz;
  req public.secret_vault_access_requests%rowtype;
begin
  select owner_id into item_owner from public.secret_vault_items where id=target_item;
  if item_owner is null then raise exception 'Vault item not found' using errcode='42501'; end if;
  if me is null or not exists(select 1 from public.employee_profiles where id=me and active=true)
     or not (item_owner=me or public.is_active_workspace_admin()) then
    raise exception 'Only the owner or an admin can share this item' using errcode='42501';
  end if;
  if grantee is null or grantee=item_owner
     or not exists(select 1 from public.employee_profiles where id=grantee and active=true) then
    raise exception 'Choose another active employee' using errcode='22023';
  end if;
  if duration_minutes is null or duration_minutes < 5 or duration_minutes > 10080 then
    raise exception 'Access time must be between 5 minutes and 7 days' using errcode='22023';
  end if;
  until_ts := now() + make_interval(mins => duration_minutes);

  if for_request is not null then
    select * into req from public.secret_vault_access_requests where id=for_request for update;
    if not found or req.status<>'pending' or req.requester_id<>grantee or req.owner_id<>item_owner then
      raise exception 'That request is not open' using errcode='22023';
    end if;
  end if;

  update public.secret_vault_acl set revoked_at=now()
  where item_id=target_item and employee_id=grantee and revoked_at is null;

  insert into public.secret_vault_acl(item_id,employee_id,can_reveal,can_manage,granted_by,expires_at)
  values (target_item,grantee,true,false,me,until_ts)
  returning id into new_acl;

  if for_request is not null then
    update public.secret_vault_access_requests
    set status='approved', item_id=target_item, decided_at=now(), decided_by=me, acl_id=new_acl
    where id=for_request;
  end if;

  insert into public.secret_vault_audit_events(item_id,actor_id,event_type,metadata)
  values (target_item,me,'acl_granted',jsonb_build_object('grantee',grantee,'expires_at',until_ts,'request_id',for_request));

  perform public.vault_notify(
    grantee, 'vault_access_granted',
    public.vault_display_name(me) || ' shared a vault item with you',
    'Open Secret Vault to reveal it before your access ends.',
    'secret_vault_item', target_item
  );
  return new_acl;
end;
$$;

-- Decline or withdraw a request, and tell the other person when it is declined.
create or replace function public.vault_close_request(target_request uuid, decision text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  me uuid := auth.uid();
  r public.secret_vault_access_requests%rowtype;
begin
  if decision not in ('declined','cancelled') then
    raise exception 'Invalid decision' using errcode='22023';
  end if;
  select * into r from public.secret_vault_access_requests where id=target_request for update;
  if not found or r.status<>'pending' then raise exception 'That request is not open' using errcode='22023'; end if;
  if me is null or not exists(select 1 from public.employee_profiles where id=me and active=true) then
    raise exception 'Active employee required' using errcode='42501';
  end if;
  if decision='declined' and not (r.owner_id=me or public.is_active_workspace_admin()) then
    raise exception 'Only the person asked can decline' using errcode='42501';
  end if;
  if decision='cancelled' and r.requester_id<>me then
    raise exception 'Only the requester can withdraw' using errcode='42501';
  end if;
  update public.secret_vault_access_requests
  set status=decision, decided_at=now(), decided_by=me where id=target_request;
  insert into public.secret_vault_audit_events(actor_id,event_type,metadata)
  values (me, case when decision='declined' then 'access_declined' else 'access_cancelled' end,
          jsonb_build_object('request_id',target_request));

  if decision='declined' then
    perform public.vault_notify(
      r.requester_id, 'vault_access_declined',
      public.vault_display_name(me) || ' declined your vault request',
      'You can ask again or ask someone else.',
      'secret_vault_request', target_request
    );
  end if;
end;
$$;

revoke all on function public.vault_request_access(uuid,text) from public, anon;
revoke all on function public.vault_grant_access(uuid,uuid,integer,uuid) from public, anon;
revoke all on function public.vault_close_request(uuid,text) from public, anon;
grant execute on function public.vault_request_access(uuid,text) to authenticated;
grant execute on function public.vault_grant_access(uuid,uuid,integer,uuid) to authenticated;
grant execute on function public.vault_close_request(uuid,text) to authenticated;

commit;
