// Pure helpers for the chat upgrade: reactions, status, emoji data, search.
// No network and no React in here, so all of it is unit tested.

export type ReactionRow = { message_id: string; user_id: string; emoji: string; created_at?: string }
export type ReactionGroup = { emoji: string; count: number; mine: boolean; userIds: string[] }

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

// Mirrors public.chat_valid_emoji in the database: 1 to 8 characters, no
// letters, digits, spaces or markup.
export function isValidEmoji(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const chars = Array.from(value)
  if (chars.length < 1 || chars.length > 8) return false
  return !/[A-Za-z0-9\s<>&"'\\/]/.test(value)
}

export function groupReactions(rows: ReactionRow[], me: string | null): ReactionGroup[] {
  const order: string[] = []
  const groups = new Map<string, ReactionGroup>()
  for (const row of rows) {
    let group = groups.get(row.emoji)
    if (!group) {
      group = { emoji: row.emoji, count: 0, mine: false, userIds: [] }
      groups.set(row.emoji, group)
      order.push(row.emoji)
    }
    if (group.userIds.includes(row.user_id)) continue
    group.count += 1
    group.userIds.push(row.user_id)
    if (me && row.user_id === me) group.mine = true
  }
  return order.map(e => groups.get(e)!).sort((a, b) => b.count - a.count || order.indexOf(a.emoji) - order.indexOf(b.emoji))
}

export function reactionTitle(group: ReactionGroup, nameOf: (id: string) => string, me: string | null): string {
  const names = group.userIds.map(id => (id === me ? 'You' : nameOf(id)))
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

// Applies one change from the realtime feed to a message's reaction list.
export function applyReactionChange(
  rows: ReactionRow[],
  change: { type: 'add' | 'remove'; row: ReactionRow },
): ReactionRow[] {
  const same = (r: ReactionRow) =>
    r.message_id === change.row.message_id && r.user_id === change.row.user_id && r.emoji === change.row.emoji
  if (change.type === 'remove') return rows.filter(r => !same(r))
  return rows.some(same) ? rows : [...rows, change.row]
}

export type ChatStatus = { emoji: string | null; text: string | null; until: string | null }

export function statusActive(status: ChatStatus | null | undefined, now = Date.now()): boolean {
  if (!status || (!status.emoji && !status.text)) return false
  if (!status.until) return true
  const t = new Date(status.until).getTime()
  return Number.isFinite(t) && t > now
}

export const STATUS_PRESETS: ReadonlyArray<{ emoji: string; text: string }> = [
  { emoji: '📅', text: 'In a meeting' },
  { emoji: '🍽️', text: 'Out for lunch' },
  { emoji: '🏠', text: 'Working from home' },
  { emoji: '🌴', text: 'On leave' },
  { emoji: '🎧', text: 'Focusing, please do not disturb' },
  { emoji: '🚗', text: 'On the road' },
]

export const STATUS_DURATIONS: ReadonlyArray<{ label: string; hours: number | null }> = [
  { label: '1 hour', hours: 1 },
  { label: '4 hours', hours: 4 },
  { label: 'Today', hours: -1 },
  { label: 'This week', hours: -7 },
  { label: 'Keep until I change it', hours: null },
]

// hours > 0: that many hours. -1: end of today. -7: end of this week (Sunday).
export function statusUntil(hours: number | null, now = new Date()): string | null {
  if (hours === null) return null
  if (hours > 0) return new Date(now.getTime() + hours * 3600_000).toISOString()
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  if (hours === -7) end.setDate(end.getDate() + ((7 - end.getDay()) % 7))
  return end.toISOString()
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, m => '\\' + m)
}

export function cleanSearchQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = cleanSearchQuery(query).toLowerCase()
  if (!q) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const parts: Array<{ text: string; hit: boolean }> = []
  let at = 0
  for (;;) {
    const i = lower.indexOf(q, at)
    if (i < 0) break
    if (i > at) parts.push({ text: text.slice(at, i), hit: false })
    parts.push({ text: text.slice(i, i + q.length), hit: true })
    at = i + q.length
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false })
  return parts.length ? parts : [{ text, hit: false }]
}

export const AVATAR_PIXELS = 256
export const AVATAR_MAX_INPUT_BYTES = 10 * 1024 * 1024

export function avatarExtension(mime: string): 'webp' | 'png' | 'jpg' {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  return 'webp'
}

export function avatarPathFor(userId: string, now = Date.now(), ext: 'webp' | 'png' | 'jpg' = 'webp'): string {
  return `${userId}/${now}.${ext}`
}

// Largest centred square inside a w by h image.
export function centreSquare(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.min(w, h)
  return { sx: Math.round((w - size) / 2), sy: Math.round((h - size) / 2), size }
}
