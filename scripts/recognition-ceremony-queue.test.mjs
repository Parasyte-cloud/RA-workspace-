import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read=path=>fs.existsSync(path)?fs.readFileSync(path,'utf8'):''
const api=read('src/celebrations/api.ts')
const types=read('src/celebrations/types.ts')
const context=read('src/celebrations/CelebrationBlockerContext.tsx')
const queue=read('src/celebrations/useRecognitionCeremonyQueue.ts')
const host=read('src/components/RecognitionCeremonyHost.tsx')
const internal=read('src/InternalApp.tsx')
const roomModule=read('src/modules/RoomModule.tsx')
const recognition=read('src/components/Recognition.tsx')
const stage=read('src/components/PremiumCelebrationStage.tsx')
const department=read('src/components/celebrations/DepartmentTrophyScene.tsx')
const personal=read('src/components/celebrations/PersonalAwardScene.tsx')

test('central ceremony types cover foundation delivery kinds without private evidence',()=>{
  for(const value of ['department_achievement','personal_award','company_recognition','company_milestone'])assert.match(types,new RegExp(value))
  assert.match(types,/deliveryId/)
  assert.doesNotMatch(types,/issue_reason|total_assigned|overdue_open/)
})

test('ceremony API uses only authenticated claim presentation and dismissal RPCs',()=>{
  assert.match(api,/claim_next_recognition_ceremony/)
  assert.match(api,/mark_recognition_ceremony_presented/)
  assert.match(api,/mark_recognition_ceremony_dismissed/)
  assert.doesNotMatch(api,/employee_recognition_awards|department_achievements/)
})

test('blocker context exposes explicit registration and aggregate blocked state',()=>{
  assert.match(context,/CelebrationBlockerProvider/)
  assert.match(context,/useCelebrationBlocker/)
  assert.match(context,/useCelebrationIsBlocked/)
  assert.match(context,/Set<string>/)
  assert.match(context,/document\.visibilityState/)
})

test('queue claims before render, caps automatic takeovers and retries safe signals',()=>{
  assert.match(queue,/claimNextRecognitionCeremony/)
  assert.match(queue,/markRecognitionCeremonyPresented/)
  assert.match(queue,/dismissRecognitionCeremony/)
  assert.match(queue,/sessionStorage/)
  assert.match(queue,/MAX_AUTOMATIC_CEREMONIES\s*=\s*2/)
  assert.match(queue,/visibilitychange/)
  assert.match(queue,/online/)
  assert.match(queue,/recognition_ceremony_deliveries/)
  assert.match(queue,/blocked/)
  assert.match(queue,/sessionStorage\.removeItem/)
  assert.match(queue,/setInterval/, 'pending ceremonies must be retried even when Realtime table SELECT is intentionally unavailable')
  assert.match(queue,/previousUser\s*&&\s*previousUser\s*!==\s*id/)
  assert.match(queue,/setCurrent\(null\)/)
})

test('one central host is mounted once inside the authenticated shell provider',()=>{
  assert.match(internal,/CelebrationBlockerProvider/)
  assert.equal((internal.match(/<RecognitionCeremonyHost/g)||[]).length,1)
  assert.match(internal,/<RecognitionHost\/>/)
  assert.match(roomModule,/useCelebrationBlocker\(['"]room7['"],\s*Boolean\(session\)\)/)
})

test('central host uses focused scenes and records presentation after successful mount',()=>{
  assert.match(host,/DepartmentTrophyScene/)
  assert.match(host,/PersonalAwardScene/)
  assert.match(host,/CompanyMilestoneScene/)
  assert.match(host,/onPresented/)
  assert.match(host,/CeremonySceneBoundary/)
  assert.match(host,/fallback/i)
  assert.match(department,/intensity="trophy"/)
  assert.match(department,/introMs=\{1600\}/)
  assert.match(department,/holdMs=\{7000\}/)
  assert.match(personal,/intensity="major"/)
  assert.match(host,/if\s*\(blocked\)\s*return null/, 'a delivery claimed during a protected-surface race must wait before rendering')
})

test('legacy department and major claim paths are removed from RecognitionHost',()=>{
  assert.doesNotMatch(recognition,/unseen_department_achievements/)
  assert.doesNotMatch(recognition,/unseen_major_recognition_award/)
  assert.doesNotMatch(recognition,/DepartmentAchievementCeremony/)
  assert.match(recognition,/<WorkCelebration/)
})

test('premium stage reports successful mount and preserves 108-piece timing behavior',()=>{
  assert.match(stage,/onPresented/)
  assert.match(stage,/requestAnimationFrame/)
  assert.match(stage,/PIECE_COUNT\s*=\s*108/)
  assert.match(stage,/role="alertdialog"/)
})
