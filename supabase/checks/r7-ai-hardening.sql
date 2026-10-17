-- Behaviour check for 20261017160000_r7_ai_hardening.sql (consent evidence, chunk ceiling, cron helpers).
-- Needs a scratch Postgres with the R7 AI foundation applied on top of stub auth/storage objects.
-- psql -v ON_ERROR_STOP=1 -f supabase/checks/r7-ai-hardening.sql
insert into public.employee_profiles(id,full_name,email,role,active) values ('00000000-0000-0000-0000-0000000000a1','Host One','h@x','employee',true),('00000000-0000-0000-0000-0000000000a2','Mate','m@x','employee',true) on conflict do nothing;
select set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select set_config('request.headers','{"user-agent":"UnitTest/1.0"}',false);
do $$
declare sid uuid; ok int:=0; n int; ua text; v text; det jsonb;
begin
  sid := public.start_physical_ai_session('Weekly sync','[{"name":"Guest Person"},{"name":"Mate","user_id":"00000000-0000-0000-0000-0000000000a2"}]'::jsonb,'days_7',false,true,'Laptop','physical-v1');
  select count(*) filter (where statement_version='physical-v1' and client_user_agent='UnitTest/1.0') into n from public.workspace_room_ai_consents where ai_session_id=sid;
  if n=3 then ok:=ok+1; else raise exception 'FAIL consent rows %',n; end if;
  -- default version still works (old clients)
  perform public.start_physical_ai_session('Old client','[]'::jsonb,'days_7',false,true);
  ok:=ok+1;
  -- audit snapshot (read as service: bypass via security definer not available, use reset role)
  reset role;
  select a.detail into det from public.workspace_room_ai_audit a where a.ai_session_id=sid and a.event='session_started';
  if det->>'consent_statement' like 'I confirm everyone%' and jsonb_array_length(det->'attendee_names')=3 and det->>'client_user_agent'='UnitTest/1.0' and det->>'consent_statement_version'='physical-v1' then ok:=ok+1; else raise exception 'FAIL audit %',det; end if;
  set role authenticated;
  -- unknown wording
  begin perform public.start_physical_ai_session('Bad','[]'::jsonb,'days_7',false,true,null,'nope-v9'); raise exception 'FAIL unknown version'; exception when others then if sqlerrm like 'Unknown consent wording%' then ok:=ok+1; else raise; end if; end;
  -- not attested
  begin perform public.start_physical_ai_session('Bad','[]'::jsonb,'days_7',false,false,null,'physical-v1'); raise exception 'FAIL attested'; exception when others then if sqlerrm like 'Confirm that everyone%' then ok:=ok+1; else raise; end if; end;
  -- expected_chunks ceiling
  begin perform public.end_ai_session(sid, 20001, 10); raise exception 'FAIL cap'; exception when others then if sqlerrm like 'That recording is longer%' then ok:=ok+1; else raise; end if; end;
  begin perform public.end_ai_session(sid, -1, 10); raise exception 'FAIL neg'; exception when others then if sqlerrm like 'That recording is longer%' then ok:=ok+1; else raise; end if; end;
  if public.end_ai_session(sid, 20000, 999999999)='finalizing' then ok:=ok+1; end if;
  reset role;
  if (select expected_chunks=20000 and duration_seconds=259200 from public.workspace_room_ai_sessions where id=sid) then ok:=ok+1; else raise exception 'FAIL clamp'; end if;
  -- DB constraint blocks direct oversize
  begin update public.workspace_room_ai_sessions set expected_chunks=20001 where id=sid; raise exception 'FAIL constraint'; exception when check_violation then ok:=ok+1; end;
  -- statements and consents are append only
  begin update public.workspace_room_ai_consent_statements set body='x'||body; raise exception 'FAIL append'; exception when others then if sqlerrm like '%append-only%' then ok:=ok+1; else raise; end if; end;
  -- cron helpers: not available here, and not callable by the app role
  select count(*) into n from public.repair_cron_authentication() where result='not_available'; if n=1 then ok:=ok+1; else raise exception 'FAIL cron na'; end if;
  set role authenticated;
  begin perform * from public.repair_cron_authentication(); raise exception 'FAIL cron exposed'; exception when insufficient_privilege then ok:=ok+1; end;
  begin perform * from public.cron_authentication_status(); raise exception 'FAIL status exposed'; exception when insufficient_privilege then ok:=ok+1; end;
  reset role;
  raise notice 'r7 hardening checks passed: %', ok;
end $$;
