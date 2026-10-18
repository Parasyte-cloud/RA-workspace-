/* Quick replies offered when declining a call, like the iPhone's Message button. */
export const DECLINE_REPLIES = [
  "Can't talk right now. What's up?",
  "I'll call you back soon.",
  "I'm in a meeting. I'll call you later.",
  "I'm driving. I'll call you when I stop.",
] as const

export function isDeclineReply(value: unknown): value is (typeof DECLINE_REPLIES)[number] {
  return typeof value === 'string' && (DECLINE_REPLIES as readonly string[]).includes(value)
}
