import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = new URL('../supabase/migrations/20261020280000_cron_authentication_hardening.sql', import.meta.url)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const migration = () => readFileSync(migrationPath, 'utf8')

function extractFunction(sql, name) {
  const start = sql.indexOf(`function public.${name}()`)
  assert.notEqual(start, -1, `${name}() must exist`)
  const tail = sql.slice(start)
  const end = tail.indexOf('\n$$;')
  assert.notEqual(end, -1, `${name}() body must terminate with $$;`)
  return tail.slice(0, end + 4)
}

test('Phase 2B additive migration exists and replaces cron authentication diagnostics', () => {
  assert.equal(existsSync(migrationPath), true, 'create the additive Phase 2B migration')
  const sql = migration()
  assert.match(sql, /create or replace function public\.cron_authentication_status\(\)/i)
})

test('cron authentication status exposes exactly the approved state vocabulary', () => {
  const status = extractFunction(migration(), 'cron_authentication_status')
  const approved = ['ok', 'missing_secret', 'legacy_service_role', 'misconfigured']
  for (const state of approved) assert.match(status, new RegExp(`'${state}'`))
  for (const legacy of ['needs_repair', 'unknown', 'not_installed', 'not_available']) {
    assert.doesNotMatch(status, new RegExp(`'${legacy}'`))
  }
})

test('status checks both governed jobs even when a cron.job row is absent', () => {
  const status = extractFunction(migration(), 'cron_authentication_status')
  assert.match(status, /ridearrivo-dispatch-notification-emails/)
  assert.match(status, /ridearrivo-poll-bookings/)
  assert.match(status, /for\s+v_jobname\s+in/i)
  assert.match(status, /v_command\s+is\s+null[\s\S]*misconfigured/i)
})

test('status classifies legacy, missing-secret, valid Vault, and unknown auth safely', () => {
  const status = extractFunction(migration(), 'cron_authentication_status')
  assert.match(status, /service_role_key[\s\S]*legacy_service_role/i)
  assert.match(status, /cron_dispatch_secret/)
  assert.match(status, /has_secret[\s\S]*missing_secret/i)
  assert.match(status, /has_secret[\s\S]*ok/i)
  assert.match(status, /else[\s\S]*misconfigured/i)
})

test('diagnostics expose status metadata only and remain unavailable to browser roles', () => {
  const sql = migration()
  const status = extractFunction(sql, 'cron_authentication_status')
  assert.match(status, /returns table\s*\(jobname text, state text\)/i)
  assert.doesNotMatch(status, /select\s+decrypted_secret/i)
  assert.doesNotMatch(status, /returns table[^\n]*secret/i)
  assert.match(sql, /revoke all on function public\.cron_authentication_status\(\) from public, anon, authenticated/i)
  assert.match(sql, /grant execute on function public\.cron_authentication_status\(\) to service_role/i)
})

test('repair is fail-closed and never falls back to the service-role key', () => {
  const repair = extractFunction(migration(), 'repair_cron_authentication')
  assert.match(repair, /returns table\s*\(jobname text, result text\)/i)
  assert.match(repair, /missing_secret/)
  assert.doesNotMatch(repair, /system_config[^\n]*service_role_key/i)
  assert.doesNotMatch(repair, /Bearer[^\n]*service_role/i)
})

test('repair governs only the two approved jobs and preserves each schedule', () => {
  const repair = extractFunction(migration(), 'repair_cron_authentication')
  assert.match(repair, /ridearrivo-dispatch-notification-emails/)
  assert.match(repair, /ridearrivo-poll-bookings/)
  assert.match(repair, /select\s+command::text,\s*schedule::text\s+from cron\.job/i)
  assert.match(repair, /cron\.schedule\(v_jobname,\s*v_schedule,\s*v_cmd\)/i)
})

test('repair keeps the approved endpoint mapping and payload semantics', () => {
  const repair = extractFunction(migration(), 'repair_cron_authentication')
  assert.match(repair, /ridearrivo-poll-bookings[\s\S]*ridearrivo-bookings-poll/)
  assert.match(repair, /ridearrivo-dispatch-notification-emails[\s\S]*notifications-email-dispatch/)
  assert.match(repair, /'Content-Type',\s*'application\/json'/)
  assert.match(repair, /body\s*:=\s*'\{\}'::jsonb/)
  assert.match(repair, /cron_dispatch_secret/)
})

test('repair leaves already-Vault-backed jobs unchanged and refuses malformed auth', () => {
  const repair = extractFunction(migration(), 'repair_cron_authentication')
  assert.match(repair, /cron_dispatch_secret[\s\S]*already_ok/i)
  assert.match(repair, /service_role_key[\s\S]*repaired/i)
  assert.match(repair, /else[\s\S]*misconfigured/i)
})

test('repair remains unavailable to browser roles and is explicit for service_role', () => {
  const sql = migration()
  assert.match(sql, /revoke all on function public\.repair_cron_authentication\(\) from public, anon, authenticated/i)
  assert.match(sql, /grant execute on function public\.repair_cron_authentication\(\) to service_role/i)
})

test('manual cron check delegates to the hardened status and repair functions', () => {
  const check = read('../supabase/checks/reauth-cron-jobs.sql')
  assert.match(check, /cron_authentication_status\(\)/)
  assert.match(check, /repair_cron_authentication\(\)/)
  assert.doesNotMatch(check, /system_config[^\n]*service_role_key/i)
  assert.doesNotMatch(check, /select\s+decrypted_secret/i)
  assert.doesNotMatch(check, /cron\.unschedule|cron\.schedule/i)
})

test('live security checks document safe Phase 2B status and repair flow', () => {
  const live = read('../docs/live-security-checks.sql')
  assert.match(live, /select \* from public\.cron_authentication_status\(\);/i)
  for (const state of ['ok', 'missing_secret', 'legacy_service_role', 'misconfigured']) {
    assert.match(live, new RegExp(state))
  }
  assert.match(live, /cron_dispatch_secret/)
  assert.match(live, /outside source control/i)
  assert.match(live, /select \* from public\.repair_cron_authentication\(\);/i)
  assert.match(live, /ridearrivo-dispatch-notification-emails[\s\S]*ok/i)
  assert.match(live, /ridearrivo-poll-bookings[\s\S]*ok/i)
  assert.doesNotMatch(live, /select\s+decrypted_secret/i)
  assert.doesNotMatch(live, /vault\.create_secret\s*\(/i)
  assert.doesNotMatch(live, /<CRON_DISPATCH_SECRET/i)
})

test('a cron_dispatch_secret mention alone is not enough to classify a job as healthy', () => {
  const sql = migration()
  const status = extractFunction(sql, 'cron_authentication_status')
  const repair = extractFunction(sql, 'repair_cron_authentication')
  const vaultBacked = /position\('cron_dispatch_secret' in v_command\) > 0\s+and position\('vault\.decrypted_secrets' in v_command\) > 0\s+and position\('Authorization' in v_command\) > 0/i
  assert.match(status, vaultBacked)
  assert.match(repair, vaultBacked)
})
