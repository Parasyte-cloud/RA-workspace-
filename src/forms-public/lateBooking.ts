/*
 * Late-booking rules for the public Forms apps (Removals, Boat, Air).
 *
 * A standard online booking needs MIN_HOURS of notice. Anything sooner used to
 * be accepted silently, so Support found out about a "tomorrow morning" job
 * after the fact. These helpers decide whether a requested time is too close,
 * and own the Lagos-time maths the dialog depends on.
 *
 * Why Lagos time: a date and time typed into these forms is a wall-clock time
 * in Lagos (WAT, UTC+1, no daylight saving) whatever timezone the visitor's
 * device is in. new Date('2026-10-10T07:30:00') would read it in the device
 * zone instead and shift the real instant for anyone abroad.
 *
 * This file is pure on purpose: no React, no DOM, no imports. That keeps it
 * testable straight from node (scripts/late-booking.test.mjs).
 */

// Keep equal to ON_THE_GO_ONLY_HOURS in arrivo-backend/services/bookingWindow.js
// and MIN_HOURS in the website's late-request.js. If Ops changes the rule, all
// three move together, otherwise one surface accepts what another refuses.
export const MIN_HOURS = 12

export const LATE_SUPPORT = {
  phone: '+2348162706078',
  whatsapp: '2348162706078',
  email: 'info@ridearrivo.com',
} as const

const HOUR_MS = 60 * 60 * 1000
const FIVE_MIN_MS = 5 * 60 * 1000
const LAGOS_OFFSET_MS = HOUR_MS

function pad(value: number) {
  return value < 10 ? `0${value}` : String(value)
}

// Lagos calendar date and clock time at a given instant.
export function lagosParts(at: Date = new Date()) {
  const shifted = new Date(at.getTime() + LAGOS_OFFSET_MS)
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  }
}

export function lagosToday(at: Date = new Date()) {
  return lagosParts(at).date
}

// "YYYY-MM-DD" + "HH:MM" typed in Lagos time becomes the real instant.
// Returns null for anything that is not a real calendar moment. The round trip
// at the end catches dates JavaScript would quietly roll forward, such as
// 2026-02-31 becoming 3 March.
export function lagosInstant(dateText: string, timeText: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) return null
  const instant = new Date(`${dateText}T${timeText}:00+01:00`)
  if (Number.isNaN(instant.getTime())) return null
  const back = lagosParts(instant)
  return back.date === dateText && back.time === timeText ? instant : null
}

// Earliest instant a standard booking is allowed, rounded up to the next five
// minutes so the "use the earliest time" button never lands a hair under the
// limit by the time the rider taps it.
export function earliestAllowed(now: Date = new Date()): Date {
  const ms = now.getTime() + MIN_HOURS * HOUR_MS
  return new Date(Math.ceil(ms / FIVE_MIN_MS) * FIVE_MIN_MS)
}

export type LeadStatus = 'ok' | 'late' | 'past'

// ok    MIN_HOURS or more away, book as normal. Exactly MIN_HOURS is fine, which
//       matches the backend rule that only blocks when hours < 12.
// late  in the future but sooner than MIN_HOURS, so it goes to Support.
// past  already gone. That is a mistake in the form, not a late request.
export function leadStatus(when: Date, now: Date = new Date()): LeadStatus {
  const ms = when.getTime() - now.getTime()
  if (ms < 0) return 'past'
  if (ms < MIN_HOURS * HOUR_MS) return 'late'
  return 'ok'
}

