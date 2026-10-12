import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012200000_hr_department_admin.sql', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const view = readFileSync('src/modules/DepartmentAdminView.tsx', 'utf8')

test('HR can open Department Admin; nobody else gains access by role', () => {
  assert.match(app, /deptadmin:\['hr'\]/)
})

test('HR gets a read-only view: the head helper that drives assign/sign-off is untouched', () => {
  assert.ok(!/replace function public\.is_department_head_of\(/.test(sql))
  assert.ok(!/replace function public\.is_department_head_of_work\(/.test(sql))
  assert.match(sql, /can_view_department_member/)
  assert.match(sql, /has_workspace_role\(array\['hr'\]\)/)
})

test('the overview still hides addresses, IPs, serials and IMEI', () => {
  for (const banned of ['source_ip', 'serial', 'imei', 'browser_name', 'latitude'])
    assert.ok(!new RegExp(banned, 'i').test(sql.replace(/--.*$/gm, '')), banned)
})

test('opening one person is still written to the audit trail', () => {
  assert.match(sql, /insert into public\.admin_audit_log/)
  assert.match(sql, /not public\.can_view_department_member\(target_user\)/)
})

test('the view has an Everyone tab that lists each person once and puts online people first', () => {
  assert.match(view, /EVERYONE/)
  assert.match(view, /seen\.has\(row\.employee_id\)/)
  assert.match(view, /isOnline\(b\.row\.last_seen_at\)/)
})
