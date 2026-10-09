import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  MIN_HOURS,
  addDays,
  describeLead,
  earliestAllowed,
  earliestWindow,
  formatDay,
  formatLagos,
  hoursAwayLabel,
  lagosInstant,
  lagosParts,
  lagosToday,
  lateRequestNote,
  leadStatus,
  mailtoHref,
  phoneHasEnoughDigits,
  supportMessage,
  whatsappHref,
  windowStartTime,
} from '../src/forms-public/lateBooking.ts'

const HOUR = 60 * 60 * 1000
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('the rule matches the backend: 12 hours', () => {
  assert.equal(MIN_HOURS, 12)
})

test('lagosParts reads Lagos wall-clock time, not UTC or the device zone', () => {
  // 23:30 UTC is already 00:30 the next day in Lagos (UTC+1).
  assert.deepEqual(lagosParts(new Date('2026-10-09T23:30:00Z')), { date: '2026-10-10', time: '00:30' })
  assert.deepEqual(lagosParts(new Date('2026-10-09T12:00:00Z')), { date: '2026-10-09', time: '13:00' })
  assert.equal(lagosToday(new Date('2026-12-31T23:59:00Z')), '2027-01-01')
})

test('lagosInstant turns a Lagos wall-clock time into the right instant', () => {
  assert.equal(lagosInstant('2026-10-10', '07:30')?.toISOString(), '2026-10-10T06:30:00.000Z')
  assert.equal(lagosInstant('2026-10-10', '00:00')?.toISOString(), '2026-10-09T23:00:00.000Z')
})

test('lagosInstant rejects anything that is not a real moment', () => {
  assert.equal(lagosInstant('2026-02-31', '10:00'), null)
  assert.equal(lagosInstant('2026-10-10', '25:00'), null)
  assert.equal(lagosInstant('2026-10-10', '10:61'), null)
  assert.equal(lagosInstant('', '10:00'), null)
  assert.equal(lagosInstant('2026-10-10', ''), null)
  assert.equal(lagosInstant('10/10/2026', '10:00'), null)
  assert.equal(lagosInstant('2026-10-10', '9:00'), null)
})

test('leadStatus: exactly 12 hours is fine, one millisecond under is late', () => {
  const now = new Date('2026-10-09T10:00:00Z')
  assert.equal(leadStatus(new Date(now.getTime() + 48 * HOUR), now), 'ok')
  assert.equal(leadStatus(new Date(now.getTime() + 12 * HOUR), now), 'ok')
  assert.equal(leadStatus(new Date(now.getTime() + 12 * HOUR - 1), now), 'late')
  assert.equal(leadStatus(new Date(now.getTime() + 2 * HOUR), now), 'late')
  assert.equal(leadStatus(new Date(now.getTime()), now), 'late')
})

test('leadStatus: a time that has already gone is past, not late', () => {
  const now = new Date('2026-10-09T10:00:00Z')
  assert.equal(leadStatus(new Date(now.getTime() - 1), now), 'past')
  assert.equal(leadStatus(new Date(now.getTime() - 5 * HOUR), now), 'past')
})

test('earliestAllowed is 12 hours out, rounded up to the next five minutes', () => {
  assert.equal(earliestAllowed(new Date('2026-10-09T10:02:30Z')).toISOString(), '2026-10-09T22:05:00.000Z')
  assert.equal(earliestAllowed(new Date('2026-10-09T10:00:00Z')).toISOString(), '2026-10-09T22:00:00.000Z')
  const now = new Date('2026-10-09T10:03:01Z')
  assert.ok(earliestAllowed(now).getTime() >= now.getTime() + MIN_HOURS * HOUR)
  assert.equal(leadStatus(earliestAllowed(now), now), 'ok')
})

test('windowStartTime reads the start of each Removals window', () => {
  assert.equal(windowStartTime('Morning (8am to 12pm)'), '08:00')
  assert.equal(windowStartTime('Afternoon (12pm to 4pm)'), '12:00')
  assert.equal(windowStartTime('Evening (4pm to 8pm)'), '16:00')
  assert.equal(windowStartTime('Late night (12am to 4am)'), '00:00')
  assert.equal(windowStartTime(''), null)
  assert.equal(windowStartTime('Choose a window'), null)
  assert.equal(windowStartTime('Odd (0am to 4am)'), null)
})

