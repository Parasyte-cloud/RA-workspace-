import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const legacyMigration = read('supabase/migrations/20261020250000_department_achievement_claim_once.sql')
const deliveryMigration = read('supabase/migrations/20261020310000_recognition_ceremony_delivery.sql')
const api = read('src/celebrations/api.ts')
const queue = read('src/celebrations/useRecognitionCeremonyQueue.ts')
const scene = read('src/components/celebrations/DepartmentTrophyScene.tsx')

function match(text, rx, message) { assert.match(text, rx, message) }

test('legacy unseen RPC remains historically atomic while new clients use durable delivery', () => {
  match(legacyMigration, /insert into public\.department_achievement_seen/i, 'legacy atomic claim evidence missing')
  match(legacyMigration, /on conflict do nothing/i, 'legacy claim must remain idempotent')
  match(deliveryMigration, /materialize_department_achievement_deliveries/i, 'durable recipient materializer missing')
  match(deliveryMigration, /revoke execute on function public\.unseen_department_achievements\(\) from authenticated/i, 'legacy browser claim must be retired')
})

test('frontend claims delivery before display and close never persists legacy seen state', () => {
  match(api, /claim_next_recognition_ceremony/, 'central claim RPC missing')
  match(api, /mark_recognition_ceremony_dismissed/, 'central dismissal RPC missing')
  assert.doesNotMatch(api + queue, /mark_department_achievements_seen|unseen_department_achievements/, 'legacy department seen RPCs must not be used')
  match(queue, /setCurrent\(null\)/, 'dismissal must clear only the active presentation')
})

test('one-time department scene delegates to the premium stage with approved trophy timing', () => {
  match(scene, /PremiumCelebrationStage/, 'shared premium stage missing')
  match(scene, /intensity="trophy"/, 'trophy intensity missing')
  match(scene, /introMs=\{1600\}/, 'trophy intro must be 1600ms')
  match(scene, /holdMs=\{7000\}/, 'trophy hold must be 7000ms')
  match(scene, /Added to your department trophy cabinet/i, 'permanent shelf message missing')
})
