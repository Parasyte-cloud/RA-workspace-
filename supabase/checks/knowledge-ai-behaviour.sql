-- Behaviour checks for 20261017130000_knowledge_ai_manager.sql and the seed.
-- Local audit users: HR and EMP5 are not admins, ADM is an admin. Rolls back.
-- Every line should end in |t.
\set A '''11111111-1111-4111-8111-111111111111'''
\set HR '''22222222-2222-4222-8222-222222222222'''
\set ADM '''33333333-3333-4333-8333-333333333333'''
\set E5 '''55555555-5555-4555-8555-555555555555'''
begin;

-- Service-role setup: one article to update and two proposals.
insert into public.workspace_knowledge_articles (title, slug, content, category, status)
values ('Plans', 'plans', 'old', 'Products', 'published');
insert into public.knowledge_ai_runs (requested_by, topic) values (:ADM, 'test');
insert into public.knowledge_ai_proposals (run_id, kind, article_id, slug, title, summary, content, category, tags, source_links)
select (select id from public.knowledge_ai_runs limit 1), 'update', id, 'plans', 'Plans v2', 's', 'new text', 'Products', '{a}', '[{"url":"https://x.com","title":"X"}]'::jsonb
from public.workspace_knowledge_articles where slug='plans';
insert into public.knowledge_ai_proposals (run_id, kind, slug, title, content, category)
values ((select id from public.knowledge_ai_runs limit 1), 'create', 'plans', 'Clashing slug', 'brand new', 'Industry');
insert into public.knowledge_ai_proposals (run_id, kind, slug, title, content, category)
values ((select id from public.knowledge_ai_runs limit 1), 'create', 'to-reject', 'Reject me', 'nope', 'Industry');

set local role authenticated;

select set_config('request.jwt.claim.sub', :E5, true);
select 'employee cannot read proposals' t, (select count(*) from public.knowledge_ai_proposals)=0 r;
select 'employee cannot read runs' t, (select count(*) from public.knowledge_ai_runs)=0 r;

select set_config('request.jwt.claim.sub', :HR, true);
select 'hr cannot read proposals (admin only)' t, (select count(*) from public.knowledge_ai_proposals)=0 r;
do $$ begin
  begin perform public.decide_knowledge_ai_proposal((select id from public.knowledge_ai_proposals limit 1), true);
    raise exception 'should have failed'; exception when insufficient_privilege then null; end;
end $$;
select 'hr cannot decide a proposal' t, true r;
do $$ begin
  begin insert into public.knowledge_ai_proposals (kind, slug, title, content) values ('create','x','x','x');
    raise exception 'should have failed'; exception when insufficient_privilege then null; end;
end $$;
select 'clients cannot insert proposals' t, true r;

select set_config('request.jwt.claim.sub', :ADM, true);
select 'admin reads 3 pending proposals' t, (select count(*) from public.knowledge_ai_proposals where status='pending')=3 r;
select public.decide_knowledge_ai_proposal(id, true) from public.knowledge_ai_proposals where title='Plans v2';
select 'approve update changes the article' t,
  (select content='new text' and title='Plans v2' and source='ai' and last_reviewed_at is not null and source_links->0->>'url'='https://x.com'
   from public.workspace_knowledge_articles where slug='plans') r;
select 'update keeps its status' t, (select status='published' from public.workspace_knowledge_articles where slug='plans') r;
select public.decide_knowledge_ai_proposal(id, true) from public.knowledge_ai_proposals where title='Clashing slug';
select 'create with taken slug gets a suffix, published' t,
  (select count(*)=1 from public.workspace_knowledge_articles where slug like 'plans-%' and status='published' and source='ai' and created_by=:ADM) r;
select public.decide_knowledge_ai_proposal(id, false) from public.knowledge_ai_proposals where title='Reject me';
select 'reject creates nothing' t, (select count(*)=0 from public.workspace_knowledge_articles where slug='to-reject') r;
do $$ begin
  begin perform public.decide_knowledge_ai_proposal((select id from public.knowledge_ai_proposals where title='Reject me'), true);
    raise exception 'should have failed'; exception when invalid_parameter_value then null; end;
end $$;
select 'a decided proposal cannot be decided again' t, true r;
select 'decisions are recorded' t, (select count(*)=3 from public.knowledge_ai_proposals where decided_by=:ADM and decided_at is not null) r;
do $$ declare n int; begin
  update public.knowledge_ai_settings set enabled=false where id; get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin update touched % rows', n; end if;
end $$;
select 'admin can switch the manager off' t, true r;

select set_config('request.jwt.claim.sub', :E5, true);
do $$ declare n int; begin
  update public.knowledge_ai_settings set enabled=true where id; get diagnostics n = row_count;
  if n <> 0 then raise exception 'employee update touched % rows', n; end if;
exception when insufficient_privilege then null;
end $$;
select 'employee cannot change settings' t, true r;
select 'employee still sees published articles only' t, (select count(*)>=1 and bool_and(status='published') from public.workspace_knowledge_articles) r;
rollback;
