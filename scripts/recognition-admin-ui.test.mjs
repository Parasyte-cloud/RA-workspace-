import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read=path=>fs.existsSync(path)?fs.readFileSync(path,'utf8'):''
const admin=read('src/modules/AdministrationControlPlane.tsx')
const panel=read('src/modules/RecognitionCelebrationsAdmin.tsx')
const css=read('src/recognition-admin.css')

test('Administration exposes a dedicated Recognition and Celebrations section',()=>{
  assert.match(admin,/RecognitionCelebrationsAdmin/)
  assert.match(admin,/recognition-celebrations/)
  assert.match(admin,/Recognition & Celebrations/)
})

test('recognition administration uses RPC-only governance boundaries',()=>{
  for(const rpc of [
    'list_recognition_award_candidates','list_recognition_governance_audit','list_recognition_delivery_health','reissue_recognition_ceremony','issue_employee_award',
    'change_employee_award_visibility','revoke_employee_award','preview_recognition_ceremony',
  ])assert.match(panel,new RegExp(`['"]${rpc}['"]`))
  assert.doesNotMatch(panel,/\.from\(\s*['"](?:employee_recognition_awards|recognition_ceremony_deliveries|recognition_governance_audit_events|employee_profiles)['"]\s*\)/)
  assert.doesNotMatch(panel,/admin_employee_presence_summary/)
})

test('preview reuses production scenes and writes no ceremony state',()=>{
  assert.match(panel,/DepartmentTrophyScene/)
  assert.match(panel,/PersonalAwardScene/)
  assert.match(panel,/CompanyMilestoneScene/)
  assert.doesNotMatch(panel,/markRecognitionCeremonyPresented|dismissRecognitionCeremony|claimNextRecognitionCeremony/)
  assert.match(panel,/preview/i)
})

test('preview supports device and motion variants with safe close controls',()=>{
  for(const mode of ['desktop','tablet','mobile'])assert.match(panel,new RegExp(`['"]${mode}['"]`))
  assert.match(panel,/reducedMotion/)
  assert.match(panel,/onClose/)
  assert.match(css,/recognitionAdminPreviewDesktop/)
  assert.match(css,/recognitionAdminPreviewTablet/)
  assert.match(css,/recognitionAdminPreviewMobile/)
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
})

test('delivery health renders aggregate status without private award evidence',()=>{
  assert.match(panel,/delivery_count/)
  assert.match(panel,/oldest_eligible_at/)
  assert.doesNotMatch(panel,/overdue_open|total_assigned|score\s*[:}]/)
})

test('governance renders audited award history without exposing unrestricted employee data',()=>{
  assert.match(panel,/list_recognition_governance_audit/)
  assert.match(panel,/actor_name/)
  assert.match(panel,/target_name/)
  assert.match(panel,/Audit history/)
})
