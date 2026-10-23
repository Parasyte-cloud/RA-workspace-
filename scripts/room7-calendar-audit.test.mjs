import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

// PArAsYtE: regression tests for the ROOM 7 calendar and call-join audit.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const load = path =>
  import(
    `data:text/javascript;base64,${Buffer.from(
      transformSync(read(path), { loader: 'ts', format: 'esm' }).code,
    ).toString('base64')}`
  )

const ICS = await load('supabase/functions/room7-calendar/ics.ts')
const CAL = await load('src/lib/room7Calendar.ts')
const SHARE = await load('src/lib/room7Share.ts')

const row = {
  event_code: 'ABCD2345',
  title: 'Quarterly review, finance; ops',
  description: 'Agenda\nline two',
  starts_at: '2026-11-02T09:00:00Z',
  ends_at: '2026-11-02T10:30:00Z',
  join_url: 'https://room7.ridearrivo.com/r/ABCD2345',
  organizer_name: 'Ride, "Arrivo"',
  organizer_email: 'host@ridearrivo.com',
  sequence: 3,
  status: 'confirmed',
  reminder_minutes: [60, 15],
  updated_at: '2026-10-30T08:00:00Z',
}

test('ics: every line is at most 75 octets, CRLF only, ends with a newline', () => {
  const ics = ICS.makeIcs({
    ...row,
    title: 'Ünïcode 🚗 '.repeat(20),
    description: 'x'.repeat(400),
  })
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.equal(/[^\r]\n/.test(ics), false)
  for (const line of ics.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75, line)
  }
})

test('ics: folding never cuts a multi byte character and unfolds to the original', () => {
  const title = '🚗'.repeat(60)
  const ics = ICS.makeIcs({ ...row, title })
  const unfolded = ics.replace(/\r\n /g, '')
  assert.ok(unfolded.includes(`SUMMARY:${title}`))
  assert.equal(ics.includes('�'), false)
})

test('ics: text is escaped, the URL is not', () => {
  const ics = ICS.makeIcs({ ...row, join_url: 'https://room7.ridearrivo.com/r/ABCD2345?a=1,2;b=3' })
  const unfolded = ics.replace(/\r\n /g, '')
  assert.match(unfolded, /SUMMARY:Quarterly review\\, finance\\; ops\r\n/)
  assert.match(unfolded, /URL:https:\/\/room7\.ridearrivo\.com\/r\/ABCD2345\?a=1,2;b=3\r\n/)
  assert.match(unfolded, /LOCATION:https:\/\/room7\.ridearrivo\.com\/r\/ABCD2345\?a=1\\,2\\;b=3\r\n/)
})

test('ics: a carriage return in a title cannot add properties', () => {
  const ics = ICS.makeIcs({ ...row, title: 'Hi\rATTENDEE:mailto:evil@x.com' })
  assert.equal(/\r?\nATTENDEE/.test(ics.replace(/\r\n /g, '')), false)
  const injected = ICS.makeIcs({ ...row, organizer_email: 'a@b.com\r\nATTENDEE:mailto:evil@x.com' })
  assert.equal(/\r\nATTENDEE/.test(injected), false)
})

test('ics: organizer name is a quoted parameter and a bad email drops the organizer', () => {
  const ics = ICS.makeIcs(row)
  assert.match(ics, /ORGANIZER;CN="Ride, 'Arrivo'":mailto:host@ridearrivo\.com\r\n/)
  assert.equal(ICS.makeIcs({ ...row, organizer_email: 'not an email' }).includes('ORGANIZER'), false)
  assert.equal(ICS.makeIcs({ ...row, organizer_email: null }).includes('ORGANIZER'), false)
})

test('ics: a cancelled event is a PUBLISH with STATUS:CANCELLED, a higher sequence and no alarms', () => {
  const ics = ICS.makeIcs({ ...row, status: 'cancelled', sequence: 4 })
  assert.match(ics, /METHOD:PUBLISH\r\n/)
  assert.doesNotMatch(ics, /METHOD:CANCEL/)
  assert.match(ics, /STATUS:CANCELLED\r\n/)
  assert.match(ics, /SEQUENCE:4\r\n/)
  assert.equal(ics.includes('VALARM'), false)
})

test('ics: times are UTC, stamp comes from updated_at, UID is stable', () => {
  const ics = ICS.makeIcs(row, new Date('2030-01-01T00:00:00Z'))
  assert.match(ics, /DTSTART:20261102T090000Z\r\n/)
  assert.match(ics, /DTEND:20261102T103000Z\r\n/)
  assert.match(ics, /DTSTAMP:20261030T080000Z\r\n/)
  assert.match(ics, /UID:ABCD2345@room7\.ridearrivo\.com\r\n/)
  // Same row, different "now": identical file (so calendars see no phantom change).
  assert.equal(ics, ICS.makeIcs(row, new Date('2031-05-05T00:00:00Z')))
})

test('ics: reminders are deduplicated, bounded and limited to five', () => {
  const ics = ICS.makeIcs({ ...row, reminder_minutes: [15, 15, 60, 0, -4, 'x', 99999, 30, 5, 2, 1] })
  const triggers = [...ics.matchAll(/TRIGGER:-PT(\d+)M/g)].map(match => Number(match[1]))
  assert.ok(triggers.length <= 5)
  assert.equal(new Set(triggers).size, triggers.length)
  assert.ok(triggers.every(minutes => minutes >= 1 && minutes <= 40320))
  const fallback = ICS.makeIcs({ ...row, reminder_minutes: null })
  assert.deepEqual([...fallback.matchAll(/TRIGGER:-PT(\d+)M/g)].map(match => Number(match[1])), [60, 15])
})

