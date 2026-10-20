import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const fn = fs.readFileSync('supabase/functions/workspace-search/index.ts', 'utf8')
const check = fs.readFileSync('supabase/checks/workspace_search_rls_check.sql', 'utf8')

const sensitive = [
  'employee_profiles', 'support_cases', 'incidents', 'hr_requests', 'leave_requests',
  'intake_submissions', 'social_conversation_members', 'social_messages',
]

test('RLS production check covers every sensitive result table', () => {
  for (const table of sensitive) assert.ok(check.includes(`'${table}'`), `${table} missing from production RLS check`)
})

test('workspace search creates one caller client carrying the inbound authorization header', () => {
  assert.match(fn, /SUPABASE_ANON_KEY/)
  assert.match(fn, /global:\s*\{\s*headers:\s*\{\s*Authorization:\s*authHeader/)
  assert.doesNotMatch(fn, /SUPABASE_SERVICE_ROLE_KEY/)
})

test('sensitive search results rely on caller RLS instead of hand-copied role or workstation filters', () => {
  assert.doesNotMatch(fn, /canSeeSupport|canSeeIncidents|canSeeAllHr|canSeeAllLeave|canSeeAllIntake/)
  assert.doesNotMatch(fn, /intakeWorkstations/)
  assert.doesNotMatch(fn, /admin\.from\(/)
  for (const table of sensitive) assert.match(fn, new RegExp(`userClient(?:[\\s\\S]{0,180})?\\.from\\("${table}"\\)`), `${table} must use caller client`)
})

test('caller authentication validates the exact bearer token before any RLS query', () => {
  assert.match(fn, /const\s+jwt\s*=\s*authHeader\.slice\(7\)\.trim\(\)/)
  assert.match(fn, /userClient\.auth\.getUser\(jwt\)/)
})
