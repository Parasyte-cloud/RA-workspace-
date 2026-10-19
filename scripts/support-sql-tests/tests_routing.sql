-- PArAsYtE | RA-Workspace support module
\set ON_ERROR_STOP on
set client_min_messages = warning;
-- runs after tests.sql in the same database (t schema exists)

do $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  c constant uuid := '00000000-0000-0000-0000-00000000000c';
  r record; ta uuid; tb uuid; tc uuid; td uuid; te uuid; n int; who uuid;
  function_dummy int;
begin
  -- clean slate for routing: no open tickets for routing assertions
  update public.support_tickets set status = 'closed' where status not in ('resolved','closed');
  update public.support_agent_presence set state = 'offline';

  -- both officers on shift via override, fresh heartbeat; b capacity 1 (booking), c capacity 2 (payments)
  update public.support_agents set shift_override_until = now() + interval '2 hours', messaging_capacity = 1, skills = array['booking'], last_assigned_at = null where employee_id = b;
  update public.support_agents set shift_override_until = now() + interval '2 hours', messaging_capacity = 2, skills = array['payments'], last_assigned_at = null where employee_id = c;
  perform public.support_set_presence(b, 'available');
  perform public.support_set_presence(c, 'available');

  -- no skill needed: lightest load / longest idle wins
  select * into r from public.support_ingest_interaction('whatsapp','inbound','whatsapp','R1','phone','+2348100000001',null,null,'hello there');
  select assigned_agent_id into who from public.support_tickets where id = r.ticket_id;
  perform t.ok(who is not null, 'WhatsApp ticket auto-assigned to an online officer');
  perform t.ok((select status from public.support_tickets where id = r.ticket_id) = 'assigned', 'status moves to assigned');
  perform t.ok((select count(*) from public.support_ticket_events where ticket_id = r.ticket_id and event_type = 'auto_assigned') = 1, 'assignment is on the timeline');
  ta := r.ticket_id;

  -- same customer again: sticks to the same ticket and officer
  select * into r from public.support_ingest_interaction('whatsapp','inbound','whatsapp','R1b','phone','+2348100000001',null,null,'still there?');
  perform t.ok(r.ticket_id = ta and (select assigned_agent_id from public.support_tickets where id = ta) = who, 'follow-up stays with the same officer');

  -- skill routing: a payment problem goes to the payments specialist (c) even if b is lighter
  select * into r from public.support_ingest_interaction('sms','inbound','twilio','R2','phone','+2348100000002',null,null,'I was charged twice for my ride');
  perform t.ok((select assigned_agent_id from public.support_tickets where id = r.ticket_id) = c, 'payment ticket routed to payments specialist');
  tb := r.ticket_id;

  -- capacity: b has capacity 1, c has 2.
  select * into r from public.support_ingest_interaction('whatsapp','inbound','whatsapp','R3','phone','+2348100000003',null,null,'hi');
  select * into r from public.support_ingest_interaction('whatsapp','inbound','whatsapp','R4','phone','+2348100000004',null,null,'hello');
  select count(*) into n from public.support_tickets where assigned_agent_id = b and status = 'assigned';
  perform t.ok(n <= 1, 'officer b never exceeds capacity 1, has '||n);
  select count(*) into n from public.support_tickets where assigned_agent_id = c and status = 'assigned';
  perform t.ok(n <= 2, 'officer c never exceeds capacity 2, has '||n);
  select count(*) into n from public.support_tickets where status in ('assigned') and assigned_agent_id is not null;
  perform t.ok(n = 3, 'total capacity 3 is fully used, assigned='||n);
  perform t.ok((select count(*) from public.support_tickets where status = 'queued') = 1, 'overflow ticket waits in the queue');
  td := (select id from public.support_tickets where status = 'queued');

  -- freeing capacity pulls the waiting ticket automatically
  who := (select assigned_agent_id from public.support_tickets where id = tb);
  update public.support_tickets set status = 'resolved' where id = tb;
  perform t.ok((select status from public.support_tickets where id = td) = 'assigned', 'resolving a ticket assigns the waiting one');

  -- availability gates: break, stale heartbeat, off shift, channel disabled
  update public.support_tickets set status = 'closed' where status not in ('resolved','closed');
  perform public.support_set_presence(b, 'break');
  perform public.support_set_presence(c, 'break');
  select * into r from public.support_ingest_interaction('whatsapp','inbound','whatsapp','R5','phone','+2348100000005',null,null,'anyone?');
  perform t.ok((select assigned_agent_id from public.support_tickets where id = r.ticket_id) is null, 'nobody on break receives work');
  te := r.ticket_id;
  perform public.support_set_presence(b, 'available');
  perform t.ok(public.support_assign_waiting(10) = 1, 'going Available pulls waiting work');
  perform t.ok((select assigned_agent_id from public.support_tickets where id = te) = b, 'work went to the officer who came online');
  update public.support_tickets set status = 'closed' where id = te;

  update public.support_agent_presence set last_seen_at = now() - interval '10 minutes' where employee_id = b;
  select * into r from public.support_ingest_interaction('whatsapp','inbound','whatsapp','R6','phone','+2348100000006',null,null,'hello?');
  perform t.ok((select assigned_agent_id from public.support_tickets where id = r.ticket_id) is null, 'stale browser receives nothing');
  update public.support_tickets set status = 'closed' where id = r.ticket_id;

  update public.support_agent_presence set last_seen_at = now() where employee_id = b;
  update public.support_agents set shift_override_until = null where employee_id = b;
  select * into r from public.support_ingest_interaction('whatsapp','inbound','whatsapp','R7','phone','+2348100000007',null,null,'hello?');
  perform t.ok((select assigned_agent_id from public.support_tickets where id = r.ticket_id) is null, 'officer off shift receives nothing');
  update public.support_tickets set status = 'closed' where id = r.ticket_id;

  update public.support_agents set shift_override_until = now() + interval '2 hours', sms_enabled = false, whatsapp_enabled = false where employee_id = b;
  perform public.support_set_presence(c, 'offline');
  select * into r from public.support_ingest_interaction('sms','inbound','twilio','R8','phone','+2348100000008',null,null,'hello?');
  perform t.ok((select assigned_agent_id from public.support_tickets where id = r.ticket_id) is null, 'officer with the channel disabled receives nothing');
  update public.support_agents set sms_enabled = true, whatsapp_enabled = true where employee_id = b;
  perform t.ok(public.support_assign_waiting(10) = 1, 'enabling the channel releases the work');
  update public.support_tickets set status = 'closed' where status not in ('resolved','closed');

  -- voice is never auto-assigned here (TaskRouter owns it)
  select * into r from public.support_voice_start_inbound('CAROUTE1','+2348100000009','+23417000000');
  perform t.ok((select assigned_agent_id from public.support_tickets where id = r.ticket_id) is null, 'voice tickets are left to TaskRouter');

  -- orphan handling
  perform public.support_set_presence(b, 'available');
  select * into r from public.support_ingest_interaction('whatsapp','inbound','whatsapp','R10','phone','+2348100000010',null,null,'orphan');
  perform t.ok((select assigned_agent_id from public.support_tickets where id = r.ticket_id) = b, 'assigned to b');
  perform public.support_set_presence(b, 'offline');
  alter table public.support_tickets disable trigger support_tickets_sla_trg;
  update public.support_tickets set updated_at = now() - interval '10 minutes' where id = r.ticket_id;
  alter table public.support_tickets enable trigger support_tickets_sla_trg;
  perform t.ok(public.support_requeue_orphaned() = 1, 'ticket held by an absent officer is requeued');
  perform t.ok((select status from public.support_tickets where id = r.ticket_id) = 'queued', 'back in the queue');
end $$;

select 'ROUTING TESTS PASSED' as result;
