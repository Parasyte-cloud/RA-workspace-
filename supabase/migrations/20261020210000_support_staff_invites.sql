-- PArAsYtE | RA-Workspace support module
-- Staff invites: Support staff do not have a RideArrivo mailbox, so an administrator
-- issues a one-time code. The person receives it by email or WhatsApp (or the admin
-- hands it over), opens the join page, enters email + code, picks a password, and
-- lands in the workspace with Support access only.
--
-- Safety properties:
--   * the code is stored only as a salted SHA-256 hash; the clear code exists in the
--     Edge Function for the moment it is sent and on the admin's screen once
--   * a code works for one email only, for 48 hours, and locks after 5 wrong tries
--   * every outcome is audited; nothing here grants more than Support access
--   * only administrators (or supervisors an administrator delegated with can_invite)
--     may invite, and a delegate can never invite a supervisor
-- Additive and idempotent.

begin;

alter table public.support_agents add column if not exists can_invite boolean not null default false;

create table if not exists public.support_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  phone text,
  role_kind text not null default 'agent' check (role_kind in ('watcher','agent','supervisor')),
  job_title text not null default 'Support Officer',
  code_salt text not null,
  code_hash text not null,
  status text not null default 'pending' check (status in ('pending','redeemed','revoked','expired','locked')),
  attempts integer not null default 0,
  expires_at timestamptz not null,
  created_by uuid references public.employee_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  send_count integer not null default 0,
  delivery jsonb not null default '{}'::jsonb,
  redeemed_at timestamptz,
  redeemed_user uuid references public.employee_profiles(id) on delete set null,
  constraint support_invites_email_lower_chk check (email = lower(email))
);
create unique index if not exists support_invites_one_pending_idx on public.support_invites (email) where status = 'pending';
create index if not exists support_invites_created_idx on public.support_invites (created_at desc);

alter table public.support_invites enable row level security;
-- No policies on purpose: the table is reached only through the functions below.
revoke all on public.support_invites from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may invite
-- ---------------------------------------------------------------------------

