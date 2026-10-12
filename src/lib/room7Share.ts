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

export function invitationText(input: {
  title: string
  code: string
  passcode?: string | null
}): string {
  const lines = [
    `You are invited to join: ${input.title}`,
    '',
    `Join link: ${guestLink(input.code)}`,
    `Event code: ${input.code}`,
  ]
  if (input.passcode) lines.push(`Passcode: ${input.passcode}`)
  lines.push(
    '',
    'How to join:',
    '1. Open the link (or go to room7.ridearrivo.com and type the event code).',
    `2. Enter your name and email${input.passcode ? ', and the passcode' : ''}.`,
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
} | null

export type Invoke = (body: Record<string, unknown>) => Promise<{ event?: EventInfo } & Record<string, unknown>>

export type GuestReady = {
  link: string
  code: string
  title: string
  passcode: string | null // null when the room was already open and the old passcode is kept
  alreadyOpen: boolean
}

export async function makeGuestReady(
  invoke: Invoke,
  room: { id: string; code: string; title: string },
  options: { newPasscode?: boolean; random?: (size: number) => Uint8Array; now?: () => number } = {},
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
  if (usable && !options.newPasscode) {
    return { link: guestLink(room.code), code: room.code, title: room.title, passcode: null, alreadyOpen: true }
  }

  const passcode = generatePasscode(8, options.random)
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

  return { link: guestLink(room.code), code: room.code, title: room.title, passcode, alreadyOpen: false }
}
