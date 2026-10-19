-- PArAsYtE | RA-Workspace support module
-- Telephony controls: hours, voicemail, registry, DNC, spend cap, quality, fraud, recordings.
\set ON_ERROR_STOP on
set client_min_messages = warning;

do $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  d constant uuid := '00000000-0000-0000-0000-00000000000d';
  e constant uuid := '00000000-0000-0000-0000-00000000000e';
  st jsonb; r jsonb; v_call uuid; v_cb uuid; n int; m numeric; v_ticket uuid;
begin
  -- Hours: off by default, fails open --------------------------------------
  update public.support_voice_settings set hours_enforced = false, timezone = 'Africa/Lagos', outbound_limit_per_10min = 500;
  perform t.ok((public.support_line_status(timestamptz '2026-10-24 09:00+00')->>'open')::boolean, 'open when hours are not enforced');

  update public.support_voice_settings set hours_enforced = true;
  delete from public.support_business_hours;
  perform t.ok((public.support_line_status(timestamptz '2026-10-24 09:00+00')->>'open')::boolean, 'no hours configured fails open');

  insert into public.support_business_hours (weekday, opens_at, closes_at) select g, '08:00', '18:00' from generate_series(1,5) g;
  -- Mon 19 Oct 2026, 10:00 Lagos = 09:00 UTC
  perform t.ok((public.support_line_status(timestamptz '2026-10-19 09:00+00')->>'open')::boolean, 'open Monday 10:00');
  st := public.support_line_status(timestamptz '2026-10-19 18:00+00');   -- 19:00 Lagos
  perform t.ok(not (st->>'open')::boolean and st->>'reason' = 'closed_hours', 'closed Monday 19:00');
  perform t.ok((st->>'next_open')::timestamptz = timestamptz '2026-10-20 07:00+00', 'next open is Tuesday 08:00 Lagos');
  st := public.support_line_status(timestamptz '2026-10-24 09:00+00');   -- Saturday
  perform t.ok(not (st->>'open')::boolean, 'closed Saturday');
  perform t.ok((st->>'next_open')::timestamptz = timestamptz '2026-10-26 07:00+00', 'next open is Monday 08:00 Lagos');
  -- Early morning same day opens later that day
  perform t.ok(public.support_next_open(timestamptz '2026-10-19 05:00+00') = timestamptz '2026-10-19 07:00+00', 'before opening, next open is today');

  insert into public.support_closures (closes_on, name) values ('2026-10-20', 'Test Holiday');
  st := public.support_line_status(timestamptz '2026-10-20 09:00+00');
  perform t.ok(not (st->>'open')::boolean and st->>'reason' = 'closure' and st->>'closure' = 'Test Holiday', 'closure closes the line');
  perform t.ok(public.support_next_open(timestamptz '2026-10-19 18:00+00') = timestamptz '2026-10-21 07:00+00', 'next open skips the closure');

  -- Route ------------------------------------------------------------------
  r := public.support_voice_route(timestamptz '2026-10-24 09:00+00');
  perform t.ok(r->>'action' = 'voicemail', 'closed with voicemail enabled routes to voicemail');
  update public.support_voice_settings set voicemail_enabled = false;
  perform t.ok(public.support_voice_route(timestamptz '2026-10-24 09:00+00')->>'action' = 'closed', 'closed without voicemail hangs up politely');
  perform t.ok(public.support_voice_route(timestamptz '2026-10-19 09:00+00')->>'action' = 'queue', 'open routes to the queue');
  update public.support_voice_settings set voicemail_enabled = true;

  -- Voicemail --------------------------------------------------------------
  perform public.support_voice_start_inbound('CAvm0001', '+2348012345678', '+2342000000000');
  select id, ticket_id into v_call, v_ticket from public.support_calls where provider_call_id = 'CAvm0001';
  perform public.support_voice_mark_after_hours('CAvm0001');
  perform t.ok((select status from public.support_calls where id = v_call) = 'after_hours', 'call marked after hours');
  v_cb := public.support_voicemail_received('CAvm0001', 'RE0001', 23);
  perform t.ok(v_cb is not null, 'voicemail books a callback');
  perform t.ok((select is_voicemail and recording_sid = 'RE0001' from public.support_calls where id = v_call), 'voicemail stored on the call');
  perform t.ok(public.support_voicemail_received('CAvm0001', 'RE0001', 23) is null, 'same voicemail twice is a no-op');
  perform t.ok((select count(*) from public.support_callbacks where call_id = v_call) = 1, 'exactly one callback');
  perform t.ok((select count(*) from public.support_ticket_events where ticket_id = v_ticket and event_type = 'voicemail_received') = 1, 'ticket records the voicemail');
  perform t.raises($q$select public.support_voicemail_received('CAnope', 'RE9', 1)$q$, 'call not found', 'unknown call is rejected');

  -- Withheld caller voicemail books no callback ------------------------------
  perform public.support_voice_start_inbound('CAvm0002', null, '+2342000000000', true);
  perform public.support_voicemail_received('CAvm0002', 'RE0002', 10);
  perform t.ok((select count(*) from public.support_callbacks c join public.support_calls k on k.id = c.call_id where k.provider_call_id = 'CAvm0002') = 0, 'withheld caller gets no callback');

  -- Registry and caller ID ---------------------------------------------------
  update public.support_voice_settings set caller_id = '+2349000000000';
  r := public.support_pick_caller_id('+2348011112222');
  perform t.ok(r->>'number' = '+2349000000000' and r->>'source' = 'settings', 'falls back to settings caller id');
  insert into public.support_numbers (e164, label, dial_prefix, kind, route) values
    ('+2342111111111', 'Nigeria local', '+234', 'both', 'byoc'),
    ('+442000000000', 'UK local', '+44', 'outbound', 'pstn');
  insert into public.support_numbers (e164, label, kind, route, is_default_outbound) values ('+12025550100', 'US default', 'outbound', 'pstn', true);
  r := public.support_pick_caller_id('+2348011112222');
  perform t.ok(r->>'number' = '+2342111111111' and r->>'route' = 'byoc', 'same-country number wins');
  r := public.support_pick_caller_id('+447700900123');
  perform t.ok(r->>'number' = '+442000000000', 'UK number for UK destination');
  r := public.support_pick_caller_id('+971501234567');
  perform t.ok(r->>'number' = '+12025550100', 'default outbound for other countries');
  perform t.raises($q$insert into public.support_numbers (e164, label, is_default_outbound) values ('+12025550101','x',true)$q$, 'duplicate key', 'only one default outbound number');

  -- Dial policy: DNC ---------------------------------------------------------
  insert into public.support_do_not_contact (phone, reason, source) values ('+2348099999999', 'asked to stop', 'customer_request');
  perform t.ok(public.support_check_dial(b, '+2348099999999')->>'reason' = 'do_not_contact', 'DNC number is blocked');
  perform t.ok((public.support_check_dial(b, '+2348088888888')->>'allowed')::boolean, 'other numbers still allowed');
  update public.support_voice_settings set dnc_enforced = false;
  perform t.ok((public.support_check_dial(b, '+2348099999999')->>'allowed')::boolean, 'DNC can be switched off');
  update public.support_voice_settings set dnc_enforced = true;

  -- Spend cap ----------------------------------------------------------------
  perform t.ok(public.support_spend_today() = 0, 'no spend yet');
  perform public.support_call_set_price(v_call, -3.5, 'USD');
  perform t.ok(public.support_spend_today() = 3.5, 'spend uses absolute price');
  update public.support_voice_settings set spend_cap_daily = 3;
  perform t.ok(public.support_check_dial(b, '+2348088888888')->>'reason' = 'spend_cap_reached', 'daily cap blocks new calls');
  update public.support_voice_settings set spend_cap_daily = null;

  -- Quality -------------------------------------------------------------------
  perform t.ok(public.support_estimate_mos(40, 5, 0) > 4.0, 'good network scores above 4.0');
  perform t.ok(public.support_estimate_mos(400, 80, 8) < 3.0, 'bad network scores under 3.0');
  perform public.support_record_call_quality('CAvm0001', b, 60, 10, 0.5);
  select mos into m from public.support_call_quality order by id desc limit 1;
  perform t.ok(m between 1 and 5, 'mos estimated on the server');
  perform public.support_record_call_quality('CAnone', b, 60, 10, 0.5, 4.2);
  perform t.ok((select call_id is null from public.support_call_quality order by id desc limit 1), 'sample for an unknown call is kept without a link');

  -- Fraud scan -----------------------------------------------------------------
  update public.support_voice_settings set fraud_calls_per_hour = 5;
  insert into public.support_calls (provider_call_id, direction, to_number, status, assigned_agent_id)
  select 'CAfr' || g, 'outbound', '+2348000000' || lpad(g::text, 3, '0'), 'completed', b from generate_series(1, 6) g;
  n := public.support_fraud_scan();
  perform t.ok(n >= 1, 'burst raises an alert');
  perform t.ok(exists (select 1 from public.support_fraud_alerts where kind = 'call_burst' and agent_id = b and resolved_at is null), 'alert names the officer');
  perform t.ok(public.support_fraud_scan() = 0, 'a second scan does not duplicate the open alert');
  update public.support_voice_settings set spend_cap_daily = 1;
  perform public.support_fraud_scan();
  perform t.ok(exists (select 1 from public.support_fraud_alerts where kind = 'spend_cap'), 'spend cap breach raises an alert');
  update public.support_voice_settings set spend_cap_daily = null, fraud_calls_per_hour = 60;

  -- Recordings: role-based access, audit, retention -------------------------------
  update public.support_calls set recording_sid = 'RE0099', assigned_agent_id = b, ended_at = now() - interval '200 days', is_voicemail = false
   where provider_call_id = 'CAfr1';
  select id into v_call from public.support_calls where provider_call_id = 'CAfr1';
  perform t.ok((select recording_sid from public.support_recording_ref(v_call, e)) = 'RE0099', 'supervisor may play');
  perform t.ok((select recording_sid from public.support_recording_ref(v_call, b)) = 'RE0099', 'handling officer may play');
  perform t.raises(format('select * from public.support_recording_ref(%L, %L)', v_call, d), 'not allowed', 'outsider may not play');
  perform t.ok((select count(*) from public.support_audit_log where action = 'recording_played') = 2, 'each play is audited');
  perform t.ok((select count(*) from public.support_recordings_expired(50) where call_id = v_call) = 1, 'old recording is due for purge');
  perform public.support_recording_purged(v_call);
  perform t.ok((select recording_deleted_at is not null from public.support_calls where id = v_call), 'purge marks the call');
  perform t.ok((select count(*) from public.support_recordings_expired(50) where call_id = v_call) = 0, 'purged recording is not due again');
  perform t.raises(format('select * from public.support_recording_ref(%L, %L)', v_call, e), 'not available', 'purged recording cannot be played');
  perform t.ok((select count(*) from public.support_audit_log where action = 'recording_purged') = 1, 'purge is audited');

  -- Old quality samples are pruned
  update public.support_call_quality set sampled_at = now() - interval '200 days' where id = (select min(id) from public.support_call_quality);
  perform t.ok(public.support_purge_quality_samples(90) = 1, 'old quality samples are purged');
