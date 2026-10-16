import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, MessageCircle, Send } from 'lucide-react'

export type LobbyMessage = {
  id: string
  from: 'guest' | 'host'
  name: string
  body: string
  at: string
  mine: boolean
}

type Transport = (action: 'lobby_chat_list' | 'lobby_chat_send', body?: string) => Promise<{ messages?: LobbyMessage[] }>

const MAX = 500

export function lobbyTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/*
 * Waiting room chat. The same component serves the guest page and the host's
 * admit panel; only the transport differs. It polls while the tab is visible
 * and stops entirely when it unmounts (for a guest that is the moment they
 * are let in).
 */
export default function Room7LobbyChat({
  transport,
  pollMs = 3500,
  title = 'Waiting room chat',
  hostView = false,
}: {
  transport: Transport
  pollMs?: number
  title?: string
  hostView?: boolean
}) {
  const [messages, setMessages] = useState<LobbyMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const data = await transport('lobby_chat_list')
      setMessages(data.messages || [])
      setError('')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      // Keep quiet on a passing network error, say it when it is a real answer.
      if (/migration|not ready|first|not in use/i.test(message)) setError(message)
    } finally {
      setReady(true)
    }
  }, [transport])

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const loop = async () => {
      if (document.visibilityState !== 'hidden') await refresh()
      if (!cancelled) timer = window.setTimeout(() => void loop(), pollMs)
    }
    void loop()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [refresh, pollMs])

  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setError('')
    try {
      const data = await transport('lobby_chat_send', text)
      setMessages(data.messages || [])
      setDraft('')
      stick.current = true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send that message.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`lcRoot${hostView ? ' lcHost' : ''}`} aria-label={title}>
      <header><MessageCircle size={15} aria-hidden="true" /> <strong>{title}</strong></header>

      <div
        ref={listRef}
        className="lcList"
        role="log"
        aria-live="polite"
        onScroll={event => {
          const el = event.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {!ready && <div className="lcEmpty"><LoaderCircle size={16} className="lcSpin" /> Loading...</div>}
        {ready && messages.length === 0 && (
          <div className="lcEmpty">
            {hostView ? 'No messages yet. Say hello to the guests who are waiting.' : 'No messages yet. Say hello, or ask the host a question.'}
          </div>
        )}
        {messages.map(message => (
          <div key={message.id} className={`lcMsg${message.mine ? ' mine' : ''}${message.from === 'host' ? ' fromHost' : ''}`}>
            <span className="lcMeta">
              <b>{message.mine ? 'You' : message.name}</b>
              <time dateTime={message.at}>{lobbyTime(message.at)}</time>
            </span>
            <p>{message.body}</p>
          </div>
        ))}
      </div>

      {error && <div className="lcError" role="alert">{error}</div>}

      <form onSubmit={event => void send(event)}>
        <input
          value={draft}
          onChange={event => setDraft(event.target.value.slice(0, MAX))}
          placeholder={hostView ? 'Message the waiting guests' : 'Message the host'}
          aria-label="Waiting room message"
          maxLength={MAX}
          enterKeyHint="send"
          autoComplete="off"
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message">
          {busy ? <LoaderCircle size={16} className="lcSpin" /> : <Send size={16} />}
        </button>
      </form>
    </section>
  )
}
