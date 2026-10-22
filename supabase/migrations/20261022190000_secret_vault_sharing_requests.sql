-- Secret Vault: sharing and access requests.
--
-- WHAT THIS ADDS
-- Before this, the Vault could only be opened by the owner and by admins. The
-- access list table (secret_vault_acl) and the check that reads it
-- (can_access_secret_vault_item) already existed, but nothing could ever write
-- a row into it, so nobody else could be given access.
--
-- THE MODEL
--  * Any active person who owns an item can share it with any other active
--    person, for a time window THEY choose (5 minutes to 7 days).
--  * A person who needs something asks the owner (vault_request_access). The
--    request does not reveal which items exist. The owner sees the request and
--    decides: approve (pick the item and the time) or decline.
--  * A share only gives "reveal". It never gives "manage", so the person it was
--    shared with cannot re-share, edit or delete the item.
--  * Every reveal rule still applies unchanged, because a share is just a row
--    in secret_vault_acl: a purpose is required, the viewing window is capped
--    by the item's reveal_max_seconds, each reveal token works once, and every
--    step is written to the audit log before anything is shown.
--  * Admins can see and audit everything (existing policies, unchanged).
--  * The owner (or an admin) can take a share back at any moment. Taking it back
--    also kills any reveal token that person still holds for that item.
--
-- Writes go only through the SECURITY DEFINER functions below. Direct inserts,
-- updates and deletes on the tables stay revoked from the signed-in role.

alter table public.secret_vault_audit_events
  drop constraint if exists secret_vault_audit_events_event_type_check;
alter table public.secret_vault_audit_events
  add constraint secret_vault_audit_events_event_type_check
  check (event_type in (
    'created','reveal_authorized','revealed','hidden','acl_granted','acl_revoked','deleted',
    'capability_granted','capability_revoked',
    'access_requested','access_declined','access_cancelled'
  ));

create table if not exists public.secret_vault_access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.employee_profiles(id) on delete cascade,
  owner_id uuid not null references public.employee_profiles(id) on delete cascade,
  item_id uuid references public.secret_vault_items(id) on delete set null,
  note text not null check (char_length(trim(note)) between 3 and 240),
  status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.employee_profiles(id) on delete set null,
  acl_id uuid references public.secret_vault_acl(id) on delete set null,
  check (requester_id <> owner_id)
);
create index if not exists secret_vault_access_requests_owner_idx
  on public.secret_vault_access_requests(owner_id, status, created_at desc);
create index if not exists secret_vault_access_requests_requester_idx
  on public.secret_vault_access_requests(requester_id, status, created_at desc);

alter table public.secret_vault_access_requests enable row level security;
drop policy if exists "vault requests parties and admin read" on public.secret_vault_access_requests;
create policy "vault requests parties and admin read" on public.secret_vault_access_requests
  for select to authenticated
  using (requester_id=auth.uid() or owner_id=auth.uid() or public.is_active_workspace_admin());
revoke insert, update, delete on public.secret_vault_access_requests from authenticated;

-- Ask a person for access. The request names the PERSON and says what is needed
-- in words. It does not need, and does not confirm, any item id, so asking
-- cannot be used to find out what someone has stored.
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
  -- Stop one person flooding someone with requests.
  if (select count(*) from public.secret_vault_access_requests
      where requester_id=me and status='pending') >= 5 then
    raise exception 'Too many open requests. Wait for a reply or cancel one.' using errcode='54000';
  end if;
  insert into public.secret_vault_access_requests(requester_id,owner_id,note)
  values (me,target_owner,left(trim(request_note),240))
  returning id into new_id;
  insert into public.secret_vault_audit_events(actor_id,event_type,metadata)
  values (me,'access_requested',jsonb_build_object('request_id',new_id,'owner_id',target_owner));
  return new_id;
end;
$$;

-- Share one item with one person until a time chosen by the owner.
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
  -- Only the owner or an admin can share. Someone who was only given reveal
  -- access cannot pass it on.
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

  -- One active share per item and person: replace, never stack.
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
  return new_acl;
end;
$$;

-- Take a share back now.
create or replace function public.vault_revoke_access(target_acl uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  me uuid := auth.uid();
  a public.secret_vault_acl%rowtype;
  item_owner uuid;
begin
  select * into a from public.secret_vault_acl where id=target_acl;
  if not found then raise exception 'Share not found' using errcode='42501'; end if;
  select owner_id into item_owner from public.secret_vault_items where id=a.item_id;
  if me is null or not exists(select 1 from public.employee_profiles where id=me and active=true)
     or not (item_owner=me or public.is_active_workspace_admin()) then
    raise exception 'Only the owner or an admin can take back a share' using errcode='42501';
  end if;
  update public.secret_vault_acl set revoked_at=now() where id=target_acl and revoked_at is null;
  -- A reveal token already issued to that person must not outlive the share.
  update public.secret_vault_reveal_sessions set revoked_at=now()
  where item_id=a.item_id and employee_id=a.employee_id and revoked_at is null;
  insert into public.secret_vault_audit_events(item_id,actor_id,event_type,metadata)
  values (a.item_id,me,'acl_revoked',jsonb_build_object('grantee',a.employee_id));
end;
$$;

-- The owner (or an admin) declines, or the requester withdraws.
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
end;
$$;

-- Who an item is currently shared with, for the owner and admins only.
create or replace function public.vault_item_shares(target_item uuid)
returns table(acl_id uuid, employee_id uuid, full_name text, expires_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path=public
as $$
  select a.id, a.employee_id, p.full_name, a.expires_at, a.created_at
  from public.secret_vault_acl a
  join public.employee_profiles p on p.id=a.employee_id
  join public.secret_vault_items i on i.id=a.item_id
  where a.item_id=target_item and a.revoked_at is null and a.can_reveal
    and (a.expires_at is null or a.expires_at>now())
    and (i.owner_id=auth.uid() or public.is_active_workspace_admin())
  order by a.created_at desc;
$$;

revoke all on function public.vault_request_access(uuid,text) from public;
revoke all on function public.vault_grant_access(uuid,uuid,integer,uuid) from public;
revoke all on function public.vault_revoke_access(uuid) from public;
revoke all on function public.vault_close_request(uuid,text) from public;
revoke all on function public.vault_item_shares(uuid) from public;
grant execute on function public.vault_request_access(uuid,text) to authenticated;
grant execute on function public.vault_grant_access(uuid,uuid,integer,uuid) to authenticated;
grant execute on function public.vault_revoke_access(uuid) to authenticated;
grant execute on function public.vault_close_request(uuid,text) to authenticated;
grant execute on function public.vault_item_shares(uuid) to authenticated;
