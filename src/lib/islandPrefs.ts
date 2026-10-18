/* Which sections sit in the floating island. Kept on this device. */
import { sanitizeIds } from './workspaceNav'

export const ISLAND_DEFAULT = ['overview', 'tasks', 'chat', 'mail', 'calendar', 'notes'] as const
export const ISLAND_MAX = 7
export const ISLAND_MIN = 2
export const ISLAND_KEY = 'ra-island-items'

export function cleanIsland(raw: unknown, valid: ReadonlySet<string>): string[] {
  const ids = sanitizeIds(raw, valid, ISLAND_MAX)
  if (ids.length >= ISLAND_MIN) return ids
  return ISLAND_DEFAULT.filter(id => valid.has(id))
}

export function toggleIsland(current: readonly string[], id: string, valid: ReadonlySet<string>): string[] {
  if (!valid.has(id)) return [...current]
  if (current.includes(id)) return current.length <= ISLAND_MIN ? [...current] : current.filter(v => v !== id)
  return current.length >= ISLAND_MAX ? [...current] : [...current, id]
}

export function moveIsland(current: readonly string[], id: string, by: -1 | 1): string[] {
  const i = current.indexOf(id)
  const j = i + by
  if (i < 0 || j < 0 || j >= current.length) return [...current]
  const next = [...current]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

export function readIsland(): string[] | null {
  try {
    const raw = window.localStorage.getItem(ISLAND_KEY)
    return raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}

export function saveIsland(ids: readonly string[]) {
  try {
    window.localStorage.setItem(ISLAND_KEY, JSON.stringify(ids))
  } catch {
    /* storage can be blocked; the choice lasts until reload */
  }
}

/* ---- position ------------------------------------------------------- */
// Saved as fractions of the free space, so a different window size or an
// iPad turning around still leaves the bar fully on screen.
export type IslandPos = { fx: number; fy: number }
export const POS_KEY = 'ra-island-pos'
export const DOUBLE_TAP_MS = 350

export function clampPos(left: number, top: number, w: number, h: number, vw: number, vh: number, pad = 8): IslandPos {
  const freeX = Math.max(1, vw - w - pad * 2)
  const freeY = Math.max(1, vh - h - pad * 2)
  const fx = Math.min(1, Math.max(0, (left - pad) / freeX))
  const fy = Math.min(1, Math.max(0, (top - pad) / freeY))
  return { fx, fy }
}

export function posToPixels(pos: IslandPos, w: number, h: number, vw: number, vh: number, pad = 8) {
  return {
    left: Math.round(pad + pos.fx * Math.max(0, vw - w - pad * 2)),
    top: Math.round(pad + pos.fy * Math.max(0, vh - h - pad * 2)),
  }
}

export function isDoubleTap(previous: number, now: number): boolean {
  return previous > 0 && now - previous <= DOUBLE_TAP_MS
}

export function cleanPos(raw: unknown): IslandPos | null {
  const o = raw as { fx?: unknown; fy?: unknown } | null
  if (!o || typeof o.fx !== 'number' || typeof o.fy !== 'number') return null
  if (!Number.isFinite(o.fx) || !Number.isFinite(o.fy)) return null
  return { fx: Math.min(1, Math.max(0, o.fx)), fy: Math.min(1, Math.max(0, o.fy)) }
}

export function readPos(): IslandPos | null {
  try {
    return cleanPos(JSON.parse(window.localStorage.getItem(POS_KEY) || 'null'))
  } catch {
    return null
  }
}

export function savePos(pos: IslandPos | null) {
  try {
    if (pos) window.localStorage.setItem(POS_KEY, JSON.stringify(pos))
    else window.localStorage.removeItem(POS_KEY)
  } catch {
    /* storage can be blocked; the spot lasts until reload */
  }
}
