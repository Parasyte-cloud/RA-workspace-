/*
 * Messages typed while the connection is down wait here and are sent when it
 * returns. The server remembers each client_message_id, so a retry after a
 * reply that got lost on the way never posts the message twice.
 *
 * Kept on this device, one list per signed-in person. Text messages only:
 * files and voice notes still show a Retry button.
 */

export type OutboxItem = {
  tempId: string
  conversationId: string
  body: string
  replyToId: string | null
  clientMessageId: string
  mentionedUserIds: string[]
  queuedAt: number
}

export const OUTBOX_MAX = 50
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const outboxKey = (userId: string) => `ra-chat-outbox:${userId}`

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function store(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function clean(raw: unknown, now: number): OutboxItem[] {
  if (!Array.isArray(raw)) return []
  const out: OutboxItem[] = []
  for (const row of raw) {
    const o = row as Partial<OutboxItem> | null
    if (!o || typeof o.conversationId !== 'string' || typeof o.clientMessageId !== 'string' || typeof o.body !== 'string') continue
    const queuedAt = typeof o.queuedAt === 'number' ? o.queuedAt : now
    if (now - queuedAt > OUTBOX_MAX_AGE_MS) continue
    out.push({
      tempId: typeof o.tempId === 'string' ? o.tempId : `temp-${o.clientMessageId}`,
      conversationId: o.conversationId,
      body: o.body,
      replyToId: typeof o.replyToId === 'string' ? o.replyToId : null,
      clientMessageId: o.clientMessageId,
      mentionedUserIds: Array.isArray(o.mentionedUserIds) ? o.mentionedUserIds.filter((v): v is string => typeof v === 'string') : [],
      queuedAt,
    })
  }
  return out.slice(-OUTBOX_MAX)
}

export function loadOutbox(userId: string, s: Store | null = store(), now = Date.now()): OutboxItem[] {
  if (!s || !userId) return []
  try {
    return clean(JSON.parse(s.getItem(outboxKey(userId)) || '[]'), now)
  } catch {
    return []
  }
}

export function saveOutbox(userId: string, items: readonly OutboxItem[], s: Store | null = store()) {
  if (!s || !userId) return
  try {
    if (items.length) s.setItem(outboxKey(userId), JSON.stringify(items.slice(-OUTBOX_MAX)))
    else s.removeItem(outboxKey(userId))
  } catch {
    /* storage can be full or blocked; the message still shows as waiting until reload */
  }
}

export function enqueue(userId: string, item: OutboxItem, s: Store | null = store()) {
  const items = loadOutbox(userId, s).filter(existing => existing.clientMessageId !== item.clientMessageId)
  saveOutbox(userId, [...items, item], s)
}

export function removeFromOutbox(userId: string, clientMessageId: string, s: Store | null = store()) {
  saveOutbox(userId, loadOutbox(userId, s).filter(item => item.clientMessageId !== clientMessageId), s)
}

// "The connection is down" as opposed to "the server said no".
export function isNetworkError(error: unknown, online = typeof navigator === 'undefined' || navigator.onLine !== false): boolean {
  if (!online) return true
  const text = String((error as { message?: unknown } | null)?.message ?? error ?? '')
  return /failed to fetch|network ?error|load failed|networkerror|timed? ?out|network request failed|fetch failed|err_internet/i.test(text)
}

export type FlushHooks<M> = {
  send: (item: OutboxItem) => Promise<M>
  onSent: (item: OutboxItem, message: M) => void
  onFailed: (item: OutboxItem, error: unknown) => void
}

let flushing = false

// Sends the waiting messages in the order they were typed. A network failure
// stops the run (try again later); any other error drops that one message and
// carries on, so one bad message cannot block the rest.
export async function flushOutbox<M>(userId: string, hooks: FlushHooks<M>, s: Store | null = store()): Promise<number> {
  if (flushing) return 0
  flushing = true
  let sent = 0
  try {
    for (const item of loadOutbox(userId, s)) {
      try {
        const message = await hooks.send(item)
        removeFromOutbox(userId, item.clientMessageId, s)
        hooks.onSent(item, message)
        sent += 1
      } catch (error) {
        if (isNetworkError(error)) break
        removeFromOutbox(userId, item.clientMessageId, s)
        hooks.onFailed(item, error)
      }
    }
  } finally {
    flushing = false
  }
  return sent
}
