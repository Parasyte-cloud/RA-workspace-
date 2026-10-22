import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const dir = new URL('../supabase/migrations/', import.meta.url)
const migrationName = '20261022160000_inactive_account_access_hardening.sql'
const sql = readFileSync(new URL(migrationName, dir), 'utf8')

// The helper is redefined in several migrations. The LAST one wins.
function lastDefinitionOf(name) {
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  let last = null
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8')
    if (new RegExp(`create or replace function public\\.${name}\\(`, 'i').test(text)) last = f
  }
  return last
}

test('current_workspace_role() never returns NULL: an inactive account gets "inactive"', () => {
  assert.equal(lastDefinitionOf('current_workspace_role'), migrationName)
  const start = sql.indexOf('function public.current_workspace_role()')
  const body = sql.slice(start, sql.indexOf('$$;', sql.indexOf('as $$', start)) + 3)
  assert.match(body, /coalesce\(/i)
  assert.match(body, /'inactive'/)
  assert.match(body, /p\.active\s*=\s*true/i, 'must still require an active profile')
  assert.match(body, /set search_path\s*=\s*public,\s*pg_temp/i)
})

test('no migration compares the role with <> / != without handling an inactive account', () => {
  // These guards are safe only because the helper never returns NULL.
  // Any NEW guard must use is_workspace_admin() or an explicit is-null branch.
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  const allowed = new Set([
    '20260829103000_workstations_kpi_personal_dashboard.sql',
    '20260830113000_admin_control_plane_presence_audit.sql',
    '20260830160000_admin_backup_control_plane.sql',
    '20261011230000_department_heads.sql',
    migrationName, // mentions the pattern in its explanation
  ])
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8')
    if (/current_workspace_role\(\)\s*(<>|!=)/.test(text)) {
      assert.ok(allowed.has(f), `${f} adds a role guard with <>; use public.is_workspace_admin() instead`)
    }
  }
})

test('knowledge articles, social media files and Room 7 events need an active employee', () => {
  assert.match(sql, /"knowledge articles read published"[\s\S]*?is_active_employee\(\)/)
  assert.match(sql, /"social media employee read"[\s\S]*?is_active_employee\(\)/)
  assert.match(sql, /"social media upload own"[\s\S]*?is_active_employee\(\)/)
  assert.match(sql, /room7_calendar_events_create[\s\S]*?is_active_employee\(\)/)
  assert.match(sql, /room7_calendar_events_update[\s\S]*?is_active_employee\(\)/)
})

test('push endpoints are limited to known https push services and cannot block the migration', () => {
  assert.match(sql, /push_subscriptions_endpoint_known_host/)
  assert.match(sql, /support_push_subscriptions_endpoint_known_host/)
  const notValid = sql.match(/\) not valid;/g) || []
  assert.equal(notValid.length, 2, 'both checks must be NOT VALID so existing rows do not fail the migration')
  assert.match(sql, /\^https:\/\//)
  assert.doesNotMatch(sql, /169\.254|localhost/)
})

test('the legal panel maps the "inactive" answer to no role', () => {
  const src = readFileSync(new URL('../src/lib/legalLawReports.ts', import.meta.url), 'utf8')
  assert.match(src, /data !== 'inactive'/)
})

test('no em dash in the migration or this test', () => {
  const dash = String.fromCharCode(0x2014)
  assert.ok(!sql.includes(dash))
  assert.ok(!readFileSync(new URL(import.meta.url), 'utf8').includes(dash))
})

test('revoking an employee also bans the Auth user, and approving lifts the ban', () => {
  const src = readFileSync(new URL('../supabase/functions/workspace-user-admin/index.ts', import.meta.url), 'utf8')
  assert.match(src, /ban_duration:"876000h"/)
  assert.match(src, /ban_duration:"none"/)
  const revoke = src.slice(src.indexOf('if(action==="revoke")'), src.indexOf('if(action==="delete-pending")'))
  assert.match(revoke, /ban_duration/)
  assert.match(revoke, /sessionsBlocked/)
})

test('the calendar feed cannot be given extra properties through a carriage return', () => {
  const src = readFileSync(new URL('../supabase/functions/room7-calendar/index.ts', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('function escapeIcs'), src.indexOf('function toIcsUtc'))
  assert.match(fn, /\\r\\n\|\\r\|\\n/)
})

test('web push sends have a timeout so one slow endpoint cannot stall dispatch', () => {
  const src = readFileSync(new URL('../supabase/functions/push-dispatch/index.ts', import.meta.url), 'utf8')
  assert.match(src, /timeout:\s*8000/)
})
