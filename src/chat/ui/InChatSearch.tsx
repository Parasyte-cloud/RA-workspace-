import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { searchMessages } from '../api/chatExtras'
import type { SearchHit } from '../api/chatExtras'
import { cleanSearchQuery, highlightParts } from '../../lib/chatExtras'

type Props = {
  client: SupabaseClient | null
  conversationId: string
  nameOf: (id: string) => string
  formatWhen: (iso: string) => string
  onJump: (id: string) => void
  onClose: () => void
}

export function InChatSearch({ client, conversationId, nameOf, formatWhen, onJump, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  useEffect(() => {
    const q = cleanSearchQuery(query)
    if (!client || q.length < 2) { setHits([]); setState('idle'); return }
    setState('busy')
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchMessages(client, conversationId, q)
        .then(rows => { if (!cancelled) { setHits(rows); setState('done') } })
        .catch(() => { if (!cancelled) setState('error') })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [client, conversationId, query])

  return (
    <div className="cmFind" role="search">
      <div className="cmFindBar">
        <Search size={16} aria-hidden="true" />
        <input
          autoFocus
          type="search"
          value={query}
          placeholder="Search this conversation"
          aria-label="Search this conversation"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape') onClose() }}
        />
        <button type="button" aria-label="Close search" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="cmFindList" aria-live="polite">
        {state === 'idle' && <p className="cmFindHint">Type at least 2 letters.</p>}
        {state === 'busy' && <p className="cmFindHint">Searching...</p>}
        {state === 'error' && <p className="cmFindHint">Search is unavailable right now.</p>}
        {state === 'done' && hits.length === 0 && <p className="cmFindHint">No messages match "{cleanSearchQuery(query)}".</p>}
        {hits.map(hit => (
          <button key={hit.id} type="button" className="cmFindHit" onClick={() => { onJump(hit.id); onClose() }}>
            <span className="cmFindMeta"><strong>{nameOf(hit.sender_id)}</strong><small>{formatWhen(hit.created_at)}</small></span>
            <span className="cmFindText">
              {highlightParts(hit.body, query).map((part, i) => part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
