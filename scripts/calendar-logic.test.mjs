import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/calendarLogic.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const L = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

const ev = (over = {}) => ({
  id: 'e1', title: 'T', starts_at: new Date(2026, 0, 31, 9, 0).toISOString(), ends_at: null,
  all_day: false, recurrence: 'none', recurrence_until: null, ...over,
})
const days = occ => occ.map(o => L.keyOf(o.start))

test('a plain event shows once, and not outside the range', () => {
  assert.equal(L.expandEvent(ev(), new Date(2026, 0, 1), new Date(2026, 1, 1)).length, 1)
  assert.equal(L.expandEvent(ev(), new Date(2026, 1, 1), new Date(2026, 2, 1)).length, 0)
})

test('monthly on the 31st lands on the last day of short months', () => {
  const occ = L.expandEvent(ev({ recurrence: 'monthly' }), new Date(2026, 0, 1), new Date(2026, 4, 1))
  assert.deepEqual(days(occ), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
})

test('weekly, biweekly and the until date', () => {
  const from = new Date(2026, 0, 1), to = new Date(2026, 1, 28)
  assert.deepEqual(days(L.expandEvent(ev({ recurrence: 'weekly', recurrence_until: '2026-02-14' }), from, to)),
    ['2026-01-31', '2026-02-07', '2026-02-14'])
  assert.deepEqual(days(L.expandEvent(ev({ recurrence: 'biweekly' }), from, to)),
    ['2026-01-31', '2026-02-14', '2026-02-28'].slice(0, 2))
})

test('yearly on Feb 29 uses Feb 28 in other years', () => {
  const e = ev({ recurrence: 'yearly', starts_at: new Date(2024, 1, 29, 9).toISOString() })
  assert.deepEqual(days(L.expandEvent(e, new Date(2025, 0, 1), new Date(2026, 0, 1))), ['2025-02-28'])
})

test('an old repeating event still appears in a later month', () => {
  const e = ev({ recurrence: 'weekly', starts_at: new Date(2025, 0, 6, 9).toISOString() })
  assert.ok(L.expandEvent(e, new Date(2026, 5, 1), new Date(2026, 6, 1)).length >= 4)
})

test('a multi-day event is on every day it spans, and midnight ends the day before', () => {
  const s = new Date(2026, 2, 10, 0), e = new Date(2026, 2, 13, 0)
  assert.equal(L.occursOnDay(s, e, '2026-03-10'), true)
  assert.equal(L.occursOnDay(s, e, '2026-03-12'), true)
  assert.equal(L.occursOnDay(s, e, '2026-03-13'), false)
})

test('overlapping events share width; separate ones do not', () => {
  const t = (h1, h2) => ({ start: new Date(2026, 3, 1, h1), end: new Date(2026, 3, 1, h2) })
  const placed = L.layoutDay([t(9, 11), t(10, 12), t(14, 15)], '2026-04-01')
  assert.equal(placed.length, 3)
  assert.equal(placed[0].columns, 2)
  assert.notEqual(placed[0].column, placed[1].column)
  assert.equal(placed[2].columns, 1)
  assert.equal(placed[2].top, 14 * 60)
})

test('weeks start on Monday', () => {
  assert.equal(L.keyOf(L.startOfWeek(new Date(2026, 9, 11))), '2026-10-05')
})

test('ics escapes text, folds long lines and carries the repeat rule', () => {
  const out = L.buildIcs([{ id: 'x', title: 'Plan, review; "go"', description: 'a'.repeat(200), location: null, url: null,
    starts_at: new Date(2026, 0, 5, 9).toISOString(), ends_at: new Date(2026, 0, 5, 10).toISOString(), all_day: false,
    recurrence: 'biweekly', recurrence_until: '2026-03-01' }], new Date(Date.UTC(2026, 0, 1)))
  assert.match(out, /SUMMARY:Plan\\, review\; "go"/)
  assert.match(out, /RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20260301/)
  for (const line of out.split('\r\n')) assert.ok(line.length <= 75)
  assert.match(out, /^BEGIN:VCALENDAR/)
})