create or replace function public.support_can_invite(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null and exists (
    select 1 from public.employee_profiles ep
     where ep.id = p_user and ep.active
       and (
         ep.role = 'admin'
         or exists (select 1 from public.workspace_workstation_assignments a
                     where a.employee_id = ep.id and a.active and a.workstation = 'administration')
         or exists (select 1 from public.support_agents sa
                     where sa.employee_id = ep.id and sa.enabled and sa.is_supervisor and sa.can_invite)
       )
  );
$$;

create or replace function public.support_invite_hash(p_salt text, p_code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(p_salt || ':' || upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex');
$$;

-- Administrators only for supervisor invites; delegates may invite agents and watchers.
create or replace function public.support_invite_actor_check(p_actor uuid, p_role_kind text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_can_invite(p_actor) then
    raise exception 'Not allowed to invite staff' using errcode = '42501';
  end if;
  if p_role_kind = 'supervisor' and not exists (
    select 1 from public.employee_profiles ep
     where ep.id = p_actor and ep.active
       and (ep.role = 'admin' or exists (select 1 from public.workspace_workstation_assignments a
                                          where a.employee_id = ep.id and a.active and a.workstation = 'administration'))
  ) then
    raise exception 'Only an administrator can invite a supervisor' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Create / resend / revoke (service role, called by the support-invite function)
-- ---------------------------------------------------------------------------

create or replace function public.support_invite_create(
  p_actor uuid, p_email text, p_name text, p_phone text, p_role_kind text, p_job_title text, p_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_role text := coalesce(nullif(p_role_kind, ''), 'agent');
  v_salt text := gen_random_uuid()::text;
  v_id uuid;
  v_exp timestamptz := now() + interval '48 hours';
  v_profile public.employee_profiles%rowtype;
begin
  perform public.support_invite_actor_check(p_actor, v_role);
  if v_role not in ('watcher','agent','supervisor') then raise exception 'Unknown role'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'A valid email address is required'; end if;
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'A name is required'; end if;
  if coalesce(length(p_code), 0) < 8 then raise exception 'Code too short'; end if;

  select * into v_profile from public.employee_profiles where lower(email) = v_email;
  if found then
    if not v_profile.active then raise exception 'That person has a deactivated account. Reactivate it in Administration first'; end if;
    if exists (select 1 from public.support_agents sa where sa.employee_id = v_profile.id and sa.enabled) then
      raise exception 'That person already has Support access';
    end if;
  end if;

  -- A new invite replaces any pending one for the same email.
  update public.support_invites set status = 'revoked' where email = v_email and status = 'pending';

  insert into public.support_invites (email, full_name, phone, role_kind, job_title, code_salt, code_hash, expires_at, created_by)
  values (v_email, v_name, nullif(btrim(coalesce(p_phone, '')), ''), v_role, coalesce(nullif(btrim(p_job_title), ''), 'Support Officer'),
          v_salt, public.support_invite_hash(v_salt, p_code), v_exp, p_actor)
  returning id into v_id;

  perform public.support_write_audit(p_actor, 'staff_invite_created', 'support_invite', v_id::text,
    jsonb_build_object('email', v_email, 'role_kind', v_role));
  return jsonb_build_object('id', v_id, 'expires_at', v_exp, 'email', v_email, 'full_name', v_name);
end;
$$;

create or replace function public.support_invite_reissue(p_actor uuid, p_invite uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.support_invites%rowtype;
  v_salt text := gen_random_uuid()::text;
  v_exp timestamptz := now() + interval '48 hours';
begin
  select * into v_row from public.support_invites where id = p_invite for update;
  if not found then raise exception 'Invite not found'; end if;
  perform public.support_invite_actor_check(p_actor, v_row.role_kind);
  if v_row.status = 'redeemed' then raise exception 'That invite was already used'; end if;
  if coalesce(length(p_code), 0) < 8 then raise exception 'Code too short'; end if;
  update public.support_invites
     set code_salt = v_salt, code_hash = public.support_invite_hash(v_salt, p_code),
         status = 'pending', attempts = 0, expires_at = v_exp
   where id = p_invite;
  perform public.support_write_audit(p_actor, 'staff_invite_reissued', 'support_invite', p_invite::text, jsonb_build_object('email', v_row.email));
  return jsonb_build_object('id', p_invite, 'expires_at', v_exp, 'email', v_row.email, 'full_name', v_row.full_name, 'phone', v_row.phone);
end;
$$;

create or replace function public.support_invite_revoke(p_actor uuid, p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.support_invites%rowtype;
begin
  select * into v_row from public.support_invites where id = p_invite for update;
  if not found then raise exception 'Invite not found'; end if;
  perform public.support_invite_actor_check(p_actor, v_row.role_kind);
  if v_row.status = 'redeemed' then raise exception 'That invite was already used'; end if;
  update public.support_invites set status = 'revoked' where id = p_invite;
  perform public.support_write_audit(p_actor, 'staff_invite_revoked', 'support_invite', p_invite::text, jsonb_build_object('email', v_row.email));
end;
$$;

create or replace function public.support_invite_record_delivery(p_invite uuid, p_channel text, p_ok boolean, p_detail text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.support_invites
     set last_sent_at = case when p_ok then now() else last_sent_at end,
         send_count = send_count + case when p_ok then 1 else 0 end,
         delivery = delivery || jsonb_build_object(p_channel, jsonb_build_object('ok', p_ok, 'at', now(), 'detail', left(coalesce(p_detail, ''), 200)))
   where id = p_invite;
$$;

-- Admin list. Never returns hashes. Quietly expires stale invites first.
create or replace function public.support_invites_list()
returns table (
  id uuid, email text, full_name text, phone text, role_kind text, job_title text, status text,
  attempts integer, expires_at timestamptz, created_at timestamptz, created_by_name text,
  last_sent_at timestamptz, send_count integer, delivery jsonb, redeemed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_can_invite(auth.uid()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.support_invites i set status = 'expired' where i.status = 'pending' and i.expires_at < now();
  return query
    select i.id, i.email, i.full_name, i.phone, i.role_kind, i.job_title, i.status, i.attempts, i.expires_at, i.created_at,
           ep.full_name, i.last_sent_at, i.send_count, i.delivery, i.redeemed_at
      from public.support_invites i
      left join public.employee_profiles ep on ep.id = i.created_by
     order by i.created_at desc
     limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeem (two steps so the auth user is only created for a correct code)
-- ---------------------------------------------------------------------------

create or replace function public.support_invite_check(p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.support_invites%rowtype;
begin
  select * into v_row from public.support_invites where email = v_email and status = 'pending' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pending');
  end if;
  if v_row.expires_at < now() then
    update public.support_invites set status = 'expired' where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if public.support_invite_hash(v_row.code_salt, p_code) <> v_row.code_hash then
    update public.support_invites
       set attempts = attempts + 1,
           status = case when attempts + 1 >= 5 then 'locked' else status end
     where id = v_row.id;
    if v_row.attempts + 1 >= 5 then
      perform public.support_write_audit(null, 'staff_invite_locked', 'support_invite', v_row.id::text, jsonb_build_object('email', v_email));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'wrong_code');
  end if;
  return jsonb_build_object('ok', true, 'invite_id', v_row.id, 'full_name', v_row.full_name, 'email', v_row.email,
                            'role_kind', v_row.role_kind, 'job_title', v_row.job_title);
end;
$$;

-- Grants Support access to an existing auth user. Never lowers an existing role.
create or replace function public.support_invite_complete(p_invite uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.support_invites%rowtype;
  v_role text;
begin
  select * into v_row from public.support_invites where id = p_invite for update;
  if not found or v_row.status <> 'pending' then raise exception 'Invite is no longer valid'; end if;

  insert into public.employee_profiles (id, full_name, email, department, job_title, role, active)
  values (p_user, v_row.full_name, v_row.email, 'Support', v_row.job_title, 'support', true)
  on conflict (id) do update
    set role = case when public.employee_profiles.role = 'employee' then 'support' else public.employee_profiles.role end,
        department = case when public.employee_profiles.department in ('', 'Unassigned') then 'Support' else public.employee_profiles.department end,
        updated_at = now();

  insert into public.workspace_workstation_assignments (employee_id, workstation, is_primary, active)
  values (p_user, 'support', true, true)
  on conflict (employee_id, workstation) do update set active = true;

  v_role := v_row.role_kind;
  insert into public.support_agents (employee_id, enabled, role_kind, is_supervisor, voice_enabled, voice_capacity, messaging_capacity)
  values (p_user, true, v_role, v_role = 'supervisor', v_role <> 'watcher',
          case when v_role = 'watcher' then 0 else 1 end, case when v_role = 'watcher' then 0 else 3 end)
  on conflict (employee_id) do update
    set enabled = true, role_kind = excluded.role_kind, is_supervisor = excluded.is_supervisor;

  insert into public.support_agent_presence (employee_id, state, state_reason, active_shift)
  values (p_user, 'offline', 'joined', false)
  on conflict (employee_id) do nothing;

  update public.support_invites set status = 'redeemed', redeemed_at = now(), redeemed_user = p_user where id = p_invite;
  perform public.support_write_audit(p_user, 'staff_invite_redeemed', 'support_invite', p_invite::text,
    jsonb_build_object('email', v_row.email, 'role_kind', v_role, 'invited_by', v_row.created_by));
end;
$$;

-- ---------------------------------------------------------------------------
-- Delegation and grants
-- ---------------------------------------------------------------------------

-- Only an administrator may delegate invite rights.
create or replace function public.support_set_can_invite(p_actor uuid, p_employee uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.employee_profiles ep
     where ep.id = p_actor and ep.active
       and (ep.role = 'admin' or exists (select 1 from public.workspace_workstation_assignments a
                                          where a.employee_id = ep.id and a.active and a.workstation = 'administration'))
  ) then raise exception 'Only an administrator can delegate invites' using errcode = '42501'; end if;
  update public.support_agents set can_invite = coalesce(p_value, false) where employee_id = p_employee and is_supervisor;
  if not found then raise exception 'Only an enabled supervisor can be given invite rights'; end if;
  perform public.support_write_audit(p_actor, 'staff_invite_delegation', 'support_agent', p_employee::text, jsonb_build_object('can_invite', p_value));
end;
$$;

revoke all on function public.support_can_invite(uuid) from public, anon;
revoke all on function public.support_invite_hash(text,text) from public, anon, authenticated;
revoke all on function public.support_invite_actor_check(uuid,text) from public, anon, authenticated;
revoke all on function public.support_invite_create(uuid,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.support_invite_reissue(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.support_invite_revoke(uuid,uuid) from public, anon, authenticated;
revoke all on function public.support_invite_record_delivery(uuid,text,boolean,text) from public, anon, authenticated;
revoke all on function public.support_invite_check(text,text) from public, anon, authenticated;
revoke all on function public.support_invite_complete(uuid,uuid) from public, anon, authenticated;
revoke all on function public.support_set_can_invite(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.support_invites_list() from public, anon;

grant execute on function public.support_can_invite(uuid) to authenticated, service_role;
grant execute on function public.support_invites_list() to authenticated, service_role;
grant execute on function public.support_invite_hash(text,text) to service_role;
grant execute on function public.support_invite_actor_check(uuid,text) to service_role;
grant execute on function public.support_invite_create(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.support_invite_reissue(uuid,uuid,text) to service_role;
grant execute on function public.support_invite_revoke(uuid,uuid) to service_role;
grant execute on function public.support_invite_record_delivery(uuid,text,boolean,text) to service_role;
grant execute on function public.support_invite_check(text,text) to service_role;
grant execute on function public.support_invite_complete(uuid,uuid) to service_role;
grant execute on function public.support_set_can_invite(uuid,uuid,boolean) to service_role;

commit;
