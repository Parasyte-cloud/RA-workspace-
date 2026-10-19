-- PArAsYtE | RA-Workspace support module
-- Workstation safety: role kinds, identity codes, location sessions, SOS incidents,
-- settings, audit search, reports. Runs after tests.sql, tests_routing.sql, tests_controls.sql.
\set ON_ERROR_STOP on
set client_min_messages = warning;

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';   -- admin (supervisor)
  b constant uuid := '00000000-0000-0000-0000-00000000000b';   -- officer
  c constant uuid := '00000000-0000-0000-0000-00000000000c';   -- officer
  d constant uuid := '00000000-0000-0000-0000-00000000000d';   -- outsider, becomes a watcher
  e constant uuid := '00000000-0000-0000-0000-00000000000e';   -- Head of Support (supervisor)
  r1 constant uuid := '11111111-0000-0000-0000-000000000001';
  r2 constant uuid := '11111111-0000-0000-0000-000000000002';
  r3 constant uuid := '11111111-0000-0000-0000-000000000003';
  d1 constant uuid := '22222222-0000-0000-0000-000000000001';
  code1 text; code2 text; dcode text; res jsonb; rec record;
  inc1 uuid; inc2 uuid; inc3 uuid; inc4 uuid; ref1 text;
  cust uuid; tk uuid; sess jsonb; sid uuid; n int; j jsonb;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  update public.support_tickets set status = 'closed' where status not in ('resolved','closed');
  update public.support_agent_presence set state = 'offline';
  update public.support_agents set shift_override_until = now() + interval '2 hours' where employee_id in (b, c);
  update public.support_safety_settings set location_requires_approval = false, location_session_minutes = 15,
    identity_lookups_per_10min = 50, identity_failed_per_10min = 6, incident_ack_seconds = 60,
    incident_escalate_seconds = 120, incident_followup_seconds = 900, incident_max_level = 3;

  -- 1. Role kinds -------------------------------------------------------------
  insert into public.support_agents (employee_id, role_kind, voice_capacity, messaging_capacity) values (d, 'watcher', 2, 5);
  select * into rec from public.support_agents where employee_id = d;
  perform t.ok(rec.voice_capacity = 0 and rec.messaging_capacity = 0 and not rec.voice_enabled and not rec.is_supervisor, 'a watcher is forced to zero capacity and no voice');
  perform t.ok(public.support_is_staff(d), 'a watcher is support staff');
  perform t.ok(not public.support_can_see_sensitive(d), 'a watcher cannot see sensitive data');
  perform t.ok(public.support_can_see_sensitive(b) and public.support_can_see_sensitive(e), 'officers and supervisors can');
  perform t.ok(not public.support_can_see_sensitive(null), 'nobody can');
  perform t.ok(not exists (select 1 from public.support_eligible_agents('whatsapp', 'general_enquiry') where employee_id = d), 'a watcher is never offered work');

  update public.support_agents set is_supervisor = true where employee_id = c;
  perform t.ok((select role_kind from public.support_agents where employee_id = c) = 'supervisor', 'setting the supervisor flag sets the role kind');
  update public.support_agents set is_supervisor = false where employee_id = c;
  perform t.ok((select role_kind from public.support_agents where employee_id = c) = 'agent', 'clearing the flag demotes');
  update public.support_agents set role_kind = 'supervisor' where employee_id = c;
  perform t.ok((select is_supervisor from public.support_agents where employee_id = c), 'setting the role kind sets the flag');
  update public.support_agents set role_kind = 'agent', is_supervisor = false where employee_id = c;
  perform t.ok((select count(*) from public.support_audit_log where action = 'support_role_changed' and entity_id = c::text) >= 3, 'role changes are audited');

  -- 2. Identity codes ---------------------------------------------------------
  code1 := public.support_issue_identity_code('rider', r1);
  perform t.ok(code1 ~ '^RAR-[A-Z0-9]{5}-[A-Z0-9]{5}$', 'rider code format');
  perform t.ok(code1 !~ '[01OIL]', 'no look-alike characters');
  perform t.ok(public.support_issue_identity_code('rider', r1) = code1, 'issuing twice returns the same code');
  dcode := public.support_issue_identity_code('driver', d1);
  perform t.ok(dcode ~ '^RAD-', 'driver code prefix');
  perform t.ok(code1 <> dcode, 'codes differ');
  perform t.raises($q$select public.support_issue_identity_code('pilot', gen_random_uuid())$q$, 'rider or driver', 'bad type rejected');
  perform t.ok((select count(distinct public.support_generate_identity_code('rider')) from generate_series(1, 3000)) = 3000, 'generated codes do not collide');

  insert into public.support_customers (display_name, primary_phone, primary_email, rider_id)
    values ('Tola Rider', '+2348012345678', 'tola.rider@example.com', r2) returning id into cust;
  code2 := public.support_issue_identity_code('rider', r2);
  perform t.ok((select customer_id from public.support_identity_codes where code = code2) = cust, 'rider code links the existing customer record');

  perform set_config('request.jwt.claim.sub', b::text, true);
  res := public.support_lookup_identity(lower(code2), 'caller asked');
  perform t.ok(res->>'status' = 'found' and res->>'subject_type' = 'rider', 'lookup is case-insensitive and finds the rider');
  perform t.ok(res->>'phone' = '+234****78' and res->>'email' = 't***@example.com', 'phone and email are masked for an officer');
  perform t.ok(not (res->>'full_details')::boolean, 'not full details');
  perform t.ok(not (res::text like '%lat%'), 'a lookup never returns location');

  insert into public.support_tickets (customer_id, subject, channel, assigned_agent_id, status) values (cust, 'Late pickup', 'form', b, 'assigned') returning id into tk;
  res := public.support_lookup_identity(code2);
  perform t.ok((res->>'full_details')::boolean and res->>'phone' = '+2348012345678', 'the officer handling an open case sees full details');
  perform set_config('request.jwt.claim.sub', c::text, true);
  perform t.ok(public.support_lookup_identity(code2)->>'phone' = '+234****78', 'another officer still sees masked details');
  perform set_config('request.jwt.claim.sub', e::text, true);
  perform t.ok((public.support_lookup_identity(code2)->>'full_details')::boolean, 'a supervisor sees full details');
  perform set_config('request.jwt.claim.sub', d::text, true);
  perform t.raises($q$select public.support_lookup_identity('RAR-AAAAA-BBBBB')$q$, 'not permitted', 'a watcher cannot look people up');
  perform t.raises($q$select public.support_request_location(null, null, null, 'looking at the rider')$q$, 'not permitted', 'a watcher cannot request location');

  perform set_config('request.jwt.claim.sub', c::text, true);
  update public.support_safety_settings set identity_failed_per_10min = 3;
  delete from public.support_identity_lookups;
  perform t.ok(public.support_lookup_identity('RAR-ZZZZZ-ZZZZZ')->>'status' = 'not_found', 'unknown code is not found');
  perform t.ok(public.support_lookup_identity('garbage')->>'status' = 'not_found', 'malformed code is not found');
  perform t.ok(public.support_lookup_identity('')->>'status' = 'not_found', 'empty code is not found');
  perform t.ok(public.support_lookup_identity('RAR-ZZZZZ-ZZZZY')->>'status' = 'rate_limited', 'too many misses are blocked');
  perform t.ok(public.support_lookup_identity(code2)->>'status' = 'rate_limited', 'and a valid code is blocked too while blocked');
  perform t.ok((select count(*) from public.support_audit_log where action = 'identity_lookup_blocked') >= 1, 'the block is audited');
  perform t.ok((select count(*) from public.support_identity_lookups l where l.actor_id = c and not l.found) = 3, 'failed attempts are counted');
  update public.support_safety_settings set identity_failed_per_10min = 6;
  delete from public.support_identity_lookups;

  -- 3. Watchers ---------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform public.support_watch_ticket(tk);
  perform public.support_watch_ticket(tk);
  perform t.ok((select count(*) from public.support_ticket_watchers where ticket_id = tk) = 1, 'watching twice is one row');
  perform t.raises(format($q$select public.support_watch_ticket(%L, %L)$q$, tk, c), 'only supervisors', 'an officer cannot add someone else as a watcher');
  perform set_config('request.jwt.claim.sub', e::text, true);
  perform public.support_watch_ticket(tk, c);
  perform t.ok((select count(*) from public.support_ticket_watchers where ticket_id = tk) = 2, 'a supervisor can add a watcher');
  perform public.support_unwatch_ticket(tk, c);
  perform t.ok((select count(*) from public.support_ticket_watchers where ticket_id = tk) = 1, 'and remove one');

  -- 4. SOS incidents ----------------------------------------------------------
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.support_set_presence(b, 'available');
  select * into rec from public.support_sos_ingest('EVT-1', 'rider', r1, null, 'TRIP-9', 'BK-77', 'VEH-5',
    now() - interval '5 seconds', '{"lat": 6.5244, "lng": 3.3792, "accuracy_m": 12, "recorded_at": null}'::jsonb, '{"raw": true}'::jsonb);
  inc1 := rec.incident_id; ref1 := rec.incident_ref;
  perform t.ok(ref1 ~ '^SOS-[0-9]{4}-[0-9]{6}$', 'incident reference format');
  perform t.ok(not rec.is_duplicate and rec.responder_id = b, 'first event creates an incident and auto-assigns the available officer');
  perform t.ok((select identity_code from public.support_incidents where id = inc1) = code1, 'the existing identity code is attached');
  perform t.ok((select (last_location->>'lat')::numeric from public.support_incidents where id = inc1) = 6.5244, 'location is stored');
  perform t.ok((select next_escalation_at > now() from public.support_incidents where id = inc1), 'an escalation timer is running');
  perform t.ok((select count(*) from public.support_incident_events where incident_id = inc1) = 2, 'triggered and assigned are on the timeline');

  select * into rec from public.support_sos_ingest('EVT-1', 'rider', r1, null, 'TRIP-9', 'BK-77', 'VEH-5', now(), null, '{"raw": true}'::jsonb);
  perform t.ok(rec.is_duplicate and rec.incident_id = inc1, 'same event id is recognised');
  perform t.ok((select count(*) from public.support_incidents where subject_ref = r1) = 1, 'no second incident');
  perform t.ok((select duplicate_count from public.support_incidents where id = inc1) = 1, 'duplicate is counted');

  select * into rec from public.support_sos_ingest('EVT-1B', 'rider', r1, null, null, null, null, now(), null, '{"second": true}'::jsonb);
  perform t.ok(rec.is_duplicate and rec.incident_id = inc1, 'pressing again joins the live incident');
  select * into rec from public.support_sos_ingest('EVT-1B', 'rider', r1, null, null, null, null, now(), null, '{"second": true}'::jsonb);
  perform t.ok((select count(*) from public.support_incident_events where incident_id = inc1 and event_type = 'repeat_activation') = 1, 'the repeat press is on the timeline once');

  perform t.raises($q$select * from public.support_sos_ingest('', 'rider', gen_random_uuid(), null, null, null, null, null, null, null)$q$, 'source_event_id', 'event id required');
  perform t.raises($q$select * from public.support_sos_ingest('X', 'pilot', gen_random_uuid(), null, null, null, null, null, null, null)$q$, 'rider or driver', 'subject type checked');
  perform t.raises($q$select * from public.support_sos_ingest('X', 'rider', null, null, null, null, null, null, null, null)$q$, 'subject_ref', 'subject required');

  select * into rec from public.support_sos_ingest('EVT-BADLOC', 'driver', d1, 'RAR-AAAAA-AAAAA', null, null, null, now() + interval '1 hour',
    '{"lat": 200, "lng": 3}'::jsonb, '{"keep": "me"}'::jsonb);
  inc4 := rec.incident_id;
  perform t.ok((select last_location is null from public.support_incidents where id = inc4), 'impossible coordinates are not stored as a location');
  perform t.ok((select original_payload->>'keep' = 'me' from public.support_incidents where id = inc4), 'but the raw payload is kept');
  perform t.ok((select activated_at <= now() from public.support_incidents where id = inc4), 'a future activation time is clamped');
  perform t.ok((select identity_code = dcode from public.support_incidents where id = inc4), 'a code belonging to someone else is ignored');

  perform t.raises(format($q$update public.support_incidents set original_payload = '{}' where id = %L$q$, inc1), 'cannot be changed', 'original payload is immutable');
  perform t.raises(format($q$update public.support_incidents set activated_at = now() where id = %L$q$, inc1), 'cannot be changed', 'activation time is immutable');
  perform t.raises(format($q$update public.support_incident_events set event_type = 'x' where incident_id = %L$q$, inc1), 'append-only', 'timeline cannot be edited');
  perform t.raises(format($q$delete from public.support_incident_events where incident_id = %L$q$, inc1), 'append-only', 'timeline cannot be deleted');

  -- acknowledge, log, resolve
  perform set_config('request.jwt.claim.sub', d::text, true);
  perform t.raises(format($q$select public.support_incident_acknowledge(%L)$q$, inc1), 'cannot work emergencies', 'a watcher cannot acknowledge');
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises(format($q$select public.support_incident_resolve(%L, 'false_alarm', 'checked and fine here')$q$, inc1), 'acknowledge', 'cannot resolve before acknowledging');
  perform public.support_incident_acknowledge(inc1);
  perform public.support_incident_acknowledge(inc1);
  select * into rec from public.support_incidents where id = inc1;
  perform t.ok(rec.status = 'acknowledged' and rec.acknowledged_by = b, 'acknowledged by the officer');
  perform t.ok((select count(*) from public.support_incident_events where incident_id = inc1 and event_type = 'acknowledged') = 1, 'double acknowledgement is one event');
  perform t.ok(rec.status <> 'resolved' and rec.next_escalation_at is not null, 'acknowledgement does not resolve and follow-up continues');

  perform t.raises(format($q$select public.support_incident_log(%L, 'contacted_subject', 'short')$q$, inc1), 'at least 10', 'action needs a description');
  perform t.raises(format($q$select public.support_incident_log(%L, 'teleported', 'something long enough')$q$, inc1), 'unknown action', 'unknown action kind');
  perform public.support_incident_log(inc1, 'note', 'Rider is not answering the phone');
  perform t.raises(format($q$select public.support_incident_resolve(%L, 'emergency_services_contacted', 'Police informed and on scene')$q$, inc1), 'log the emergency services contact', 'emergency services outcome needs a logged contact');
  perform public.support_incident_log(inc1, 'contacted_emergency_services', 'Called police control room, reference 4471');
  perform set_config('request.jwt.claim.sub', c::text, true);
  perform t.raises(format($q$select public.support_incident_resolve(%L, 'other', 'resolved by someone else')$q$, inc1), 'only the responder', 'a different officer cannot resolve');
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises(format($q$select public.support_incident_resolve(%L, 'other', 'short')$q$, inc1), 'closure notes', 'notes required');
  perform t.raises(format($q$select public.support_incident_resolve(%L, 'martian', 'long enough notes here')$q$, inc1), 'choose an outcome', 'outcome required');

  -- location session on the incident, closed when the incident resolves
  sess := public.support_request_location(null, inc1, null, 'Rider pressed panic, checking position');
  sid := (sess->>'id')::uuid;
  perform t.ok(sess->>'status' = 'active', 'an emergency location session is active at once');

  perform public.support_incident_resolve(inc1, 'emergency_services_contacted', 'Police on scene, rider safe');
  perform t.ok((select status from public.support_incidents where id = inc1) = 'resolved', 'resolved');
  perform t.ok((select status = 'ended' and end_reason = 'incident resolved' from public.support_location_sessions where id = sid), 'resolving the incident ends its location sessions');
  perform t.raises(format($q$select public.support_incident_resolve(%L, 'other', 'resolving twice here')$q$, inc1), 'already resolved', 'cannot resolve twice');
  perform t.raises(format($q$select public.support_incident_acknowledge(%L)$q$, inc1), 'already resolved', 'cannot acknowledge a resolved incident');
  perform set_config('request.jwt.claim.sub', '', true);
  select * into rec from public.support_sos_ingest('EVT-1', 'rider', r1, null, null, null, null, now(), null, '{}'::jsonb);
  perform t.ok((select status from public.support_incidents where id = inc1) = 'resolved', 'a late duplicate delivery does not reopen it');

  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises(format($q$select public.support_incident_reopen(%L, 'responder reopening this one')$q$, inc1), 'supervisor', 'an officer cannot reopen');
  perform set_config('request.jwt.claim.sub', e::text, true);
  perform t.raises(format($q$select public.support_incident_reopen(%L, 'short')$q$, inc1), 'reason', 'reopen needs a reason');
  perform public.support_incident_reopen(inc1, 'Rider called back, still unsafe');
  perform t.ok((select status = 'acknowledged' and resolved_at is null from public.support_incidents where id = inc1), 'a supervisor can reopen');
  perform t.ok((select count(*) from public.support_incident_events where incident_id = inc1 and event_type in ('resolved','reopened')) = 2, 'history of both is kept');
  perform public.support_incident_resolve(inc1, 'assisted_on_scene', 'Patrol reached the rider, safe');

  -- escalation ladder
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.support_set_presence(b, 'available');
  select * into rec from public.support_sos_ingest('EVT-2', 'rider', r2, null, null, null, null, now(), null, '{}'::jsonb);
  inc2 := rec.incident_id;
  perform t.ok(rec.responder_id = b, 'assigned to the available officer');
  perform t.ok((select count(*) from public.support_incident_escalate_due()) = 0, 'nothing due yet');
  update public.support_incidents set next_escalation_at = now() - interval '1 second' where id = inc2;
  select * into rec from public.support_incident_escalate_due();
  perform t.ok(rec.incident_id = inc2 and rec.level = 1 and rec.action = 'escalated', 'unacknowledged past the threshold escalates');
  perform t.ok((select status = 'escalated' and escalation_level = 1 and next_escalation_at > now() from public.support_incidents where id = inc2), 'status and next timer set');
  perform t.ok((select count(*) from public.support_incident_escalate_due()) = 0, 'running again does nothing');
  update public.support_incidents set next_escalation_at = now() - interval '1 second' where id = inc2;
  perform public.support_incident_escalate_due();
  update public.support_incidents set next_escalation_at = now() - interval '1 second' where id = inc2;
  perform public.support_incident_escalate_due();
  perform t.ok((select escalation_level = 3 and next_escalation_at is null from public.support_incidents where id = inc2), 'stops at the maximum level and stays flagged');
  perform t.ok((select count(*) from public.support_incident_escalate_due()) = 0, 'no more escalation events');
  perform t.ok((select status from public.support_incidents where id = inc2) = 'escalated', 'still an open alert');

  -- acknowledged but open: follow-up
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform public.support_incident_acknowledge(inc2);
  update public.support_incidents set next_escalation_at = now() - interval '1 second', escalation_level = 0 where id = inc2;
  perform set_config('request.jwt.claim.sub', '', true);
  select * into rec from public.support_incident_escalate_due();
  perform t.ok(rec.action = 'followup' and rec.level = 1, 'acknowledged-but-open produces a follow-up flag');

  -- responder goes away: handed to someone available
  perform public.support_set_presence(c, 'available');
  perform public.support_set_presence(b, 'offline');
  select * into rec from public.support_incident_escalate_due();
  perform t.ok(rec.action = 'reassigned' and (select assigned_to from public.support_incidents where id = inc2) = c, 'work moves to an available officer when the responder goes offline');

  -- nobody available at all
  perform public.support_set_presence(c, 'offline');
  select * into rec from public.support_sos_ingest('EVT-3', 'rider', r3, null, null, null, null, now(), null, '{}'::jsonb);
  inc3 := rec.incident_id;
  perform t.ok(rec.responder_id is null, 'no responder available is not an error');
  perform t.ok(exists (select 1 from public.support_incident_events where incident_id = inc3 and event_type = 'no_responder_available'), 'it is on the timeline');
  perform t.ok((select status = 'triggered' and next_escalation_at is not null from public.support_incidents where id = inc3), 'the incident is still a live alert with a timer');
  perform public.support_set_presence(b, 'available');
  update public.support_incidents set next_escalation_at = now() - interval '1 second' where id = inc3;
  perform public.support_incident_escalate_due();
  perform t.ok((select assigned_to from public.support_incidents where id = inc3) = b, 'escalation finds a responder when one appears');

  -- manual reassignment
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises(format($q$select public.support_incident_reassign(%L, %L, 'x')$q$, inc3, c), 'reason', 'reason needed');
  perform t.raises(format($q$select public.support_incident_reassign(%L, %L, 'handing over to the night officer')$q$, inc3, d), 'cannot take emergencies', 'cannot hand to a watcher');
  perform public.support_incident_reassign(inc3, c, 'handing over to the night officer');
  perform t.ok((select assigned_to from public.support_incidents where id = inc3) = c, 'responder can hand over');
  perform t.raises(format($q$select public.support_incident_reassign(%L, %L, 'taking it back myself')$q$, inc3, b), 'only the responder', 'but not after losing ownership');

  -- board view: details hidden from watchers
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.ok((select detail_visible and identity_code is not null from public.support_incident_board_view where id = inc3), 'officer sees details on the board');
  perform set_config('request.jwt.claim.sub', d::text, true);
  perform t.ok((select not detail_visible and identity_code is null and last_location is null and trip_ref is null from public.support_incident_board_view where id = inc2), 'watcher sees only status');
  perform t.ok((select count(*) from public.support_incident_board_view) >= 3, 'but still sees that emergencies exist');
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 5. Location sessions, settings, audit, reports ------------------------------
do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  c constant uuid := '00000000-0000-0000-0000-00000000000c';
  d constant uuid := '00000000-0000-0000-0000-00000000000d';
  e constant uuid := '00000000-0000-0000-0000-00000000000e';
  r2 constant uuid := '11111111-0000-0000-0000-000000000002';
  r9 constant uuid := '11111111-0000-0000-0000-000000000009';
  code2 text; tk uuid; tk2 uuid; cust uuid; sess jsonb; sid uuid; sid2 uuid; g jsonb; n int; j jsonb; inc uuid;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  select code into code2 from public.support_identity_codes where subject_ref = r2;
  select customer_id into cust from public.support_identity_codes where code = code2;
  insert into public.support_tickets (customer_id, subject, channel, assigned_agent_id, status) values (cust, 'Where is my driver', 'form', b, 'assigned') returning id into tk;
  update public.support_safety_settings set location_requires_approval = false, location_session_minutes = 15, location_max_active_per_officer = 3;

  -- Request rules
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises(format($q$select public.support_request_location(%L, null, %L, 'too short')$q$, tk, code2), 'at least 10', 'a reason is required');
  perform t.raises(format($q$select public.support_request_location(%L, null, null, 'rider asked where the car is')$q$, tk), 'identity code', 'an identity code is required');
  perform t.raises(format($q$select public.support_request_location(%L, null, 'RAR-AAAAA-AAAAA', 'rider asked where the car is')$q$, tk), 'identity code', 'and it must exist');
  perform t.raises($q$select public.support_request_location(null, null, null, 'rider asked where the car is')$q$, 'exactly one', 'a case is required');
  sess := public.support_request_location(tk, null, code2, 'Rider asked where the car is');
  sid := (sess->>'id')::uuid;
  perform t.ok(sess->>'status' = 'active' and (sess->>'expires_at')::timestamptz between now() + interval '14 minutes' and now() + interval '16 minutes', 'session is active for the configured time');
  perform t.ok((public.support_request_location(tk, null, code2, 'Rider asked where the car is')->>'id')::uuid = sid, 'asking again returns the same session');
  perform t.ok(exists (select 1 from public.support_audit_log where action = 'location_session_requested' and entity_id = sid::text), 'the request is audited with who and why');
  perform set_config('request.jwt.claim.sub', c::text, true);
  perform t.raises(format($q$select public.support_request_location(%L, null, %L, 'checking on behalf of Bola')$q$, tk, code2), 'handling this case', 'an officer who does not own the case cannot open a session');
  perform set_config('request.jwt.claim.sub', e::text, true);
  perform t.ok((public.support_request_location(tk, null, code2, 'Supervisor review of the case')->>'status') = 'active', 'a supervisor can');

  -- Gate
  perform set_config('request.jwt.claim.sub', '', true);
  g := public.support_location_gate(sid, b);
  perform t.ok((g->>'ok')::boolean and g->>'subject_ref' = r2::text, 'the gate allows the owner');
  perform t.ok(not (public.support_location_gate(sid, c)->>'ok')::boolean and public.support_location_gate(sid, c)->>'reason' = 'not_your_session', 'but not anyone else');
  perform t.ok(public.support_location_gate(sid, d)->>'reason' = 'not_your_session', 'nor a watcher');
  perform t.ok(public.support_location_gate(gen_random_uuid(), b)->>'reason' = 'not_found', 'nor an unknown session');
  perform public.support_location_log(sid, b, 'served', 3);
  perform public.support_location_log(sid, b, 'served', 4);
  perform public.support_location_log(sid, b, 'unavailable', null);
  perform t.ok((select count(*) from public.support_location_access_log where session_id = sid) = 3, 'every fetch is logged');
  perform t.ok((select count(*) from public.support_audit_log where action = 'location_viewed' and entity_id = sid::text) = 1, 'the first view is audited once');
  perform t.raises(format($q$select public.support_location_log(%L, %L, 'bogus', 1)$q$, sid, b), 'bad outcome', 'outcomes are validated');
  insert into public.support_location_access_log (session_id, actor_id, outcome) select sid, b, 'served' from generate_series(1, 30);
  perform t.ok(public.support_location_gate(sid, b)->>'reason' = 'rate_limited', 'polling too fast is stopped');
  delete from public.support_location_access_log where session_id = sid;

  -- Expiry
  update public.support_location_sessions set expires_at = now() - interval '1 second' where id = sid;
  perform t.ok(public.support_location_gate(sid, b)->>'reason' = 'expired', 'an expired session is refused');
  perform t.ok((select status from public.support_location_sessions where id = sid) = 'expired', 'and marked expired');

  -- Ends with the case
  perform set_config('request.jwt.claim.sub', b::text, true);
  sid := (public.support_request_location(tk, null, code2, 'Second look for the same rider')->>'id')::uuid;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.support_tickets set status = 'resolved' where id = tk;
  perform t.ok((select status = 'ended' and end_reason = 'case closed' from public.support_location_sessions where id = sid), 'resolving the case ends the session');
  perform t.ok(public.support_location_gate(sid, b)->>'reason' = 'ended', 'and the gate refuses it');
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises(format($q$select public.support_request_location(%L, null, %L, 'Looking again after closing')$q$, tk, code2), 'closed', 'no new session on a closed case');

  -- Approval policy
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.support_tickets (customer_id, subject, channel, assigned_agent_id, status) values (cust, 'Driver detour', 'form', b, 'assigned') returning id into tk2;
  update public.support_safety_settings set location_requires_approval = true;
  perform set_config('request.jwt.claim.sub', b::text, true);
  sess := public.support_request_location(tk2, null, code2, 'Rider says the driver took a detour');
  sid := (sess->>'id')::uuid;
  perform t.ok(sess->>'status' = 'pending_approval', 'policy holds the request for approval');
  perform set_config('request.jwt.claim.sub', '', true);
  perform t.ok(public.support_location_gate(sid, b)->>'reason' = 'awaiting_approval', 'no location while pending');
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises(format($q$select public.support_decide_location(%L, true)$q$, sid), 'supervisor', 'the officer cannot approve their own request');
  perform set_config('request.jwt.claim.sub', e::text, true);
  perform public.support_decide_location(sid, true);
  perform t.ok((select status = 'active' and approved_by = e from public.support_location_sessions where id = sid), 'a supervisor approves');
  perform t.ok(exists (select 1 from public.support_audit_log where action = 'location_session_approved' and entity_id = sid::text), 'approval is audited');
  perform t.raises(format($q$select public.support_decide_location(%L, true)$q$, sid), 'no longer waiting', 'approving twice is refused');

  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.support_location_sessions (ticket_id, subject_type, subject_ref, requested_by, reason, status, expires_at)
    values (tk2, 'rider', r2, a, 'Supervisor requested directly', 'pending_approval', now() + interval '10 minutes') returning id into sid2;
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform t.raises(format($q$select public.support_decide_location(%L, true)$q$, sid2), 'your own request', 'nobody approves their own request');
  perform set_config('request.jwt.claim.sub', e::text, true);
  perform public.support_decide_location(sid2, false, 'not needed');
  perform t.ok((select status from public.support_location_sessions where id = sid2) = 'denied', 'a supervisor can deny');

  -- Emergencies are never held for approval
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.support_set_presence(b, 'available');
  select incident_id into inc from public.support_sos_ingest('EVT-LOC', 'rider', r9, null, null, null, null, now(), null, '{}'::jsonb);
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.ok(public.support_request_location(null, inc, null, 'Panic pressed, need a position')->>'status' = 'active', 'an emergency session is active despite the approval policy');

  -- Revocation
  perform public.support_end_location((public.support_request_location(null, inc, null, 'Panic pressed, need a position')->>'id')::uuid, 'done');
  perform t.ok(not exists (select 1 from public.support_location_sessions where incident_id = inc and status = 'active'), 'the requester can end it');
  perform set_config('request.jwt.claim.sub', c::text, true);
  perform t.raises(format($q$select public.support_end_location(%L)$q$, sid), 'requester or a supervisor', 'a bystander cannot end it');
  perform set_config('request.jwt.claim.sub', e::text, true);
  perform public.support_end_location(sid, 'precaution');
  perform t.ok((select status = 'ended' from public.support_location_sessions where id = sid), 'a supervisor can revoke it');

  -- Open-session limit
  update public.support_safety_settings set location_requires_approval = false, location_max_active_per_officer = 1;
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform public.support_request_location(null, inc, null, 'Panic pressed, need a position');
  perform t.raises(format($q$select public.support_request_location(%L, null, %L, 'Another look at the rider')$q$, tk2, code2), 'too many open', 'open sessions per officer are limited');
  update public.support_safety_settings set location_max_active_per_officer = 3;

  -- Sweep
  perform set_config('request.jwt.claim.sub', '', true);
  update public.support_location_sessions set expires_at = now() - interval '1 minute' where status = 'active';
  insert into public.support_location_access_log (session_id, actor_id, outcome, created_at) values (sid, b, 'served', now() - interval '40 days');
  j := public.support_location_sweep();
  perform t.ok((j->>'expired')::int >= 1 and (j->>'access_rows_purged')::int >= 1, 'the sweep expires sessions and purges old logs');
  perform t.ok(not exists (select 1 from public.support_location_sessions where status = 'active' and expires_at <= now()), 'nothing stays active past its time');

  -- Settings
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises($q$select public.support_update_safety_settings('{"location_session_minutes": 30}')$q$, 'supervisor', 'officers cannot change safety settings');
  perform set_config('request.jwt.claim.sub', e::text, true);
  j := public.support_update_safety_settings('{"location_session_minutes": 30, "location_requires_approval": false}');
  perform t.ok((j->>'location_session_minutes')::int = 30, 'a supervisor can');
  perform t.raises($q$select public.support_update_safety_settings('{"location_session_minutes": 0}')$q$, 'check', 'out-of-range values are refused');
  perform t.ok(exists (select 1 from public.support_audit_log where action = 'safety_settings_updated'), 'settings changes are audited');
  perform public.support_update_safety_settings('{"location_session_minutes": 15}');

  -- Audit search
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises($q$select * from public.support_audit_search()$q$, 'supervisor', 'officers cannot read the audit log');
  perform set_config('request.jwt.claim.sub', e::text, true);
  select count(*) into n from public.support_audit_search('sos_');
  perform t.ok(n >= 3, 'audit search filters by action');
  select count(*) into n from public.support_audit_search(null, b);
  perform t.ok(n >= 3, 'audit search filters by actor');
  select count(*) into n from public.support_audit_search(null, null, now() + interval '1 day');
  perform t.ok(n = 0, 'audit search filters by date');
  select count(*) into n from public.support_audit_search(null, null, null, null, 2);
  perform t.ok(n = 2, 'audit search honours the limit');
  perform public.support_log_export('report_csv', 12);
  perform t.ok(exists (select 1 from public.support_audit_log where action = 'export' and entity_id = 'report_csv'), 'exports are audited');

  -- Reports
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform t.raises($q$select public.support_report_summary()$q$, 'supervisor', 'officers cannot run reports');
  perform set_config('request.jwt.claim.sub', e::text, true);
  j := public.support_report_summary(now() - interval '1 day', now() + interval '1 day');
  perform t.ok((j->'cases'->>'total')::int >= 2, 'report counts cases');
  perform t.ok(jsonb_typeof(j->'by_category') = 'array' and jsonb_typeof(j->'by_agent') = 'array', 'report has breakdowns');
  perform t.ok((j->'emergencies'->>'total')::int >= 4, 'report counts emergencies');
  perform t.ok((j->'emergencies'->>'avg_seconds_to_acknowledge') is not null, 'report has acknowledgement time');
  perform t.ok((j->'location'->>'sessions')::int >= 3, 'report counts location sessions');
  j := public.support_report_summary(now() - interval '1 day', now() + interval '1 day', b, 'no_such_category');
  perform t.ok((j->'cases'->>'total')::int = 0, 'report filters by agent and category');
  perform t.raises($q$select public.support_report_summary(now(), now() - interval '1 day')$q$, 'before the end', 'bad range refused');
  perform t.raises($q$select public.support_report_summary(now() - interval '2 years', now())$q$, '366', 'huge range refused');

  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 6. What a signed-in browser can and cannot reach (real roles, real RLS) -----
