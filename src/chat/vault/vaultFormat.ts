// Pure helpers for confidential messages. No React, no network.
// The alphabet and key length must match supabase/functions/_shared/vaultCore.ts
// (a test compares them).

export const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const KEY_LENGTH = 12

// 15 seconds up to 1 hour. An administrator sets the ceiling.
export const VIEW_CHOICES = [15, 30, 60, 300, 900, 1800, 3600] as const

export type VaultStatus = 'pending' | 'sealed' | 'spent' | 'locked' | 'destroyed'

export type VaultItem = {
  id: string
  message_id: string | null
  conversation_id: string
  sender_id: string
  kind: 'text' | 'file'
  mime: string | null
  status: VaultStatus
  view_seconds: number
  opened_by: string | null
  opened_at: string | null
  failed_attempts: number
  unblock_count: number
}

export function viewLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`
  if (seconds === 60) return '1 minute'
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`
  return seconds === 3600 ? '1 hour' : `${Math.round(seconds / 3600)} hours`
}

export function choicesUpTo(ceiling: number): number[] {
  return VIEW_CHOICES.filter(seconds => seconds <= ceiling)
}

// What a person typed or pasted, made comparable: case, spaces and dashes ignored.
export function normalizeKeyInput(raw: string): string {
  let out = ''
  for (const ch of (raw || '').toUpperCase()) {
    if (KEY_ALPHABET.includes(ch) && out.length < KEY_LENGTH) out += ch
  }
  return out
}

// ABCD-EFGH-JKMN, as it is read out loud.
export function formatKey(key: string): string {
  return key.match(/.{1,4}/g)?.join('-') || key
}

export function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// Written across the content while it is open, so a photo or a screenshot of it
// names whose screen it came from.
export function watermarkLabel(name: string, at: Date): string {
  const time = at.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
  return `${name || 'Viewer'} ${time}`
}

export type CardState =
  | 'loading'
  | 'pending'
  | 'sealed'
  | 'window'
  | 'viewed'
  | 'blocked'
  | 'mine-sealed'
  | 'mine-viewed'
  | 'mine-blocked'
  | 'deleted'

// Which face the card shows to this person right now.
export function cardState(item: VaultItem | undefined, me: string, now: number = Date.now()): CardState {
  if (!item) return 'loading'
  if (item.status === 'destroyed') return 'deleted'
  if (item.status === 'pending') return 'pending'
  if (item.sender_id === me) {
    if (item.status === 'sealed') return 'mine-sealed'
    if (item.status === 'spent') return 'mine-viewed'
    return 'mine-blocked'
  }
  if (item.status === 'sealed') return 'sealed'
  if (item.status === 'locked') return 'blocked'
  // spent
  if (item.opened_by === me && item.opened_at && Date.parse(item.opened_at) + item.view_seconds * 1000 > now) {
    return 'window'
  }
  return 'viewed'
}

export const VIEWED_NOTE = 'Need to view again? Contact an administrator.'
