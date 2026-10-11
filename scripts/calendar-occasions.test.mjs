import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012130000_calendar_occasions.sql', 'utf8')
const cal = readFileSync('src/modules/WorkspaceCalendar.tsx', 'utf8')
const people = readFileSync('src/modules/PeopleDirectory.tsx', 'utf8')

test('occasions are computed live, never copied, and need an active employee', () => {
  assert.match(sql, /create or replace function public\.get_calendar_occasions/)
  assert.match(sql, /Active workspace profile required/)
  assert.doesNotMatch(sql, /insert into public\.workspace_events/)
})

test('birthdays expose day and month only (no year or age column)', () => {
  const fn = sql.slice(sql.indexOf('create or replace function public.get_calendar_occasions'), sql.indexOf('3. HR can record'))
  assert.doesNotMatch(fn, /age\(/)
  assert.match(fn, /null::int/)
})

test('only HR and Admin edit festivals; anon cannot call the function', () => {
  assert.match(sql, /"festivals manage"[\s\S]*has_workspace_role\(array\['hr', 'admin'\]\)/)
  assert.match(sql, /revoke all on function public\.get_calendar_occasions\(date, date\) from public, anon/)
})

test('islamic festival dates are flagged approximate', () => {
  assert.match(sql, /'Eid al-Fitr'[^)]*true/)
})

test('calendar shows all five kinds and the people editor sets a start date', () => {
  for (const kind of ['event', 'birthday', 'anniversary', 'holiday', 'festival']) assert.ok(cal.includes(`'${kind}'`), kind)
  assert.match(cal, /get_calendar_occasions/)
  assert.match(people, /new_start_date/)
})
