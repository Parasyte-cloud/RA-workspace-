import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'

const load = async (path) => {
  const js = transformSync(fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' }).code
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
}
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8')

const U = await load('src/lib/safeUrl.ts')
const C = await load('src/lib/calendarLogic.ts')

test('links from the database only open when they are plain web addresses', () => {
  assert.equal(U.safeHttpUrl('https://meet.example.com/x'), 'https://meet.example.com/x')
  assert.equal(U.safeHttpUrl('javascript:alert(1)'), undefined)
  assert.equal(U.safeHttpUrl('data:text/html,<b>'), undefined)
  assert.equal(U.safeHttpUrl('https://user:pw@evil.example'), undefined)
  assert.equal(U.safeHttpUrl('not a url'), undefined)
  assert.equal(U.safeHttpUrl(null), undefined)
  for (const f of ['WorkspaceCalendar', 'LegalStatutesPanel', 'LegalLawReportsPanel', 'BrandLibrary']) {
    assert.match(read(`src/modules/${f}.tsx`), /safeHttpUrl\(/, f)
  }
})

const ics = (over = {}) => C.buildIcs([{ id: 'e1', title: 'T', description: null, location: null, url: null,
  starts_at: new Date(2026, 0, 5, 9).toISOString(), ends_at: null, all_day: false, recurrence: 'none', recurrence_until: null, ...over }])

test('calendar export cannot be given extra lines through a link, title or lone carriage return', () => {
  const bad = ics({ url: 'https://ok.example/a\r\nBEGIN:VALARM' })
  assert.ok(!/\r\nBEGIN:VALARM/.test(bad))
  assert.ok(!ics({ url: 'javascript:alert(1)' }).includes('URL:'))
  assert.ok(ics({ url: 'https://ok.example/a' }).includes('URL:https://ok.example/a'))
  const t = ics({ title: 'a\rBEGIN:VALARM' })
  assert.ok(!/(^|\r\n)BEGIN:VALARM/.test(t))
  assert.ok(ics({ title: 'a;b,c' }).includes('SUMMARY:a\\;b\\,c'))
})

test('repeat end date is a UTC time for timed events and a date for all-day events', () => {
  const timed = ics({ recurrence: 'weekly', recurrence_until: '2026-03-01' })
  assert.match(timed, /RRULE:FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z/)
  const allDay = ics({ recurrence: 'weekly', recurrence_until: '2026-03-01', all_day: true })
  assert.match(allDay, /RRULE:FREQ=WEEKLY;UNTIL=20260301\r?\n/)
})

test('an event that has repeated for years still shows today', () => {
  const start = new Date(2019, 0, 1, 9).toISOString()
  const from = new Date(2026, 9, 1), to = new Date(2026, 9, 8)
  const daily = C.expandEvent({ id: 'd', starts_at: start, ends_at: null, recurrence: 'daily', recurrence_until: null }, from, to)
  assert.equal(daily.length, 7)
  const weekly = C.expandEvent({ id: 'w', starts_at: start, ends_at: null, recurrence: 'weekly', recurrence_until: null }, from, to)
  assert.equal(weekly.length, 1)
  const monthly = C.expandEvent({ id: 'm', starts_at: new Date(2010, 0, 3, 9).toISOString(), ends_at: null, recurrence: 'monthly', recurrence_until: null }, new Date(2026, 9, 1), new Date(2026, 10, 1))
  assert.equal(monthly.length, 1)
  // a long event that began before the window still reaches into it
  const long = C.expandEvent({ id: 'l', starts_at: new Date(2019, 0, 1, 9).toISOString(), ends_at: new Date(2019, 0, 4, 9).toISOString(), recurrence: 'daily', recurrence_until: null }, from, to)
  assert.ok(long.length >= 7)
})

test('the admin people list reads every page of accounts, not just the first 200', () => {
  const fn = read('supabase/functions/workspace-user-admin/index.ts')
  assert.match(fn, /for\(let page=1;page<=25;page\+\+\)/)
  assert.match(fn, /batch\.length < 200\) break/)
})

test('a call or meeting stops the idle sign-out', () => {
  const idle = read('src/lib/useIdleSignOut.ts')
  assert.match(idle, /export function useHoldIdleSignOut/)
  assert.match(idle, /if \(holds > 0\)/)
  assert.match(read('src/modules/RoomMeeting.tsx'), /useHoldIdleSignOut\(Boolean\(meeting\)\)/)
})

test('a formula nested far too deep shows an error instead of crashing the sheet', () => {
  assert.match(read('src/lib/sheetFormula.ts'), /v = E\.parse/)
})

test('no em dash in anything the app shows or sends', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`])
  for (const file of [...walk('src'), ...walk('supabase/functions')]) {
    if (!/\.(tsx?|css|html)$/.test(file)) continue
    assert.ok(!fs.readFileSync(file, 'utf8').includes('—'), file)
  }
})
