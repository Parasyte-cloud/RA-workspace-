// Pure calendar maths: no React, no network. Kept separate so it can be tested.

export type Recurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'

export type EventLike = {
  id: string
  title: string
  starts_at: string
  ends_at: string | null
  all_day: boolean
  recurrence: Recurrence
  recurrence_until: string | null
}

export type Occurrence = {
  eventId: string
  start: Date
  end: Date
}

const pad = (n: number) => String(n).padStart(2, '0')

export const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// Weeks start on Monday.
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7))

export const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()

function shifted(base: Date, rule: Recurrence, step: number): Date {
  const h = base.getHours()
  const mi = base.getMinutes()
  if (rule === 'daily') return new Date(base.getFullYear(), base.getMonth(), base.getDate() + step, h, mi)
  if (rule === 'weekly') return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 7 * step, h, mi)
  if (rule === 'biweekly') return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 14 * step, h, mi)
  if (rule === 'monthly') {
    const total = base.getMonth() + step
    const year = base.getFullYear() + Math.floor(total / 12)
    const month = ((total % 12) + 12) % 12
    return new Date(year, month, Math.min(base.getDate(), daysInMonth(year, month)), h, mi)
  }
  if (rule === 'yearly') {
    const year = base.getFullYear() + step
    return new Date(year, base.getMonth(), Math.min(base.getDate(), daysInMonth(year, base.getMonth())), h, mi)
  }
  return base
}

const DAY_MS = 86_400_000

// The step to begin from: a little before the window, never before 0.
function firstStep(start0: Date, rule: Recurrence, from: Date, length: number): number {
  const gap = from.getTime() - start0.getTime()
  if (gap <= 0) return 0
  let guess = 0
  if (rule === 'daily') guess = gap / DAY_MS - Math.ceil(length / DAY_MS)
  else if (rule === 'weekly') guess = gap / (7 * DAY_MS) - Math.ceil(length / (7 * DAY_MS))
  else if (rule === 'biweekly') guess = gap / (14 * DAY_MS) - Math.ceil(length / (14 * DAY_MS))
  else if (rule === 'monthly') guess = (from.getFullYear() - start0.getFullYear()) * 12 + from.getMonth() - start0.getMonth() - Math.ceil(length / (28 * DAY_MS))
  else if (rule === 'yearly') guess = from.getFullYear() - start0.getFullYear() - Math.ceil(length / (365 * DAY_MS))
  return Math.max(0, Math.floor(guess) - 2)
}

// Every occurrence of an event that touches [from, to). A repeating event keeps
// its length; a monthly event on the 31st lands on the last day of short months.
export function expandEvent(ev: EventLike, from: Date, to: Date): Occurrence[] {
  const start0 = new Date(ev.starts_at)
  const end0 = ev.ends_at ? new Date(ev.ends_at) : start0
  const length = Math.max(0, end0.getTime() - start0.getTime())
  const out: Occurrence[] = []
  const touches = (s: Date, e: Date) => s < to && (e > from || (e.getTime() === s.getTime() && s >= from))

  if (ev.recurrence === 'none') {
    if (touches(start0, end0)) out.push({ eventId: ev.id, start: start0, end: end0 })
    return out
  }

  const until = ev.recurrence_until ? addDays(parseKey(ev.recurrence_until), 1) : null
  // Start close to the window instead of at the first ever occurrence, so an
  // event that has repeated for years still shows (the loop is capped).
  const first = firstStep(start0, ev.recurrence, from, length)
  for (let step = first; step < first + 2000; step += 1) {
    const s = shifted(start0, ev.recurrence, step)
    if (s >= to) break
    if (until && s >= until) break
    const e = new Date(s.getTime() + length)
    if (touches(s, e)) out.push({ eventId: ev.id, start: s, end: e })
  }
  return out
}

// The last day an occurrence is on. An all-day event ending at midnight ends the
// day before; a timed event that finishes at exactly midnight does too.
export function lastDayKey(start: Date, end: Date): string {
  if (end <= start) return keyOf(start)
  const probe = new Date(end.getTime() - 1)
  return keyOf(probe < start ? start : probe)
}

export function occursOnDay(start: Date, end: Date, dayKey: string): boolean {
  return keyOf(start) <= dayKey && dayKey <= lastDayKey(start, end)
}

