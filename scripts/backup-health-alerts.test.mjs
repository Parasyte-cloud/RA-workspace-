import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012170000_backup_health_alerts.sql', 'utf8')
const fn = sql.slice(sql.indexOf('create or replace function public.check_admin_backup_health'), sql.indexOf('revoke all on function'))

test('the checker is security definer with a pinned search_path', () => {
  assert.match(fn, /security definer/)
  assert.match(fn, /set search_path = public, pg_temp/)
})

test('nobody but the database owner can call it', () => {
  assert.match(sql, /revoke all on function public\.check_admin_backup_health\(\) from public, anon, authenticated/)
  assert.doesNotMatch(sql, /grant execute on function public\.check_admin_backup_health/)
})

test('only active admins are told, once a day, and email goes through the dispatcher', () => {
  assert.match(fn, /p\.active = true/)
  assert.match(fn, /lower\(p\.role\) = 'admin'/)
  assert.match(fn, /interval '24 hours'/)
  assert.match(fn, /'pending'/)
})

test('it works when pg_cron is missing and schedules hourly when present', () => {
  assert.match(sql, /pg_extension where extname = 'pg_cron'/)
  assert.match(sql, /'41 \* \* \* \*'/)
  assert.match(sql, /raise notice 'pg_cron is not enabled/)
})

test('array appends are typed so a plain string is never parsed as an array', () => {
  assert.doesNotMatch(fn, /v_reasons \|\| '/)
})

test('backup alerts open the Administration section', () => {
  const alerts = readFileSync('src/lib/desktopAlerts.ts', 'utf8')
  assert.match(alerts, /entityType === 'backup_health'\) return 'admin'/)
})

test('preflight rejects the connection strings GitHub runners cannot use', () => {
  const pf = readFileSync('scripts/admin-backup/preflight.sh', 'utf8')
  assert.match(pf, /port 6543 \(transaction pooler\)/)
  assert.match(pf, /ahostsv4/)
  assert.match(pf, /postgres\.<project-ref>/)
})
