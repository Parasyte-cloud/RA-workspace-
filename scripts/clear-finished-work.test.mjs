import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const sql = read('../supabase/migrations/20261011220000_clear_finished_work_notifications.sql')

test('migration lets people delete only their own notifications', () => {
  assert.match(sql, /create policy "notifications own delete"[\s\S]*for delete[\s\S]*user_id = auth\.uid\(\)/)
  assert.match(sql, /grant delete on public\.notifications to authenticated/)
  assert.ok(!/grant[^;]*delete[^;]*to anon/i.test(sql))
})

test('migration clears notifications when work is completed or cancelled', () => {
  assert.match(sql, /new\.status in \('completed', 'cancelled'\)/)
  assert.match(sql, /entity_type = 'work_item'/)
  assert.match(sql, /after update of status on public\.work_items/)
  assert.match(sql, /security definer/)
  assert.match(sql, /set search_path = public, pg_temp/)
  assert.match(sql, /revoke all on function public\.clear_finished_work_notifications\(\)/)
})

test('migration cleans up stale notifications and has no em dash', () => {
  assert.match(sql, /delete from public\.notifications n\s+using public\.work_items w/)
  assert.ok(!sql.includes('—'))
})

test('notification center can dismiss and clear read', () => {
  const ui = read('../src/components/NotificationCenter.tsx')
  const ctx = read('../src/context/NotificationsContext.tsx')
  assert.ok(ui.includes('Clear read') && ui.includes('notificationDismiss'))
  assert.match(ctx, /\.delete\(\)[\s\S]*\.in\('id',ids\)[\s\S]*\.select\('id'\)/)
})

test('work desk hides finished work behind a toggle', () => {
  const desk = read('../src/modules/WorkDesk.tsx')
  assert.ok(desk.includes('showFinished'))
  assert.match(desk, /status==='completed' \|\| status==='cancelled'/)
})
