import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const sql = fs.readFileSync('supabase/migrations/20261023150000_collaboration_tasks_ops_fixes.sql', 'utf8')
const read = (p) => fs.readFileSync(p, 'utf8')
const fn = (name) => {
  const start = sql.indexOf(`function public.${name}(`)
  assert.ok(start > -1, `${name} missing`)
  return sql.slice(start, sql.indexOf('$$;', start))
}

test('a collaboration message notifies the space audience except the author, in-app only', () => {
  assert.match(sql, /create trigger collaboration_messages_notify\s+after insert on public\.collaboration_messages/)
  const body = fn('notify_collaboration_message')
  assert.match(body, /a\.user_id<>new\.author_id/)
  assert.match(body, /'collaboration_space'/)
  assert.match(body, /'skipped'/)
  const audience = fn('collaboration_space_audience')
  for (const kind of ['department', 'cross_department', 'project']) assert.ok(audience.includes(`'${kind}'`), kind)
  assert.match(sql, /revoke all on function public\.collaboration_space_audience\(uuid\)/)
})

test('watchers can read a task, which is what makes a shared task and its files visible', () => {
  assert.match(fn('can_read_work_item'), /work_item_watchers wt[\s\S]*wt\.user_id=auth\.uid\(\)/)
  assert.match(fn('can_read_work_item'), /is_department_head_of_work/)
})

test('any active employee can assign to any active employee', () => {
  const body = fn('can_assign_work')
  assert.match(body, /me\.active=true/)
  assert.match(body, /target\.active=true/)
  assert.doesNotMatch(body, /me\.role in/)
})

test('task files keep executables blocked but allow common formats', () => {
  assert.match(sql, /'video\/mp4'/)
  assert.match(sql, /'text\/markdown'/)
  assert.doesNotMatch(sql, /application\/x-msdownload|application\/x-sh|text\/html|image\/svg/)
})

test('supervisors get select-only access to Operations, never writes', () => {
  assert.match(sql, /for select to authenticated/)
  const after = sql.slice(sql.indexOf('operations supervisor read'))
  assert.doesNotMatch(after, /for (all|insert|update|delete)/)
  assert.match(fn('operations_access_mode'), /support_is_supervisor/)
  assert.match(fn('operations_access_mode'), /ops_is_supervisor/)
})

test('the app wires notifications, nav, assigning and the read-only view', () => {
  assert.match(read('src/components/NotificationCenter.tsx'), /collaboration_space[\s\S]{0,200}setSearchFocus\('shared'/)
  assert.match(read('src/App.tsx'), /\['shared','Collaboration'/)
  assert.match(read('src/App.tsx'), /operations_readonly/)
  assert.doesNotMatch(read('src/modules/WorkDesk.tsx'), /canBrowseAssigneeDirectory/)
  const bench = read('src/modules/DataWorkbench.tsx')
  assert.match(bench, /useOperationsReadOnly/)
  assert.match(bench, /readOnly\s*\?\s*null/)
  assert.match(read('src/modules/OperationsControlPanel.tsx'), /OperationsReadOnlyContext\.Provider/)
})

test('support staff reach Live Dispatch, and supervisors skip the operations-only sign-in', () => {
  assert.match(read('src/modules/OperationsControlPanel.tsx'), /accessMode === 'operations' && !readOnly/)
  assert.match(read('src/modules/DepartmentTeamWorkspace.tsx'), /name:'ArrivoOps Live Dispatch'[^}]*url:'https:\/\/admin\.ridearrivo\.com\/'/)
})

test('Support has an ArrivoOps area that opens the standard read-only console', () => {
  const hub = read('src/modules/SupportWorkspaceHub.tsx')
  assert.match(hub, /id: 'arrivoops'/)
  assert.match(hub, /active === 'arrivoops' \? <SupportArrivoOps \/>/)
  const panel = read('src/modules/SupportArrivoOps.tsx')
  assert.match(panel, /CONSOLE_URL = 'https:\/\/admin\.ridearrivo\.com\/'/)
  assert.doesNotMatch(panel, /surface=operations/)
})
