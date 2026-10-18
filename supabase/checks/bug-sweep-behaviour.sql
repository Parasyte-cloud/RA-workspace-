-- Behaviour checks for supabase/migrations/20261016320000_bug_sweep_fixes.sql.
-- Needs the test users from the local audit database (employee, hr, admin, a
-- deactivated account). Each block runs in a transaction and rolls back.
-- Expected: every line ending in |t is true; the two forward errors say
-- 'The file does not match the original'; can_use_room_chat is t for an active
-- participant and active host, f for everyone else.

\set A '''11111111-1111-4111-8111-111111111111'''
\set ADM '''33333333-3333-4333-8333-333333333333'''
\set HR '''22222222-2222-4222-8222-222222222222'''
\set INACT '''66666666-6666-4666-8666-666666666666'''
begin;
-- room made by HR; EMP participant; INACT participant (inactive)
insert into workspace_rooms(id,title,room_code,status,created_by,cloudflare_meeting_id) values ('aaaaaaaa-0000-4000-8000-000000000001','Test room','RCODEAAA','active',:HR,'meeting-0001')
  on conflict do nothing;
insert into workspace_room_participants(room_id,user_id,role) values
 ('aaaaaaaa-0000-4000-8000-000000000001',:A,'member'),('aaaaaaaa-0000-4000-8000-000000000001',:INACT,'member') on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub',:A,true);   select 'active participant' t, public.can_use_room_chat('aaaaaaaa-0000-4000-8000-000000000001') r;
select set_config('request.jwt.claim.sub',:INACT,true); select 'inactive participant' t, public.can_use_room_chat('aaaaaaaa-0000-4000-8000-000000000001') r;
select set_config('request.jwt.claim.sub',:HR,true);   select 'active host' t, public.can_use_room_chat('aaaaaaaa-0000-4000-8000-000000000001') r;
select set_config('request.jwt.claim.sub',:ADM,true);  select 'admin not in room' t, public.can_use_room_chat('aaaaaaaa-0000-4000-8000-000000000001') r;
reset role;
update workspace_room_participants set removed_at=now() where user_id=:A;
set local role authenticated; select set_config('request.jwt.claim.sub',:A,true); select 'removed participant' t, public.can_use_room_chat('aaaaaaaa-0000-4000-8000-000000000001') r;
reset role;
update employee_profiles set active=false where id=:HR;
set local role authenticated; select set_config('request.jwt.claim.sub',:HR,true); select 'deactivated host' t, public.can_use_room_chat('aaaaaaaa-0000-4000-8000-000000000001') r;
rollback;

\set ADM '''33333333-3333-4333-8333-333333333333'''
\set HR '''22222222-2222-4222-8222-222222222222'''
\set A '''11111111-1111-4111-8111-111111111111'''
begin;
insert into social_conversations(id,is_group,created_by) values
 ('c0000000-0000-4000-8000-000000000001',false,:ADM),
 ('c0000000-0000-4000-8000-000000000002',false,:A),
 ('c0000000-0000-4000-8000-000000000003',false,:A);
insert into social_conversation_members(conversation_id,user_id) values
 ('c0000000-0000-4000-8000-000000000001',:ADM),('c0000000-0000-4000-8000-000000000001',:HR),
 ('c0000000-0000-4000-8000-000000000002',:A),('c0000000-0000-4000-8000-000000000002',:HR),
 ('c0000000-0000-4000-8000-000000000003',:A),('c0000000-0000-4000-8000-000000000003',:ADM);
insert into workspace_rooms(id,title,room_code,status,created_by,cloudflare_meeting_id) values
 ('bbbbbbbb-0000-4000-8000-000000000001','Call','CALLAAAA','active',:ADM,'meeting-0001'),
 ('bbbbbbbb-0000-4000-8000-000000000002','Call2','CALLBBBB','active',:ADM,'meeting-0002');
insert into workspace_calling_access(employee_id) values (:A) on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub',:ADM,true);
select 'free callee returns id' t, public.start_chat_call('c0000000-0000-4000-8000-000000000001','voice','CALLAAAA') is not null r;
reset role;
-- HR now ringing from ADM. A calls HR as well -> busy
insert into workspace_rooms(id,title,room_code,status,created_by,cloudflare_meeting_id) values
 ('bbbbbbbb-0000-4000-8000-000000000003','Call3','CALLCCCC','active',:A,'meeting-0003');
