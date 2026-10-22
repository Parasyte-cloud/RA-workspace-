begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.workspace_capability_grants (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  capability text not null check (capability in ('work_item.delete','vault.reveal','vault.manage')),
  granted_by uuid not null references public.employee_profiles(id) on delete restrict,
  reason text,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.employee_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index if not exists workspace_capability_grants_active_uq
  on public.workspace_capability_grants(employee_id, capability)
  where revoked_at is null;

create table if not exists public.secret_vault_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.employee_profiles(id) on delete restrict,
  label text not null check (char_length(trim(label)) between 1 and 120),
  kind text not null check (kind in ('text','number','document')),
  classification text not null default 'restricted' check (classification in ('confidential','restricted','highly_restricted')),
  mime_type text,
  original_filename text,
  byte_size bigint check (byte_size is null or byte_size between 0 and 15728640),
  last_four text check (last_four is null or char_length(last_four) <= 8),
  reveal_max_seconds integer not null default 60 check (reveal_max_seconds between 5 and 600),
  owner_approval_for_others boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.secret_vault_payloads (
  item_id uuid primary key references public.secret_vault_items(id) on delete cascade,
  ciphertext bytea not null,
  iv bytea not null,
  aad text not null,
  created_at timestamptz not null default now()
);
revoke all on private.secret_vault_payloads from public, anon, authenticated;

create table if not exists public.secret_vault_acl (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.secret_vault_items(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  can_reveal boolean not null default false,
  can_manage boolean not null default false,
  granted_by uuid not null references public.employee_profiles(id) on delete restrict,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists secret_vault_acl_active_uq
  on public.secret_vault_acl(item_id, employee_id)
  where revoked_at is null;

create table if not exists public.secret_vault_reveal_sessions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.secret_vault_items(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null check (char_length(trim(purpose)) between 3 and 240),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count integer not null default 0
);

create table if not exists public.secret_vault_audit_events (
  id bigint generated always as identity primary key,
  item_id uuid references public.secret_vault_items(id) on delete set null,
  actor_id uuid references public.employee_profiles(id) on delete set null,
  event_type text not null check (event_type in ('created','reveal_authorized','revealed','hidden','acl_granted','acl_revoked','deleted','capability_granted','capability_revoked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.work_item_deletion_audit (
  id bigint generated always as identity primary key,
  work_item_id uuid not null,
  actor_id uuid not null references public.employee_profiles(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.workspace_capability_grants enable row level security;
alter table public.secret_vault_items enable row level security;
alter table public.secret_vault_acl enable row level security;
alter table public.secret_vault_reveal_sessions enable row level security;
alter table public.secret_vault_audit_events enable row level security;
alter table public.work_item_deletion_audit enable row level security;

create or replace function public.is_active_workspace_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.employee_profiles p
    where p.id=auth.uid() and p.active=true and p.role='admin'
  );
$$;

create or replace function public.has_workspace_capability(required_capability text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_active_workspace_admin() or exists(
    select 1
    from public.workspace_capability_grants g
    join public.employee_profiles p on p.id=g.employee_id and p.active=true
    where g.employee_id=auth.uid()
      and g.capability=required_capability
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at>now())
  );
$$;

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

revoke all on function public.is_active_workspace_admin() from public;
revoke all on function public.has_workspace_capability(text) from public;
revoke all on function public.can_access_secret_vault_item(uuid,boolean) from public;
grant execute on function public.is_active_workspace_admin() to authenticated;
grant execute on function public.has_workspace_capability(text) to authenticated;
grant execute on function public.can_access_secret_vault_item(uuid,boolean) to authenticated;

drop policy if exists "vault metadata read" on public.secret_vault_items;
create policy "vault metadata read" on public.secret_vault_items for select to authenticated
using (public.can_access_secret_vault_item(id,false));

drop policy if exists "vault owner insert" on public.secret_vault_items;
create policy "vault owner insert" on public.secret_vault_items for insert to authenticated
with check (owner_id=auth.uid() and exists(select 1 from public.employee_profiles p where p.id=auth.uid() and p.active=true));

drop policy if exists "vault owner manage metadata" on public.secret_vault_items;
create policy "vault owner manage metadata" on public.secret_vault_items for update to authenticated
using (public.can_access_secret_vault_item(id,true)) with check (public.can_access_secret_vault_item(id,true));

drop policy if exists "vault acl read" on public.secret_vault_acl;
create policy "vault acl read" on public.secret_vault_acl for select to authenticated
using (public.can_access_secret_vault_item(item_id,true) or employee_id=auth.uid());

drop policy if exists "vault reveal session own read" on public.secret_vault_reveal_sessions;
create policy "vault reveal session own read" on public.secret_vault_reveal_sessions for select to authenticated
using (employee_id=auth.uid());

drop policy if exists "vault audit owner/admin read" on public.secret_vault_audit_events;
create policy "vault audit owner/admin read" on public.secret_vault_audit_events for select to authenticated
using (item_id is null or public.can_access_secret_vault_item(item_id,true) or public.is_active_workspace_admin());

drop policy if exists "capability admin read" on public.workspace_capability_grants;
create policy "capability admin read" on public.workspace_capability_grants for select to authenticated
using (public.is_active_workspace_admin() or employee_id=auth.uid());

drop policy if exists "work deletion audit admin read" on public.work_item_deletion_audit;
create policy "work deletion audit admin read" on public.work_item_deletion_audit for select to authenticated
using (public.is_active_workspace_admin() or actor_id=auth.uid());

revoke insert, update, delete on public.workspace_capability_grants from authenticated;
revoke insert, update, delete on public.secret_vault_acl from authenticated;
revoke insert, update, delete on public.secret_vault_reveal_sessions from authenticated;
revoke insert, update, delete on public.secret_vault_audit_events from authenticated;
revoke insert, update, delete on public.work_item_deletion_audit from authenticated;
revoke delete on public.work_items from authenticated;

create or replace function public.admin_set_workspace_capability(
  target_employee uuid,
  target_capability text,
  enabled boolean,
  grant_reason text default null,
  grant_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid();
begin
  if not public.is_active_workspace_admin() then raise exception 'Administrator authorization required'; end if;
  if target_capability not in ('work_item.delete','vault.reveal','vault.manage') then raise exception 'Invalid capability'; end if;
  if not exists(select 1 from public.employee_profiles where id=target_employee and active=true) then raise exception 'Target must be an active employee'; end if;
  if enabled then
    update public.workspace_capability_grants set revoked_at=now(),revoked_by=actor
      where employee_id=target_employee and capability=target_capability and revoked_at is null;
    insert into public.workspace_capability_grants(employee_id,capability,granted_by,reason,expires_at)
      values(target_employee,target_capability,actor,nullif(trim(grant_reason),''),grant_expires_at);
    insert into public.secret_vault_audit_events(actor_id,event_type,metadata)
      values(actor,'capability_granted',jsonb_build_object('employee_id',target_employee,'capability',target_capability,'expires_at',grant_expires_at));
  else
    update public.workspace_capability_grants set revoked_at=now(),revoked_by=actor
      where employee_id=target_employee and capability=target_capability and revoked_at is null;
    insert into public.secret_vault_audit_events(actor_id,event_type,metadata)
      values(actor,'capability_revoked',jsonb_build_object('employee_id',target_employee,'capability',target_capability));
  end if;
end;$$;
revoke all on function public.admin_set_workspace_capability(uuid,text,boolean,text,timestamptz) from public;
grant execute on function public.admin_set_workspace_capability(uuid,text,boolean,text,timestamptz) to authenticated;

create or replace function public.delete_work_item_governed(target_work_item uuid, delete_reason text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid(); task_row public.work_items%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not public.has_workspace_capability('work_item.delete') then raise exception 'Task deletion permission required'; end if;
  if nullif(trim(delete_reason),'') is null or char_length(trim(delete_reason))<3 then raise exception 'Deletion reason is required'; end if;
  select * into task_row from public.work_items where id=target_work_item for update;
  if not found then raise exception 'Task not found'; end if;
  insert into public.work_item_deletion_audit(work_item_id,actor_id,reason,snapshot)
  values(target_work_item,actor,trim(delete_reason),to_jsonb(task_row));
  delete from public.work_items where id=target_work_item;
end;$$;
revoke all on function public.delete_work_item_governed(uuid,text) from public;
grant execute on function public.delete_work_item_governed(uuid,text) to authenticated;

commit;
