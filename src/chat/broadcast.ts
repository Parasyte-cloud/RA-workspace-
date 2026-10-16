// @everyone and @here in rooms. The server expands them and enforces who may use them.
export type BroadcastKind = 'everyone' | 'here'

export type BroadcastSuggestion = { kind: BroadcastKind; token: string; title: string; hint: string }

const ALL: BroadcastSuggestion[] = [
  { kind: 'everyone', token: '@everyone', title: 'everyone', hint: 'Notify every member of this room' },
  { kind: 'here', token: '@here', title: 'here', hint: 'Notify members who are online now' },
]

export function broadcastSuggestions(query: string, inRoom: boolean): BroadcastSuggestion[] {
  if (!inRoom) return []
  const q = query.trim().toLowerCase()
  return ALL.filter(item => !q || item.title.startsWith(q))
}

// Which broadcast the finished message actually contains. Typing the words
// without picking them from the list still works, as long as they stand alone.
export function detectBroadcast(body: string, inRoom: boolean): BroadcastKind | null {
  if (!inRoom) return null
  if (/(^|\s)@everyone(?=$|[\s.,!?;:])/i.test(body)) return 'everyone'
  if (/(^|\s)@here(?=$|[\s.,!?;:])/i.test(body)) return 'here'
  return null
}

export function highlightsBroadcast(body: string): boolean {
  return /(^|\s)@(everyone|here)(?=$|[\s.,!?;:])/i.test(body)
}
