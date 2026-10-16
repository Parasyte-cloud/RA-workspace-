// Pure helpers for the recognition suite: weeks, streak flames, initials.

const LAGOS_OFFSET_MS = 60 * 60 * 1000 // Africa/Lagos is UTC+1 all year

// Monday 00:00 in Lagos, as a real instant.
export function lagosWeekStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + LAGOS_OFFSET_MS)
  const day = (shifted.getUTCDay() + 6) % 7 // Monday = 0
  const monday = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - day)
  return new Date(monday - LAGOS_OFFSET_MS)
}

export function lagosWeekRange(now: Date = new Date()): { from: string; to: string } {
  const start = lagosWeekStart(now)
  return { from: start.toISOString(), to: new Date(start.getTime() + 7 * 86_400_000).toISOString() }
}

export function weekLabel(weekStart: string): string {
  // weekStart is a plain date, Monday of the week that was judged.
  const [y, m, d] = weekStart.split('-').map(Number)
  if (!y || !m || !d) return ''
  const from = new Date(Date.UTC(y, m - 1, d))
  const to = new Date(Date.UTC(y, m - 1, d + 6))
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const fmt = (date: Date, withMonth: boolean) =>
    withMonth ? `${date.getUTCDate()} ${months[date.getUTCMonth()]}` : String(date.getUTCDate())
  const sameMonth = from.getUTCMonth() === to.getUTCMonth()
  return `${fmt(from, !sameMonth)} to ${fmt(to, true)}`
}

export type FlameTier = 'spark' | 'blaze' | 'inferno'

export function flameTier(streak: number): FlameTier | null {
  if (!Number.isFinite(streak) || streak < 3) return null
  if (streak >= 10) return 'inferno'
  if (streak >= 5) return 'blaze'
  return 'spark'
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'RA'
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('')
}

export function ribbonCountLine(total: number, golden: number): string {
  const word = total === 1 ? 'ribbon' : 'ribbons'
  return golden > 0 ? `${total} ${word}, ${golden} golden` : `${total} ${word}`
}

// Same scoring the database uses for the Hall of Fame.
export function ribbonScore(kinds: string[]): number {
  return kinds.reduce((sum, kind) => sum + (kind === 'golden' ? 5 : 3), 0)
}
