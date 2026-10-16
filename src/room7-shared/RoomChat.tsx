import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { CornerUpLeft, LoaderCircle, Pencil, RotateCw, Send, Trash2, X } from 'lucide-react'
import { safeHttpUrl } from '../lib/safeUrl'
import type { RoomChatMessage } from './useRoomChat'

type ChatApi = {
  messages: RoomChatMessage[]
  names: Record<string, string>
  loading: boolean
  error: string
  send: (body: string, replyTo?: string | null) => Promise<void>
  retry: (message: RoomChatMessage) => void
  edit: (id: string, body: string) => Promise<void>
  remove: (id: string) => Promise<void>
  clearError: () => void
}

// Turns plain text into links and highlights @mentions. Nothing here builds
// HTML from text: links are checked first and everything else is plain text.
export function renderChatText(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(https?:\/\/[^\s<]+)|(@[\p{L}][\p{L}'.-]*)/gu
  let last = 0
  let key = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) out.push(text.slice(last, index))
    if (match[1]) {
      const trimmed = match[1].replace(/[.,;:!?)]+$/, '')
      const href = safeHttpUrl(trimmed)
      out.push(href
        ? <a key={key++} href={href} target="_blank" rel="noopener noreferrer">{trimmed}</a>
        : trimmed)
      last = index + trimmed.length
      continue
    }
    out.push(<span key={key++} className="rcMention">{match[2]}</span>)
    last = index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function clock(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dayKey(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toDateString()
}

function dayText(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function RoomChat({
  chat,
  myId,
  canModerate = false,
  readOnly = false,
  title = 'Team chat'
}: {
  chat: ChatApi
  myId: string
  canModerate?: boolean
  readOnly?: boolean
  title?: string
}) {
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<RoomChatMessage | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const byId = useMemo(() => new Map(chat.messages.map(m => [m.id, m])), [chat.messages])

  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [chat.messages.length])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (editing) {
      const value = editing.text.trim()
      if (value) void chat.edit(editing.id, value)
      setEditing(null)
      return
    }
    const value = text.trim()
    if (!value) return
    setText('')
    const reply = replyTo
    setReplyTo(null)
    stickRef.current = true
    void chat.send(value, reply && !reply.id.startsWith('tmp-') ? reply.id : null)
  }

  const name = (id: string) => (id === myId ? 'You' : chat.names[id] || 'Colleague')
  let lastDay = ''

  return (
    <div className="rcRoot" aria-label={title}>
      <div className="rcList" ref={listRef} onScroll={onScroll} role="log" aria-live="polite">
        {chat.loading && <div className="rcState"><LoaderCircle size={18} className="roomSpin" /> Loading chat...</div>}
        {!chat.loading && chat.messages.length === 0 && (
          <div className="rcState">No messages yet. Say hello, share a link or a decision. It stays here after the meeting.</div>
        )}
        {chat.messages.map(message => {
          const mine = message.sender_id === myId
          const day = dayKey(message.created_at)
          const showDay = day !== lastDay
          lastDay = day
          const parent = message.reply_to_id ? byId.get(message.reply_to_id) : null
          const deleted = Boolean(message.deleted_at)
          return (
            <div key={message.id}>
              {showDay && <div className="rcDay">{dayText(message.created_at)}</div>}
              <div className={`rcMsg${mine ? ' mine' : ''}${message.failed ? ' failed' : ''}${message.pending ? ' pending' : ''}`}>
                {!mine && <span className="rcWho">{name(message.sender_id)}</span>}
                {parent && !deleted && (
                  <span className="rcQuote"><b>{name(parent.sender_id)}</b> {parent.deleted_at ? 'Message deleted' : parent.body.slice(0, 90)}</span>
                )}
                <p className={deleted ? 'rcDeleted' : ''}>{deleted ? 'Message deleted' : renderChatText(message.body)}</p>
                <span className="rcMeta">
                  {clock(message.created_at)}{message.edited_at && !deleted ? ' · edited' : ''}
                  {message.pending ? ' · sending' : ''}
                </span>
                {message.failed && (
                  <button type="button" className="rcRetry" onClick={() => chat.retry(message)}>
                    <RotateCw size={12} /> Not sent. Tap to retry
                  </button>
                )}
                {!deleted && !message.pending && !message.failed && !readOnly && (
                  <span className="rcTools">
                    <button type="button" aria-label="Reply" title="Reply" onClick={() => setReplyTo(message)}><CornerUpLeft size={13} /></button>
                    {mine && Date.now() - Date.parse(message.created_at) < 24 * 3600 * 1000 && (
                      <button type="button" aria-label="Edit" title="Edit" onClick={() => setEditing({ id: message.id, text: message.body })}><Pencil size={13} /></button>
                    )}
                    {(mine || canModerate) && (
                      <button type="button" aria-label="Delete" title="Delete" onClick={() => { if (window.confirm('Delete this message for everyone?')) void chat.remove(message.id) }}><Trash2 size={13} /></button>
                    )}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {chat.error && (
        <div className="rcError" role="alert">{chat.error}<button type="button" aria-label="Dismiss" onClick={chat.clearError}><X size={12} /></button></div>
      )}

      {readOnly ? (
        <div className="rcState">This chat is read only.</div>
      ) : (
        <form className="rcComposer" onSubmit={submit}>
          {replyTo && !editing && (
            <div className="rcReplying">
              <span>Replying to <b>{name(replyTo.sender_id)}</b>: {replyTo.body.slice(0, 70)}</span>
              <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={13} /></button>
            </div>
          )}
          {editing && (
            <div className="rcReplying">
              <span>Editing your message</span>
              <button type="button" aria-label="Cancel edit" onClick={() => setEditing(null)}><X size={13} /></button>
            </div>
          )}
          <div className="rcRow">
            <textarea
              rows={1}
              maxLength={4000}
              placeholder="Message the team"
              value={editing ? editing.text : text}
              onChange={event => editing ? setEditing({ ...editing, text: event.target.value }) : setText(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <button type="submit" className="rcSend" aria-label="Send" disabled={!(editing ? editing.text.trim() : text.trim())}><Send size={16} /></button>
          </div>
        </form>
      )}
    </div>
  )
}
