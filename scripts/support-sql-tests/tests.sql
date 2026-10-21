-- PArAsYtE | RA-Workspace support module
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema t;
grant usage on schema t to public;
create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ASSERT FAILED: %', msg; end if; end $$;
create function t.raises(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm !~* pattern then
      raise exception 'ASSERT FAILED: % (wrong error: %)', msg, sqlerrm;
    end if;
    return;
  end;
  raise exception 'ASSERT FAILED: % (expected an error matching %, got none)', msg, pattern;
end $$;
grant execute on all functions in schema t to public;

-- People -------------------------------------------------------------------
insert into auth.users (id) values
 ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),
 ('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d'),
 ('00000000-0000-0000-0000-00000000000e'),('00000000-0000-0000-0000-00000000000f');
insert into public.employee_profiles (id, full_name, email, role, job_title, department) values
 ('00000000-0000-0000-0000-00000000000a','Ada Admin','a@x.com','admin','',''),
 ('00000000-0000-0000-0000-00000000000b','Bola Agent','b@x.com','support','Support Officer','Support'),
 ('00000000-0000-0000-0000-00000000000c','Chidi Agent','c@x.com','employee','Officer','Operations'),
 ('00000000-0000-0000-0000-00000000000d','Dayo Outsider','d@x.com','employee','Engineer','Engineering'),
 ('00000000-0000-0000-0000-00000000000e','Emeka Head','e@x.com','employee','Head of Support','Support'),
 ('00000000-0000-0000-0000-00000000000f','Femi Team Lead','f@x.com','employee','Team Lead','Marketing');

-- C is not in the Support department but is provisioned as an officer.
insert into public.support_agents (employee_id, skills) values
 ('00000000-0000-0000-0000-00000000000b', array['booking']),
 ('00000000-0000-0000-0000-00000000000c', array['payments']);

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  c constant uuid := '00000000-0000-0000-0000-00000000000c';
  d constant uuid := '00000000-0000-0000-0000-00000000000d';
  e constant uuid := '00000000-0000-0000-0000-00000000000e';
  f constant uuid := '00000000-0000-0000-0000-00000000000f';
  night uuid; day_ uuid;
begin
  -- 1. Authorization model -------------------------------------------------
  perform t.ok(public.support_is_staff(a), 'admin is staff');
  perform t.ok(public.support_is_staff(b), 'support role is staff');
  perform t.ok(public.support_is_staff(c), 'provisioned officer outside Support dept is staff');
  perform t.ok(not public.support_is_staff(d), 'engineer is not staff');
  perform t.ok(public.support_is_staff(e), 'Head of Support by job title is staff');
  perform t.ok(public.support_is_supervisor(e), 'Head of Support is supervisor');
  perform t.ok(not public.support_is_staff(f), 'generic team lead is NOT staff');
  perform t.ok(public.support_is_supervisor(a), 'admin is supervisor');
  perform t.ok(not public.support_is_supervisor(b), 'plain officer is not supervisor');
  perform t.ok(not public.support_is_staff(null), 'null user is not staff');

  -- 2. Shift maths, including a shift that crosses midnight -----------------
  select id into night from public.support_shifts where name = 'Night Shift';
  select id into day_  from public.support_shifts where name = 'Day Shift';
  insert into public.support_shift_assignments (shift_id, employee_id, weekday) values
    (night, c, 1),   -- Monday night shift
    (day_,  b, 3);   -- Wednesday day shift
  -- 2026-10-19 is a Monday; Lagos is UTC+1.
  perform t.ok(public.support_is_employee_on_shift(c, '2026-10-19 20:00+01'), 'Mon 20:00 on Monday night shift');
  perform t.ok(public.support_is_employee_on_shift(c, '2026-10-20 03:00+01'), 'Tue 03:00 is still Monday night shift');
  perform t.ok(not public.support_is_employee_on_shift(c, '2026-10-20 07:00+01'), 'Tue 07:00 shift is over (end exclusive)');
  perform t.ok(not public.support_is_employee_on_shift(c, '2026-10-19 06:00+01'), 'Mon 06:00 is before the Monday shift');
  perform t.ok(not public.support_is_employee_on_shift(c, '2026-10-21 03:00+01'), 'Wed 03:00 only counts if Tuesday night is assigned');
  perform t.ok(public.support_is_employee_on_shift(b, '2026-10-21 07:00+01'), 'Wed 07:00 day shift starts');
  perform t.ok(public.support_is_employee_on_shift(b, '2026-10-21 18:59+01'), 'Wed 18:59 still on day shift');
  perform t.ok(not public.support_is_employee_on_shift(b, '2026-10-21 19:00+01'), 'Wed 19:00 day shift ended');
  perform t.ok(not public.support_is_employee_on_shift(b, '2026-10-22 10:00+01'), 'Thu not assigned');
  -- Use a deterministic Thursday window where B has no scheduled shift.
  -- This proves the temporary override itself grants access and then expires,
  -- without depending on the weekday/time when the test suite is executed.
  update public.support_agents
     set shift_override_until = '2026-10-22 12:00+01'
   where employee_id = b;

  perform t.ok(
    public.support_is_employee_on_shift(b, '2026-10-22 11:00+01'),
    'override grants access before expiry'
  );

  perform t.ok(
    not public.support_is_employee_on_shift(b, '2026-10-22 13:00+01'),
    'override expires'
  );

  update public.support_agents
     set shift_override_until = null
   where employee_id = b;