export type Placed<T> = { item: T; column: number; columns: number; top: number; height: number }

// Lays timed items out in a day column. Items that overlap share the width.
// top and height are minutes from midnight, clamped to the day.
export function layoutDay<T extends { start: Date; end: Date }>(items: T[], dayKey: string): Placed<T>[] {
  const day = parseKey(dayKey)
  const dayStart = day.getTime()
  const dayEnd = addDays(day, 1).getTime()
  const rows = items
    .map(item => {
      const s = Math.max(item.start.getTime(), dayStart)
      const e = Math.min(Math.max(item.end.getTime(), item.start.getTime() + 30 * 60000), dayEnd)
      return { item, s, e }
    })
    .filter(r => r.s < dayEnd && r.e > dayStart)
    .sort((a, b) => a.s - b.s || b.e - a.e)

  const placed: Placed<T>[] = []
  let group: { row: (typeof rows)[number]; column: number }[] = []
  let groupEnd = 0

  const flush = () => {
    const columns = Math.max(1, ...group.map(g => g.column + 1))
    for (const g of group) {
      placed.push({
        item: g.row.item,
        column: g.column,
        columns,
        top: (g.row.s - dayStart) / 60000,
        height: Math.max(20, (g.row.e - g.row.s) / 60000),
      })
    }
    group = []
  }

  for (const row of rows) {
    if (group.length && row.s >= groupEnd) flush()
    const taken = new Set(group.filter(g => g.row.e > row.s).map(g => g.column))
    let column = 0
    while (taken.has(column)) column += 1
    group.push({ row, column })
    groupEnd = Math.max(groupEnd, row.e)
  }
  if (group.length) flush()
  return placed
}

// ---------- ICS export ----------

// Same rule as lib/safeUrl.ts, kept here so this file has no imports.
function plainWebUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    if (url.username || url.password) return ''
    return url.href
  } catch {
    return ''
  }
}

const icsEscape = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')

const icsUtc = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`

const icsDate = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`

// Long lines are folded at 75 characters, as the format requires.
function fold(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = [line.slice(0, 75)]
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`)
  return parts.join('\r\n')
}

export type IcsEvent = {
  id: string
  title: string
  description?: string | null
  location?: string | null
  url?: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  recurrence: Recurrence
  recurrence_until: string | null
}

const RRULE: Record<Exclude<Recurrence, 'none'>, string> = {
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  biweekly: 'FREQ=WEEKLY;INTERVAL=2',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
}

export function buildIcs(events: IcsEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RideArrivo//Workspace Calendar//EN', 'CALSCALE:GREGORIAN']
  for (const ev of events) {
    const start = new Date(ev.starts_at)
    const end = ev.ends_at ? new Date(ev.ends_at) : null
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@ridearrivo-workspace`, `DTSTAMP:${icsUtc(now)}`)
    if (ev.all_day) {
      const lastDay = end && end > start ? new Date(end.getTime() - 1) : start
      lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`)
      lines.push(`DTEND;VALUE=DATE:${icsDate(addDays(startOfDay(lastDay < start ? start : lastDay), 1))}`)
    } else {
      lines.push(`DTSTART:${icsUtc(start)}`)
      lines.push(`DTEND:${icsUtc(end && end > start ? end : new Date(start.getTime() + 30 * 60000))}`)
    }
    lines.push(`SUMMARY:${icsEscape(ev.title)}`)
    if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`)
    if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`)
    // The link is text typed by whoever made the event. Keep only a plain web
    // address, so it cannot carry a line break that adds lines to the file.
    const link = plainWebUrl(ev.url)
    if (link && !/[\r\n]/.test(link)) lines.push(`URL:${link}`)
    if (ev.recurrence !== 'none') {
      // UNTIL must be the same kind of value as DTSTART: a date for all-day
      // events, a UTC time (end of that local day) for timed ones.
      let until = ''
      if (ev.recurrence_until) {
        until = ev.all_day
          ? `;UNTIL=${ev.recurrence_until.replace(/-/g, '')}`
          : `;UNTIL=${icsUtc(new Date(parseKey(ev.recurrence_until).getTime() + 86_400_000 - 1000))}`
      }
      lines.push(`RRULE:${RRULE[ev.recurrence]}${until}`)
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
  yearly: 'Every year',
}
