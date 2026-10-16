// Search across all chats: what the sidebar shows for each hit. Pure.
export type SearchHit = {
  message_id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
}

export const MIN_SEARCH_CHARS = 3

export function searchable(query: string): boolean {
  return query.trim().length >= MIN_SEARCH_CHARS
}

// A short piece of the message around the first match, with the match kept.
export function snippetAround(body: string, query: string, width = 80): { before: string; match: string; after: string } {
  const flat = body.replace(/\s+/g, ' ').trim()
  const q = query.trim()
  const at = q ? flat.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (at < 0) return { before: flat.slice(0, width), match: '', after: flat.length > width ? '...' : '' }
  const start = Math.max(0, at - Math.floor((width - q.length) / 3))
  const end = Math.min(flat.length, start + width)
  return {
    before: (start > 0 ? '...' : '') + flat.slice(start, at),
    match: flat.slice(at, at + q.length),
    after: flat.slice(at + q.length, end) + (end < flat.length ? '...' : ''),
  }
}
