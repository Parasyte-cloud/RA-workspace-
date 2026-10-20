-- PArAsYtE | RA-Workspace Support invitation abuse controls
-- Replace permanent 5-guess invite lockout with durable cooldown / security hold state.
-- Additive: historical support invite migrations remain untouched.

begin;

create table if not exists public.support_invitation_security (
  invitation_id uuid primary key references public.support_invites(id) on delete cascade,
  failed_attempts_window integer not null default 0 check (failed_attempts_window >= 0),
  window_started_at timestamptz,
  cooldown_until timestamptz,
  held_at timestamptz,
  last_failure_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.support_invitation_security enable row level security;
-- No browser policies: only service-role RPCs below may touch this table.
revoke all on table public.support_invitation_security from public, anon, authenticated;

-- Reissue remains the administrator recovery path for legacy locked invitations and
-- new security holds. Reissuing always invalidates the prior code and clears counters.
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
  v_was_held boolean := false;
begin
  select * into v_row from public.support_invites where id = p_invite for update;
  if not found then raise exception 'Invite not found'; end if;
  perform public.support_invite_actor_check(p_actor, v_row.role_kind);
  if v_row.status = 'redeemed' then raise exception 'That invite was already used'; end if;
  if coalesce(length(p_code), 0) < 8 then raise exception 'Code too short'; end if;

  select (held_at is not null)
    into v_was_held
    from public.support_invitation_security
   where invitation_id = p_invite
   for update;
  v_was_held := coalesce(v_was_held, false);

  update public.support_invites
     set code_salt = v_salt,
         code_hash = public.support_invite_hash(v_salt, p_code),
         status = 'pending',
         attempts = 0,
         expires_at = v_exp
   where id = p_invite;

  delete from public.support_invitation_security where invitation_id = p_invite;

  if v_was_held then
    perform public.support_write_audit(
      p_actor,
      'staff_invite_hold_cleared',
      'support_invite',
      p_invite::text,
      jsonb_build_object('email', v_row.email)
    );
  end if;
  perform public.support_write_audit(
    p_actor,
    'staff_invite_reissued',
    'support_invite',
    p_invite::text,
    jsonb_build_object('email', v_row.email)
  );

  return jsonb_build_object(
    'id', p_invite,
    'expires_at', v_exp,
    'email', v_row.email,
    'full_name', v_row.full_name,
    'phone', v_row.phone
  );
end;
$$;

-- Check a pending invitation while atomically owning both lifecycle and abuse rows.
-- Internal reasons are service-role-only and must never be passed through publicly.
create or replace function public.support_invite_check(p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.support_invites%rowtype;
  v_security public.support_invitation_security%rowtype;
  v_failures integer;
begin
  select *
    into v_row
    from public.support_invites
   where email = v_email
     and status = 'pending'
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  if v_row.expires_at < now() then
    update public.support_invites set status = 'expired' where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  insert into public.support_invitation_security (invitation_id, window_started_at)
  values (v_row.id, now())
  on conflict (invitation_id) do nothing;

  select *
    into v_security
    from public.support_invitation_security
   where invitation_id = v_row.id
   for update;

  -- A hold and an active cooldown are checked before hashing the supplied code, so
  -- blocked requests neither verify the code nor increment counters.
  if v_security.held_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'held');
  end if;

  if v_security.cooldown_until is not null and v_security.cooldown_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'cooldown');
  end if;

  -- Expired cooldowns are only state, not history; clear them before a new attempt.
  if v_security.cooldown_until is not null then
    update public.support_invitation_security
       set cooldown_until = null,
           updated_at = now()
     where invitation_id = v_row.id;
    v_security.cooldown_until := null;
  end if;

  -- The 24-hour counter is rolling from the first failed attempt in the active window.
  if v_security.window_started_at is null
     or v_security.window_started_at <= now() - interval '24 hours' then
    update public.support_invitation_security
       set failed_attempts_window = 0,
           window_started_at = now(),
           cooldown_until = null,
           updated_at = now()
     where invitation_id = v_row.id;
    v_security.failed_attempts_window := 0;
    v_security.window_started_at := now();
  end if;

  if public.support_invite_hash(v_row.code_salt, p_code) <> v_row.code_hash then
    v_failures := v_security.failed_attempts_window + 1;

    update public.support_invitation_security
       set failed_attempts_window = v_failures,
           last_failure_at = now(),
           cooldown_until = case
             when v_failures in (5, 10, 15) then now() + interval '15 minutes'
             else cooldown_until
           end,
           held_at = case
             when v_failures >= 20 then coalesce(held_at, now())
             else held_at
           end,
           updated_at = now()
     where invitation_id = v_row.id;

    -- Keep the historical attempts column useful for administrators, but never turn
    -- new failures into the legacy permanent status='locked' state.
    update public.support_invites
       set attempts = attempts + 1
     where id = v_row.id;

    if v_failures in (5, 10, 15) then
      perform public.support_write_audit(
        null,
        'staff_invite_cooldown_entered',
        'support_invite',
        v_row.id::text,
        jsonb_build_object('email', v_email)
      );
    end if;

    if v_failures = 20 then
      perform public.support_write_audit(
        null,
        'staff_invite_security_hold_entered',
        'support_invite',
        v_row.id::text,
        jsonb_build_object('email', v_email)
      );
    end if;

    return jsonb_build_object('ok', false, 'reason', case when v_failures >= 20 then 'held' else 'invalid' end);
  end if;

  return jsonb_build_object(
    'ok', true,
    'invite_id', v_row.id,
    'full_name', v_row.full_name,
    'email', v_row.email,
    'role_kind', v_row.role_kind,
    'job_title', v_row.job_title
  );
