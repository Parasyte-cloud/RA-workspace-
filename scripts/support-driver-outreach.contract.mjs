import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../supabase/migrations/20261021133000_support_driver_outreach_crm.sql', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/modules/SupportDriverOutreach.tsx', import.meta.url), 'utf8')
const centre = readFileSync(new URL('../src/modules/SupportCommandCentre.tsx', import.meta.url), 'utf8')

test('driver outreach CRM has editable business statuses and follow-up records', () => {
  assert.match(migration, /create table if not exists public\.support_driver_statuses/i)
  assert.match(migration, /create table if not exists public\.support_ticket_followups/i)
  assert.match(migration, /Interested/)
  assert.match(migration, /Not interested/)
  assert.match(migration, /support_driver_status_upsert/)
})

test('outreach writes are guarded by Support authorization and ownership', () => {
  assert.match(migration, /support_is_staff\(auth\.uid\(\)\)/)
  assert.match(migration, /support_is_supervisor\(auth\.uid\(\)\)/)
  assert.match(migration, /belongs to another officer/)
  assert.match(migration, /revoke all on function public\.support_driver_outreach_create/)
})

test('outreach view keeps representative rows scoped to assigned tickets', () => {
  assert.match(migration, /public\.support_is_supervisor\(auth\.uid\(\)\) or t\.assigned_agent_id = auth\.uid\(\)/)
})

test('command centre exposes Driver outreach as a native tab', () => {
  assert.match(centre, /Driver outreach/)
  assert.match(centre, /<SupportDriverOutreach/)
  assert.match(panel, /Every recruitment call becomes an owned ticket/)
  assert.match(panel, /New driver/)
})