end $$;

-- 3. Privilege boundaries ----------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
  set local role authenticated;
  perform t.ok((select count(*) from public.support_tickets) = 0, 'outsider sees no tickets');
  perform t.raises('insert into public.support_tickets(subject,channel) values (''x'',''voice'')', 'permission denied', 'outsider cannot insert tickets');
  perform t.raises('select public.support_ingest_interaction(''sms'',''inbound'',''x'',''1'',''phone'',''+2348011111111'')', 'permission denied', 'authenticated cannot call ingest');
  perform t.raises('select public.support_set_presence(''00000000-0000-0000-0000-00000000000b'',''offline'')', 'permission denied', 'authenticated cannot set presence directly');
  perform t.raises('select public.support_voice_start_inbound(''CA1'',''+2348011111111'',''+2340000'')', 'permission denied', 'authenticated cannot start voice tickets');
  perform t.raises('select public.support_resolve_customer(''phone'',''+2348011111111'')', 'permission denied', 'authenticated cannot mint customers');
  perform t.raises('select public.support_heartbeat()', 'support access required', 'outsider heartbeat refused');
  perform t.raises('select public.support_claim_ticket(gen_random_uuid())', 'support access required', 'outsider cannot claim');
  perform t.ok((select count(*) from public.support_agent_presence_view) = 0, 'outsider sees no presence');
  reset role;
  set local role anon;
  perform t.raises('select count(*) from public.support_tickets', 'permission denied', 'anon cannot read tickets');
  perform t.raises('select public.support_is_staff(null)', 'permission denied', 'anon cannot probe staff status');
  reset role;
end $$;

