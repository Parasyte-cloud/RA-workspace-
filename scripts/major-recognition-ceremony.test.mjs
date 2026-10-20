import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const migrationPath = new URL('../supabase/migrations/20261020260000_major_recognition_ceremony_claims.sql', import.meta.url)
const recognitionPath = new URL('../src/components/Recognition.tsx', import.meta.url)
const readMaybe = url => fs.existsSync(url) ? fs.readFileSync(url, 'utf8') : ''

const migration = readMaybe(migrationPath)
const recognition = readMaybe(recognitionPath)

function match(text, rx, message) { assert.match(text, rx, message) }

test('major recognition seen-state is durable, caller-scoped and duplicate safe', () => {
  match(migration, /create table if not exists public\.employee_recognition_award_seen/i, 'seen table missing')
  match(migration, /unique\s*\(award_id\s*,\s*user_id\)/i, 'award/user uniqueness missing')
  match(migration, /enable row level security/i, 'RLS missing')
  match(migration, /auth\.uid\(\)\s*=\s*user_id|user_id\s*=\s*auth\.uid\(\)/i, 'caller-owned RLS missing')
  match(migration, /revoke all on public\.employee_recognition_award_seen from (?:public,\s*)?anon/i, 'anon table access must be revoked')
})

test('unseen major award RPC atomically claims one caller-owned award before returning it', () => {
  match(migration, /create or replace function public\.unseen_major_recognition_award\(\)/i, 'claim RPC missing')
  match(migration, /security definer/i, 'claim RPC must use a fixed database boundary')
  match(migration, /auth\.uid\(\)/i, 'RPC must derive caller identity')
  match(migration, /a\.employee_id\s*=\s*auth\.uid\(\)/i, 'RPC must only claim caller awards')
  match(migration, /p\.active\s*=\s*true/i, 'active employee predicate missing')
  match(migration, /a\.active\s*=\s*true/i, 'active award predicate missing')
  match(migration, /insert into public\.employee_recognition_award_seen/i, 'claim insert missing')
  match(migration, /on conflict do nothing/i, 'parallel-tab idempotency missing')
  match(migration, /returning\s+award_id/i, 'RPC must return only successful claim')
  match(migration, /limit\s+1/i, 'RPC must claim one ceremony at a time')
  match(migration, /grant execute on function public\.unseen_major_recognition_award\(\) to authenticated/i, 'authenticated execute grant missing')
  match(migration, /revoke all on function public\.unseen_major_recognition_award\(\) from public, anon/i, 'public/anon execute must be revoked')
})

test('major award client flow never uses a close-time mark-seen RPC', () => {
  assert.doesNotMatch(recognition, /mark_major_recognition|mark_employee_recognition.*seen/i)
})

test('RecognitionHost uses claim-before-display for major awards and no close-time persistence', () => {
  match(recognition, /unseen_major_recognition_award/, 'major award claim RPC missing')
  match(recognition, /setMajorAward\(/, 'major award state missing')
  match(recognition, /intensity="major"/, 'premium major intensity missing')
  match(recognition, /introMs=\{1600\}/, 'major intro timing missing')
  match(recognition, /holdMs=\{7000\}/, 'major hold timing missing')
  assert.doesNotMatch(recognition, /mark_major_recognition|mark_employee_recognition.*seen/i)
})

test('major recognition prefix eligibility does not rely on a multi-character SQL ESCAPE literal', () => {
  assert.match(migration, /left\(a\.badge_code,\s*6\)\s*=\s*'major_'/i)
  assert.match(migration, /left\(a\.badge_code,\s*4\)\s*=\s*'kpi_'/i)
  assert.doesNotMatch(migration, /escape\s+'\\\\'/i)
})
