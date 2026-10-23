// Builds the .ics calendar file for a ROOM 7 event. Kept free of Deno APIs so
// the same code is unit tested under Node.
//
// PArAsYtE

export type IcsEventRow = {
  event_code: string
  title: string
  description?: string | null
  starts_at: string
  ends_at: string
  join_url: string
  organizer_name?: string | null
  organizer_email?: string | null
  sequence?: number | null
  status?: string | null
  reminder_minutes?: unknown
  updated_at?: string | null
}

export function escapeIcs(value: unknown) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    // A bare CR ends a line in iCalendar too. Without this a title could add
    // its own properties (ATTACH, ATTENDEE) after a carriage return.
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

export function toIcsUtc(value: string | Date) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

// URI values (URL, mailto) are not TEXT: escaping a comma or semicolon in them
// breaks the link. Only line breaks and other control characters are removed.
function cleanUri(value: unknown) {
  return String(value || '').replace(/[\u0000-\u001f\u007f\s]+/g, '')
}

// Parameter values are quoted, never backslash-escaped, and cannot hold quotes.
function quoteParam(value: unknown) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/"/g, "'")
    .trim()
  return `"${cleaned}"`
}

// RFC 5545 section 3.1: lines are at most 75 octets. Longer lines are folded
// with CRLF plus one space. Folding is by code point so a multi byte
// character (an emoji in a title) is never cut in half.
export function foldLine(line: string) {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = encoder.encode(char).length
    const limit = parts.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      parts.push(current)
      current = char
      size = bytes
    } else {
      current += char
      size += bytes
    }
  }
  parts.push(current)
  return parts.join('\r\n ')
}

function alarmMinutes(raw: unknown) {
  const source = Array.isArray(raw) ? raw : [60, 15]
  const seen = new Set<number>()
  for (const value of source) {
    const number = Number(value)
    if (!Number.isFinite(number)) continue
    // At least a minute, at most four weeks, and no more than five alarms.
    seen.add(Math.min(40320, Math.max(1, Math.round(number))))
    if (seen.size >= 5) break
  }
  return [...seen].sort((a, b) => b - a)
}

export function makeIcs(event: IcsEventRow, now: Date = new Date()) {
  const cancelled = event.status === 'cancelled'

  const alarms = alarmMinutes(event.reminder_minutes).map(minutes =>
    [
      'BEGIN:VALARM',
      `TRIGGER:-PT${minutes}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcs(event.title)} starts in ${minutes} minutes`,
      'END:VALARM',
    ].join('\r\n'),
  )

  const stamp = (() => {
    const updated = event.updated_at ? new Date(event.updated_at) : null
    return updated && !Number.isNaN(updated.getTime()) ? updated : now
  })()

  const email = cleanUri(event.organizer_email)
  const joinUrl = cleanUri(event.join_url)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RideArrivo//Room7//EN',
    'CALSCALE:GREGORIAN',
    // PUBLISH even when cancelled. METHOD:CANCEL belongs to a mailed
    // invitation and needs an ATTENDEE list, which this feed does not have, so
    // calendars would drop it. A higher SEQUENCE with STATUS:CANCELLED updates
    // and removes the event for anyone who already added it.
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcs(event.event_code)}@room7.ridearrivo.com`,
    `DTSTAMP:${toIcsUtc(stamp)}`,
    `LAST-MODIFIED:${toIcsUtc(stamp)}`,
    `DTSTART:${toIcsUtc(event.starts_at)}`,
    `DTEND:${toIcsUtc(event.ends_at)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(
      [
        event.description || '',
        '',
        `Join Room7: ${event.join_url}`,
        `Event code: ${event.event_code}`,
      ].join('\n'),
    )}`,
    `LOCATION:${escapeIcs(event.join_url)}`,
    joinUrl ? `URL:${joinUrl}` : '',
    `SEQUENCE:${Math.max(0, Math.trunc(Number(event.sequence) || 0))}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    email && /^[^@:;,<>"]+@[^@:;,<>"]+$/.test(email)
      ? `ORGANIZER;CN=${quoteParam(event.organizer_name || 'RideArrivo')}:mailto:${email}`
      : '',
    // A cancelled event has nothing left to remind anyone about.
    ...(cancelled ? [] : alarms),
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lines
    .filter(Boolean)
    .map(foldLine)
    .join('\r\n') + '\r\n'
}