-- 4. Ingest pipeline ---------------------------------------------------------
do $$
declare r record; r2 record; r3 record; tk public.support_tickets%rowtype; n int;
begin
  select * into r from public.support_ingest_interaction('sms','inbound','twilio','SM1','phone','08012345678','Tola','Need help','My driver has not arrived', p_source_reference => 'sms:+2348012345678');
  perform t.ok(r.ticket_created and not r.duplicate, 'first SMS creates a ticket');
  select * into tk from public.support_tickets where id = r.ticket_id;
  perform t.ok(tk.priority = 'P1' and tk.category = 'active_ride', 'triage: driver not arrived is P1 active_ride, got '||tk.priority||'/'||tk.category);
  perform t.ok(tk.first_response_due_at = tk.created_at + interval '5 minutes', 'P1 first-response SLA is 5 minutes');
  perform t.ok(tk.resolution_due_at = tk.created_at + interval '240 minutes', 'P1 resolution SLA is 240 minutes');
  perform t.ok(tk.status = 'queued' and tk.queue_id = (select id from public.support_queues where name='SMS'), 'routed to SMS queue');
  perform t.ok((select primary_phone from public.support_customers where id = r.customer_id) = '+2348012345678', 'Nigerian local number normalised');

  -- same webhook delivered twice
  select * into r2 from public.support_ingest_interaction('sms','inbound','twilio','SM1','phone','08012345678', p_source_reference => 'sms:+2348012345678');
  perform t.ok(r2.duplicate and r2.ticket_id = r.ticket_id, 'replayed webhook is a no-op');

  -- same customer, other channel and format, joins the open ticket
  select * into r3 from public.support_ingest_interaction('voice','inbound','twilio','CA9','phone','+234 801 234 5678');
  perform t.ok(r3.ticket_id = r.ticket_id and not r3.ticket_created, 'call from same person attaches to the open ticket');
  select count(*) into n from public.support_interactions where ticket_id = r.ticket_id;
  perform t.ok(n = 2, 'timeline has both interactions');

  -- a different person gets a different ticket; safety goes to the safety queue at P0
  select * into r2 from public.support_ingest_interaction('whatsapp','inbound','whatsapp','W1','phone','+2348099999999',null,null,'There has been an accident, please help');
  select * into tk from public.support_tickets where id = r2.ticket_id;
  perform t.ok(r2.ticket_id <> r.ticket_id, 'different customer, different ticket');
  perform t.ok(tk.priority = 'P0' and tk.category = 'safety', 'accident is P0 safety');
  perform t.ok(tk.queue_id = (select id from public.support_queues where name='Safety & Emergency'), 'safety queue used');

  -- priority only ever escalates on attach
  select * into r3 from public.support_ingest_interaction('sms','inbound','twilio','SM2','phone','08012345678',null,null,'also I was charged twice', p_source_reference => 'sms:+2348012345678');
  perform t.ok((select priority from public.support_tickets where id = r.ticket_id) = 'P1', 'P2 message does not lower P1 ticket');

  -- email identity, lower-cased, unknown phone becomes external identity
  select * into r2 from public.support_ingest_interaction('email','inbound','zoho','E1','email','  Someone@Example.COM ','Some One','Receipt','Please send my receipt');
  perform t.ok((select identity_value from public.support_customer_identities where customer_id = r2.customer_id) = 'someone@example.com', 'email normalised');
  select * into r2 from public.support_ingest_interaction('voice','inbound','twilio','CA10','phone','anonymous');
  perform t.ok((select identity_type from public.support_customer_identities where customer_id = r2.customer_id) = 'external', 'withheld number handled');
  begin
    perform public.support_ingest_interaction('fax','inbound','x','1','phone','+2348011111111');
    raise exception 'ASSERT FAILED: invalid channel accepted';
  exception when others then
    if sqlerrm !~ 'invalid channel' then raise; end if;
  end;
end $$;

-- 5. WhatsApp and intake forms flow into tickets without being able to break the source insert
do $$
declare cid uuid; tid uuid; tk public.support_tickets%rowtype; n int;
begin
  insert into public.support_whatsapp_conversations (wa_id, customer_name) values ('2348055550000','Kemi') returning id into cid;
  insert into public.support_whatsapp_messages (conversation_id, whatsapp_message_id, direction, body) values (cid,'wamid.1','inbound','Hello, I need to change my booking');
  select id into tid from public.support_tickets where source_reference = 'wa:'||cid::text;
  perform t.ok(tid is not null, 'WhatsApp message created a ticket');
  perform t.ok((select display_name from public.support_customers c join public.support_tickets x on x.customer_id=c.id where x.id=tid) = 'Kemi', 'customer named from WhatsApp profile');
  insert into public.support_whatsapp_messages (conversation_id, whatsapp_message_id, direction, body) values (cid,'wamid.2','inbound','Are you there?');
  select count(*) into n from public.support_tickets where source_reference = 'wa:'||cid::text;
  perform t.ok(n = 1, 'second WhatsApp message joins the same ticket');
  perform t.ok((select first_responded_at from public.support_tickets where id=tid) is null, 'no response yet');
  insert into public.support_whatsapp_messages (conversation_id, whatsapp_message_id, direction, body) values (cid,'wamid.3','outbound','Hi Kemi, how can we help?');
  select * into tk from public.support_tickets where id = tid;
  perform t.ok(tk.first_responded_at is not null and tk.status = 'in_progress', 'agent reply stops first-response clock');
  -- a message the pipeline cannot ticket must still save
  insert into public.support_whatsapp_messages (conversation_id, whatsapp_message_id, direction, body, message_type) values (cid,'wamid.4','inbound','','image');
  perform t.ok((select count(*) from public.support_whatsapp_messages where conversation_id = cid) = 4, 'source inserts always succeed');

  insert into public.intake_submissions (form_title_snapshot, category_title_snapshot, payload, destination_workstation)
  values ('Complaint form','Complaints', '{"full_name":"Yemi","phone":"08031112222","email":"y@x.com","message":"Driver was rude","nested":{"a":1}}', 'support');
  select * into tk from public.support_tickets where channel = 'form' and subject = 'Complaint form';
  perform t.ok(tk.id is not null and tk.category = 'complaint', 'support form became a complaint ticket');
  perform t.ok((select count(*) from public.support_customer_identities where customer_id = tk.customer_id) = 2, 'form captured both phone and email identities');
  insert into public.intake_submissions (form_title_snapshot, category_title_snapshot, payload, destination_workstation)
  values ('Hiring form','HR', '{"name":"Z"}', 'people');
  perform t.ok((select count(*) from public.support_tickets where subject = 'Hiring form') = 0, 'non-support forms are ignored');
