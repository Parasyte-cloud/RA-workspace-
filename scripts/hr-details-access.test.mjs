import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const dir = 'supabase/migrations'
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

// Final definition of each employee_hr_details policy = the last migration that creates it.
function lastPolicy(name) {
  let body = ''
  for (const f of files) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8')
    const m = sql.match(new RegExp(`create policy\\s+"${name}"[\\s\\S]*?;`, 'i'))
    if (m && /employee_hr_details/.test(m[0])) body = m[0]
  }
  return body
}

test('employee_hr_details policies never grant the manager role', () => {
  for (const name of ['employee hr details read', 'employee hr details insert', 'employee hr details update']) {
    const body = lastPolicy(name)
    assert.ok(body, `${name} policy not found`)
    assert.doesNotMatch(body, /manager/i, `${name} still allows managers`)
    assert.match(body, /hr/)
  }
})

test('HR biodata admin panel is shown to hr and admin only', () => {
  const ui = readFileSync('src/modules/CoreModules.tsx', 'utf8')
  assert.match(ui, /\['hr','admin'\]\.includes\(viewerRole\)&&<EmployeeHrDetailsAdminPanel/)
})

test('employee_profiles role changes are guarded to admins', () => {
  const sql = readFileSync('supabase/migrations/20261006121000_employee_profiles_role_change_guard.sql', 'utf8')
  assert.match(sql, /new\.role is distinct from old\.role/)
  assert.match(sql, /<> 'admin'/)
  assert.match(sql, /before insert or update on public\.employee_profiles/)
})
