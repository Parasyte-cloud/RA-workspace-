// Mute choices and how a mute is described. Pure.
export type MuteChoice = '1h' | '8h' | '1d' | '1w' | 'forever'

export const MUTE_CHOICES: Array<{ id: MuteChoice; label: string }> = [
  { id: '1h', label: 'For 1 hour' },
  { id: '8h', label: 'For 8 hours' },
  { id: '1d', label: 'For 1 day' },
  { id: '1w', label: 'For 1 week' },
  { id: 'forever', label: 'Until I turn it back on' },
]

// Postgres sends 'infinity' for forever.
export function isMuted(until: string | null | undefined, now = Date.now()): boolean {
  if (!until) return false
  if (until === 'infinity') return true
  const at = Date.parse(until)
  return Number.isFinite(at) && at > now
}

export function muteLabel(until: string | null | undefined, now = Date.now()): string {
  if (!isMuted(until, now)) return ''
  if (until === 'infinity') return 'Muted'
  const mins = Math.max(1, Math.round((Date.parse(until as string) - now) / 60000))
  if (mins < 60) return `Muted for ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `Muted for ${hours} h`
  return `Muted for ${Math.round(hours / 24)} days`
}