set local role authenticated;
select set_config('request.jwt.claim.sub',:A,true);
select 'busy callee returns null' t, public.start_chat_call('c0000000-0000-4000-8000-000000000002','voice','CALLCCCC') is null r;
reset role;
select 'missed row' t, count(*) r from chat_calls where caller_id=:A and callee_id=:HR and status='missed';
select 'missed notification' t, count(*) r from notifications where user_id=:HR and type='call_missed' and body='You were on another call';
select 'rings for HR' t, count(*) r from chat_calls where callee_id=:HR and status='ringing';
-- accepted call: HR accepted ADM's call, now ADM calls HR again from same pair is not busy-by-others; A calls HR still busy
update chat_calls set status='accepted', answered_at=now() where callee_id=:HR and status='ringing';
insert into workspace_rooms(id,title,room_code,status,created_by,cloudflare_meeting_id) values
 ('bbbbbbbb-0000-4000-8000-000000000004','Call4','CALLDDDD','active',:A,'meeting-0004');
set local role authenticated;
select set_config('request.jwt.claim.sub',:A,true);
select 'accepted -> busy' t, public.start_chat_call('c0000000-0000-4000-8000-000000000002','video','CALLDDDD') is null r;
reset role;
-- a call ended long ago does not block
update chat_calls set status='ended' where callee_id=:HR and status='accepted';
insert into workspace_rooms(id,title,room_code,status,created_by,cloudflare_meeting_id) values
 ('bbbbbbbb-0000-4000-8000-000000000005','Call5','CALLEEEE','active',:A,'meeting-0005');
set local role authenticated;
select set_config('request.jwt.claim.sub',:A,true);
select 'ended -> free' t, public.start_chat_call('c0000000-0000-4000-8000-000000000002','video','CALLEEEE') is not null r;
rollback;

\set ADM '''33333333-3333-4333-8333-333333333333'''
\set HR '''22222222-2222-4222-8222-222222222222'''
\set A '''11111111-1111-4111-8111-111111111111'''
begin;
insert into social_conversations(id,is_group,created_by) values
 ('c0000000-0000-4000-8000-000000000001',false,:ADM),('c0000000-0000-4000-8000-000000000002',false,:ADM);
insert into social_conversation_members(conversation_id,user_id) values
 ('c0000000-0000-4000-8000-000000000001',:ADM),('c0000000-0000-4000-8000-000000000001',:HR),
 ('c0000000-0000-4000-8000-000000000002',:ADM),('c0000000-0000-4000-8000-000000000002',:A);
insert into storage.objects(bucket_id,name,metadata) values
 ('chat-attachments','c0000000-0000-4000-8000-000000000001/'||:HR||'/orig.pdf','{"size":1000,"eTag":"\"abc\""}'),
 ('chat-attachments','c0000000-0000-4000-8000-000000000002/'||:ADM||'/copy.pdf','{"size":1000,"eTag":"\"abc\""}'),
 ('chat-attachments','c0000000-0000-4000-8000-000000000002/'||:ADM||'/fake.pdf','{"size":1000,"eTag":"\"zzz\""}'),
 ('chat-attachments','c0000000-0000-4000-8000-000000000002/'||:ADM||'/big.pdf','{"size":5,"eTag":"\"abc\""}');
insert into social_messages(id,conversation_id,sender_id,body,attachment_path,attachment_name,attachment_mime,attachment_size)
 values ('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',:HR,'','c0000000-0000-4000-8000-000000000001/'||:HR||'/orig.pdf','orig.pdf','application/pdf',1000);
set local role authenticated; select set_config('request.jwt.claim.sub',:ADM,true);
select 'matching copy forwards' t, (public.forward_chat_message('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002/'||:ADM||'/copy.pdf')).id is not null r;
savepoint s1;
select public.forward_chat_message('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002/'||:ADM||'/fake.pdf');
rollback to s1;
savepoint s2;
select public.forward_chat_message('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002/'||:ADM||'/big.pdf');
rollback to s2;
rollback;

