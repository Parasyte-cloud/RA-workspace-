// Forwarding a message to other chats. Pure helpers, no network.
export const MAX_FORWARD_TARGETS = 5
export const MAX_NOTE = 2000

export type ForwardTarget = {
  key: string
  kind: 'room' | 'direct' | 'person'
  id: string // conversation id for rooms and directs, person id for people
  title: string
  subtitle: string
}

type RoomIn = { id: string; title: string | null }
type DirectIn = { conversationId: string; personId: string | null; name: string; subtitle: string }
type PersonIn = { id: string; name: string; subtitle: string }

export function buildForwardTargets(rooms: RoomIn[], directs: DirectIn[], people: PersonIn[], myId: string): ForwardTarget[] {
  const withDirect = new Set(directs.map(row => row.personId).filter(Boolean) as string[])
  const out: ForwardTarget[] = []
  for (const row of directs) {
    out.push({ key: `c:${row.conversationId}`, kind: 'direct', id: row.conversationId, title: row.name, subtitle: row.subtitle })
  }
  for (const room of rooms) {
    out.push({ key: `c:${room.id}`, kind: 'room', id: room.id, title: room.title || 'Room', subtitle: 'Room' })
  }
  for (const person of people) {
    if (person.id === myId || withDirect.has(person.id)) continue
    out.push({ key: `p:${person.id}`, kind: 'person', id: person.id, title: person.name, subtitle: person.subtitle })
  }
  return out
}

export function filterTargets(list: ForwardTarget[], query: string): ForwardTarget[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(item => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q))
}

export function toggleTarget(selected: string[], key: string, max = MAX_FORWARD_TARGETS): string[] {
  if (selected.includes(key)) return selected.filter(item => item !== key)
  if (selected.length >= max) return selected
  return [...selected, key]
}

export function cleanNote(text: string): string {
  return text.trim().slice(0, MAX_NOTE)
}

export function canForward(message: { id: string; pending?: boolean; failed?: boolean; deleted_at?: string | null }): boolean {
  return !message.pending && !message.failed && !message.deleted_at && !message.id.startsWith('temp-')
}

export function forwardedLabel(fromName: string | null | undefined): string {
  const name = (fromName || '').trim()
  return name ? `Forwarded from ${name}` : 'Forwarded'
}

export type ForwardResult = { title: string; ok: boolean; error?: string }

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] || ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function forwardSummary(results: ForwardResult[]): string {
  const done = results.filter(item => item.ok).map(item => item.title)
  const failed = results.filter(item => !item.ok)
  const parts: string[] = []
  if (done.length) parts.push(`Forwarded to ${joinNames(done)}.`)
  for (const item of failed) parts.push(`Could not forward to ${item.title}${item.error ? `: ${item.error}` : '.'}`)
  return parts.join(' ')
}
