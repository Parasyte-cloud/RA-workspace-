import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const migrationPath='supabase/migrations/20261020320000_recognition_governance.sql'
const sql=fs.existsSync(migrationPath)?fs.readFileSync(migrationPath,'utf8'):''
const normalized=sql.replace(/\s+/g,' ')

function functionSlice(name,next=''){
  const start=normalized.toLowerCase().indexOf(`function public.${name}`)
  assert.notEqual(start,-1,`${name} must exist`)
  const end=next?normalized.toLowerCase().indexOf(`function public.${next}`,start+1):-1
  return normalized.slice(start,end>start?end:undefined)
}

test('recognition governance migration is additive and audit-only tables are protected',()=>{
  assert.ok(fs.existsSync(migrationPath),'governance migration must exist')
  assert.match(sql,/create table public\.recognition_governance_audit_events/i)
  assert.match(sql,/enable row level security/i)
  assert.match(sql,/force row level security/i)
  assert.match(sql,/revoke all on public\.recognition_governance_audit_events from public, anon, authenticated/i)
  assert.doesNotMatch(sql,/drop table|truncate table|alter table public\.employee_profiles/i)
})

test('governance authority is limited to active People Administration or workspace admin callers',()=>{
  const body=functionSlice('can_govern_recognition','list_recognition_delivery_health')
  assert.match(body,/is_active_employee\s*\(\s*\)/i)
  assert.match(body,/is_workspace_admin\s*\(\s*\)/i)
  assert.match(body,/has_workstation_access\s*\(\s*array\s*\[\s*'people'\s*,\s*'administration'\s*\]/i)
  assert.match(body,/security definer/i)
  assert.match(body,/set search_path\s*=\s*public\s*,\s*pg_temp/i)
})

test('governance RPCs are security definer controlled search path and browser-table writes stay revoked',()=>{
  for(const name of [
    'list_recognition_award_candidates','list_recognition_governance_audit','list_recognition_delivery_health','reissue_recognition_ceremony','issue_employee_award',
    'change_employee_award_visibility','revoke_employee_award','preview_recognition_ceremony',
  ]){
    const body=functionSlice(name)
    assert.match(body,/security definer/i,`${name} must be SECURITY DEFINER`)
    assert.match(body,/set search_path\s*=\s*public\s*,\s*pg_temp/i,`${name} must control search_path`)
  }
  assert.match(sql,/grant execute on function public\.list_recognition_delivery_health\(timestamptz, timestamptz\) to authenticated/i)
  assert.match(sql,/grant execute on function public\.preview_recognition_ceremony\(text, jsonb\) to authenticated/i)
  assert.doesNotMatch(sql,/grant (insert|update|delete).*recognition_governance_audit_events.*authenticated/is)
})


test('mutations serialize identical request ids before idempotency checks',()=>{
  for(const [name,next] of [
    ['reissue_recognition_ceremony','issue_employee_award'],
    ['issue_employee_award','change_employee_award_visibility'],
    ['change_employee_award_visibility','revoke_employee_award'],
    ['revoke_employee_award','preview_recognition_ceremony'],
  ]){
    const body=functionSlice(name,next)
    assert.match(body,/pg_advisory_xact_lock\s*\(\s*hashtextextended/i,`${name} must serialize request ids`)
  }
})

test('reissue requires reason resets one governed delivery and preserves prior state in idempotent audit',()=>{
  const body=functionSlice('reissue_recognition_ceremony','issue_employee_award')
  assert.match(body,/nullif\s*\(\s*btrim\s*\(\s*p_reason\s*\)/i)
  assert.match(body,/for update/i)
  assert.match(body,/revision\s*=\s*revision\s*\+\s*1/i)
  assert.match(body,/state\s*=\s*'pending'/i)
  for(const field of ['claimed_at','presented_at','dismissed_at','revoked_at'])assert.match(body,new RegExp(`${field}\\s*=\\s*null`,'i'))
  assert.match(body,/RECOGNITION_CEREMONY_REISSUED/i)
  assert.match(sql,/unique\s*\(\s*actor_id\s*,\s*request_id\s*,\s*action\s*\)/i)
})

test('company ceremony reissue requires the source award to remain published',()=>{
  const body=functionSlice('reissue_recognition_ceremony','issue_employee_award')
  assert.match(body,/v_delivery\.source_kind\s*=\s*'company_recognition'/i)
  assert.match(body,/visibility\s*=\s*'company_recognition'/i)
  assert.match(body,/company recognition is no longer published/i)
})

test('award issue materializes one private delivery and records governed evidence',()=>{
  const body=functionSlice('issue_employee_award','change_employee_award_visibility')
  assert.match(body,/insert into public\.employee_recognition_awards/i)
  assert.match(body,/visibility[^;]*'private'/i)
  assert.match(body,/materialize_personal_award_delivery/i)
  assert.match(body,/AWARD_ISSUED/i)
  assert.match(body,/issue_reason/i)
  assert.doesNotMatch(body,/service_role/i)
  assert.match(body,/v_source_kind\s+text\s*:=\s*'administration_manual'/i)
  assert.match(body,/v_source_key\s+text\s*:=\s*'admin:'\s*\|\|\s*p_request_id::text/i)
  assert.doesNotMatch(body,/p_payload->>'source_kind'|p_payload->>'source_key'/i, 'browser payload must not impersonate automated award sources')
  assert.match(body,/v_category\s+in\s*\(\s*'monthly_kpi_excellence'\s*,\s*'annual_kpi_excellence'\s*\)/i)
  assert.match(body,/cannot be issued manually/i)
})

test('governance provides a minimal authorized award candidate directory and readable audit history',()=>{
  const candidates=functionSlice('list_recognition_award_candidates','list_recognition_governance_audit')
  assert.match(candidates,/can_govern_recognition/i)
  assert.match(candidates,/employee_profiles/i)
  assert.match(candidates,/active\s*=\s*true/i)
  assert.doesNotMatch(candidates,/email|source_ip|address_full|location_/i)
  const audit=functionSlice('list_recognition_governance_audit','list_recognition_delivery_health')
  assert.match(audit,/can_govern_recognition/i)
  assert.match(audit,/recognition_governance_audit_events/i)
  assert.match(audit,/actor_name|target_name/i)
  assert.match(audit,/least\s*\(/i)
})

test('historical unrevoked awards remain governable after their featured badge becomes inactive',()=>{
  for(const [name,next] of [
    ['reissue_recognition_ceremony','issue_employee_award'],
    ['change_employee_award_visibility','revoke_employee_award'],
    ['revoke_employee_award','preview_recognition_ceremony'],
  ]) assert.doesNotMatch(functionSlice(name,next),/(?:v_award|a)\.active\s*=\s*true|not v_award\.active/i,`${name} must use explicit revocation rather than legacy active badge state`)
})

test('company publication uses sanitized copy only and reverting private revokes pending company deliveries',()=>{
  const body=functionSlice('change_employee_award_visibility','revoke_employee_award')
  assert.match(body,/company_recognition/i)
  assert.match(body,/company_title/i)
  assert.match(body,/company_message/i)
  assert.match(body,/source_kind\s*=\s*'company_recognition'/i)
  assert.match(body,/jsonb_build_object\s*\([^)]*'title'[^)]*company_title[^)]*'message'[^)]*company_message/is)
  assert.doesNotMatch(body,/jsonb_build_object\s*\([^)]*score|jsonb_build_object\s*\([^)]*overdue_open/is)
  assert.match(body,/visibility\s*=\s*'private'/i)
  assert.match(body,/state\s*=\s*'revoked'/i)
  assert.match(body,/state\s+in\s*\(\s*'pending'\s*,\s*'claimed'\s*\)/i)
  assert.doesNotMatch(body,/state\s+in\s*\([^)]*'presented'[^)]*\)/i)
})

