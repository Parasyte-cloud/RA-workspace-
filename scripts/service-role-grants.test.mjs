import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261006140000_service_role_table_grants.sql', 'utf8')

test('service role gets table access but anon and authenticated are not widened', () => {
  assert.match(sql, /grant all on all tables in schema public to service_role/)
  assert.doesNotMatch(sql, /to\s+(anon|authenticated)/i)
})

test('append-only Zoho audit trail restriction is kept', () => {
  assert.match(sql, /revoke update, delete, truncate on public\.zoho_mail_audit_events from service_role/)
})
