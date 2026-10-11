import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const sql = read('../supabase/migrations/20261011230000_department_heads.sql')

test('head flag lives on the workstation assignment and clears when it is inactive', () => {
  assert.match(sql, /add column if not exists is_head boolean not null default false/)
  assert.match(sql, /if new\.active is not true then\s+new\.is_head := false/)
})

test('only an admin can name a head, and not for administration or executive', () => {
  assert.match(sql, /current_workspace_role\(\) is distinct from 'admin'/)
  assert.match(sql, /current_ws in \('administration', 'executive'\)/)
})

test('head powers are scoped by is_department_head_of and exclude project spaces', () => {
  assert.match(sql, /function public\.is_department_head_of\(target uuid\)/)
  assert.match(sql, /h\.is_head = true/)
  assert.match(sql, /w\.project_space_id is null/)
})

test('every work permission function got the head rule and stays security definer', () => {
  for (const fn of ['can_read_work_item', 'can_assign_work', 'get_work_approval_candidates', 'request_work_approval', 'decide_work_approval', 'cancel_work_approval', 'update_work_status']) {
    const m = sql.match(new RegExp(`create or replace function public\\.${fn}\\(.*?\\n\\$\\$;\\n`, 's'))
    assert.ok(m, `${fn} missing`)
    assert.match(m[0], /is_department_head_of(_work)?\(/, `${fn} lacks head rule`)
    assert.match(m[0], /security definer/)
    assert.match(m[0], /set search_path\s*=\s*public,\s*pg_temp/)
  }
})

test('a head cannot approve their own request', () => {
  assert.match(sql, /is_department_head_of_work\(approval_row\.work_item_id\)\s+and approval_row\.requested_by<>actor/)
})

test('new functions are closed to anon and the migration has no em dash', () => {
  for (const fn of ['is_department_head_of(uuid)', 'is_department_head_of_work(uuid)', 'get_department_head_scope()', 'set_workstation_head(uuid, boolean)']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon`), fn)
  }
  assert.ok(!sql.includes('—'))
})

test('UI: Workstation Control names heads and Work Desk shows Department Work', () => {
  assert.ok(read('../src/modules/WorkstationAssignmentManager.tsx').includes("rpc('set_workstation_head'"))
  const desk = read('../src/modules/WorkDesk.tsx')
  assert.ok(desk.includes("rpc('get_department_head_scope')") && desk.includes('Department Work'))
  assert.ok(read('../src/modules/WorkItemDetail.tsx').includes('departmentScopeIds'))
})