test('award revocation preserves presented history and revokes only unpresented deliveries',()=>{
  const body=functionSlice('revoke_employee_award','preview_recognition_ceremony')
  assert.match(body,/active\s*=\s*false/i)
  assert.match(body,/revoked_at\s*=\s*now\s*\(\s*\)/i)
  assert.match(body,/revocation_reason/i)
  assert.match(body,/state\s*=\s*'revoked'/i)
  assert.match(body,/state\s+in\s*\(\s*'pending'\s*,\s*'claimed'\s*\)/i)
  assert.doesNotMatch(body,/state\s+in\s*\([^)]*'presented'/i)
  assert.match(body,/AWARD_REVOKED/i)
})

test('preview validates exact themes returns sanitized DTO and performs no writes',()=>{
  const body=functionSlice('preview_recognition_ceremony')
  for(const theme of ['department_trophy','personal_award','company_recognition','company_milestone'])assert.match(body,new RegExp(`'${theme}'`,'i'))
  assert.match(body,/title/i)
  assert.match(body,/message/i)
  assert.match(body,/source_kind/i)
  assert.doesNotMatch(body,/insert into|update public\.|delete from/i)
  assert.doesNotMatch(body,/score|overdue_open|issue_reason/i)
})

test('delivery health is aggregate and omits protected presentation payloads',()=>{
  const body=functionSlice('list_recognition_delivery_health','reissue_recognition_ceremony')
  assert.match(body,/group by/i)
  assert.match(body,/count\s*\(\s*\*\s*\)/i)
  assert.match(body,/source_kind/i)
  assert.match(body,/state/i)
  assert.doesNotMatch(body,/presentation|recipient_id|title|message/i)
})
