import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Send, X } from 'lucide-react'

type ThreadItem = {
  id: string
  sender_id: string
  body: string
  created_at: string
  pending?: boolean
  failed?: boolean
}

/*
 * The side panel for a message thread: the first message at the top, every
 * reply under it, and a box that replies to that message. It does no fetching
 * itself; the chat passes in what to show.
 */
export default function ThreadPanel({
  root,
  replies,
  loading,
  nameOf,
  formatWhen,
  onSend,
  onClose,
}: {
  root: ThreadItem | null
  replies: ThreadItem[]
  loading: boolean
  nameOf: (id: string) => string
  formatWhen: (iso: string) => string
  onSend: (text: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [replies.length])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  const row = (item: ThreadItem, isRoot = false) => (
    <div key={item.id} className={`cmThreadMsg${isRoot ? ' root' : ''}${item.failed ? ' failed' : ''}`}>
      <span className="cmThreadMeta">
        <b>{nameOf(item.sender_id)}</b>
        <time dateTime={item.created_at}>{formatWhen(item.created_at)}</time>
        {item.pending && <em>Sending...</em>}
        {item.failed && <em>Not sent</em>}
      </span>
      <p>{item.body}</p>
    </div>
  )

  return (
    <aside className="cmThreadPanel" role="complementary" aria-label="Thread">
      <header>
        <strong>Thread</strong>
        <button type="button" onClick={onClose} aria-label="Close thread"><X size={18} /></button>
      </header>

      <div className="cmThreadBody">
        {root ? row(root, true) : <div className="cmThreadEmpty">This message is further back in the history.</div>}
        <div className="cmThreadDivider">{replies.length === 1 ? '1 reply' : `${replies.length} replies`}</div>
        {loading && replies.length === 0 && <div className="cmThreadEmpty"><LoaderCircle size={16} className="cmSpin" /> Loading replies...</div>}
        {replies.map(item => row(item))}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit}>
        <input
          value={draft}
          onChange={event => setDraft(event.target.value.slice(0, 10000))}
          placeholder="Reply in thread"
          aria-label="Reply in thread"
          enterKeyHint="send"
          autoComplete="off"
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Send reply"><Send size={17} /></button>
      </form>
    </aside>
  )
}