end;
$$;

-- Grants Support access to an existing/new auth user. Completion clears abuse state.
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

  update public.support_invites
     set status = 'redeemed', redeemed_at = now(), redeemed_user = p_user
   where id = p_invite;

  delete from public.support_invitation_security where invitation_id = p_invite;

  perform public.support_write_audit(
    p_user,
    'staff_invite_redeemed',
    'support_invite',
    p_invite::text,
    jsonb_build_object('email', v_row.email, 'role_kind', v_role, 'invited_by', v_row.created_by)
  );
end;
$$;

-- Return safe abuse-state metadata to authenticated administrators/delegated inviters.
-- The return signature changes, so replace the zero-argument function explicitly.
drop function if exists public.support_invites_list();
create function public.support_invites_list()
returns table (
  id uuid,
  email text,
  full_name text,
  phone text,
  role_kind text,
  job_title text,
  status text,
  attempts integer,
  expires_at timestamptz,
  created_at timestamptz,
  created_by_name text,
  last_sent_at timestamptz,
  send_count integer,
  delivery jsonb,
  redeemed_at timestamptz,
  security_state text,
  cooldown_until timestamptz,
  held_at timestamptz,
  failed_attempts_window integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.support_can_invite(auth.uid()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  update public.support_invites i
     set status = 'expired'
   where i.status = 'pending'
     and i.expires_at < now();

  return query
    select
      i.id,
      i.email,
      i.full_name,
      i.phone,
      i.role_kind,
      i.job_title,
      i.status,
      i.attempts,
      i.expires_at,
      i.created_at,
      ep.full_name,
      i.last_sent_at,
      i.send_count,
      i.delivery,
      i.redeemed_at,
      case
        when s.held_at is not null then 'held'
        when s.cooldown_until is not null and s.cooldown_until > now() then 'cooldown'
        else 'normal'
      end as security_state,
      s.cooldown_until,
      s.held_at,
      coalesce(s.failed_attempts_window, 0)
    from public.support_invites i
    left join public.employee_profiles ep on ep.id = i.created_by
    left join public.support_invitation_security s on s.invitation_id = i.id
    order by i.created_at desc
    limit 200;
end;
$$;

revoke all on function public.support_invite_reissue(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.support_invite_check(text,text) from public, anon, authenticated;
revoke all on function public.support_invite_complete(uuid,uuid) from public, anon, authenticated;
revoke all on function public.support_invites_list() from public, anon;

grant execute on function public.support_invite_reissue(uuid,uuid,text) to service_role;
grant execute on function public.support_invite_check(text,text) to service_role;
grant execute on function public.support_invite_complete(uuid,uuid) to service_role;
grant execute on function public.support_invites_list() to authenticated, service_role;

commit;
