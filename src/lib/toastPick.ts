/*
 * Which notification deserves an in-app banner right now.
 *
 * A chat conversation has ONE notification row. The first message inserts it;
 * every later message updates that same row (new created_at, new text, "3 new
 * messages") instead of adding another. A banner that only looked for ids it
 * had never seen therefore fired once per conversation and stayed silent for
 * every message after that. So the memory here is id -> created_at: a row whose
 * created_at moved on is new again.
 */
export type ToastCandidate = {
  id: string
  created_at: string
  read_at: string | null
}

export type ToastMemory = Map<string, string>

// Remembers everything on screen without raising a banner (first load is history).
export function rememberAll(items: readonly ToastCandidate[], known: ToastMemory): void {
  for (const item of items) known.set(item.id, item.created_at)
}

// Returns the newest unread item that is new or was bumped since last time, and
// remembers every item shown. `items` is newest first, as the list is loaded.
export function pickFreshToast<T extends ToastCandidate>(items: readonly T[], known: ToastMemory): T | null {
  let fresh: T | null = null
  for (const item of items) {
    const changed = known.get(item.id) !== item.created_at
    if (changed && !item.read_at && !fresh) fresh = item
  }
  rememberAll(items, known)
  return fresh
}
