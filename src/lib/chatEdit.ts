// Small, pure rules for the chat extras, so they can be tested without a browser.

export const EDIT_WINDOW_MS = 24 * 3600 * 1000
export const TYPING_SHOW_MS = 4000
export const TYPING_SEND_EVERY_MS = 2500
export const OLDER_PAGE = 100

type Editable = {
  sender_id: string
  created_at: string
  body: string
  deleted_at?: string | null
  pending?: boolean
  failed?: boolean
  attachment_mime?: string | null
}

export function isDeleted(message: { deleted_at?: string | null }) {
  return Boolean(message.deleted_at)
}

// Own text (or a photo or file with a caption), still fresh, not sending.
// Voice notes have no text to edit.
export function canEdit(message: Editable, userId: string, now = Date.now()) {
  if (message.pending || message.failed || isDeleted(message)) return false
  if (message.sender_id !== userId) return false
  if ((message.attachment_mime || '').startsWith('audio/')) return false
  return now - new Date(message.created_at).getTime() <= EDIT_WINDOW_MS
}

export function canDelete(message: Editable, userId: string) {
  return !message.pending && !message.failed && !isDeleted(message) && message.sender_id === userId
}

// Fixed windows: send at most once per interval while the person keeps typing.
export function shouldSendTyping(lastSentAt: number, now: number) {
  return now - lastSentAt >= TYPING_SEND_EVERY_MS
}

export function typingLine(name: string | null | undefined) {
  return `${(name || 'Someone').trim() || 'Someone'} is typing...`
}

// Older pages go in front; anything already shown wins (it may be newer, edited or deleted).
export function mergeOlder<T extends { id: string; created_at: string }>(current: T[], older: T[]) {
  const have = new Set(current.map(item => item.id))
  const fresh = older.filter(item => !have.has(item.id))
  return [...fresh, ...current].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

// After a refresh of the latest page, keep the older messages already loaded.
export function keepOlderThan<T extends { created_at: string; pending?: boolean; failed?: boolean }>(
  current: T[],
  oldestFreshAt: string | undefined,
) {
  if (!oldestFreshAt) return []
  const cutoff = new Date(oldestFreshAt).getTime()
  return current.filter(m => !m.pending && !m.failed && new Date(m.created_at).getTime() < cutoff)
}
