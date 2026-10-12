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
  ttl: number
  type: string
}

function clip(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

// Where tapping the notification should land inside the workspace.
export function targetUrl(row: NotificationRow) {
  if (row.entity_type === 'social_conversation') return '/?section=chat'
  if (row.type === 'call' || row.type === 'call_missed') return '/?section=chat'
  return '/'
}

export function buildPushMessage(row: NotificationRow): PushMessage {
  const isCall = row.type === 'call'
  const isMissed = row.type === 'call_missed'
  // A ring and the missed call that follows share a tag, so the missed-call
  // notice replaces the ring on the phone instead of stacking under it.
  const tag = isCall || isMissed ? `call-${row.entity_id || row.id}` : `n-${row.id}`
  return {
    title: clip(row.title, 120) || 'RideArrivo',
    body: clip(row.body, 200),
    tag,
    url: targetUrl(row),
    urgent: isCall,
    // A ring is worthless after the phone stops ringing; everything else can wait.
    ttl: isCall ? 45 : 24 * 3600,
    type: row.type,
  }
}

// Push services answer 404 or 410 for a subscription that no longer exists.
export function isGone(status: number) {
  return status === 404 || status === 410
}
