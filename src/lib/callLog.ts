/*
 * Turns call records into what a person reads in a chat: "Missed voice call",
 * "Voice call, 4:32", "Declined", and so on, and mixes them into the message
 * timeline by time. Pure functions so every case can be tested.
 */

export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'missed' | 'cancelled' | 'ended'

export type CallRecord = {
  id: string
  conversation_id: string
  caller_id: string
  callee_id: string
  room_code: string
  kind: 'voice' | 'video'
  status: CallStatus
  created_at: string
  answered_at?: string | null
  ended_at?: string | null
}

export type CallTone = 'missed' | 'ok' | 'neutral'

export type CallLabel = {
  title: string
  detail: string
  tone: CallTone
  // Someone should ring back: they missed it, or it was declined.
  canCallBack: boolean
}

export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

export function callDurationMs(call: CallRecord): number | null {
  if (!call.answered_at || !call.ended_at) return null
  const start = Date.parse(call.answered_at)
  const end = Date.parse(call.ended_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return end - start
}

export function describeCall(call: CallRecord, me: string): CallLabel {
  const mine = call.caller_id === me
  const noun = call.kind === 'video' ? 'video call' : 'voice call'
  const cap = noun.charAt(0).toUpperCase() + noun.slice(1)

  switch (call.status) {
    case 'ringing':
      return {
        title: mine ? `Calling (${noun})` : `Incoming ${noun}`,
        detail: 'Ringing',
        tone: 'neutral',
        canCallBack: false,
      }
    case 'accepted': {
      return { title: cap, detail: 'In progress', tone: 'ok', canCallBack: false }
    }
    case 'ended': {
      const ms = callDurationMs(call)
      return {
        title: cap,
        detail: ms === null ? 'Ended' : formatCallDuration(ms),
        tone: 'ok',
        canCallBack: true,
      }
    }
    case 'declined':
      return mine
        ? { title: `${cap}`, detail: 'Declined', tone: 'missed', canCallBack: true }
        : { title: `${cap}`, detail: 'You declined', tone: 'neutral', canCallBack: true }
    case 'cancelled':
      return mine
        ? { title: `${cap}`, detail: 'Cancelled', tone: 'neutral', canCallBack: true }
        : { title: `Missed ${noun}`, detail: 'Caller hung up before you answered', tone: 'missed', canCallBack: true }
    case 'missed':
    default:
      return mine
        ? { title: cap, detail: 'No answer', tone: 'missed', canCallBack: true }
        : { title: `Missed ${noun}`, detail: 'You did not answer', tone: 'missed', canCallBack: true }
  }
}

// Calls the person missed: not answered or hung up on, and they were the callee.
export function isMissedForMe(call: CallRecord, me: string): boolean {
  return call.callee_id === me && (call.status === 'missed' || call.status === 'cancelled')
}

// Missed calls in one chat that happened after the person last looked.
export function unseenMissed(
  calls: readonly CallRecord[],
  me: string,
  conversationId: string,
  seenAt: string | null | undefined,
): number {
  const seen = seenAt ? Date.parse(seenAt) : 0
  return calls.filter(
    call =>
      call.conversation_id === conversationId &&
      isMissedForMe(call, me) &&
      Date.parse(call.created_at) > seen,
  ).length
}

export type TimelineItem<M extends { created_at: string; id: string }> =
  | { type: 'message'; message: M; at: number }
  | { type: 'call'; call: CallRecord; at: number }

// Messages and calls of one chat, oldest first. Ringing calls are left out:
// the ringer shows those, and the line appears once the call settles.
export function mergeTimeline<M extends { created_at: string; id: string }>(
  messages: readonly M[],
  calls: readonly CallRecord[],
  conversationId: string,
): TimelineItem<M>[] {
  const items: TimelineItem<M>[] = []
  for (const message of messages) {
    items.push({ type: 'message', message, at: Date.parse(message.created_at) })
  }
  for (const call of calls) {
    if (call.conversation_id !== conversationId || call.status === 'ringing') continue
    items.push({ type: 'call', call, at: Date.parse(call.created_at) })
  }
  return items.sort((a, b) => a.at - b.at)
}

// One short line for the chat list.
export function callPreview(call: CallRecord, me: string): string {
  const label = describeCall(call, me)
  if (label.title.startsWith('Missed')) return label.title
  if (['Ended', 'Ringing', 'In progress'].includes(label.detail)) return label.title
  return `${label.title}, ${label.detail}`
}

// Replaces or adds one record, newest first, capped. Used for realtime updates.
export function upsertCall(
  list: readonly CallRecord[],
  row: CallRecord,
  cap = 300,
): CallRecord[] {
  const rest = list.filter(item => item.id !== row.id)
  rest.push(row)
  return rest.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, cap)
}
