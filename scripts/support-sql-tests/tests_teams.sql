-- PArAsYtE | RA-Workspace support module
-- Team scoping for supervisors.
\set ON_ERROR_STOP on
set client_min_messages = warning;

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';   -- admin
  b constant uuid := '00000000-0000-0000-0000-00000000000b';   -- officer
  c constant uuid := '00000000-0000-0000-0000-00000000000c';   -- officer
  e constant uuid := '00000000-0000-0000-0000-00000000000e';   -- Head of Support
  s1 constant uuid := '44444444-0000-0000-0000-000000000001';  -- team lead, Lagos
  s2 constant uuid := '44444444-0000-0000-0000-000000000002';  -- team lead, Abuja
  t1 uuid; t2 uuid; cust uuid; code2 text; tk uuid; tk2 uuid; tk3 uuid; sess jsonb; sid uuid; n int; rep jsonb; inc uuid;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  update public.support_safety_settings set location_requires_approval = true, location_session_minutes = 15, location_max_active_per_officer = 5;

  insert into public.support_teams (name) values ('Lagos') returning id into t1;
  insert into public.support_teams (name) values ('Abuja') returning id into t2;
  perform t.raises($q$insert into public.support_teams (name) values ('lagos')$q$, 'duplicate key', 'team names are unique regardless of case');

  insert into auth.users (id) values (s1), (s2);
  insert into public.employee_profiles (id, full_name, email, role, job_title, department) values
    (s1, 'Lagos Lead', 's1@x.com', 'support', 'Support Officer', 'Support'),
    (s2, 'Abuja Lead', 's2@x.com', 'support', 'Support Officer', 'Support');
  update public.support_agents set team_id = t1 where employee_id = b;
  update public.support_agents set team_id = t2 where employee_id = c;
  insert into public.support_agents (employee_id, is_supervisor, supervisor_scope, team_id) values (s1, true, 'team', t1), (s2, true, 'team', t2);

  -- 1. Scope resolution
  perform t.ok(public.support_supervisor_scope(s1) = 'team' and public.support_supervisor_scope(s2) = 'team', 'team leads are scoped');
  perform t.ok(public.support_supervisor_scope(a) = 'all', 'an administrator is never scoped');
  perform t.ok(public.support_supervisor_scope(e) = 'all', 'the Head of Support is never scoped');
  perform t.ok(public.support_supervisor_scope(b) is null, 'an officer has no supervisor scope');
  update public.support_agents set supervisor_scope = 'team' where employee_id = e;
  perform t.ok(public.support_supervisor_scope(e) = 'all', 'even if the Head of Support row says team, the title wins');
  update public.support_agents set supervisor_scope = 'all' where employee_id = e;
  perform t.ok(public.support_supervises(s1, b) and not public.support_supervises(s1, c), 'a team lead supervises own team only');
  perform t.ok(public.support_supervises(s1, s1), 'and themselves');
  perform t.ok(public.support_supervises(s1, null), 'and the unassigned');
  perform t.ok(public.support_supervises(a, b) and public.support_supervises(a, c) and public.support_supervises(e, c), 'unscoped supervisors supervise everyone');
  perform t.ok(not public.support_supervises(b, c) and not public.support_supervises(b, b), 'an officer supervises nobody');
  update public.support_agents set team_id = null where employee_id = s2;
  perform t.ok(not public.support_supervises(s2, c), 'a scoped supervisor with no team supervises nobody else');
  update public.support_agents set team_id = t2 where employee_id = s2;

  -- 2. Assignment
  insert into public.support_customers (display_name) values ('Scope Test') returning id into cust;
  insert into public.support_tickets (customer_id, subject, channel, status) values (cust, 'Unassigned one', 'form', 'queued') returning id into tk;
  insert into public.support_tickets (customer_id, subject, channel, assigned_agent_id, status) values (cust, 'Abuja ticket', 'form', c, 'assigned') returning id into tk2;
  insert into public.support_tickets (customer_id, subject, channel, assigned_agent_id, status) values (cust, 'Lagos ticket', 'form', b, 'assigned') returning id into tk3;

  perform set_config('request.jwt.claim.sub', s1::text, true);
  perform public.support_assign_ticket(tk, b);
  perform t.ok((select assigned_agent_id from public.support_tickets where id = tk) = b, 'a team lead assigns to their own officer');
  perform t.raises(format('select public.support_assign_ticket(%L, %L)', tk, c), 'not on your team', 'but not to another team''s officer');
  perform t.raises(format('select public.support_assign_ticket(%L, %L)', tk2, b), 'outside your team', 'and cannot take another team''s ticket');
  perform t.raises(format('select public.support_assign_ticket(%L, null)', tk2), 'outside your team', 'nor unassign it');
  perform public.support_assign_ticket(tk3, null);
  perform t.ok((select assigned_agent_id from public.support_tickets where id = tk3) is null, 'but can unassign their own');
  perform set_config('request.jwt.claim.sub', e::text, true);
  perform public.support_assign_ticket(tk2, b);
  perform t.ok((select assigned_agent_id from public.support_tickets where id = tk2) = b, 'an unscoped supervisor can move anything');
  perform public.support_assign_ticket(tk2, c);

  -- 3. Location approvals follow the team
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.support_tickets (customer_id, subject, channel, assigned_agent_id, status) values (cust, 'Needs location', 'form', c, 'assigned') returning id into tk2;
  code2 := public.support_issue_identity_code('rider', gen_random_uuid());
  perform set_config('request.jwt.claim.sub', c::text, true);
  sess := public.support_request_location(tk2, null, code2, 'Rider asked where the car is');
  sid := (sess->>'id')::uuid;
  perform t.ok(sess->>'status' = 'pending_approval', 'the request waits for approval');
  perform set_config('request.jwt.claim.sub', s1::text, true);
  perform t.raises(format('select public.support_decide_location(%L, true)', sid), 'not on your team', 'another team''s lead cannot approve it');
  perform set_config('request.jwt.claim.sub', s2::text, true);
  perform public.support_decide_location(sid, true);
  perform t.ok((select status from public.support_location_sessions where id = sid) = 'active', 'and approves it');
  perform set_config('request.jwt.claim.sub', s1::text, true);
  perform t.raises(format('select public.support_end_location(%L)', sid), 'only the requester or a supervisor', 'another team''s lead cannot end it');
  perform set_config('request.jwt.claim.sub', s2::text, true);
  perform public.support_end_location(sid, 'done');
  perform t.ok((select status from public.support_location_sessions where id = sid) = 'ended', 'the right lead can');

  -- Emergencies are not scoped: any supervisor can approve a session attached to an incident.
  perform set_config('request.jwt.claim.sub', '', true);
  select incident_id into inc from public.support_sos_ingest('EVT-SCOPE-1', 'rider', gen_random_uuid(), null, null, null, null, now(), null, '{}'::jsonb);
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform public.support_incident_acknowledge(inc);
  sess := public.support_request_location(null, inc, null, 'Rider pressed panic, checking position');
  perform t.ok(sess->>'status' = 'active', 'an emergency location request needs no approval');
  perform set_config('request.jwt.claim.sub', s2::text, true);
  perform public.support_end_location((sess->>'id')::uuid, 'handover');
  perform t.ok((select status from public.support_location_sessions where id = (sess->>'id')::uuid) = 'ended', 'a supervisor from another team can end an emergency session');

  -- 4. Audit trail and reports
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.support_write_audit(b, 'scope_probe', 'x', 'lagos', '{}'::jsonb);
  perform public.support_write_audit(c, 'scope_probe', 'x', 'abuja', '{}'::jsonb);
  perform public.support_write_audit(null, 'scope_probe', 'x', 'system', '{}'::jsonb);
  perform set_config('request.jwt.claim.sub', s1::text, true);
  select count(*) into n from public.support_audit_search('scope_probe');
  perform t.ok(n = 1 and exists (select 1 from public.support_audit_search('scope_probe') where entity_id = 'lagos'), 'a team lead''s audit search shows only their team');
  perform set_config('request.jwt.claim.sub', e::text, true);
  select count(*) into n from public.support_audit_search('scope_probe');
  perform t.ok(n = 3, 'an unscoped supervisor sees everything including system rows');

  perform set_config('request.jwt.claim.sub', s1::text, true);
  rep := public.support_report_summary(now() - interval '1 day', now() + interval '1 day');
  perform t.ok(not exists (select 1 from jsonb_array_elements(rep->'by_agent') x where (x->>'employee_id')::uuid = c), 'a team lead''s report leaves out the other team''s officers');
  perform set_config('request.jwt.claim.sub', e::text, true);
  rep := public.support_report_summary(now() - interval '1 day', now() + interval '1 day');
  perform t.ok(exists (select 1 from jsonb_array_elements(rep->'by_agent') x where (x->>'employee_id')::uuid = b), 'an unscoped report includes everyone');

  -- 5. Browser-level checks under the real role
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', s1::text, true);
  select count(*) into n from public.support_audit_log where action = 'scope_probe';
  perform t.ok(n = 1, 'row level security applies the same scope to the audit log');
  select count(*) into n from public.support_location_sessions where id = sid;
  perform t.ok(n = 0, 'another team''s lead cannot see the location session');
  perform set_config('request.jwt.claim.sub', s2::text, true);
  select count(*) into n from public.support_location_sessions where id = sid;
  perform t.ok(n = 1, 'the right lead can');
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.support_audit_log where action = 'scope_probe';
  perform t.ok(n = 3, 'and administrators see all');
  perform t.raises($q$insert into public.support_teams (name) values ('Nope')$q$, 'permission denied', 'the browser cannot create teams');
  perform t.raises($q$update public.support_agents set supervisor_scope = 'all'$q$, 'permission denied', 'the browser cannot widen its own scope');
  select count(*) into n from public.support_teams;
  perform t.ok(n = 2, 'staff can read team names');
  reset role;

  -- 6. Invites can place a person on a team
  perform t.raises(format('select public.support_invite_set_team(%L, gen_random_uuid(), %L)', b, t1), 'Not allowed', 'only inviters set a team');
end $$;