end $$;

-- RLS and grants ---------------------------------------------------------------
do $$
declare
  b constant uuid := '00000000-0000-0000-0000-00000000000b';
  e constant uuid := '00000000-0000-0000-0000-00000000000e';
  n int;
begin
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  perform t.ok((select count(*) from public.support_fraud_alerts) = 0, 'officer cannot read fraud alerts');
  perform t.ok((select count(*) from public.support_numbers) = 0, 'officer cannot read the number registry');
  perform t.ok((select count(*) from public.support_business_hours) > 0, 'officer can read business hours');
  perform t.ok((select count(*) from public.support_telephony_health_view) = 0, 'officer gets no health view');
  perform t.raises('insert into public.support_do_not_contact (phone) values (''+2348000000001'')', 'permission denied', 'officer cannot write DNC directly');
  perform t.raises('select public.support_fraud_scan()', 'permission denied', 'officer cannot run the scan');
  reset role;

  perform set_config('request.jwt.claim.sub', e::text, true);
  set local role authenticated;
  perform t.ok((select count(*) from public.support_fraud_alerts) > 0, 'supervisor reads fraud alerts');
  perform t.ok((select count(*) from public.support_telephony_health_view) = 1, 'supervisor reads the health view');
  perform t.ok((select samples_24h from public.support_telephony_health_view) >= 1, 'health view counts samples');
  reset role;

  set local role anon;
  perform t.raises('select * from public.support_numbers', 'permission denied', 'anon cannot read the registry');
  reset role;
end $$;

select 'CONTROLS_OK';
