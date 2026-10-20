import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = p => fs.existsSync(new URL(`../${p}`, import.meta.url)) ? fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8') : ''
const recognition = read('src/components/Recognition.tsx')
const ceremony = read('src/components/celebrations/DepartmentTrophyScene.tsx')
const centralHost = read('src/components/RecognitionCeremonyHost.tsx')
const queue = read('src/celebrations/useRecognitionCeremonyQueue.ts')
const cabinet = read('src/components/DepartmentTrophyCabinet.tsx')
const workspace = read('src/modules/DepartmentTeamWorkspace.tsx')

function match(text, rx, message) { assert.match(text, rx, message) }

test('central ceremony host uses the durable delivery queue and keeps personal WorkCelebration separate', () => {
  match(centralHost, /DepartmentTrophyScene/, 'central department scene missing')
  match(queue, /claimNextRecognitionCeremony/, 'durable ceremony claim missing')
  assert.doesNotMatch(recognition + queue, /unseen_department_achievements|mark_department_achievements_seen/, 'legacy department ceremony RPC still used')
  match(recognition, /<WorkCelebration/, 'personal ribbon/champion celebration must remain')
  match(queue, /table:\s*'recognition_ceremony_deliveries'/, 'realtime signal must listen to recipient deliveries')
})

test('department ceremony delegates the louder timing to PremiumCelebrationStage', () => {
  match(ceremony, /PremiumCelebrationStage/, 'premium stage import missing')
  match(ceremony, /presentation\.department/, 'department label missing')
  match(ceremony, /presentation\.title/, 'achievement title missing')
  match(ceremony, /presentation\.message/, 'achievement message missing')
  match(ceremony, /presentation\.tier/, 'achievement tier missing')
  match(ceremony, /intensity="trophy"/, 'trophy intensity missing')
  match(ceremony, /introMs=\{1600\}/, 'trophy intro must be 1600ms')
  match(ceremony, /holdMs=\{7000\}/, 'trophy hold must be 7000ms')
  match(ceremony, /Added to your department trophy cabinet/i, 'cabinet persistence message missing')
})


test('department trophy cabinet is persistent history, not ceremony seen-state', () => {
  match(cabinet, /list_department_trophy_history/, 'cabinet must use the authorized persistent history RPC')
  match(cabinet, /Department Trophy Cabinet/i, 'cabinet heading missing')
  match(cabinet, /View achievement history/i, 'history disclosure missing')
  assert.doesNotMatch(cabinet, /department_achievement_seen|unseen_department_achievements/, 'persistent cabinet must not depend on seen state')
  match(cabinet, /achievements\[0\]/, 'newest achievement should be featured')
  match(cabinet, /slice\(1\)/, 'older achievements should remain available')
})

test('department workspace mounts the cabinet with canonical department identity', () => {
  match(workspace, /import .*DepartmentTrophyCabinet/, 'workspace cabinet import missing')
  match(workspace, /canonicalDepartment/, 'canonical department identity missing')
  match(workspace, /<DepartmentTrophyCabinet/, 'workspace cabinet mount missing')
  assert.doesNotMatch(workspace, /enabled=/, 'workspace must not calculate trophy authorization in the browser')
})

test('cabinet treats realtime rows only as a signal and refetches authorised history', () => {
  match(cabinet, /table:\s*'department_achievements'/, 'cabinet should listen for new trophy signals')
  match(cabinet, /list_department_trophy_history/, 'cabinet realtime path must refetch through authorised history RPC')
  match(cabinet, /removeChannel/, 'cabinet realtime subscription must be cleaned up')
})

test('workspace delegates cabinet authorization to the server', () => {
  assert.doesNotMatch(workspace, /const canViewAchievements=/, 'browser-computed trophy authorization must be removed')
  assert.doesNotMatch(workspace, /enabled=\{/, 'cabinet must not accept an enabled flag')
  match(workspace, /<DepartmentTrophyCabinet[\s\S]{0,120}department=\{canonicalDepartment\}/, 'cabinet must receive canonical department only')
})

test('sign-out clears the central delivery queue', () => {
  match(queue, /if \(!id\)[\s\S]{0,180}setCurrent\(null\)/, 'signed-out sessions must clear the active ceremony')
  match(queue, /presented\.current\.clear\(\)/, 'sign-out must clear in-memory presentation state')
})

test('cabinet ignores stale history responses when department changes quickly', () => {
  match(cabinet, /requestSequenceRef/, 'cabinet needs a request sequence guard')
  match(cabinet, /requestSequence\s*!==\s*requestSequenceRef\.current/, 'stale trophy history responses must be ignored')
})
