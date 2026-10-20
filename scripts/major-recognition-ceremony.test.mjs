import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = p => fs.existsSync(new URL(`../${p}`, import.meta.url)) ? fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8') : ''
const legacy = read('supabase/migrations/20261020260000_major_recognition_ceremony_claims.sql')
const delivery = read('supabase/migrations/20261020310000_recognition_ceremony_delivery.sql')
const api = read('src/celebrations/api.ts')
const queue = read('src/celebrations/useRecognitionCeremonyQueue.ts')
const scene = read('src/components/celebrations/PersonalAwardScene.tsx')
const recognition = read('src/components/Recognition.tsx')
function match(text,rx,message){assert.match(text,rx,message)}

test('legacy major recognition seen-state remains durable and caller scoped',()=>{
  match(legacy,/create table if not exists public\.employee_recognition_award_seen/i,'seen table missing')
  match(legacy,/unique\s*\(award_id\s*,\s*user_id\)/i,'award/user uniqueness missing')
  match(legacy,/user_id\s*=\s*auth\.uid\(\)/i,'caller-owned RLS missing')
})

test('new major award delivery is recipient specific and legacy claim RPC is retired',()=>{
  match(delivery,/materialize_personal_award_delivery/i,'personal materializer missing')
  match(delivery,/recipient_id[^;]+employee_id/is,'award recipient delivery missing')
  match(delivery,/revoke execute on function public\.unseen_major_recognition_award\(\) from authenticated/i,'legacy claim RPC must be retired')
  match(api,/claim_next_recognition_ceremony/,'central claim missing')
  assert.doesNotMatch(api+queue,/unseen_major_recognition_award|mark_major_recognition|mark_employee_recognition.*seen/i)
})

test('personal award scene uses premium major timing and permanent shelf copy',()=>{
  match(scene,/intensity="major"/,'major intensity missing')
  match(scene,/introMs=\{1600\}/,'major intro timing missing')
  match(scene,/holdMs=\{7000\}/,'major hold timing missing')
  match(scene,/Saved permanently in My Awards/i,'personal shelf persistence copy missing')
})

test('ordinary ribbon RecognitionHost no longer owns major award persistence',()=>{
  match(recognition,/<WorkCelebration/,'lightweight ribbon celebration must remain')
  assert.doesNotMatch(recognition,/unseen_major_recognition_award|setMajorAward|intensity="major"/)
})

test('legacy major recognition prefix eligibility does not rely on a multi-character SQL ESCAPE literal',()=>{
  assert.match(legacy,/left\(a\.badge_code,\s*6\)\s*=\s*'major_'/i)
  assert.match(legacy,/left\(a\.badge_code,\s*4\)\s*=\s*'kpi_'/i)
  assert.doesNotMatch(legacy,/escape\s+'\\\\'/i)
})
