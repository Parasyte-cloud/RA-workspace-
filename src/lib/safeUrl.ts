// Links that come from the database (a meeting link someone typed into a
// calendar event, a source link on an imported law report) are text from other
// people. A value like "javascript:..." must never become a clickable link.
// This keeps only plain web addresses, with no embedded user name or password.

export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (!raw || raw.length > 2048) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}