// 'Morning (8am to 12pm)' starts at 08:00, 'Evening (4pm to 8pm)' at 16:00.
// Removals is booked by date and window, not by clock time, so the window's
// start is the moment we measure the notice against.
export function windowStartTime(label: string): string | null {
  const match = /\(\s*(\d{1,2})\s*(am|pm)\s+to\s/i.exec(label)
  if (!match) return null
  const base = Number(match[1]) % 12
  if (Number(match[1]) < 1 || Number(match[1]) > 12) return null
  const hour = base + (match[2].toLowerCase() === 'pm' ? 12 : 0)
  return `${pad(hour)}:00`
}

// Add whole days to a "YYYY-MM-DD" date. Done in UTC so it can never be thrown
// off by the device's own clock or a daylight-saving change.
export function addDays(dateText: string, days: number): string {
  const [year, month, day] = dateText.split('-').map(Number)
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`
}

// First date and window that has MIN_HOURS of notice, for the one-tap
// "use the earliest window" button on Removals. Looks three days ahead, which
// is always enough because the three windows start 8am, 12pm and 4pm.
export function earliestWindow(
  windows: string[],
  now: Date = new Date(),
): { date: string; window: string } | null {
  const today = lagosToday(now)
  for (let offset = 0; offset < 3; offset += 1) {
    const date = addDays(today, offset)
    for (const window of windows) {
      const time = windowStartTime(window)
      if (!time) continue
      const instant = lagosInstant(date, time)
      if (instant && leadStatus(instant, now) === 'ok') return { date, window }
    }
  }
  return null
}

// How the typed time is to be read. Removals and Boat are always in Lagos. A
// jet's departure time is normally the departure airport's own local time, so
// Air only calls it Lagos time when the airport is in Nigeria. Either way the
// notice check itself reads the typed time as Lagos wall-clock time, which for
// a far-off airport is off by a few hours at most. That is acceptable for a
// 12 hour guard, and the "local" label keeps Support from misreading the time.
export type TimeZoneReading = 'lagos' | 'local'

export function formatLagos(date: Date, withZoneLabel: boolean = true): string {
  let text: string
  try {
    text = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    const parts = lagosParts(date)
    text = `${parts.date} ${parts.time}`
  }
  return withZoneLabel ? `${text} (Lagos time)` : text
}

export function hoursAwayLabel(when: Date, now: Date = new Date()): string {
  const hours = Math.max(0, (when.getTime() - now.getTime()) / HOUR_MS)
  if (hours < 1) return 'less than an hour'
  const rounded = Math.round(hours)
  return `about ${rounded} ${rounded === 1 ? 'hour' : 'hours'}`
}

// "2026-10-10" as "Sat 10 Oct" for people to read. Returns the input unchanged
// if it is not a real date, so a half-typed value never shows as "Invalid Date".
export function formatDay(dateText: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return dateText
  const day = new Date(`${dateText}T12:00:00Z`)
  // The round trip rejects dates JavaScript would quietly roll forward, such as
  // 2026-02-31 becoming 3 March.
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== dateText) return dateText
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(day)
  } catch {
    return dateText
  }
}

// "is about 5 hours away" or "has already started", for the sentence in the
// dialog that tells the rider how close their chosen time is.
export function describeLead(when: Date, now: Date = new Date()): string {
  if (when.getTime() < now.getTime()) return 'has already started'
  return `is ${hoursAwayLabel(when, now)} away`
}

// The late flag travels inside the form's own free-text notes field. The intake
// function rejects unknown payload keys, so a new field would need a schema
// migration; notes needs none and Support already reads it. The rider's own
// notes are trimmed, never the flag, so the flag always survives the form's
// maxLength (1000 for Removals, 2000 for Boat and Air).
export function lateRequestNote(
  notes: string,
  when: Date,
  maxLength: number,
  zone: TimeZoneReading = 'lagos',
): string {
  const requested =
    zone === 'lagos' ? formatLagos(when) : `${formatLagos(when, false)} (as typed, departure airport time)`
  const flag = `LATE REQUEST, under ${MIN_HOURS}h notice. Requested time: ${requested}.`
  const own = notes.trim()
  if (!own) return flag.slice(0, maxLength)
  const room = maxLength - flag.length - 1
  if (room <= 0) return flag.slice(0, maxLength)
  return `${flag} ${own.slice(0, room)}`
}

export type SummaryRow = { label: string; value: string }

export function supportMessage(summary: SummaryRow[], serviceName: string): string {
  const lines = summary.filter(row => row.value).map(row => `${row.label}: ${row.value}`)
  return `Hello RideArrivo, I need a ${serviceName} booking sooner than ${MIN_HOURS} hours from now.\n${lines.join('\n')}`
}

export function whatsappHref(message: string) {
  return `https://wa.me/${LATE_SUPPORT.whatsapp}?text=${encodeURIComponent(message)}`
}

export function mailtoHref(message: string, serviceName: string) {
  return (
    `mailto:${LATE_SUPPORT.email}` +
    `?subject=${encodeURIComponent(`${serviceName} booking sooner than ${MIN_HOURS} hours`)}` +
    `&body=${encodeURIComponent(message)}`
  )
}

export function phoneHasEnoughDigits(value: string) {
  return (value.match(/\d/g) || []).length >= 7
}
