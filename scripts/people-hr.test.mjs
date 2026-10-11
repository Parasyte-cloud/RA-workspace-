import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012100000_people_hr_offboarding.sql', 'utf8')
const fn = readFileSync('supabase/functions/workspace-user-admin/index.ts', 'utf8')
const ui = readFileSync('src/modules/PeopleDirectory.tsx', 'utf8')
const core = readFileSync('src/modules/CoreModules.tsx', 'utf8')
const block = fn.slice(fn.indexOf('action==="delete-former"'), fn.indexOf('Unsupported administrator action'))

test('every people function is limited to HR and admin, never anon', () => {
  for (const name of ['get_offboarding_summary', 'offboard_employee', 'update_employee_record']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`))
  }
  assert.equal((sql.match(/has_workspace_role\(array\['hr', 'admin'\]\)/g) || []).length, 3)
})

test('role changes stay administrator only and admins cannot be offboarded', () => {
  assert.match(sql, /Only an administrator can change a role/)
  assert.match(sql, /An administrator cannot be offboarded/)
  assert.match(sql, /Only an administrator can edit an administrator/)
})

test('every change writes to the audit trail', () => {
  assert.equal((sql.match(/insert into public\.admin_audit_log/g) || []).length, 2)
})

test('HR may call delete-former only; all other actions stay admin only', () => {
  assert.match(fn, /callerRole !== "hr"/)
  assert.match(fn, /!callerIsAdmin &&\s*action !== "delete-former"/)
  assert.ok(fn.indexOf('action !== "delete-former"') < fn.indexOf('action==="delete-pending"'))
})

test('delete-former refuses self, active people and admins, and audits first', () => {
  assert.match(block, /userId===administratorId/)
  assert.match(block, /former\.active===true/)
  assert.match(block, /=== ?"admin"|==="admin"/)
  assert.ok(block.indexOf('employee.delete_former"') < block.indexOf('auth.admin.deleteUser'))
})

test('directory asks for the email before a permanent delete and is wired in', () => {
  assert.match(ui, /confirmText\.trim\(\)\.toLowerCase\(\) !== selected\.email\.toLowerCase\(\)/)
  assert.match(ui, /delete-former/)
  assert.match(core, /<PeopleDirectory canManage=/)
})