test('a Removals date plus window becomes a Lagos instant to measure notice against', () => {
  const start = windowStartTime('Morning (8am to 12pm)')
  const when = lagosInstant('2026-10-10', start ?? '')
  assert.equal(when?.toISOString(), '2026-10-10T07:00:00.000Z')
})

test('addDays crosses month and year ends and ignores the device zone', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-10-09', 0), '2026-10-09')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})

test('earliestWindow finds the first Removals window with 12 hours of notice', () => {
  const windows = ['Morning (8am to 12pm)', 'Afternoon (12pm to 4pm)', 'Evening (4pm to 8pm)']
  // 06:00 Lagos on 9 Oct: the earliest start is 18:00 today, so the first
  // window that clears it is tomorrow's morning.
  assert.deepEqual(earliestWindow(windows, new Date('2026-10-09T05:00:00Z')), {
    date: '2026-10-10',
    window: 'Morning (8am to 12pm)',
  })
  // 03:30 Lagos: 12 hours later is 15:30, so today's Evening (16:00) works.
  assert.deepEqual(earliestWindow(windows, new Date('2026-10-09T02:30:00Z')), {
    date: '2026-10-09',
    window: 'Evening (4pm to 8pm)',
  })
  // Exactly 12 hours before a window start is still allowed.
  assert.deepEqual(earliestWindow(windows, new Date('2026-10-09T03:00:00Z')), {
    date: '2026-10-09',
    window: 'Evening (4pm to 8pm)',
  })
  // 23:30 Lagos on 9 Oct: every window today has gone, and 12 hours out is
  // 11:30 on the 10th, so the 8am window is too soon and noon is the first fit.
  assert.deepEqual(earliestWindow(windows, new Date('2026-10-09T22:30:00Z')), {
    date: '2026-10-10',
    window: 'Afternoon (12pm to 4pm)',
  })
  assert.equal(earliestWindow([], new Date('2026-10-09T05:00:00Z')), null)
  assert.equal(earliestWindow(['Choose a window'], new Date('2026-10-09T05:00:00Z')), null)
})

test('lateRequestNote always keeps the flag and never exceeds the field limit', () => {
  const when = new Date('2026-10-10T06:30:00Z')
  const plain = lateRequestNote('', when, 1000)
  assert.match(plain, /^LATE REQUEST, under 12h notice\. Requested time: /)
  assert.ok(plain.length <= 1000)

  const withNotes = lateRequestNote('Please call the gate first.', when, 1000)
  assert.ok(withNotes.startsWith(plain))
  assert.ok(withNotes.endsWith('Please call the gate first.'))

  for (const limit of [1000, 2000]) {
    const huge = lateRequestNote('x'.repeat(5000), when, limit)
    assert.equal(huge.length, limit)
    assert.ok(huge.startsWith('LATE REQUEST'))
  }

  // Absurdly small limit: flag is clipped, never longer than the limit.
  assert.ok(lateRequestNote('hello', when, 20).length <= 20)
})

test('a non-Nigerian departure is labelled as typed, not as Lagos time', () => {
  const when = new Date('2026-10-10T06:30:00Z') // 07:30 in Lagos
  // Intl may or may not put a comma after the weekday depending on the ICU
  // version of the runtime, so the pattern allows both.
  assert.match(formatLagos(when), /^Sat,? 10 Oct,? 07:30 \(Lagos time\)$/)
  assert.match(formatLagos(when, false), /^Sat,? 10 Oct,? 07:30$/)
  const lagosNote = lateRequestNote('', when, 2000)
  assert.match(lagosNote, /Requested time: Sat,? 10 Oct,? 07:30 \(Lagos time\)\./)
  const localNote = lateRequestNote('', when, 2000, 'local')
  assert.match(localNote, /Requested time: Sat,? 10 Oct,? 07:30 \(as typed, departure airport time\)\./)
  assert.ok(!localNote.includes('Lagos time'))
  assert.ok(lateRequestNote('x'.repeat(5000), when, 2000, 'local').length <= 2000)
})

test('formatDay shows a readable date and never "Invalid Date"', () => {
  assert.match(formatDay('2026-10-10'), /^Sat,? 10 Oct$/)
  assert.match(formatDay('2026-12-31'), /^Thu,? 31 Dec$/)
  assert.equal(formatDay(''), '')
  assert.equal(formatDay('2026-02-31'), '2026-02-31')
  assert.equal(formatDay('soon'), 'soon')
})

test('hoursAwayLabel reads naturally', () => {
  const now = new Date('2026-10-09T10:00:00Z')
  assert.equal(hoursAwayLabel(new Date(now.getTime() + 20 * 60 * 1000), now), 'less than an hour')
  assert.equal(hoursAwayLabel(new Date(now.getTime() + 1 * HOUR), now), 'about 1 hour')
  assert.equal(hoursAwayLabel(new Date(now.getTime() + 5.4 * HOUR), now), 'about 5 hours')
  assert.equal(hoursAwayLabel(new Date(now.getTime() - HOUR), now), 'less than an hour')
})

test('describeLead says how close the time is, or that it has already started', () => {
  const now = new Date('2026-10-09T10:00:00Z')
  assert.equal(describeLead(new Date(now.getTime() + 5 * HOUR), now), 'is about 5 hours away')
  assert.equal(describeLead(new Date(now.getTime() + 10 * 60 * 1000), now), 'is less than an hour away')
  assert.equal(describeLead(new Date(now.getTime() - 2 * HOUR), now), 'has already started')
})

test('support links carry the rider\'s details and encode safely', () => {
  const message = supportMessage(
    [
      { label: 'Date', value: 'Sat 10 Oct' },
      { label: 'Empty', value: '' },
      { label: 'From', value: 'Lekki & Ikoyi' },
    ],
    'Removals',
  )
  assert.match(message, /Removals booking sooner than 12 hours/)
  assert.ok(!message.includes('Empty'))
  const wa = whatsappHref(message)
  assert.ok(wa.startsWith('https://wa.me/2348162706078?text='))
  assert.ok(wa.includes(encodeURIComponent('Lekki & Ikoyi')))
  const mail = mailtoHref(message, 'Removals')
  assert.ok(mail.startsWith('mailto:info@ridearrivo.com?subject='))
  assert.ok(!mail.includes(' '))
})

test('phoneHasEnoughDigits matches the existing form rule (7 digits)', () => {
  assert.equal(phoneHasEnoughDigits('0801 234 5678'), true)
  assert.equal(phoneHasEnoughDigits('12345'), false)
  assert.equal(phoneHasEnoughDigits('abc'), false)
})

test('Removals, Boat and Air all use the late-booking dialog and the shared rule', () => {
  for (const file of ['MoveApp', 'BoatApp', 'AirApp']) {
    const source = read(`src/forms-public/${file}.tsx`)
    assert.match(source, /LateBookingDialog/, `${file} must render the dialog`)
    assert.match(source, /leadStatus\(/, `${file} must check notice with leadStatus`)
    assert.match(source, /lagosInstant\(/, `${file} must read times as Lagos time`)
  }
})

test('the dialog posts through the shared intake client, with no new payload keys', () => {
  const dialog = read('src/forms-public/LateBookingDialog.tsx')
  assert.match(dialog, /submitPublicIntakeForm/)
  // Unknown keys are rejected by the intake function, so the dialog must only
  // reuse the payload its parent builds and never invent a field of its own.
  assert.ok(!/late_request|is_late|late:/.test(dialog), 'dialog must not add its own payload key')
})

test('no em dash characters in the new late-booking code', () => {
  for (const path of [
    'src/forms-public/lateBooking.ts',
    'src/forms-public/LateBookingDialog.tsx',
    'src/forms-public/lateBooking.css',
  ]) {
    assert.ok(!read(path).includes(String.fromCharCode(0x2014)), `${path} contains an em dash`)
  }
})
