// Pure helpers for the ROOM 7 team chat (no browser or network access).

export type RoomChatMessage = {
  id: string
  room_id: string
  sender_id: string
  body: string
  reply_to_id: string | null
  client_message_id: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  pending?: boolean
  failed?: boolean
}

export function mergeRoomMessages(current: RoomChatMessage[], incoming: RoomChatMessage[]): RoomChatMessage[] {
  const byId = new Map<string, RoomChatMessage>()
  for (const message of current) byId.set(message.id, message)
  for (const message of incoming) {
    const old = byId.get(message.id)
    byId.set(message.id, old ? { ...old, ...message, pending: false, failed: false } : message)
  }
  // A saved copy replaces the optimistic one that carries the same client id.
  const saved = new Set(
    [...byId.values()].filter(m => !m.pending && m.client_message_id).map(m => `${m.sender_id}:${m.client_message_id}`)
  )
  const merged = [...byId.values()].filter(
    m => !(m.pending && m.client_message_id && saved.has(`${m.sender_id}:${m.client_message_id}`))
  )
  return merged.sort((a, b) => {
    const diff = Date.parse(a.created_at) - Date.parse(b.created_at)
    if (Number.isFinite(diff) && diff !== 0) return diff
    return a.id.localeCompare(b.id)
  })
}

export function newClientId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

