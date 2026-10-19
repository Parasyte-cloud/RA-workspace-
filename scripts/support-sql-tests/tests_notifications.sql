-- PArAsYtE | RA-Workspace support module
-- Alerts outside the screen: rules, queueing, delays, cancellation, retries, failure isolation, permissions.
\set ON_ERROR_STOP on
set client_min_messages = warning;

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';
  b constant uuid := '00000000-0000-0000-0000-00000000000b';   -- responder
  c constant uuid := '00000000-0000-0000-0000-00000000000c';
  d constant uuid := '00000000-0000-0000-0000-00000000000d';   -- watcher
  e constant uuid := '00000000-0000-0000-0000-00000000000e';   -- supervisor
  s1 constant uuid := '44444444-0000-0000-0000-000000000001'; -- Lagos team lead
  s2 constant uuid := '44444444-0000-0000-0000-000000000002'; -- Abuja team lead
  inc uuid; inc2 uuid; rec record; n int; nid bigint; cust uuid; tk uuid; sess jsonb; code text; ep text := 'https://push.example.com/send/abc123';
begin
  perform set_config('request.jwt.claim.sub', '', true);

  -- Set the stage: b is the only available officer; everyone with a phone or device is registered.
  update public.support_agent_presence set state = 'offline';
  update public.support_agents set shift_override_until = now() + interval '2 hours' where employee_id in (b, c);
  update public.support_agent_presence set state = 'available', last_seen_at = now() where employee_id = b;
  insert into public.support_agents (employee_id, is_supervisor) values (e, true) on conflict (employee_id) do update set is_supervisor = true, enabled = true;
  insert into public.support_staff_contacts (employee_id, phone) values (b, '+2348011111111'), (e, '+2348022222222'), (s1, '+2348033333333');
  insert into public.support_push_subscriptions (employee_id, endpoint, p256dh, auth)
    values (b, ep, repeat('B', 87), repeat('a', 22)), (e, ep || 'e', repeat('B', 87), repeat('a', 22));
  update public.support_safety_settings set incident_ack_seconds = 60, incident_escalate_seconds = 120, incident_followup_seconds = 900, incident_max_level = 3;
  delete from public.support_notifications;

  -- 1. A new emergency fans out by the rules
  select incident_id into inc from public.support_sos_ingest('EVT-N-1', 'rider', gen_random_uuid(), null, null, null, null, now(), null, '{}'::jsonb);
  perform t.ok((select assigned_to from public.support_incidents where id = inc) = b, 'b took the emergency');
  perform t.ok(exists (select 1 from public.support_notifications where recipient_id = b and kind = 'sos_new' and entity_id = inc::text and severity = 'critical'), 'the responder gets an in-app alert');
  perform t.ok(exists (select 1 from public.support_notifications where recipient_id = e and kind = 'sos_new'), 'supervisors get one too');
  perform t.ok(not exists (select 1 from public.support_notifications where recipient_id in (d, c) and entity_id = inc::text), 'watchers and uninvolved officers get nothing');
  perform t.ok((select count(*) from public.support_notifications where recipient_id = b and entity_id = inc::text) = 1, 'one alert per person, not one per channel');
  perform t.ok(not exists (select 1 from public.support_notifications where body ~* '(lat|lng|[0-9]\.[0-9]{4})' ), 'alerts carry no location or personal detail');

  select count(*) into n from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id
   where x.recipient_id = b and x.entity_id = inc::text and d.status = 'queued';
  perform t.ok(n = 3, 'responder: push, sms and a delayed call are queued');
  perform t.ok((select next_attempt_at from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id
                 where x.recipient_id = b and d.channel = 'voice' and x.entity_id = inc::text) > now() + interval '55 seconds', 'the call waits 60 seconds');
  perform t.ok((select status from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id
                 where x.recipient_id = e and d.channel = 'sms' and x.entity_id = inc::text) = 'queued', 'a supervisor with a phone gets the delayed text');
  perform t.ok((select status from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id
                 where x.recipient_id = s2 and d.channel = 'push' and x.entity_id = inc::text) = 'skipped', 'a supervisor with no device shows as skipped, not silently dropped');
  perform t.ok((select last_error from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id
                 where x.recipient_id = s2 and d.channel = 'push' and x.entity_id = inc::text) like 'no device%', 'with the reason');

  -- 2. Claiming respects the delay and marks rows as in flight
  select count(*) into n from public.support_claim_deliveries(50);
  perform t.ok(n = 3, 'only due deliveries are claimed (b push and sms, e push); the delayed ones wait');
  perform t.ok((select count(*) from public.support_claim_deliveries(50)) = 0, 'claiming twice never hands out the same row');
  perform t.ok((select count(*) from public.support_notification_deliveries where status = 'sending') = 3, 'claimed rows are marked sending');

  -- 3. Results: success, retry with backoff, permanent failure
  select d.id into nid from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id
   where x.recipient_id = b and d.channel = 'sms' and x.entity_id = inc::text;
  perform public.support_delivery_result(nid, true, 'SM123');
  perform t.ok((select status from public.support_notification_deliveries where id = nid) = 'sent', 'success is recorded');
  select d.id into nid from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id
   where x.recipient_id = b and d.channel = 'push' and x.entity_id = inc::text;
  perform public.support_delivery_result(nid, false, null, 'timeout', true);
  select * into rec from public.support_notification_deliveries where id = nid;
  perform t.ok(rec.status = 'queued' and rec.next_attempt_at > now() + interval '10 seconds' and rec.last_error = 'timeout', 'a failure retries later');
  update public.support_notification_deliveries set attempts = 3, status = 'sending' where id = nid;
  perform public.support_delivery_result(nid, false, null, 'timeout', true);
  perform t.ok((select status from public.support_notification_deliveries where id = nid) = 'failed', 'three attempts and it is failed');
  update public.support_notification_deliveries set status = 'sent' where status = 'sending';

  -- 4. Acknowledging cancels the call and the supervisor text that have not gone out
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform public.support_incident_acknowledge(inc);
  perform set_config('request.jwt.claim.sub', '', true);
  perform t.ok(not exists (select 1 from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id
                            where x.entity_id = inc::text and d.status = 'queued' and d.channel in ('sms','whatsapp','voice')), 'nothing is left to ring once it is acknowledged');
  perform t.ok(exists (select 1 from public.support_notification_deliveries d where d.last_error = 'acknowledged' and d.status = 'skipped' and d.channel = 'voice'), 'the call was cancelled and says why');

  -- 5. Escalation alerts louder
  select incident_id into inc2 from public.support_sos_ingest('EVT-N-2', 'driver', gen_random_uuid(), null, null, null, null, now(), null, '{}'::jsonb);
  update public.support_notification_deliveries set status = 'skipped' where status = 'queued';
  update public.support_incidents set next_escalation_at = now() - interval '1 second' where id = inc2;
  perform * from public.support_incident_escalate_due();
  perform t.ok(exists (select 1 from public.support_notifications where kind = 'sos_escalated' and entity_id = inc2::text and recipient_id = e), 'supervisors are alerted when nobody acknowledges');
  perform t.ok(exists (select 1 from public.support_notifications x join public.support_notification_deliveries d on d.notification_id = x.id
                        where x.kind = 'sos_escalated' and x.recipient_id = b and d.channel = 'voice' and d.status = 'queued' and d.next_attempt_at <= now() + interval '1 second'), 'the responder is called straight away');
  perform t.ok(not exists (select 1 from public.support_notifications x join public.support_notification_deliveries d on d.notification_id = x.id
                            where x.kind = 'sos_escalated' and x.level = 1 and x.recipient_id = e and d.channel = 'voice'), 'supervisors are only phoned from level 2');
  perform t.ok((select level from public.support_notifications where kind = 'sos_escalated' and entity_id = inc2::text and recipient_id = e limit 1) = 1, 'the level is recorded');

  -- 6. Resolving cancels everything still waiting
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform public.support_incident_acknowledge(inc2);
  perform public.support_incident_resolve(inc2, 'false_alarm', 'Rider safe, confirmed with the driver and the rider.');
  perform set_config('request.jwt.claim.sub', '', true);
  perform t.ok(not exists (select 1 from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id
                            where x.entity_id = inc2::text and d.status = 'queued'), 'a resolved emergency leaves nothing queued');

  -- 7. Notification faults never stop an emergency
  alter table public.support_notifications rename to support_notifications_off;
  select incident_id into inc from public.support_sos_ingest('EVT-N-3', 'rider', gen_random_uuid(), null, null, null, null, now(), null, '{}'::jsonb);
  alter table public.support_notifications_off rename to support_notifications;
  perform t.ok(exists (select 1 from public.support_incidents where id = inc), 'the emergency is still recorded when the notifier is broken');
  perform t.ok(exists (select 1 from public.support_audit_log where action = 'notify_failed'), 'and the fault is audited');

  -- 8. Repeat presses are throttled
  select count(*) into n from public.support_notifications where kind = 'sos_repeat';
  perform * from public.support_sos_ingest('EVT-N-3B', 'rider', (select subject_ref from public.support_incidents where id = inc), null, null, null, null, now(), null, '{}'::jsonb);
  perform * from public.support_sos_ingest('EVT-N-3C', 'rider', (select subject_ref from public.support_incidents where id = inc), null, null, null, null, now(), null, '{}'::jsonb);
  perform t.ok((select count(*) from public.support_notifications where kind = 'sos_repeat' and recipient_id = b) = 1, 'many presses, one nudge a minute');

  -- 9. Location requests alert the right supervisors
  update public.support_safety_settings set location_requires_approval = true;
  insert into public.support_customers (display_name) values ('Alert Test') returning id into cust;
  code := public.support_issue_identity_code('rider', gen_random_uuid());
  insert into public.support_tickets (customer_id, subject, channel, assigned_agent_id, status) values (cust, 'Where is my driver', 'form', c, 'assigned') returning id into tk;
  delete from public.support_notifications where kind = 'location_pending';
  perform set_config('request.jwt.claim.sub', c::text, true);
  sess := public.support_request_location(tk, null, code, 'Rider asked where the car is');
  perform set_config('request.jwt.claim.sub', '', true);
  perform t.ok(sess->>'status' = 'pending_approval', 'the request is waiting');
  perform t.ok(exists (select 1 from public.support_notifications where kind = 'location_pending' and recipient_id = s2), 'the officer''s own team lead is alerted');
  perform t.ok(exists (select 1 from public.support_notifications where kind = 'location_pending' and recipient_id = e), 'so is an unscoped supervisor');
  perform t.ok(not exists (select 1 from public.support_notifications where kind = 'location_pending' and recipient_id = s1), 'another team''s lead is not');
  update public.support_safety_settings set location_requires_approval = false;

  -- 10. Urgent tickets alert their new owner
  delete from public.support_notifications where kind = 'ticket_urgent';
  insert into public.support_tickets (customer_id, subject, channel, priority, assigned_agent_id, status) values (cust, 'Urgent payment', 'form', 'P0', b, 'assigned');
  insert into public.support_tickets (customer_id, subject, channel, priority, assigned_agent_id, status) values (cust, 'Routine', 'form', 'P3', b, 'assigned');
  perform t.ok((select count(*) from public.support_notifications where kind = 'ticket_urgent' and recipient_id = b) = 1, 'P0 and P1 assignments alert; routine ones do not');

  -- 11. Contacts and devices
  perform set_config('request.jwt.claim.sub', c::text, true);
  perform t.raises($q$select public.support_set_my_contact('12345', true, true, true)$q$, 'not valid', 'a junk phone number is refused');
  perform public.support_set_my_contact('0801 234 5678', true, false, true);
  perform t.ok((select phone from public.support_staff_contacts where employee_id = c) = '+2348012345678' and not (select allow_whatsapp from public.support_staff_contacts where employee_id = c), 'a local number is normalised and flags are kept');
  perform t.ok(not exists (select 1 from public.support_audit_log where action = 'alert_contact_updated' and payload::text like '%8012345678%'), 'the audit trail holds only a masked number');
  perform t.raises($q$select public.support_push_subscribe('http://insecure.example/x', repeat('B', 87), repeat('a', 22))$q$, 'push subscription', 'an insecure endpoint is refused');
  perform public.support_push_subscribe('https://push.example.com/send/c-device', repeat('B', 87), repeat('a', 22), 'Test Browser');
  perform t.ok((select count(*) from public.support_my_push_devices()) = 1, 'a device registers');
  perform public.support_push_unsubscribe('https://push.example.com/send/c-device');
  perform t.ok((select count(*) from public.support_my_push_devices()) = 0, 'and unregisters');
  perform t.raises($q$select public.support_send_test_alert('push')$q$, 'no device', 'a test with no device says so');
  perform public.support_send_test_alert('sms');
  perform t.ok(exists (select 1 from public.support_notification_deliveries d join public.support_notifications x on x.id = d.notification_id where x.recipient_id = c and x.kind = 'test' and d.channel = 'sms' and d.status = 'queued'), 'a test text is queued');
  perform t.raises($q$select public.support_send_test_alert('fax')$q$, 'unknown channel', 'unknown channels are refused');
  perform set_config('request.jwt.claim.sub', '', true);

  -- 12. Sweep recovers stuck sends and keeps data tidy
  update public.support_notification_deliveries set status = 'sending', claimed_at = now() - interval '10 minutes', attempts = 1 where id = (select min(id) from public.support_notification_deliveries);
  perform t.ok((public.support_notifications_sweep()->>'reclaimed')::int >= 1, 'the sweep gives back rows a dead dispatcher left behind');
  insert into public.support_notification_deliveries (notification_id, recipient_id, channel, status, next_attempt_at)
    select id, recipient_id, 'whatsapp', 'queued', now() - interval '20 minutes' from public.support_notifications limit 1;
  perform public.support_notifications_sweep();
  perform t.ok(not exists (select 1 from public.support_notification_deliveries where status = 'queued' and next_attempt_at < now() - interval '15 minutes'), 'a late text is dropped rather than sent hours after the event');

  -- 13. Browser permissions under the real role
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', b::text, true);
  select count(*) into n from public.support_notifications where recipient_id <> b;
  perform t.ok(n = 0, 'a person sees only their own notifications');
  perform t.ok((select count(*) from public.support_notifications) >= 3, 'and does see theirs');
  perform t.raises($q$select count(*) from public.support_push_subscriptions$q$, 'permission denied', 'push keys are not readable from the browser');
  perform t.raises($q$insert into public.support_notifications (recipient_id, kind, title) values (auth.uid(), 'sos_new', 'forged')$q$, 'permission denied', 'a browser cannot forge an alert');
  perform t.raises($q$select public.support_notify('sos_new','critical','x','y',null,null,0,auth.uid())$q$, 'permission denied', 'a browser cannot call the notifier');
  perform t.raises($q$select * from public.support_claim_deliveries(5)$q$, 'permission denied', 'a browser cannot claim deliveries');
  select count(*) into n from public.support_alert_rules;
  perform t.ok(n = 0, 'an officer cannot read the alert rules');
  perform t.ok(public.support_notifications_mark_read() >= 1, 'mark all read works');
  perform t.ok(not exists (select 1 from public.support_notifications where read_at is null), 'and clears the unread count');
  perform t.raises($q$select public.support_delivery_report()$q$, 'supervisor access', 'officers cannot read the delivery report');
  perform set_config('request.jwt.claim.sub', e::text, true);
  perform t.ok(jsonb_array_length(public.support_delivery_report()->'by_channel') >= 2, 'a supervisor can');
  perform t.ok(jsonb_typeof(public.support_delivery_report()->'staff_without_path') = 'array', 'and sees who has no way to be reached');
  select count(*) into n from public.support_alert_rules;
  perform t.ok(n >= 20, 'a supervisor reads the rules');
  reset role;
end $$;
