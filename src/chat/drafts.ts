// Unsent message drafts, kept per person and per chat in this browser.
export const DRAFT_PREFIX = 'ridearrivo:chat:draft:'
export const DRAFT_MAX = 10000

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

function defaultStore(): Store | null {
  try { return window.localStorage } catch { return null }
}

export function draftKey(userId: string, conversationId: string): string {
  return `${DRAFT_PREFIX}${userId}:${conversationId}`
}

export function loadDraft(userId: string, conversationId: string, store: Store | null = defaultStore()): string {
  if (!store || !userId || !conversationId) return ''
  try { return store.getItem(draftKey(userId, conversationId)) || '' } catch { return '' }
}

// An empty or whitespace-only draft is removed, so the list never shows "Draft:" for nothing.
export function saveDraft(userId: string, conversationId: string, text: string, store: Store | null = defaultStore()): void {
  if (!store || !userId || !conversationId) return
  try {
    const key = draftKey(userId, conversationId)
    if (!text.trim()) store.removeItem(key)
    else store.setItem(key, text.slice(0, DRAFT_MAX))
  } catch { /* storage is optional */ }
}

export function listDrafts(userId: string, store: Store | null = defaultStore()): Record<string, string> {
  const out: Record<string, string> = {}
  if (!store || !userId) return out
  const prefix = `${DRAFT_PREFIX}${userId}:`
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (key && key.startsWith(prefix)) {
        const text = store.getItem(key) || ''
        if (text.trim()) out[key.slice(prefix.length)] = text
      }
    }
  } catch { /* ignore */ }
  return out
}

export function draftPreview(text: string, max = 48): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat
}
