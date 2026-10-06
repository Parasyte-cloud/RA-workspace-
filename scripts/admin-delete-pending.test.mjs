import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fn = readFileSync('supabase/functions/workspace-user-admin/index.ts', 'utf8')
const ui = readFileSync('src/modules/AdminAccessManager.tsx', 'utf8')
const block = fn.slice(fn.indexOf('action==="delete-pending"'), fn.indexOf('Unsupported administrator action'))

test('delete-pending is admin only and guards self, active and previously approved accounts', () => {
  assert.ok(fn.indexOf('Active administrator access is required.') < fn.indexOf('action==="delete-pending"'))
  assert.match(block, /userId===administratorId/)
  assert.match(block, /target\?\.active===true/)
  assert.match(block, /employee\.approve/)
})

test('audit row is written before the Auth user is deleted', () => {
  assert.ok(block.indexOf('employee.delete_pending') < block.indexOf('auth.admin.deleteUser'))
})

test('UI offers delete only for inactive accounts and asks for confirmation', () => {
  assert.match(ui, /!user\.active &&\s*<button[\s\S]{0,200}deletePending\(user\)/)
  assert.match(ui, /window\.confirm\(\s*`Permanently delete/)
})

test('service role is granted access to the admin audit log', () => {
  const sql = readFileSync('supabase/migrations/20261006130000_admin_audit_log_service_role_grant.sql', 'utf8')
  assert.match(sql, /grant select, insert on public\.admin_audit_log to service_role/)
})