end $$;

-- 6. Staff RPCs and ownership rules ---------------------------------------------
do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  c constant uuid := '00000000-0000-0000-0000-00000000000c';
  e constant uuid := '00000000-0000-0000-0000-00000000000e';
  tid uuid; detail jsonb;
begin
  select id into tid from public.support_tickets where subject = 'Need help';
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  perform public.support_claim_ticket(tid);
  perform t.ok((select assigned_agent_id from public.support_tickets where id = tid) = b, 'B claimed the ticket');
  perform t.ok((select status from public.support_tickets where id = tid) = 'assigned', 'claim moves queued to assigned');
  perform t.raises('update public.support_tickets set status=''closed''', 'permission denied', 'no direct updates');
  perform public.support_update_ticket(tid, 'waiting_customer');
  perform public.support_add_note(tid, 'Called driver, ETA 5 minutes');
  detail := public.support_ticket_detail(tid);
  perform t.ok(jsonb_array_length(detail->'notes') = 1 and jsonb_array_length(detail->'interactions') = 3, 'detail has timeline and note');
  perform t.ok(detail #>> '{customer,display_name}' = 'Tola', 'detail has customer');
  perform t.ok(jsonb_array_length(detail->'events') >= 3, 'ticket audit trail recorded');
  perform t.ok((select actor_id from public.support_ticket_events where ticket_id = tid and event_type='status_changed' order by id desc limit 1) = b, 'audit trail records WHO changed status');
  -- customer replies: waiting_customer wakes up
  reset role;
  perform public.support_ingest_interaction('sms','inbound','twilio','SM3','phone','08012345678',null,null,'He is here now', p_source_reference => 'sms:+2348012345678');
  perform t.ok((select status from public.support_tickets where id = tid) = 'in_progress', 'customer reply wakes a waiting ticket');

  -- C cannot touch B's ticket; supervisor can reassign it
  perform set_config('request.jwt.claim.sub', c::text, true);
  set local role authenticated;
  perform t.raises(format('select public.support_update_ticket(%L,''resolved'')', tid), 'belongs to another', 'cannot edit a colleague''s ticket');
  perform t.raises(format('select public.support_claim_ticket(%L)', tid), 'already assigned', 'cannot steal a ticket');
  perform t.raises(format('select public.support_assign_ticket(%L,%L)', tid, c), 'supervisor access required', 'officers cannot reassign');
  reset role;
  perform set_config('request.jwt.claim.sub', e::text, true);
  set local role authenticated;
  perform public.support_assign_ticket(tid, c);
  perform t.ok((select assigned_agent_id from public.support_tickets where id = tid) = c, 'supervisor reassigned');
  reset role;
  perform t.ok((select count(*) from public.support_audit_log where action='ticket_assigned') = 1, 'reassignment audited');

  -- resolve / close / reopen rules
  perform set_config('request.jwt.claim.sub', c::text, true);
  set local role authenticated;
  perform t.raises(format('select public.support_update_ticket(%L,''closed'')', tid), 'resolve the ticket before', 'must resolve before closing');
  perform t.raises(format('select public.support_update_ticket(%L,''assigned'')', tid), 'cannot be set manually', 'cannot set assigned by hand');
  perform t.raises(format('select public.support_update_ticket(%L,NULL,''P9'')', tid), 'invalid priority', 'bad priority refused');
  perform public.support_update_ticket(tid, 'resolved');
  reset role;
  perform t.ok((select resolved_at from public.support_tickets where id = tid) is not null, 'resolved_at stamped');
  perform public.support_ingest_interaction('sms','inbound','twilio','SM4','phone','08012345678',null,null,'Actually still not fixed', p_source_reference => 'sms:+2348012345678');
  perform t.ok((select status from public.support_tickets where id = tid) = 'reopened', 'customer reply within 7 days reopens');
  perform t.ok((select reopen_count from public.support_tickets where id = tid) = 1, 'reopen counted');
  perform t.ok((select resolved_at from public.support_tickets where id = tid) is null, 'reopen clears resolved_at');

  -- priority change recomputes SLA from creation
  perform set_config('request.jwt.claim.sub', c::text, true);
  set local role authenticated;
  perform public.support_update_ticket(tid, null, 'P0');
  reset role;
  perform t.ok((select first_response_due_at from public.support_tickets where id=tid) = (select created_at + interval '2 minutes' from public.support_tickets where id=tid), 'raising priority to P0 recomputes the first-response SLA from creation');
end $$;

-- 7. Presence ---------------------------------------------------------------------
do $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  c constant uuid := '00000000-0000-0000-0000-00000000000c';
  d constant uuid := '00000000-0000-0000-0000-00000000000d';
  j jsonb; st text;
begin
  perform t.raises(format('select public.support_set_presence(%L,''available'')', d), 'not_provisioned', 'non-officer cannot have presence');
  update public.support_agents set shift_override_until = null;
  delete from public.support_shift_assignments where employee_id = b;
  perform t.raises(format('select public.support_set_presence(%L,''available'')', b), 'not_on_shift', 'cannot go Available off shift');
  j := public.support_set_presence(b, 'break');
  perform t.ok(j->>'state' = 'break', 'break allowed off shift');
  update public.support_agents set shift_override_until = now() + interval '1 hour' where employee_id = b;
  j := public.support_set_presence(b, 'available');
  perform t.ok((j->>'on_shift')::boolean, 'override puts officer on shift');

  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  j := public.support_heartbeat();
  perform t.ok(j->>'state' = 'available' and (j->>'provisioned')::boolean, 'heartbeat returns server state');
  perform t.ok((select state from public.support_agent_presence_view where employee_id = b) = 'available', 'view shows available');
  reset role;
  update public.support_agent_presence set last_seen_at = now() - interval '5 minutes' where employee_id = b;
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  select state into st from public.support_agent_presence_view where employee_id = b;
  perform t.ok(st = 'offline', 'stale heartbeat shows offline in the view, got '||st);
  reset role;

  -- maintenance flips the stored state and tells us which TaskRouter workers to fix
  update public.support_agents set provider_worker_id = 'WK_B' where employee_id = b;
  perform t.ok((select count(*) from public.support_maintenance_presence(90) where employee_id = b and new_state = 'offline' and reason = 'stale_heartbeat' and provider_worker_id = 'WK_B') = 1, 'maintenance offlines stale officer');
  perform t.ok((select state from public.support_agent_presence where employee_id = b) = 'offline', 'stored state corrected');
  update public.support_agents set shift_override_until = now() + interval '1 hour' where employee_id = b;
  perform public.support_set_presence(b, 'available');
  update public.support_agents set shift_override_until = null where employee_id = b;
  perform t.ok((select count(*) from public.support_maintenance_presence(90) where employee_id = b and reason = 'shift_ended') = 1, 'maintenance offlines officer whose shift ended');
  perform public.support_set_presence(b, 'wrap_up');
  update public.support_agent_presence set state_changed_at = now() - interval '20 minutes' where employee_id = b;
  perform t.ok((select count(*) from public.support_maintenance_presence(90) where employee_id = b and new_state = 'away') = 1, 'stuck wrap-up becomes away');
end $$;

-- 8. Voice --------------------------------------------------------------------------
do $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  r record; r2 record; cb uuid; cb2 uuid; res text; tk public.support_tickets%rowtype; cl public.support_calls%rowtype;
begin
  select * into r from public.support_voice_start_inbound('CAVOICE1','+2348077770000','+23417000000');
  perform t.ok(not r.duplicate and r.ticket_id is not null and r.caller_phone = '+2348077770000', 'inbound call opens ticket');
  select * into r2 from public.support_voice_start_inbound('CAVOICE1','+2348077770000','+23417000000');
  perform t.ok(r2.duplicate and r2.ticket_id = r.ticket_id and r2.call_id = r.call_id, 'Twilio retry does not duplicate the call');
  perform t.ok((select count(*) from public.support_tickets where customer_id = r.customer_id) = 1, 'still exactly one ticket');

  -- ring, then agent answers
  perform public.support_call_mark_ringing(r.call_id, 'WT1', b);
  perform t.ok((select ringing_agent_id from public.support_calls where id = r.call_id) = b, 'ringing agent recorded for screen pop');
  perform public.support_call_mark_answered('WT1', b, now());
  select * into tk from public.support_tickets where id = r.ticket_id;
  select * into cl from public.support_calls where id = r.call_id;
  perform t.ok(tk.assigned_agent_id = b and tk.first_responded_at is not null and tk.status = 'in_progress', 'answer assigns ticket and stops SLA clock');
  perform t.ok(cl.answered_at is not null and cl.wait_seconds is not null, 'answer stamps wait time');
  perform public.support_call_apply_status('CAVOICE1','completed',125);
  select * into cl from public.support_calls where id = r.call_id;
  perform t.ok(cl.status = 'completed' and cl.duration_seconds = 125 and cl.ended_at is not null, 'completion recorded');
  perform public.support_call_apply_status('CAVOICE1','in-progress');
  perform t.ok((select status from public.support_calls where id = r.call_id) = 'completed', 'late status never moves a call backwards');

  -- abandoned call becomes a callback; duplicates collapse
  select * into r from public.support_voice_start_inbound('CAVOICE2','+2348066660000','+23417000000');
  select callback_id into cb from public.support_call_abandon('CAVOICE2', 42, true);
  perform t.ok(cb is not null, 'abandoned call creates callback');
  select * into tk from public.support_tickets where id = r.ticket_id;
  perform t.ok(tk.priority = 'P2' and tk.subject like 'Missed call%', 'abandoned ticket is P2 and labelled');
  select * into r2 from public.support_voice_start_inbound('CAVOICE3','+2348066660000','+23417000000');
  select callback_id into cb2 from public.support_call_abandon('CAVOICE3', 10, true);
  perform t.ok(cb2 = cb, 'redialling caller does not stack callbacks');
  perform t.ok((select count(*) from public.support_callbacks_due(10) where id = cb) = 1, 'callback is due');
  res := public.support_callback_result(cb, false, 'no-answer');
  perform t.ok(res = 'scheduled' and (select not_before from public.support_callbacks where id=cb) > now(), 'first failure retries later');
  update public.support_callbacks set not_before = now() - interval '1 second' where id = cb;
  perform t.ok((select count(*) from public.support_callbacks_due(10) where id = cb) = 1, 'retry becomes due');
  res := public.support_callback_result(cb, false, 'busy');
  update public.support_callbacks set not_before = now() - interval '1 second' where id = cb;
  perform t.ok(public.support_callback_result(cb, false, 'no-answer') = 'failed', 'gives up after max attempts');
  perform t.ok((select count(*) from public.support_ticket_events where ticket_id = r.ticket_id and event_type = 'callback_failed') = 1, 'failure on the ticket timeline');

  -- withheld numbers cannot be called back
  select * into r from public.support_voice_start_inbound('CAVOICE4','anonymous','+23417000000');
  perform t.ok(r.caller_phone is null, 'withheld caller has no phone');
  perform t.ok((select count(*) from public.support_call_abandon('CAVOICE4', 30, true)) = 0, 'no callback for withheld number');

  -- outbound
  select * into r from public.support_voice_start_outbound('CAOUT1', b, '08071230000', '+23417000000');
  perform t.ok(r.ticket_id is not null, 'outbound call gets a ticket');
  perform t.ok((select count(*) from public.support_tickets where id = r.ticket_id and assigned_agent_id = b) = 1, 'outbound ticket belongs to caller');
  perform public.support_call_apply_status('CAOUT1','in-progress');
  perform t.ok((select first_responded_at from public.support_tickets where id = r.ticket_id) is not null, 'outbound answer is a first response');
  select * into r2 from public.support_voice_start_outbound('CAOUT2', b, '+2348012345678', '+23417000000', r.ticket_id);
  perform t.ok(r2.ticket_id = r.ticket_id, 'click-to-call from a ticket stays on that ticket');
end $$;

-- 9. Dial policy ---------------------------------------------------------------------------
do $$
declare b constant uuid := '00000000-0000-0000-0000-00000000000b'; j jsonb; i int;
begin
  perform t.ok((public.support_check_dial(b,'08012345678')->>'allowed')::boolean, 'Nigerian mobile allowed');
  perform t.ok((public.support_check_dial(b,'+442071838750')->>'allowed')::boolean, 'UK geographic allowed');
  perform t.ok(not (public.support_check_dial(b,'+449012345678')->>'allowed')::boolean, 'UK premium blocked (longest prefix wins over +44)');
  perform t.ok(not (public.support_check_dial(b,'+19005551234')->>'allowed')::boolean, 'US premium blocked');
  perform t.ok(public.support_check_dial(b,'+8613800138000')->>'reason' = 'destination_not_allowed', 'unlisted country denied by default');
  perform t.ok(public.support_check_dial(b,'12345')->>'reason' = 'invalid_number', 'garbage refused');
  update public.support_voice_settings set outbound_limit_per_10min = 2;
  for i in 1..2 loop
    perform public.support_voice_start_outbound('CARATE'||i, b, '+23480100000'||i, '+23417000000');
  end loop;
  perform t.ok(public.support_check_dial(b,'+2348012345678')->>'reason' = 'rate_limited', 'outbound rate limit enforced');
end $$;

-- 10. Supervisor read model -----------------------------------------------------------------
do $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  e constant uuid := '00000000-0000-0000-0000-00000000000e';
  k record;
begin
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  perform t.ok((select count(*) from public.support_kpi_today_view) = 0, 'officers do not see supervisor KPIs');
  perform t.ok((select count(*) from public.support_ticket_summary_view) > 0, 'officers see the ticket list');
  perform t.ok((select count(*) from public.support_audit_log) = 0, 'officers cannot read the audit log');
  perform t.ok((select count(*) from public.support_dial_rules) = 0, 'dial rules hidden from officers');
  reset role;
end $$;

do $$
declare e constant uuid := '00000000-0000-0000-0000-00000000000e'; k record; n int;
begin
  perform set_config('request.jwt.claim.sub', e::text, true);
  set local role authenticated;
  select * into k from public.support_kpi_today_view;
  perform t.ok(k.calls_offered >= 4 and k.calls_abandoned >= 2, 'KPI counts calls: offered='||k.calls_offered||' abandoned='||k.calls_abandoned);
  perform t.ok(k.calls_answered >= 1 and k.answer_rate is not null, 'KPI answer rate');
  perform t.ok(k.open_tickets > 0 and k.callbacks_pending is not null, 'KPI ticket counts');
  perform t.ok((select count(*) from public.support_audit_log) >= 1, 'supervisor reads the audit log');
  select count(*) into n from public.support_dial_rules; perform t.ok(n > 10, 'supervisor reads dial rules');
  perform t.ok((select count(*) from public.support_channel_stats_view) = 6, 'channel stats cover every channel');
  perform t.ok((select count(*) from public.support_queue_snapshot_view) = 8, 'queue snapshot lists seeded queues');
  reset role;
end $$;

select 'ALL SQL TESTS PASSED' as result;
