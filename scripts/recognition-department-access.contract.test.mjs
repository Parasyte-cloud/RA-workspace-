import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const migrationPath = new URL('../supabase/migrations/20261020290000_recognition_department_trophy_access.sql', import.meta.url)
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''
const normalized = sql.toLowerCase().replace(/\s+/g, ' ')

function has(pattern, message) { assert.match(sql, pattern, message) }

function functionSlice(name, length = 6000) {
  const start = normalized.indexOf(`function public.${name}`)
  assert.ok(start >= 0, `${name} must exist`)
  return normalized.slice(start, start + length)
}

test('department trophy access migration is additive and defines the approved RPCs', () => {
  assert.ok(sql.length > 0, 'department trophy access migration must exist')
  assert.doesNotMatch(sql, /drop\s+table\s+(?!if exists)/i)
  for (const fn of [
    'recognition_normalize_department',
    'recognition_department_relationship',
    'get_authorized_department_trophy_context',
    'list_department_trophy_history',
  ]) has(new RegExp(`function\\s+public\\.${fn}`, 'i'), `${fn} missing`)
})

test('relationship resolver defines exactly the five approved relationship values', () => {
  const fragment = functionSlice('recognition_department_relationship')
  for (const value of [
    'department_member',
    'workstation_assignee',
    'department_head',
    'delegated_leadership',
    'workspace_admin',
  ]) assert.match(fragment, new RegExp(`'${value}'`), `${value} missing`)
  assert.doesNotMatch(fragment, /like\s+['"]%|position\s*\(/, 'authorization must not use substring matching')
})

test('authorization checks active employee, exact department membership, workstation, heads, delegated leadership and admin', () => {
  const fragment = functionSlice('recognition_department_relationship', 9000)
  assert.match(fragment, /employee_profiles/)
  assert.match(fragment, /active\s*=\s*true/)
  assert.match(fragment, /workspace_workstation_assignments/)
  assert.match(fragment, /is_head\s*=\s*true/)
  assert.match(fragment, /workspace_department_leads/)
  assert.match(fragment, /ended_at\s+is\s+null/)
  assert.match(fragment, /is_workspace_admin\s*\(\s*\)/)
  assert.match(fragment, /recognition_normalize_department/)
})

test('department normalization explicitly covers workstation and display aliases', () => {
  const fragment = functionSlice('recognition_normalize_department')
  for (const value of ['marketing', 'people', 'hr', 'executive', 'administration']) {
    assert.match(fragment, new RegExp(`'${value}'`), `normalizer missing ${value}`)
  }
  assert.match(fragment, /people\s*&\s*hr|people and hr|human resources/)
  assert.match(fragment, /ceo\s*\/\s*management|ceo management/)
})

test('context is redacted and history authorizes before returning rows', () => {
  const context = functionSlice('get_authorized_department_trophy_context')
  for (const key of ['authorized', 'department', 'relationship', 'achievement_count']) {
    assert.match(context, new RegExp(`'${key}'`), `context missing ${key}`)
  }
  assert.doesNotMatch(context, /employee_id|email|job_title|cloudflare|token/)

  const history = functionSlice('list_department_trophy_history')
  assert.match(history, /recognition_department_relationship/)
  assert.match(history, /department_achievements/)
  assert.match(history, /greatest\s*\(\s*1\s*,\s*least\s*\(\s*coalesce\s*\(\s*p_limit/)
  assert.match(history, /order\s+by\s+a\.earned_at\s+desc/)
})

test('privileged functions control search path and execute only for authenticated callers', () => {
  for (const fn of [
    'recognition_department_relationship',
    'get_authorized_department_trophy_context',
    'list_department_trophy_history',
  ]) {
    const fragment = functionSlice(fn)
    assert.match(fragment, /security definer/)
    assert.match(fragment, /set search_path\s*=\s*public\s*,\s*pg_temp/)
  }
  assert.match(normalized, /revoke all on function public\.get_authorized_department_trophy_context\(text\) from public, anon/)
  assert.match(normalized, /grant execute on function public\.get_authorized_department_trophy_context\(text\) to authenticated/)
  assert.match(normalized, /revoke all on function public\.recognition_department_relationship\(text\) from public, anon, authenticated/)
})

test('protected achievement tables are RPC only for browsers', () => {
  assert.match(normalized, /revoke all on public\.department_achievements from anon, authenticated/)
  assert.match(normalized, /revoke all on public\.department_achievement_seen from anon, authenticated/)
  assert.match(normalized, /grant all on public\.department_achievements, public\.department_achievement_seen to service_role/)
})
