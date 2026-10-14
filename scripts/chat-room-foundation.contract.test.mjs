import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '20261013130100_chat_rooms_foundation.sql',
)

function readMigration() {
  assert.ok(
    fs.existsSync(migrationPath),
    'chat room foundation migration must exist',
  )

  return fs.readFileSync(migrationPath, 'utf8')
}

function normalizedSql() {
  return readMigration()
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

test('chat room foundation migration exists and is additive', () => {
  const sql = normalizedSql()

  assert.match(sql, /alter table .*social_conversations/)
  assert.match(sql, /alter table .*social_conversation_members/)

  assert.doesNotMatch(sql, /\bdrop\s+table\b/)
  assert.doesNotMatch(sql, /\btruncate\b/)
})

test('conversation kind permits the exact governed communication kinds', () => {
  const sql = normalizedSql()

  for (const value of [
    'direct',
    'department',
    'project',
    'committee',
    'restricted',
  ]) {
    assert.match(
      sql,
      new RegExp(`['"]${value}['"]`),
      `conversation kind must include ${value}`,
    )
  }
})

test('room metadata defines exact status and history-policy values', () => {
  const sql = normalizedSql()

  assert.match(sql, /create table .*chat_rooms/)

  for (const value of ['active', 'archived']) {
    assert.match(
      sql,
      new RegExp(`['"]${value}['"]`),
      `room status must include ${value}`,
    )
  }

  for (const value of ['full', 'from_join_date']) {
    assert.match(
      sql,
      new RegExp(`['"]${value}['"]`),
      `history policy must include ${value}`,
    )
  }
})

test('conversation membership defines exact room roles and history boundary', () => {
  const sql = normalizedSql()

  for (const value of ['member', 'admin', 'owner']) {
    assert.match(
      sql,
      new RegExp(`['"]${value}['"]`),
      `room role must include ${value}`,
    )
  }

  assert.match(sql, /\bhistory_from\b/)
  assert.match(sql, /\badded_by\b/)
  assert.match(sql, /\bremoved_at\b/)
})

test('workspace chat administration and department lead sources are explicit', () => {
  const sql = normalizedSql()

  assert.match(sql, /create table .*workspace_chat_admin_grants/)
  assert.match(sql, /create table .*workspace_department_leads/)
})

test('authorization helper functions are present', () => {
  const sql = normalizedSql()

  for (const fn of [
    'is_active_employee',
    'is_workspace_chat_admin',
    'is_conversation_member',
    'is_room_admin',
    'can_write_to_conversation',
  ]) {
    assert.match(
      sql,
      new RegExp(`function .*${fn}`),
      `migration must define ${fn}`,
    )
  }
})

test('privileged authorization helpers use SECURITY DEFINER and controlled search_path', () => {
  const sql = normalizedSql()

  assert.match(sql, /security definer/)
  assert.match(sql, /set search_path/)
})

test('anonymous callers are denied privileged chat capabilities', () => {
  const sql = normalizedSql()

  assert.match(sql, /revoke .* from anon/)
})

test('ordinary authenticated clients cannot directly create governed rooms', () => {
  const sql = normalizedSql()

  assert.doesNotMatch(
    sql,
    /grant insert on .*chat_rooms .* to authenticated/,
  )
})