test('feed endpoint: public GET/HEAD only, saved as a file, uses the shared builder', () => {
  const fn = read('supabase/functions/room7-calendar/index.ts')
  assert.match(fn, /from '\.\/ics\.ts'/)
  assert.match(fn, /req\.method !== 'GET' && req\.method !== 'HEAD'/)
  assert.match(fn, /attachment; filename=/)
  assert.match(read('supabase/config.toml'), /\[functions\.room7-calendar\]\s*\nverify_jwt = false/)
})

test('timezone check accepts real zones and rejects free text', () => {
  for (const ok of ['Africa/Lagos', 'UTC', 'Europe/London', 'America/New_York']) {
    assert.equal(CAL.isValidTimeZone(ok), true, ok)
  }
  for (const bad of ['Lagos', '', '   ', null, undefined, 'GMT+1 please', 'Mars/Olympus']) {
    assert.equal(CAL.isValidTimeZone(bad), false, String(bad))
  }
})

test('calendar links: long descriptions are trimmed, the join link always survives', () => {
  const event = {
    eventCode: 'ABCD2345',
    title: 'Town hall',
    description: 'long '.repeat(2000),
    startsAt: '2026-11-02T09:00:00Z',
    endsAt: '2026-11-02T10:30:00Z',
    joinUrl: 'https://room7.ridearrivo.com/r/ABCD2345',
  }
  const google = new URL(CAL.googleCalendarUrl(event))
  assert.equal(google.searchParams.get('dates'), '20261102T090000Z/20261102T103000Z')
  assert.match(google.searchParams.get('details'), /Join Room7: https:\/\/room7\.ridearrivo\.com\/r\/ABCD2345/)
  assert.ok(google.href.length < 3000)

  const work = new URL(CAL.outlookCalendarUrl(event))
  const personal = new URL(CAL.outlookCalendarUrl(event, 'personal'))
  assert.equal(work.host, 'outlook.office.com')
  assert.equal(personal.host, 'outlook.live.com')
  assert.equal(personal.searchParams.get('startdt'), '2026-11-02T09:00:00.000Z')
})

test('in-app .ics escapes semicolons and the feed link follows the configured project', () => {
  const start = new Date('2026-11-02T09:00:00Z')
  const event = SHARE.calendarEventFor({ title: 'a; b', code: 'ABCD2345', start, minutes: 30 })
  const ics = SHARE.icsFile(event, 'ABCD2345@room7.ridearrivo.com', new Date('2026-10-30T00:00:00Z'))
  assert.match(ics, /SUMMARY:a\\; b\r\n/)
  assert.match(SHARE.room7InviteCalendarUrl(' abcd2345 '), /\/functions\/v1\/room7-calendar\?code=ABCD2345$/)
})

test('saving validates title, order of times, timezone and reminders before writing', () => {
  const api = read('src/lib/room7CalendarApi.ts')
  assert.match(api, /isValidTimeZone/)
  assert.match(api, /The meeting must end after it starts/)
  assert.match(api, /Give the meeting a title/)
  assert.match(api, /value >= 1 && value <= 1440/)
  const center = read('src/modules/Room7EventControlCenter.tsx')
  assert.match(center, /Timezone must be a real zone name/)
})

test('calendar menu offers Google, work Outlook, personal Outlook and .ics', () => {
  const ui = read('src/modules/Room7CalendarActions.tsx')
  for (const text of ['Google Calendar', 'Outlook (work or school)', 'Outlook.com (personal)', 'Apple / .ics']) {
    assert.ok(ui.includes(text), text)
  }
})

test('migration: deleting a meeting cancels its calendar event, server checks timezone and reminders', () => {
  const sql = read('supabase/migrations/20261023230000_room7_calendar_hardening.sql')
  assert.match(sql, /before delete on public\.workspace_rooms/)
  assert.match(sql, /set status = 'cancelled'/)
  assert.match(sql, /security definer/)
  assert.match(sql, /revoke all on function public\.room7_cancel_calendar_on_room_delete/)
  assert.match(sql, /pg_timezone_names/)
  assert.match(sql, /new\.description is distinct from old\.description/)
  assert.match(sql, /\^\[A-Z0-9\]\{4,20\}\$/)
})

test('call rejoin fails closed: a refused preset change replaces the participant', () => {
  const src = read('supabase/functions/room-session/index.ts')
  const join = src.slice(src.indexOf('if (action === "join")'), src.indexOf('if (action === "end")'))
  assert.match(src, /async function setParticipantPreset[\s\S]*?return true[\s\S]*?return false/)
  assert.match(join, /const presetApplied = await setParticipantPreset/)
  assert.match(join, /deleteParticipant\(config, room\.cloudflare_meeting_id, participantId, true\)/)
  // The replacement is created with the preset the person should have now.
  assert.match(join, /addParticipant\(config, room\.cloudflare_meeting_id, \{[\s\S]*?preset,/)
  // The strict delete throws instead of swallowing.
  assert.match(src, /if \(strict\) throw error/)
})
