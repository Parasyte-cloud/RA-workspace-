import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012140000_calendar_full.sql', 'utf8')
const cal = readFileSync('src/modules/WorkspaceCalendar.tsx', 'utf8')
const rem = readFileSync('src/modules/EventReminders.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const center = readFileSync('src/components/NotificationCenter.tsx', 'utf8')

test('private events are only visible to their owner (not even admin) and only owners invite', () => {
  assert.match(sql, /"events select"[\s\S]*visibility = 'everyone'[\s\S]*created_by = auth\.uid\(\)[\s\S]*is_event_attendee\(id\)/)
  assert.match(sql, /"attendees insert"[\s\S]*event_owner\(event_id\) = auth\.uid\(\)/)
})

test('only HR, Admin and managers publish to everyone', () => {
  assert.match(sql, /"events insert"[\s\S]*visibility in \('private', 'invited'\) or public\.has_workspace_role/)
})

test('attendees can only change their own reply columns', () => {
  assert.match(sql, /revoke update on public\.workspace_event_attendees from authenticated/)
  assert.match(sql, /grant update \(response, responded_at\)/)
})

test('leave is dates only and anon cannot call it', () => {
  assert.match(sql, /returns table\(employee_id uuid, full_name text, start_date date, end_date date\)/)
  assert.doesNotMatch(sql.slice(sql.indexOf('create or replace function public.get_calendar_leave')), /leave_type|reason/)
  assert.match(sql, /revoke all on function public\.get_calendar_leave\(date, date\) from public, anon/)
})

test('calendar offers the four views, search, export, invites and reply buttons', () => {
  for (const word of ["'month'", "'week'", "'day'", "'agenda'", 'buildIcs', 'workspace_event_attendees', 'Only my events', 'Going']) {
    assert.ok(cal.includes(word), word)
  }
})

test('reminders run workspace-wide and invitations open the calendar', () => {
  assert.match(app, /<EventReminders\/>/)
  assert.match(rem, /showDesktopAlert/)
  assert.match(center, /entity_type==='workspace_event'/)
})
