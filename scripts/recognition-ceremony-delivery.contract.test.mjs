import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const path='supabase/migrations/20261020310000_recognition_ceremony_delivery.sql'
const sql=fs.existsSync(path)?fs.readFileSync(path,'utf8'):''
const n=sql.toLowerCase().replace(/\s+/g,' ')
function fn(name){const marker=`create or replace function public.${name}`;const start=n.indexOf(marker);assert.ok(start>=0,`${name} must exist`);const next=n.indexOf('create or replace function public.',start+marker.length);return n.slice(start,next<0?n.length:next)}

test('delivery ledger defines exact sources audiences states and recipient-safe identities',()=>{
  assert.match(n,/create table (if not exists )?public\.recognition_ceremony_deliveries/)
  for(const value of ['department_achievement','personal_award','company_recognition','seasonal_campaign','birthday'])assert.match(n,new RegExp(`'${value}'`))
  for(const value of ['department','individual','company'])assert.match(n,new RegExp(`'${value}'`))
  for(const value of ['pending','claimed','presented','dismissed','expired','revoked'])assert.match(n,new RegExp(`'${value}'`))
  for(const column of ['recipient_id','priority','department_snapshot','eligible_at','claimed_at','presented_at','dismissed_at','expires_at','revision','presentation'])assert.match(n,new RegExp(`\\b${column}\\b`))
  assert.match(n,/source_id is not null[\s\S]{0,120}source_key is null[\s\S]{0,160}source_id is null[\s\S]{0,120}source_key is not null/)
  assert.match(n,/unique index[^;]+source_id[^;]+recipient_id[^;]+where source_id is not null/)
  assert.match(n,/unique index[^;]+source_key[^;]+recipient_id[^;]+where source_key is not null/)
})

test('department materialization snapshots active profile members only and is trigger driven',()=>{
  const s=fn('materialize_department_achievement_deliveries')
  assert.match(s,/recognition_normalize_department/)
  assert.match(s,/employee_profiles/)
  assert.match(s,/ep\.active = true/)
  assert.match(s,/ep\.department/)
  assert.doesNotMatch(s,/workspace_workstation_assignments/)
  assert.match(n,/after insert on public\.department_achievements/)
  assert.match(n,/materialize_department_achievement_deliveries\(new\.id\)/)
})

test('personal award materialization targets only the active recipient and keeps private payload redacted',()=>{
  const s=fn('materialize_personal_award_delivery')
  assert.match(s,/a\.employee_id/)
  assert.match(s,/ep\.active = true/)
  assert.match(s,/a\.revoked_at is null/)
  assert.doesNotMatch(s,/a\.active = true/, 'historical unrevoked awards remain eligible for durable delivery')
  assert.match(s,/audience_type[\s\S]{0,180}'individual'/)
  assert.doesNotMatch(s,/company_message[\s\S]{0,500}score/)
  assert.match(n,/after insert on public\.employee_recognition_awards/)
})

test('claim is caller scoped ordered atomic and uses skip locked',()=>{
  const s=fn('claim_next_recognition_ceremony')
  assert.match(s,/recipient_id = auth\.uid\(\)/)
  assert.match(s,/state = 'pending'/)
  assert.match(s,/priority desc[\s\S]{0,100}eligible_at asc[\s\S]{0,100}created_at asc[\s\S]{0,100}id asc/)
  assert.match(s,/for update skip locked/)
  assert.match(s,/set state = 'claimed'/)
  assert.match(s,/returning/)
  assert.doesNotMatch(s,/p_recipient|p_user_id/)
  for(const privateField of ['issue_reason','revocation_reason','total_assigned','total_completed','overdue_open'])assert.doesNotMatch(s,new RegExp(`\\b${privateField}\\b`))
})

test('presentation transitions require the authenticated recipient and preserve history',()=>{
  for(const name of ['mark_recognition_ceremony_presented','mark_recognition_ceremony_dismissed']){
    const s=fn(name)
    assert.match(s,/recipient_id = auth\.uid\(\)/)
    assert.match(s,/security definer/)
    assert.match(s,/set search_path = public, pg_temp/)
  }
  assert.match(fn('mark_recognition_ceremony_presented'),/state = 'presented'/)
  assert.match(fn('mark_recognition_ceremony_dismissed'),/state = 'dismissed'/)
  assert.doesNotMatch(fn('mark_recognition_ceremony_dismissed'),/delete from/)
})

test('legacy personal seen state is backfilled but department history is not mass replayed',()=>{
  assert.match(n,/employee_recognition_award_seen/)
  assert.match(n,/case when s\.award_id is not null then 'dismissed' else 'pending' end/)
  assert.doesNotMatch(n,/where a\.active = true[\s\S]{0,220}a\.revoked_at is null/, 'backfill must include valid historical awards')
  assert.doesNotMatch(n,/insert into public\.recognition_ceremony_deliveries[\s\S]{0,500}from public\.department_achievements a[\s\S]{0,300}where/)
})

test('employee deactivation revokes only unpresented delivery states',()=>{
  const body=fn('revoke_unpresented_recognition_deliveries_on_deactivation')
  assert.match(n,/after update of active on public\.employee_profiles/)
  assert.match(body,/old\.active\s*=\s*true[\s\S]{0,100}new\.active\s*=\s*false/)
  assert.match(body,/state\s+in\s*\(\s*'pending'\s*,\s*'claimed'\s*\)/)
  assert.match(body,/state\s*=\s*'revoked'/)
  assert.doesNotMatch(body,/state\s+in\s*\([^)]*'presented'[^)]*\)/)
})

test('serialized department trophy E2E uses the durable queue instead of revoked legacy claim RPCs',()=>{
  const e2e=fs.readFileSync('scripts/department-achievements-e2e.test.mjs','utf8')
  assert.match(e2e,/claim_next_recognition_ceremony/)
  assert.match(e2e,/list_department_trophy_history/)
  assert.doesNotMatch(e2e,/unseen_department_achievements|mark_department_achievements_seen/)
})

test('delivery storage is RLS protected RPC only and realtime enabled',()=>{
  assert.match(n,/alter table public\.recognition_ceremony_deliveries enable row level security/)
  assert.match(n,/alter table public\.recognition_ceremony_deliveries force row level security/)
  assert.match(n,/revoke all on public\.recognition_ceremony_deliveries from public, anon, authenticated/)
  assert.match(n,/grant all on public\.recognition_ceremony_deliveries to service_role/)
  assert.match(n,/alter publication supabase_realtime add table public\.recognition_ceremony_deliveries/)
  for(const name of ['claim_next_recognition_ceremony','mark_recognition_ceremony_presented','mark_recognition_ceremony_dismissed']){
    assert.match(n,new RegExp(`grant execute on function public\\.${name}`))
    assert.match(n,new RegExp(`revoke all on function public\\.${name}`))
  }
})
