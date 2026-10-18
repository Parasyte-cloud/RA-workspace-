/*
 * "Poor connection", like FaceTime. RealtimeKit scores each audio stream from 0
 * (unusable) to 10 (perfect). The label must not flicker on every wobble, so it
 * turns on below 5 and only turns off again at 7 or better.
 */
export type CallQuality = 'good' | 'poor'

export const POOR_BELOW = 5
export const GOOD_AT = 7

export function nextQuality(current: CallQuality, score: number): CallQuality {
  if (!Number.isFinite(score)) return current
  if (current === 'good') return score < POOR_BELOW ? 'poor' : 'good'
  return score >= GOOD_AT ? 'good' : 'poor'
}

// Both directions matter: the weaker of what you send and what you receive.
export function weakest(scores: Record<string, number>): number {
  const values = Object.values(scores).filter(Number.isFinite)
  return values.length ? Math.min(...values) : 10
}
