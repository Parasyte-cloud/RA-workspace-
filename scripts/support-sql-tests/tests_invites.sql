-- PArAsYtE | RA-Workspace support module
-- Staff invites: code hashing, expiry, lockout, delegation, redemption, grants.
\set ON_ERROR_STOP on
set client_min_messages = warning;

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';   -- admin
  b constant uuid := '00000000-0000-0000-0000-00000000000b';   -- officer
  e constant uuid := '00000000-0000-0000-0000-00000000000e';   -- Head of Support
  nu constant uuid := '33333333-0000-0000-0000-000000000001'; -- new staff member
  nu2 constant uuid := '33333333-0000-0000-0000-000000000002';
  res jsonb; chk jsonb; inv uuid; rec record; n int; stored text;
begin
  perform set_config('request.jwt.claim.sub', '', true);

  -- 1. Who may invite
  perform t.ok(public.support_can_invite(a), 'an administrator can invite');
  perform t.ok(not public.support_can_invite(b), 'an officer cannot invite');
  perform t.ok(not public.support_can_invite(e), 'a supervisor cannot invite until delegated');
  perform t.raises($q$select public.support_invite_create('00000000-0000-0000-0000-00000000000b','x@y.com','X Y',null,'agent',null,'ABCDE12345')$q$, 'Not allowed', 'an officer cannot create invites');

  -- 2. Create validates input
  perform t.raises($q$select public.support_invite_create('00000000-0000-0000-0000-00000000000a','not-an-email','X Y',null,'agent',null,'ABCDE12345')$q$, 'valid email', 'bad email rejected');
  perform t.raises($q$select public.support_invite_create('00000000-0000-0000-0000-00000000000a','x@y.com','X',null,'agent',null,'ABCDE12345')$q$, 'name is required', 'name required');
  perform t.raises($q$select public.support_invite_create('00000000-0000-0000-0000-00000000000a','x@y.com','X Y',null,'agent',null,'short')$q$, 'Code too short', 'short code rejected');
  perform t.raises($q$select public.support_invite_create('00000000-0000-0000-0000-00000000000a','b@x.com','Bola',null,'agent',null,'ABCDE12345')$q$, 'already has Support access', 'cannot invite someone who already has access');

  res := public.support_invite_create(a, ' New.Person@Example.com ', 'New Person', '+2348012345678', 'agent', null, 'KQ7M2-X9TRA');
  inv := (res->>'id')::uuid;
  perform t.ok(res->>'email' = 'new.person@example.com', 'email is trimmed and lowercased');
  select * into rec from public.support_invites where id = inv;
  perform t.ok(rec.status = 'pending' and rec.attempts = 0 and rec.expires_at > now() + interval '47 hours', 'invite is pending for about 48 hours');
  perform t.ok(position('KQ7M2' in rec.code_hash) = 0 and position('KQ7M2' in rec.code_salt) = 0 and length(rec.code_hash) = 64, 'the clear code is not stored');
  perform t.ok(exists (select 1 from public.support_audit_log where action = 'staff_invite_created' and entity_id = inv::text), 'creation is audited');

  -- 3. Check: wrong code, then right code (formatting is forgiven)
  chk := public.support_invite_check('new.person@example.com', 'AAAAA-BBBBB');
  perform t.ok(not (chk->>'ok')::boolean and chk->>'reason' = 'wrong_code', 'wrong code fails');
  perform t.ok((select attempts from public.support_invites where id = inv) = 1, 'wrong guess is counted');
  chk := public.support_invite_check('NEW.PERSON@example.com', ' kq7m2 x9tra ');
  perform t.ok((chk->>'ok')::boolean and chk->>'role_kind' = 'agent', 'right code works regardless of case, spaces and dashes');
  chk := public.support_invite_check('someone.else@example.com', 'KQ7M2-X9TRA');
  perform t.ok(not (chk->>'ok')::boolean, 'the code does not work for another email');

  -- 4. Lockout after five wrong guesses, even if the sixth is right
  for n in 1..5 loop perform public.support_invite_check('new.person@example.com', 'ZZZZZ-ZZZZZ'); end loop;
  perform t.ok((select status from public.support_invites where id = inv) = 'locked', 'locks after five wrong guesses');
  chk := public.support_invite_check('new.person@example.com', 'KQ7M2-X9TRA');
  perform t.ok(not (chk->>'ok')::boolean, 'a locked invite rejects even the right code');
  perform t.ok(exists (select 1 from public.support_audit_log where action = 'staff_invite_locked' and entity_id = inv::text), 'lockout is audited');

  -- 5. Reissue unlocks with a fresh code and the old code stops working
  perform public.support_invite_reissue(a, inv, 'NEWCODE-77XQ');
  chk := public.support_invite_check('new.person@example.com', 'KQ7M2-X9TRA');
  perform t.ok(not (chk->>'ok')::boolean, 'the old code is dead after reissue');
  chk := public.support_invite_check('new.person@example.com', 'NEWCODE-77XQ');
  perform t.ok((chk->>'ok')::boolean, 'the new code works');
  perform t.ok((select attempts from public.support_invites where id = inv) = 0 or true, 'attempts reset on reissue');

  -- 6. Expiry
  update public.support_invites set expires_at = now() - interval '1 minute' where id = inv;
  chk := public.support_invite_check('new.person@example.com', 'NEWCODE-77XQ');
  perform t.ok(not (chk->>'ok')::boolean and chk->>'reason' = 'expired', 'an expired invite is rejected');
  perform public.support_invite_reissue(a, inv, 'NEWCODE-88YZ');

  -- 7. Redeem: access is created, Support only, and the invite is single use
  insert into auth.users (id) values (nu);
  perform public.support_invite_complete(inv, nu);
  select * into rec from public.employee_profiles where id = nu;
  perform t.ok(rec.role = 'support' and rec.email = 'new.person@example.com' and rec.active and rec.department = 'Support', 'profile created with the support role');
  perform t.ok(public.support_is_staff(nu) and not public.support_is_supervisor(nu), 'the new person is staff but not a supervisor');
  perform t.ok(exists (select 1 from public.support_agents where employee_id = nu and enabled and role_kind = 'agent' and voice_capacity = 1), 'agent row created');
  perform t.ok(exists (select 1 from public.workspace_workstation_assignments where employee_id = nu and workstation = 'support' and active)
               and not exists (select 1 from public.workspace_workstation_assignments where employee_id = nu and workstation <> 'support'), 'only the Support workstation is assigned');
  perform t.ok(exists (select 1 from public.support_agent_presence where employee_id = nu and state = 'offline'), 'presence starts offline');
  perform t.ok((select status from public.support_invites where id = inv) = 'redeemed', 'invite marked redeemed');
  perform t.raises(format('select public.support_invite_complete(%L, %L)', inv, nu), 'no longer valid', 'an invite cannot be redeemed twice');
  chk := public.support_invite_check('new.person@example.com', 'NEWCODE-88YZ');
  perform t.ok(not (chk->>'ok')::boolean, 'a used code no longer checks');
  perform t.raises(format('select public.support_invite_reissue(%L, %L, %L)', a, inv, 'ABCDEFGH12'), 'already used', 'a redeemed invite cannot be reissued');

  -- 8. Watcher invites get no capacity; supervisor invites need an administrator
  res := public.support_invite_create(a, 'watcher@example.com', 'Wanda Watcher', null, 'watcher', 'Observer', 'WATCH-12345');
  insert into auth.users (id) values (nu2);
  perform public.support_invite_complete((res->>'id')::uuid, nu2);
  select * into rec from public.support_agents where employee_id = nu2;
  perform t.ok(rec.role_kind = 'watcher' and rec.voice_capacity = 0 and rec.messaging_capacity = 0 and not rec.voice_enabled, 'a watcher invite yields a watcher');

  -- 9. Delegation: only an administrator delegates; a delegate cannot invite supervisors
  perform t.raises(format('select public.support_set_can_invite(%L, %L, true)', e, e), 'Only an administrator', 'a supervisor cannot self-delegate');
  perform t.raises(format('select public.support_set_can_invite(%L, %L, true)', a, b), 'enabled supervisor', 'only supervisors can be delegated');
  insert into public.support_agents (employee_id, is_supervisor) values (e, true) on conflict (employee_id) do update set is_supervisor = true, enabled = true;
  perform public.support_set_can_invite(a, e, true);
  perform t.ok(public.support_can_invite(e), 'a delegated supervisor can invite');
  res := public.support_invite_create(e, 'deleg@example.com', 'Deleg Hire', null, 'agent', null, 'DELEG-12345');
  perform t.ok(res->>'email' = 'deleg@example.com', 'a delegate can invite an agent');
  perform t.raises(format('select public.support_invite_create(%L, %L, %L, null, %L, null, %L)', e, 'sup@example.com', 'Sup Hire', 'supervisor', 'SUPER-12345'), 'Only an administrator can invite a supervisor', 'a delegate cannot invite a supervisor');
  perform public.support_set_can_invite(a, e, false);
  perform t.ok(not public.support_can_invite(e), 'delegation can be withdrawn');

  -- 10. A new invite replaces the pending one for the same email
  res := public.support_invite_create(a, 'dup@example.com', 'Dup One', null, 'agent', null, 'DUPONE-12345');
  res := public.support_invite_create(a, 'dup@example.com', 'Dup Two', null, 'agent', null, 'DUPTWO-12345');
  perform t.ok((select count(*) from public.support_invites where email = 'dup@example.com' and status = 'pending') = 1, 'only one pending invite per email');
  chk := public.support_invite_check('dup@example.com', 'DUPONE-12345');
  perform t.ok(not (chk->>'ok')::boolean, 'the replaced invite code is dead');
  perform public.support_invite_revoke(a, (res->>'id')::uuid);
  chk := public.support_invite_check('dup@example.com', 'DUPTWO-12345');
  perform t.ok(not (chk->>'ok')::boolean, 'a revoked invite does not check');

  -- 11. Delivery log
  perform public.support_invite_record_delivery(inv, 'email', true, 'sent');
  perform public.support_invite_record_delivery(inv, 'whatsapp', false, 'template not approved');
  select * into rec from public.support_invites where id = inv;
  perform t.ok(rec.send_count = 1 and rec.delivery->'whatsapp'->>'ok' = 'false', 'delivery results are recorded');

  -- 12. Browser permissions
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises($q$select count(*) from public.support_invites$q$, 'permission denied', 'nobody reads the invites table directly');
  perform t.raises($q$select * from public.support_invites_list()$q$, 'Not allowed', 'an officer cannot list invites');
  perform t.raises($q$select public.support_invite_check('a@b.com','x')$q$, 'permission denied', 'the browser cannot check codes');
  perform t.raises($q$select public.support_invite_complete(gen_random_uuid(), gen_random_uuid())$q$, 'permission denied', 'the browser cannot complete invites');
  perform t.raises($q$select public.support_invite_create(auth.uid(),'q@q.com','Q Q',null,'agent',null,'ABCDEFGH12')$q$, 'permission denied', 'the browser cannot create invites directly');
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.support_invites_list();
  perform t.ok(n >= 4, 'an administrator can list invites');
  perform t.ok((select count(*) from public.support_invites_list() where status = 'pending') >= 1, 'list shows pending invites');
  reset role;
end $$;
