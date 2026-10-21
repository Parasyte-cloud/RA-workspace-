/*
 * One click from "I created a ROOM 7" to "here is a link and a code that work".
 *
 * A guest link only works once the room has been set up as an external event:
 * passcode access on, the public page on, a passcode saved, and the event open
 * (Doors open or Live). Until now that took several screens in the Event Control
 * Center, and the app handed out the link before any of it was done, so guests
 * saw "not accepting guests". This does the whole setup through the same
 * server function the Control Center uses, so every server rule still applies.
 */

export const GUEST_ORIGIN = 'https://room7.ridearrivo.com'


export function room7InviteCalendarUrl(code: string): string {
  const normalized =
    code.trim().toUpperCase()

  return `https://fkkxcivxnwshahnbatnp.supabase.co/functions/v1/room7-calendar?code=${encodeURIComponent(normalized)}`
}

// Same alphabet as room codes: no 0, 1, I or O, so nothing is misread on a phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generatePasscode(
  length = 8,
  random: (size: number) => Uint8Array = size => crypto.getRandomValues(new Uint8Array(size)),
): string {
  // Reject bytes that would bias the choice, so every letter is equally likely.
  const limit = 256 - (256 % ALPHABET.length)
  let out = ''
  while (out.length < length) {
    for (const byte of random(length * 2)) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length]
    }
  }
  return out
}

export const guestLink = (code: string) => `${GUEST_ORIGIN}/r/${code}`

export const JOIN_STATES = ['doors_open', 'live', 'intermission'] as const

// The server only allows these moves in order, so walk them one at a time.
const PATH_TO_LIVE: Record<string, string[]> = {
  draft: ['pre_event', 'doors_open', 'live'],
  pre_event: ['doors_open', 'live'],
  doors_open: ['live'],
  live: [],
  intermission: [],
  ended: [],
  replay: [],
}

export function stepsToOpen(state: string | null | undefined): string[] {
  if (!state) return PATH_TO_LIVE.draft
  return PATH_TO_LIVE[state] ?? []
}

export const isGuestOpen = (state: string | null | undefined) =>
  !!state && (JOIN_STATES as readonly string[]).includes(state)

function invitationSchedule(input: {
  startsAt: string
  endsAt: string
  timezone?: string
}) {
  const start =
    new Date(input.startsAt)

  const end =
    new Date(input.endsAt)

  const requestedTimezone =
    input.timezone ||
    'Africa/Lagos'

  const timezone = (() => {
    try {
      new Intl.DateTimeFormat(
        'en-NG',
        {
          timeZone:
            requestedTimezone,
        },
      ).format(start)

      return requestedTimezone
    } catch {
      return 'Africa/Lagos'
    }
  })()

  const date =
    new Intl.DateTimeFormat(
      'en-NG',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: timezone,
      },
    ).format(start)

  const time =
    new Intl.DateTimeFormat(
      'en-NG',
      {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      },
    )

  return {
    date,
    time:
      `${time.format(start)} – ${time.format(end)}`,
    timezone,
  }
}

export function invitationText(input: {
  title: string
  code: string
  passcode?: string | null
  // A separate passcode exists but is not known here (set earlier).
  passcodeSeparate?: boolean
  startsAt?: string | null
  endsAt?: string | null
  timezone?: string | null
}): string {
  const schedule =
    input.startsAt &&
    input.endsAt
      ? invitationSchedule({
          startsAt:
            input.startsAt,
          endsAt:
            input.endsAt,
          timezone:
            input.timezone ||
            undefined,
        })
      : null

  const lines = [
    `You are invited to join: ${input.title}`,
  ]

  if (schedule) {
    lines.push(
      '',
      schedule.date,
      `${schedule.time} · ${schedule.timezone}`,
    )
  }

  lines.push(
    '',
    `Join link: ${guestLink(input.code)}`,
    `Event code: ${input.code}`,
  )

  if (schedule) {
    lines.push(
      `Add to calendar: ${room7InviteCalendarUrl(input.code)}`,
    )
  }

  const needsPasscode =
    !!input.passcode ||
    !!input.passcodeSeparate

  if (input.passcode) {
    lines.push(
      `Passcode: ${input.passcode}`,
    )
  }

  lines.push(
    '',
    'How to join:',
    '1. Open the link (or go to room7.ridearrivo.com and type the event code).',
    `2. Enter your name and email${needsPasscode ? ', and the passcode' : ''}.`,
    '3. Press Join.',
  )

  return lines.join('\n')
}

export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

// Server messages in words a host can act on.
export function friendlyEventError(message: string): string {
  if (/passcode protection is not configured|passcode access is not configured/i.test(message)) {
    return 'Guest passcodes need a secret that is not set yet. In Supabase open Edge Functions, then Secrets, and add ROOM7_ACCESS_PEPPER with a long random value. Then try again.'
  }
  if (/only the room 7 host, manager or administrator/i.test(message)) {
    return 'Only the person who created this ROOM 7, a Manager or an Administrator can open it to guests.'
  }
  if (/slug/i.test(message) && /in use/i.test(message)) {
    return 'That public name is already used by another event. Try again.'
  }
  return message
}

export type EventInfo = {
  public_enabled?: boolean
  access_mode?: string
  event_state?: string
  has_passcode?: boolean
  scheduled_end?: string | null
  // 'host' means the host admits each guest. Absent on servers without the setting.
  admission?: string
  auto_open?: boolean
} | null

export type Invoke = (body: Record<string, unknown>) => Promise<{ event?: EventInfo } & Record<string, unknown>>

