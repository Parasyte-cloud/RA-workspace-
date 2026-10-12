import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/room7Share.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const S = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const sql = readFileSync('supabase/migrations/20261012300000_room7_summary_email.sql', 'utf8')
const dispatch = readFileSync('supabase/functions/notifications-email-dispatch/index.ts', 'utf8')
const ui = readFileSync('src/modules/RoomModule.tsx', 'utf8')

const start = new Date('2026-10-14T13:30:00Z')
const event = S.calendarEventFor({ title: 'Weekly sync, ops; "all hands"', code: 'ABCD2345', start, minutes: 45 })

test('google and outlook links carry the right times and the guest link', () => {
  const g = new URL(S.googleCalendarUrl(event))
  assert.equal(g.searchParams.get('dates'), '20261014T133000Z/20261014T141500Z')
  assert.equal(g.searchParams.get('location'), 'https://room7.ridearrivo.com/r/ABCD2345')
  assert.match(g.searchParams.get('details'), /Event code: ABCD2345/)
  const o = new URL(S.outlookCalendarUrl(event))
  assert.equal(o.searchParams.get('startdt'), '2026-10-14T13:30:00.000Z')
  assert.equal(o.searchParams.get('enddt'), '2026-10-14T14:15:00.000Z')
})

test('ics file is valid: CRLF, escaped text, folded lines, reminder', () => {
  const ics = S.icsFile(event, 'ABCD2345@room7.ridearrivo.com', new Date('2026-10-12T09:00:00Z'))
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'))
  assert.match(ics, /DTSTART:20261014T133000Z\r\n/)
  assert.match(ics, /DTEND:20261014T141500Z\r\n/)
  assert.match(ics, /SUMMARY:Weekly sync\\, ops\; "all hands"\r\n/)
  assert.match(ics, /TRIGGER:-PT10M/)
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line)
  assert.equal(/[^\r]\n/.test(ics), false)
})

test('passcode only goes into the event when it is known', () => {
  assert.doesNotMatch(event.details, /Passcode:/)
  const withPass = S.calendarEventFor({ title: 'x1', code: 'ABCD2345', passcode: 'ZZZZ9999', start, minutes: 30 })
  assert.match(withPass.details, /Passcode: ZZZZ9999/)
})

test('picker starts at the next quarter hour, never in the past', () => {
  const from = new Date('2026-10-12T10:07:00Z')
  const next = S.nextQuarterHour(from)
  assert.ok(next > from)
  assert.equal(next.getUTCMinutes() % 15, 0)
  assert.ok(next.getTime() - from.getTime() <= 15 * 60000)
  const exact = S.nextQuarterHour(new Date('2026-10-12T10:15:00Z'))
  assert.equal(exact.toISOString(), '2026-10-12T10:30:00.000Z')
})

test('summary email: once per session, only when AI notes were on, host and attendees only', () => {
  assert.match(sql, /summary_emailed_at is not null/)
  assert.match(sql, /not room\.ai_notes_enabled/)
  assert.match(sql, /e\.id = room\.created_by/)
  assert.match(sql, /workspace_room_attendance/)
  assert.doesNotMatch(sql, /room7_guest_attendance/)
  assert.match(sql, /exception when others/)
  assert.match(sql, /revoke all on function public\.room7_email_summary/)
})

test('email sweep renders room_minutes with a summary card', () => {
  assert.match(dispatch, /row\.type === "room_minutes"/)
  assert.match(dispatch, /minutesEmail\(/)
  assert.match(dispatch, /escapeHtml\(part\)/)
})

test('invite card offers calendar buttons', () => {
  for (const s of ['Add to calendar', 'googleCalendarUrl', 'outlookCalendarUrl', 'icsFile', 'datetime-local'])
    assert.ok(ui.includes(s), s)
})
