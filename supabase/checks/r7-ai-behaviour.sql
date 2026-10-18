-- Behaviour checks for 20261017120000_r7_ai_assistant_foundation.sql.
-- Uses the local audit database users: A and EMP5 are employees, HR hosts,
-- ADM is an admin, INACT is a deactivated employee. Everything rolls back.
-- Every line should end in |t.
\set A '''11111111-1111-4111-8111-111111111111'''
\set HR '''22222222-2222-4222-8222-222222222222'''
\set ADM '''33333333-3333-4333-8333-333333333333'''
\set E5 '''55555555-5555-4555-8555-555555555555'''
\set INACT '''66666666-6666-4666-8666-666666666666'''
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :HR, true);
create temp table t_sid(id uuid);
grant all on t_sid to authenticated;
insert into t_sid select public.start_physical_ai_session(
  'Weekly ops', jsonb_build_array(
    jsonb_build_object('name','Adeola','user_id',:A),
    jsonb_build_object('name','Visitor Bola'),
    jsonb_build_object('name','Ghost','user_id',:INACT)
  ), 'delete_after_finalize', true, true, 'MacBook mic');

select 'session created in recording state' t, (select state from workspace_room_ai_sessions where id=(select id from t_sid))='recording' r;
select 'host + 3 attendees listed' t, (select count(*) from workspace_room_ai_attendees where ai_session_id=(select id from t_sid))=4 r;
select 'inactive employee is not an employee attendee' t,
  (select user_id is null from workspace_room_ai_attendees where ai_session_id=(select id from t_sid) and display_name='Ghost') r;
select 'consent row per attendee' t, (select count(*) from workspace_room_ai_consents where ai_session_id=(select id from t_sid))=4 r;

-- attestation is required
do $$ begin
  begin
    perform public.start_physical_ai_session('No consent','[]'::jsonb,'permanent',false,false,null);
    raise exception 'should have failed';
  exception when others then
    if sqlerrm not like 'Confirm that everyone%' then raise; end if;
  end;
end $$;

-- reads
select set_config('request.jwt.claim.sub', :A, true);
select 'listed active attendee can read' t, public.can_read_room_ai_session((select id from t_sid)) r;
select 'attendee cannot manage' t, not public.can_manage_room_ai_session((select id from t_sid)) r;
select set_config('request.jwt.claim.sub', :E5, true);
select 'unrelated employee cannot read' t, not public.can_read_room_ai_session((select id from t_sid)) r;
select 'unrelated employee sees no rows' t, (select count(*) from workspace_room_ai_sessions)=0 r;
select set_config('request.jwt.claim.sub', :ADM, true);
select 'admin role gets no access' t, not public.can_read_room_ai_session((select id from t_sid)) r;
select 'admin sees no rows' t, (select count(*) from workspace_room_ai_sessions)=0 r;
select set_config('request.jwt.claim.sub', :INACT, true);
select 'inactive employee cannot read' t, not public.can_read_room_ai_session((select id from t_sid)) r;

-- writes by the wrong person are refused
select set_config('request.jwt.claim.sub', :A, true);
do $$ begin
  begin perform public.end_ai_session((select id from t_sid), 3, 60); raise exception 'should have failed';
  exception when others then if sqlerrm <> 'Meeting not found' then raise; end if; end;
end $$;

-- host flow
select set_config('request.jwt.claim.sub', :HR, true);
select 'pause' t, public.pause_resume_ai_session((select id from t_sid), true)='paused' r;
select 'pause again is idempotent' t, public.pause_resume_ai_session((select id from t_sid), true)='paused' r;
select 'resume' t, public.pause_resume_ai_session((select id from t_sid), false)='recording' r;
select 'marker' t, public.add_ai_marker((select id from t_sid), 5000, 'important', 'budget agreed') > 0 r;
select 'end -> finalizing' t, public.end_ai_session((select id from t_sid), 3, 1800)='finalizing' r;
select 'end twice is idempotent' t, public.end_ai_session((select id from t_sid), 3, 1800)='finalizing' r;
do $$ begin
  begin perform public.add_ai_marker((select id from t_sid), 6000, 'note', 'late'); raise exception 'should have failed';
  exception when others then if sqlerrm not like 'The meeting is not being recorded%' then raise; end if; end;
end $$;

-- state machine + retention clock (service side)
reset role;
do $$ begin
  begin update workspace_room_ai_sessions set state='recording' where id=(select id from t_sid); raise exception 'should have failed';
  exception when others then if sqlerrm not like 'AI session cannot move%' then raise; end if; end;
end $$;
update workspace_room_ai_sessions set state='ready' where id=(select id from t_sid);
select 'default policy: deletable immediately after ready' t,
  (select delete_after is not null and delete_after <= now() from workspace_room_ai_sessions where id=(select id from t_sid)) r;
select 'due list includes it' t, exists(select 1 from public.r7_ai_sessions_due_for_deletion(10) where id=(select id from t_sid)) r;

set local role authenticated;
select set_config('request.jwt.claim.sub', :HR, true);
select public.set_ai_retention((select id from t_sid), 'days_30');
select 'days_30 sets a future deadline' t,
  (select delete_after > now() + interval '29 days' from workspace_room_ai_sessions where id=(select id from t_sid)) r;
select public.set_ai_retention((select id from t_sid), 'permanent');
select 'permanent clears the deadline' t,
  (select delete_after is null from workspace_room_ai_sessions where id=(select id from t_sid)) r;

-- append-only
reset role;
do $$ begin
  begin update workspace_room_ai_consents set display_name='x'; raise exception 'should have failed';
  exception when others then if sqlerrm not like '%append-only' then raise; end if; end;
end $$;
do $$ begin
  begin delete from workspace_room_ai_audit; raise exception 'should have failed';
  exception when others then if sqlerrm not like '%append-only' then raise; end if; end;
end $$;

-- clients cannot write tables directly
set local role authenticated;
select set_config('request.jwt.claim.sub', :HR, true);
do $$ begin
  begin insert into workspace_room_transcript_segments(ai_session_id,speaker_key,start_ms,end_ms,text)
    values ((select id from t_sid),'s0',0,1,'forged'); raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin perform public.r7_ai_mark_audio_deleted((select id from t_sid), true); raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
end $$;
select 'direct writes and service helpers are blocked for clients' t, true r;
rollback;