export type GuestReady = {
  link: string
  code: string
  title: string
  // Only set when a separate passcode was just made. Null means either the
  // event code alone is the key (codeOnly) or an older passcode is kept.
  passcode: string | null
  // The event code is the only thing a guest needs: open the link, type a name.
  codeOnly: boolean
  alreadyOpen: boolean
  // Whether each guest waits for the host to admit them.
  admission: 'auto' | 'host'
}

export async function makeGuestReady(
  invoke: Invoke,
  room: { id: string; code: string; title: string },
  options: {
    // Replace whatever is set with a fresh separate passcode.
    newPasscode?: boolean
    // Replace whatever is set so the event code alone lets guests in.
    codeOnly?: boolean
    random?: (size: number) => Uint8Array
    now?: () => number
  } = {},
): Promise<GuestReady> {
  const now = options.now ?? Date.now
  const current = await invoke({ action: 'get', room_id: room.id })
  const event = current.event ?? null

  const usable =
    !!event &&
    event.public_enabled === true &&
    event.access_mode === 'passcode' &&
    event.has_passcode === true &&
    isGuestOpen(event.event_state) &&
    !(event.scheduled_end && Date.parse(event.scheduled_end) <= now())

  // Already working: never replace a passcode people may already hold.
  if (usable && !options.newPasscode && !options.codeOnly) {
    return { link: guestLink(room.code), code: room.code, title: room.title, passcode: null, codeOnly: false, alreadyOpen: true, admission: event?.admission === 'host' ? 'host' : 'auto' }
  }

  // The default is the simplest thing that is still private: the event code
  // is the key, and it only travels in the link the host chooses to share.
  // The server stores it as the passcode, hashed like any other, so every
  // existing check (join, documents, questions) keeps working unchanged.
  const separate = !!options.newPasscode
  const passcode = separate ? generatePasscode(8, options.random) : room.code
  const configure: Record<string, unknown> = {
    action: 'configure',
    room_id: room.id,
    access_mode: 'passcode',
    passcode,
    public_enabled: true,
    default_guest_role: 'attendee',
  }
  // A scheduled end in the past would shut guests out as soon as they arrive.
  if (event?.scheduled_end && Date.parse(event.scheduled_end) <= now()) configure.scheduled_end = null
  const configured = await invoke(configure)

  let state = configured.event?.event_state ?? event?.event_state ?? 'draft'
  for (const next of stepsToOpen(state)) {
    const moved = await invoke({ action: 'set_state', room_id: room.id, event_state: next })
    state = moved.event?.event_state ?? next
  }

  if (!isGuestOpen(state)) {
    throw new Error(
      state === 'ended' || state === 'replay'
        ? 'This ROOM 7 event has ended. Create a new meeting for guests.'
        : 'ROOM 7 could not be opened to guests. Open its Event settings to see why.',
    )
  }

  return {
    link: guestLink(room.code),
    code: room.code,
    title: room.title,
    passcode: separate ? passcode : null,
    codeOnly: !separate,
    alreadyOpen: false,
    admission: (configured.event?.admission ?? event?.admission) === 'host' ? 'host' : 'auto',
  }
}

// ---- Add to calendar ----------------------------------------------------

export type CalendarEvent = {
  title: string
  start: Date
  minutes: number
  details: string
  location: string
}

const pad = (n: number) => String(n).padStart(2, '0')

// 20261012T140000Z
export const calendarStamp = (date: Date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`

const endOf = (event: CalendarEvent) => new Date(event.start.getTime() + event.minutes * 60000)

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${calendarStamp(event.start)}/${calendarStamp(endOf(event))}`,
    details: event.details,
    location: event.location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function outlookCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: event.start.toISOString(),
    enddt: endOf(event).toISOString(),
    body: event.details,
    location: event.location,
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

const icsText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

// Lines over 75 bytes must be folded; continuation lines start with one space.
function fold(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74
    if (encoder.encode(current + char).length > limit) {
      parts.push(current)
      current = char
    } else current += char
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function icsFile(event: CalendarEvent, uid: string, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RideArrivo//ROOM 7//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${calendarStamp(now)}`,
    `DTSTART:${calendarStamp(event.start)}`,
    `DTEND:${calendarStamp(endOf(event))}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(event.details)}`,
    `LOCATION:${icsText(event.location)}`,
    `URL:${event.location}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    'DESCRIPTION:ROOM 7 starts in 10 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function calendarEventFor(input: {
  title: string
  code: string
  passcode?: string | null
  passcodeSeparate?: boolean
  start: Date
  minutes: number
  timezone?: string
}): CalendarEvent {
  return {
    title: input.title,
    start: input.start,
    minutes: input.minutes,
    location: guestLink(input.code),
    details: invitationText({
      title: input.title,
      code: input.code,
      passcode: input.passcode,
      passcodeSeparate: input.passcodeSeparate,
      startsAt: input.start.toISOString(),
      endsAt: new Date(
        input.start.getTime() +
          input.minutes * 60000,
      ).toISOString(),
      timezone:
        input.timezone ||
        Intl.DateTimeFormat()
          .resolvedOptions()
          .timeZone ||
        'Africa/Lagos',
    }),
  }
}

// Next quarter hour, so the picker never starts in the past.
export function nextQuarterHour(from: Date = new Date()): Date {
  const ms = 15 * 60000
  return new Date(Math.ceil((from.getTime() + 1) / ms) * ms)
}

// <input type="datetime-local"> works in local time without a zone.
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
