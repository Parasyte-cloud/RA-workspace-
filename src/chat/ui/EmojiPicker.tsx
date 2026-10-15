import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { EMOJI_GROUPS, searchEmoji } from '../emojiData'

const RECENT_KEY = 'ra-chat-recent-emoji'

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 16) : []
  } catch { return [] }
}

function remember(emoji: string) {
  try {
    const next = [emoji, ...readRecent().filter(e => e !== emoji)].slice(0, 16)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* Recent emoji are a convenience only. */ }
}

type Props = { onPick: (emoji: string) => void; onClose: () => void; className?: string }

export function EmojiPicker({ onPick, onClose, className = '' }: Props) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(EMOJI_GROUPS[0].id)
  const [recent] = useState(readRecent)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  const found = useMemo(() => searchEmoji(query), [query])
  const active = EMOJI_GROUPS.find(g => g.id === group) || EMOJI_GROUPS[0]
  const items = query.trim() ? found : active.items.map(i => ({ e: i.e, k: i.k }))

  const pick = (emoji: string) => { remember(emoji); onPick(emoji) }

  return (
    <div className={`cmEmoji ${className}`.trim()} ref={rootRef} role="dialog" aria-label="Choose an emoji">
      <label className="cmEmojiSearch">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={query}
          autoFocus
          placeholder="Search emoji"
          aria-label="Search emoji"
          onChange={event => setQuery(event.target.value)}
        />
      </label>
      {!query.trim() && (
        <div className="cmEmojiTabs" role="tablist">
          {EMOJI_GROUPS.map(g => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g.id === group}
              aria-label={g.label}
              title={g.label}
              className={g.id === group ? 'on' : ''}
              onClick={() => setGroup(g.id)}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="cmEmojiScroll">
        {!query.trim() && recent.length > 0 && (
          <>
            <div className="cmEmojiLabel">Recent</div>
            <div className="cmEmojiGrid">
              {recent.map(e => <button key={'r' + e} type="button" onClick={() => pick(e)} aria-label={e}>{e}</button>)}
            </div>
          </>
        )}
        <div className="cmEmojiLabel">{query.trim() ? `Results for "${query.trim()}"` : active.label}</div>
        <div className="cmEmojiGrid">
          {items.length === 0 && <span className="cmEmojiNone">Nothing matches that.</span>}
          {items.map(item => (
            <button key={item.e} type="button" title={item.k} aria-label={item.k || item.e} onClick={() => pick(item.e)}>{item.e}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
