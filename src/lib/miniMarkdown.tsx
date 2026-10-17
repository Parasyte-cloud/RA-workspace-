import type { ReactNode } from 'react'

// A deliberately tiny renderer for Knowledge Base text: "## " headings, "- "
// bullets, **bold**, and https links. It builds React elements, never HTML
// strings, so article text (which an AI may have drafted from web pages) cannot
// inject markup or script. Anything it does not recognise renders as plain text.

const INLINE = /(\*\*[^*\n]+\*\*|https:\/\/[^\s<>"')]+)/g

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const token = m[0]
    if (token.startsWith('**')) {
      out.push(<strong key={i++}>{token.slice(2, -2)}</strong>)
    } else {
      // Trailing sentence punctuation is not part of the link.
      const clean = token.replace(/[.,;:!?]+$/, '')
      out.push(
        <a key={i++} href={clean} target="_blank" rel="noopener noreferrer">{clean}</a>,
      )
      if (clean.length < token.length) out.push(token.slice(clean.length))
    }
    last = at + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export type Block =
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'p'; text: string }

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  let list: string[] | null = null
  let para: string[] = []
  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') })
    para = []
  }
  const flushList = () => {
    if (list) blocks.push({ kind: 'ul', items: list })
    list = null
  }
  for (const raw of source.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushPara(); flushList(); continue }
    const heading = /^#{1,3}\s+(.+)$/.exec(line)
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line)
    if (heading) { flushPara(); flushList(); blocks.push({ kind: 'h', text: heading[1] }) }
    else if (bullet) { flushPara(); (list ??= []).push(bullet[1]) }
    else { flushList(); para.push(line) }
  }
  flushPara(); flushList()
  return blocks
}

export function ArticleBody({ text }: { text: string }) {
  return (
    <div className="kbBody">
      {parseBlocks(text).map((b, i) =>
        b.kind === 'h' ? <h3 key={i}>{renderInline(b.text)}</h3>
        : b.kind === 'ul' ? <ul key={i}>{b.items.map((t, j) => <li key={j}>{renderInline(t)}</li>)}</ul>
        : <p key={i}>{renderInline(b.text)}</p>,
      )}
    </div>
  )
}
