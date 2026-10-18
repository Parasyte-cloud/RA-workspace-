// How long the caller waits after the other person has answered. If nobody has
// arrived in the call by then (their app was closed or lost signal right after
// tapping Accept), the call ends with a clear message instead of leaving the
// caller on "Calling..." for ever. Their own heartbeat would keep it alive.
export const NO_SHOW_MS = 30_000

// Milliseconds still to wait, given when the call was answered.
export function noShowDelay(acceptedAt: number, now: number = Date.now()): number {
  return Math.max(0, NO_SHOW_MS - Math.max(0, now - acceptedAt))
}
