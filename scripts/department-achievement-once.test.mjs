import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261020250000_department_achievement_claim_once.sql')
const recognition = read('src/components/Recognition.tsx')
const ceremony = read('src/components/DepartmentAchievementCeremony.tsx')

function match(text, rx, message) { assert.match(text, rx, message) }

test('unseen achievement RPC atomically claims exactly one achievement before returning it', () => {
  match(migration, /create or replace function public\.unseen_department_achievements\(\)/i, 'claiming unseen RPC replacement missing')
  match(migration, /insert into public\.department_achievement_seen/i, 'RPC must persist the claim before returning')
  match(migration, /on conflict do nothing/i, 'claim must be idempotent across refreshes and tabs')
  match(migration, /returning\s+achievement_id/i, 'RPC must return only successfully claimed achievements')
  match(migration, /limit\s+1/i, 'claim RPC must reserve one ceremony at a time')
  match(migration, /join\s+claimed/i, 'RPC must return only the row claimed by this call')
})

test('frontend never waits until ceremony close to mark the achievement seen', () => {
  match(recognition, /unseen_department_achievements/, 'achievement claim RPC missing')
  assert.doesNotMatch(recognition, /mark_department_achievements_seen[\s\S]{0,260}closing\.id/, 'close handler must not be responsible for persistence')
  match(recognition, /setAchievementQueue\(list => list\.slice\(1\)\)/, 'close must only remove the displayed ceremony')
  match(recognition, /void loadDepartmentAchievements\(\)/, 'closing should ask for the next one-time achievement')
})

test('one-time ceremony gives a short ribbon pop before the trophy reveal', () => {
  match(ceremony, /'ribbon'\s*\|\s*'trophy'/, 'ceremony phase type missing')
  match(ceremony, /departmentAchievementRibbonPop/, 'ribbon pop visual missing')
  match(ceremony, /setPhase\('trophy'\)/, 'ribbon must transition to trophy')
  match(ceremony, /RIBBON_POP_MS\s*=\s*950/, 'ribbon pop should be short')
  match(ceremony, /Added to your department trophy cabinet/i, 'permanent shelf message missing')
})
