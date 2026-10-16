// Threads: a message with replies shows "N replies" and opens a side panel. Pure.
export type ThreadMessage = { id: string; reply_to_id?: string | null; created_at: string; sender_id: string; deleted_at?: string | null }

export function replyCounts<T extends ThreadMessage>(messages: T[]): Map<string, { count: number; lastAt: string }> {
  const out = new Map<string, { count: number; lastAt: string }>()
  for (const message of messages) {
    if (!message.reply_to_id || message.deleted_at) continue
    const current = out.get(message.reply_to_id)
    out.set(message.reply_to_id, {
      count: (current?.count || 0) + 1,
      lastAt: !current || message.created_at > current.lastAt ? message.created_at : current.lastAt,
    })
  }
  return out
}

// Root first, then replies oldest to newest. Fetched and loaded copies are merged by id.
export function threadView<T extends ThreadMessage>(rootId: string, loaded: T[], fetched: T[]): { root: T | null; replies: T[] } {
  const byId = new Map<string, T>()
  for (const message of fetched) byId.set(message.id, message)
  for (const message of loaded) byId.set(message.id, message)
  const all = [...byId.values()].filter(message => !message.deleted_at)
  const root = all.find(message => message.id === rootId) || null
  const replies = all
    .filter(message => message.reply_to_id === rootId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  return { root, replies }
}

export function repliesLabel(count: number): string {
  return count === 1 ? '1 reply' : `${count} replies`
}
