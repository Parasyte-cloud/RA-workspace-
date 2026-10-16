// Find web addresses in message text. Pure, no network.
export type TextPart = { type: 'text'; text: string } | { type: 'link'; text: string; href: string }

const CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi
const TRAILING = new Set(['.', ',', '!', '?', ';', ':', "'", '"', ')', ']', '}'])

function count(text: string, ch: string): number {
  let n = 0
  for (const c of text) if (c === ch) n++
  return n
}

// "(see https://a.com/x)." should not swallow the bracket or the full stop,
// while "https://en.wikipedia.org/wiki/Foo_(bar)" keeps its own bracket.
function trimTail(raw: string): string {
  let text = raw
  while (text.length) {
    const last = text[text.length - 1]
    if (!TRAILING.has(last)) break
    if (last === ')' && count(text, ')') <= count(text, '(')) break
    if (last === ']' && count(text, ']') <= count(text, '[')) break
    if (last === '}' && count(text, '}') <= count(text, '{')) break
    text = text.slice(0, -1)
  }
  return text
}

export function safeHref(shown: string): string | null {
  const value = /^www\./i.test(shown) ? `https://${shown}` : shown
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null // user:pass@host is a classic disguise
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index ?? 0
    // Not in the middle of a word, e.g. "foowww.x.com".
    if (start > 0 && /[A-Za-z0-9@]/.test(text[start - 1]) && !/^https?:/i.test(match[0])) continue
    const shown = trimTail(match[0])
    const href = safeHref(shown)
    if (!href) continue
    if (start > last) parts.push({ type: 'text', text: text.slice(last, start) })
    parts.push({ type: 'link', text: shown, href })
    last = start + shown.length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts.length ? parts : [{ type: 'text', text }]
}
