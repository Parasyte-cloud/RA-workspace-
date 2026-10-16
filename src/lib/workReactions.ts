// Pure helpers for task reactions and celebration ribbons.

export type RibbonKind = 'golden' | 'rocket' | 'crown' | 'star' | 'rainbow' | 'diamond' | 'fire' | 'heart'

export type ReactionRow = { id: string; work_item_id: string; user_id: string; emoji: string; created_at: string }
export type RibbonRow = {
  id: string
  work_item_id: string
  given_by: string
  kind: RibbonKind
  message: string
  created_at: string
}

export type RibbonStyle = { kind: RibbonKind; label: string; blurb: string; emoji: string }

// The golden ribbon is the big one. The others are smaller, themed shout-outs.
export const RIBBONS: RibbonStyle[] = [
  { kind: 'golden', label: 'Golden Ribbon', blurb: 'The golden buzzer. Outstanding work.', emoji: '🏆' },
  { kind: 'rocket', label: 'Rocket Ribbon', blurb: 'Shipped fast and shipped well.', emoji: '🚀' },
  { kind: 'crown', label: 'Crown Ribbon', blurb: 'Handled a hard one like a pro.', emoji: '👑' },
  { kind: 'star', label: 'Star Ribbon', blurb: 'Went above and beyond.', emoji: '⭐' },
  { kind: 'rainbow', label: 'Rainbow Ribbon', blurb: 'Brought colour to the whole team.', emoji: '🌈' },
  { kind: 'diamond', label: 'Diamond Ribbon', blurb: 'Flawless. Polished to a shine.', emoji: '💎' },
  { kind: 'fire', label: 'Fire Ribbon', blurb: 'On fire. Keep it going.', emoji: '🔥' },
  { kind: 'heart', label: 'Heart Ribbon', blurb: 'Done with care. Thank you.', emoji: '💖' },
]

export const QUICK_WORK_REACTIONS = ['👍', '🔥', '👏', '🎉', '💯', '❤️'] as const

export const MORE_WORK_REACTIONS = [
  '🙌', '🚀', '⭐', '💪', '🤝', '👀', '✅', '😮', '😂', '🙏', '💡', '🎯', '🏆', '🧠', '⚡', '🥳',
] as const

export type ReactionGroup = { emoji: string; count: number; mine: boolean; userIds: string[] }

export function groupReactions(rows: ReactionRow[], me: string | null): ReactionGroup[] {
  const order: string[] = []
  const map = new Map<string, ReactionGroup>()
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const row of sorted) {
    let group = map.get(row.emoji)
    if (!group) {
      group = { emoji: row.emoji, count: 0, mine: false, userIds: [] }
      map.set(row.emoji, group)
      order.push(row.emoji)
    }
    group.count += 1
    group.userIds.push(row.user_id)
    if (me && row.user_id === me) group.mine = true
  }
  return order.map(emoji => map.get(emoji)!)
}

export function ribbonStyle(kind: string): RibbonStyle {
  return RIBBONS.find(r => r.kind === kind) || RIBBONS[3]
}

// A ribbon that arrived live and is fresh enough to deserve a celebration.
export function isFreshRibbon(row: Pick<RibbonRow, 'created_at'>, now = Date.now(), windowMs = 30_000): boolean {
  const at = Date.parse(row.created_at)
  return Number.isFinite(at) && now - at >= -5_000 && now - at <= windowMs
}

// Optimistic toggle used before the server answers.
export function toggleReactionLocal(rows: ReactionRow[], itemId: string, me: string, emoji: string): ReactionRow[] {
  const has = rows.some(r => r.work_item_id === itemId && r.user_id === me && r.emoji === emoji)
  if (has) return rows.filter(r => !(r.work_item_id === itemId && r.user_id === me && r.emoji === emoji))
  return [...rows, {
    id: `local-${itemId}-${emoji}`, work_item_id: itemId, user_id: me, emoji, created_at: new Date().toISOString(),
  }]
}

// A short bzzt pattern for phones that support it.
export const BUZZ_PATTERN = [60, 40, 60, 40, 140]

export type UnseenRibbon = {
  id: string
  work_item_id: string
  given_by: string
  kind: RibbonKind
  message: string
  created_at: string
  task_title: string
  giver_name: string
}