do $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  c constant uuid := '00000000-0000-0000-0000-00000000000c';
  d constant uuid := '00000000-0000-0000-0000-00000000000d';
  e constant uuid := '00000000-0000-0000-0000-00000000000e';
  n int;
begin
  set local role authenticated;

  perform set_config('request.jwt.claim.sub', b::text, true);
  select count(*) into n from public.support_incidents;
  perform t.ok(n >= 3, 'an officer can read incidents');
  select count(*) into n from public.support_location_sessions where requested_by <> b;
  perform t.ok(n = 0, 'an officer sees only their own location sessions');
  select count(*) into n from public.support_audit_log;
  perform t.ok(n = 0, 'an officer cannot read the audit log');
  select count(*) into n from public.support_location_access_log;
  perform t.ok(n = 0, 'an officer cannot read location access logs');
  select count(*) into n from public.support_identity_lookups;
  perform t.ok(n = 0, 'an officer cannot read lookup history');
  perform t.raises($q$select count(*) from public.support_identity_codes$q$, 'permission denied', 'nobody can list identity codes directly');
  perform t.raises($q$select * from public.support_sos_ingest('X','rider',gen_random_uuid(),null,null,null,null,null,null,null)$q$, 'permission denied', 'the browser cannot inject an SOS');
  perform t.raises($q$select public.support_location_gate(gen_random_uuid(), gen_random_uuid())$q$, 'permission denied', 'the browser cannot call the location gate');
  perform t.raises($q$select public.support_issue_identity_code('rider', gen_random_uuid())$q$, 'permission denied', 'the browser cannot mint identity codes');
  perform t.raises($q$select * from public.support_incident_escalate_due()$q$, 'permission denied', 'the browser cannot run escalation');
  perform t.raises($q$update public.support_incidents set status = 'resolved'$q$, 'permission denied', 'the browser cannot write incidents directly');
  perform t.raises($q$insert into public.support_location_sessions (subject_type, subject_ref, requested_by, reason, expires_at) values ('rider', gen_random_uuid(), auth.uid(), 'forged session row', now())$q$, 'permission denied', 'the browser cannot forge a location session');
  perform t.raises($q$update public.support_agents set role_kind = 'supervisor'$q$, 'permission denied', 'an officer cannot promote themselves');

  perform set_config('request.jwt.claim.sub', d::text, true);
  select count(*) into n from public.support_incidents;
  perform t.ok(n = 0, 'a watcher cannot read incident rows');
  select count(*) into n from public.support_incident_events;
  perform t.ok(n = 0, 'a watcher cannot read incident timelines');
  select count(*) into n from public.support_incident_board_view;
  perform t.ok(n >= 3, 'a watcher can read the redacted board');

  perform set_config('request.jwt.claim.sub', e::text, true);
  select count(*) into n from public.support_audit_log;
  perform t.ok(n > 10, 'a supervisor can read the audit log');
  select count(*) into n from public.support_location_sessions;
  perform t.ok(n >= 3, 'a supervisor sees every location session');

  reset role;
end $$;
