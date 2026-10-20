import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = p => fs.existsSync(new URL(`../${p}`, import.meta.url)) ? fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8') : ''
const recognition = read('src/components/Recognition.tsx')
const ceremony = read('src/components/DepartmentAchievementCeremony.tsx')
const cabinet = read('src/components/DepartmentTrophyCabinet.tsx')
const workspace = read('src/modules/DepartmentTeamWorkspace.tsx')

function match(text, rx, message) { assert.match(text, rx, message) }

test('RecognitionHost uses secure department achievement RPCs and keeps personal WorkCelebration', () => {
  match(recognition, /unseen_department_achievements/, 'secure unseen achievement RPC missing')
  assert.doesNotMatch(recognition, /mark_department_achievements_seen/, 'ceremony close must not persist seen-state; claim happens before display')
  assert.doesNotMatch(recognition, /unseen_team_milestones|mark_team_milestones_seen/, 'legacy milestone ceremony RPC still used')
  assert.doesNotMatch(recognition, /kind:\s*'rainbow'/, 'department milestones must not map to rainbow ceremony')
  match(recognition, /<WorkCelebration/, 'personal ribbon/champion celebration must remain')
  match(recognition, /table:\s*'department_achievements'/, 'realtime signal must listen to department achievements')
})

test('department ceremony is dedicated, dismissible, timed, and reduced-motion aware', () => {
  match(ceremony, /export type DepartmentAchievement/, 'DepartmentAchievement type missing')
  match(ceremony, /DepartmentAchievementCeremony/, 'ceremony component missing')
  match(ceremony, /achievement\.department/, 'department label missing')
  match(ceremony, /achievement\.title/, 'achievement title missing')
  match(ceremony, /achievement\.description/, 'achievement description missing')
  match(ceremony, /achievement\.tier/, 'achievement tier missing')
  match(ceremony, /4500/, 'default auto-close must be 4500ms')
  match(ceremony, /Escape/, 'Escape dismissal missing')
  match(ceremony, /prefers-reduced-motion/, 'reduced-motion handling missing')
  match(ceremony, /Added to your department trophy cabinet/i, 'cabinet persistence message missing')
})


test('department trophy cabinet is persistent history, not ceremony seen-state', () => {
  match(cabinet, /department_achievement_history/, 'cabinet must use persistent history RPC')
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
  match(workspace, /enabled=/, 'workspace must control whether cabinet queries')
})

test('cabinet treats realtime rows only as a signal and refetches authorised history', () => {
  match(cabinet, /table:\s*'department_achievements'/, 'cabinet should listen for new trophy signals')
  match(cabinet, /department_achievement_history/, 'cabinet realtime path must refetch through authorised history RPC')
  match(cabinet, /removeChannel/, 'cabinet realtime subscription must be cleaned up')
})

test('workspace only enables cabinet for own department or workspace admin', () => {
  match(workspace, /const canViewAchievements=[\s\S]{0,160}profileBelongsHere[\s\S]{0,160}admin/, 'cabinet enablement must not query unrelated department data')
  match(workspace, /enabled=\{Boolean\(canonicalDepartment\) && canViewAchievements\}/, 'cabinet mount must use authorization guard')
})

test('sign-out clears any queued department ceremony', () => {
  match(recognition, /if\s*\(signedIn\)\s*return[\s\S]{0,180}setAchievementQueue\(\[\]\)/, 'signed-out sessions must clear department achievement queue')
})

test('cabinet ignores stale history responses when department changes quickly', () => {
  match(cabinet, /requestSequenceRef/, 'cabinet needs a request sequence guard')
  match(cabinet, /requestSequence\s*!==\s*requestSequenceRef\.current/, 'stale trophy history responses must be ignored')
})
