// Turns a notifications row into the small message a phone shows.
// Pure on purpose (no Deno or network calls) so it can be tested in Node.

export type NotificationRow = {
  id: string
  type: string
  title: string
  body?: string | null
  entity_type?: string | null
  entity_id?: string | null
}

export type PushMessage = {
  title: string
  body: string
  tag: string
  url: string
  urgent: boolean
  // Delivered straight away even when the phone is asleep, but not a ring.
  highPriority: boolean
  ttl: number
  type: string
  // Number to show on the app icon (unread alerts), when the server knows it.
  badge?: number
}

function clip(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Where tapping the notification should land inside the workspace. A chat or
// call opens that exact conversation; a waiting Room 7 guest opens that room.
export function targetUrl(row: NotificationRow) {
  const id = row.entity_id && UUID.test(row.entity_id) ? row.entity_id : ''
  if (row.entity_type === 'social_conversation' || row.type === 'call' || row.type === 'call_missed') {
    return id ? `/?section=chat&conversation=${id}` : '/?section=chat'
  }
  if (row.type === 'mail_message') return '/?section=mail'
  if (row.type === 'room_join_request' || row.type === 'room_minutes') {
    return id ? `/?section=room&room=${id}` : '/?section=room'
  }
  if (row.type === 'push_test') return '/?section=settings'
  return '/'
}

export function buildPushMessage(row: NotificationRow): PushMessage {
  const isCall = row.type === 'call'
  const isMissed = row.type === 'call_missed'
  // A ring and the missed call that follows share a tag, so the missed-call
  // notice replaces the ring on the phone instead of stacking under it.
  const isChat = row.type === 'chat_message' || row.type === 'chat_mention'
  const tag = isCall || isMissed
    ? `call-${row.entity_id || row.id}`
    // One notification per chat, replaced by each new message, but the phone
    // still sounds and buzzes again every time (renotify in the service worker).
    : isChat && row.entity_id ? `chat-${row.entity_id}`
    // New mail from one mailbox replaces the last notice for it; a waiting guest has its own.
    : row.type === 'mail_message' && row.entity_id ? `mail-${row.entity_id}`
    : row.type === 'push_test' ? 'push-test'
    : `n-${row.id}`
  return {
    title: clip(row.title, 120) || 'RideArrivo',
    body: clip(row.body, 200),
    tag,
    url: targetUrl(row),
    urgent: isCall,
    highPriority: isCall || isChat || row.type === 'room_join_request',
    // A ring is worthless after the phone stops ringing; everything else can wait.
    ttl: isCall ? 45 : 24 * 3600,
    type: row.type,
  }
}

// A closed app cannot loop a ringtone, so a call is sent again a few times
// while it is still ringing. Each repeat carries the same tag and replaces the
// last one, so the phone buzzes and sounds again without stacking notices.
export const RING_REPEATS = 5
export const RING_GAP_MS = 8000

// Push services answer 404 or 410 for a subscription that no longer exists.
export function isGone(status: number) {
  return status === 404 || status === 410
}

// ---- What the person wants pushed -------------------------------------------

export type PushCategory = 'chat' | 'calls' | 'mail' | 'room' | 'test' | 'other'

export type PushPrefs = {
  push_chat: boolean
  push_calls: boolean
  push_mail: boolean
  push_room: boolean
  push_other: boolean
  show_previews: boolean
  quiet_enabled: boolean
  quiet_start: string // "HH:MM" or "HH:MM:SS"
  quiet_end: string
  quiet_allow_calls: boolean
  timezone: string
}

export const DEFAULT_PREFS: PushPrefs = {
  push_chat: true,
  push_calls: true,
  push_mail: true,
  push_room: true,
  push_other: true,
  show_previews: true,
  quiet_enabled: false,
  quiet_start: '22:00',
  quiet_end: '07:00',
  quiet_allow_calls: true,
  timezone: 'Africa/Lagos',
}

export function categoryOf(type: string): PushCategory {
  if (type === 'chat_message' || type === 'chat_mention') return 'chat'
  if (type === 'call' || type === 'call_missed') return 'calls'
  if (type === 'mail_message') return 'mail'
  if (type === 'room_join_request' || type === 'room_minutes') return 'room'
  if (type === 'push_test') return 'test'
  return 'other'
}

function minutesOfDay(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''))
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

// Minutes since midnight where the person is, per their saved time zone.
export function localMinutes(now: Date, timeZone: string) {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
    const h = Number(parts.find(part => part.type === 'hour')?.value)
    const m = Number(parts.find(part => part.type === 'minute')?.value)
    return h * 60 + m
  }
  try {
    return read(timeZone)
  } catch {
    return read(DEFAULT_PREFS.timezone)
  }
}

// True between start and end, including windows that cross midnight (22:00 to 07:00).
export function inQuietHours(now: Date, prefs: Pick<PushPrefs, 'quiet_enabled' | 'quiet_start' | 'quiet_end' | 'timezone'>) {
  if (!prefs.quiet_enabled) return false
  const start = minutesOfDay(prefs.quiet_start)
  const end = minutesOfDay(prefs.quiet_end)
  if (start === null || end === null || start === end) return false
  const at = localMinutes(now, prefs.timezone)
  return start < end ? at >= start && at < end : at >= start || at < end
}

export type PushDecision = { send: true } | { send: false; reason: 'preference' | 'quiet_hours' }

// Should this notification be pushed to the person's devices right now?
// Skipped alerts are not lost: they stay in the bell inside the workspace.
export function decidePush(row: Pick<NotificationRow, 'type'>, prefs: PushPrefs, now: Date = new Date()): PushDecision {
  const category = categoryOf(row.type)
  if (category === 'test') return { send: true }
  const wanted =
    category === 'chat' ? prefs.push_chat
    : category === 'calls' ? prefs.push_calls
    : category === 'mail' ? prefs.push_mail
    : category === 'room' ? prefs.push_room
    : prefs.push_other
  if (!wanted) return { send: false, reason: 'preference' }
  if (inQuietHours(now, prefs) && !(category === 'calls' && prefs.quiet_allow_calls)) {
    return { send: false, reason: 'quiet_hours' }
  }
  return { send: true }
}

// With previews off a locked screen shows what happened, not who or what.
// A call keeps the caller's name: nobody can answer a ring they cannot identify.
export function applyPreviewSetting(message: PushMessage, prefs: Pick<PushPrefs, 'show_previews'>): PushMessage {
  if (prefs.show_previews) return message
  const category = categoryOf(message.type)
  if (category === 'calls' || category === 'test') return message
  const body =
    category === 'chat' ? 'You have a new message'
    : category === 'mail' ? 'You have new email'
    : category === 'room' ? 'There is an update in ROOM 7'
    : 'You have a new notification'
  return { ...message, title: 'RideArrivo', body }
}
