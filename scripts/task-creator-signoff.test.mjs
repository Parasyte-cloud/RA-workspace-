import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = (p) => fs.readFileSync(p, 'utf8')
const sql = read('supabase/migrations/20261023220000_task_creator_signoff.sql')
const fn = (name) => {
  const start = sql.indexOf(`function public.${name}(`)
  assert.ok(start > -1, `${name} missing`)
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('as $$', start)))
}

test('only tasks someone else works on need sign-off, and project boards keep their own flow', () => {
  const body = fn('work_needs_creator_signoff')
  assert.match(body, /a\.assignee_id<>w\.created_by/)
  assert.match(body, /w\.project_space_id is null/)
})

test('an assignee cannot complete the task, only the creator can', () => {
  const body = fn('update_work_status')
  assert.match(body, /new_status='completed'\s+and public\.work_needs_creator_signoff/)
  assert.match(body, /needs approval from the person who assigned it/)
  assert.match(body, /w\.created_by=actor/)
})

test('moving to review sends a pending approval to the creator', () => {
  const body = fn('update_work_status')
  assert.match(body, /new_status='review'[\s\S]*perform public\.request_work_approval\(/)
})

test('any approval request also pulls in the creator, and only the creator can decide their row', () => {
  assert.match(fn('request_work_approval'), /Creator sign-off is required/)
  assert.match(fn('decide_work_approval'), /Only the person who assigned this work can approve it/)
})

test('the creator being gone never traps a task', () => {
  assert.match(fn('work_creator_available'), /c\.active=true/)
  assert.match(fn('update_work_status'), /work_creator_available/)
})

test('the screens show it in red and lock Completed for assignees', () => {
  const desk = read('src/modules/WorkDesk.tsx')
  assert.match(desk, /workSignoffBanner/)
  assert.match(desk, /Send for approval/)
  assert.match(desk, /\(!needsSignoff \|\| iAmCreator \|\| item\.status==='completed'\)/)
  assert.match(read('src/modules/WorkItemDetail.tsx'), /workSignoffBanner/)
  assert.match(read('src/components/NotificationCenter.tsx'), /approvalRequired/)
  const css = read('src/styles.css')
  assert.match(css, /\.workSignoffBanner\{[^}]*#ff4d4f/)
})
