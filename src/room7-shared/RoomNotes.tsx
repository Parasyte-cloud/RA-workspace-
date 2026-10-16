import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, Circle, ClipboardCopy, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Minutes = {
  id: string
  session_id: string
  status: 'pending' | 'ready' | 'failed'
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  participant_count: number
  summary_markdown: string | null
}

type ActionItem = {
  id: string
  minutes_id: string
  position: number
  body: string
  owner_name: string | null
  due_text: string | null
  done: boolean
}

// Bold text only. Everything else is plain text, so nothing from the summary
// can turn into markup.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part
  )
}

export function renderNotes(markdown: string): ReactNode[] {
  const out: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) {
      out.push(<ul key={`u${out.length}`}>{bullets.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>)
      bullets = []
    }
  }
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) { flush(); continue }
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      out.push(<h4 key={`h${out.length}`}>{inline(heading[2])}</h4>)
      continue
    }
    const bullet = /^\s*(?:[-*+•]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) { bullets.push(bullet[1].replace(/^\[[ xX]\]\s*/, '')); continue }
    flush()
    out.push(<p key={`p${out.length}`}>{inline(line.trim())}</p>)
  }
  flush()
  return out
}

function length(seconds: number | null) {
  if (seconds === null || seconds < 0) return ''
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)} h ${mins % 60} min`
}

export default function RoomNotes({ roomId, aiEnabled }: { roomId: string; aiEnabled: boolean }) {
  const [minutes, setMinutes] = useState<Minutes[]>([])
  const [items, setItems] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    const client = supabase
    if (!client) { setLoading(false); return }
    setLoading(true)
    const [{ data, error: minutesError }, { data: actionRows }] = await Promise.all([
      client.rpc('my_room_minutes', { p_room: roomId }),
      client.from('workspace_room_action_items')
        .select('id,minutes_id,position,body,owner_name,due_text,done')
        .eq('room_id', roomId)
        .order('position', { ascending: true })
    ])
    if (minutesError) setError(minutesError.message)
    else { setError(''); setMinutes((data || []) as Minutes[]) }
    setItems((actionRows || []) as ActionItem[])
    setLoading(false)
  }, [roomId])

  useEffect(() => { void load() }, [load])

  const toggle = async (item: ActionItem) => {
    const client = supabase
    if (!client) return
    const next = !item.done
    setItems(current => current.map(row => row.id === item.id ? { ...row, done: next } : row))
    const { error: toggleError } = await client.rpc('set_room_action_done', { p_id: item.id, p_done: next })
    if (toggleError) {
      setItems(current => current.map(row => row.id === item.id ? { ...row, done: item.done } : row))
      setError(toggleError.message)
    }
  }

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      window.prompt('Copy these notes:', text)
    }
  }

  if (loading) return <div className="rcState"><LoaderCircle size={18} className="roomSpin" /> Loading notes...</div>

  return (
    <div className="rnRoot">
      {error && <div className="rcError" role="alert">{error}</div>}
      {!aiEnabled && <div className="rcState"><Sparkles size={16} /> AI notes were turned off for this meeting.</div>}
      {aiEnabled && minutes.length === 0 && (
        <div className="rcState">
          Notes appear here a few minutes after the meeting ends.
          <button type="button" className="glassButton" onClick={() => void load()}><RefreshCw size={14} /> Check again</button>
        </div>
      )}
      {minutes.map(session => {
        const mine = items.filter(item => item.minutes_id === session.id)
        const open = mine.filter(item => !item.done).length
        return (
          <article key={session.id} className="rnCard">
            <header>
              <div>
                <strong>{session.started_at ? new Date(session.started_at).toLocaleString() : 'Meeting'}</strong>
                <small>{[length(session.duration_seconds), session.participant_count ? `${session.participant_count} people` : ''].filter(Boolean).join(' · ')}</small>
              </div>
              {session.summary_markdown && (
                <button type="button" className="glassButton" onClick={() => void copy(session.id, session.summary_markdown || '')}>
                  <ClipboardCopy size={14} /> {copied === session.id ? 'Copied' : 'Copy'}
                </button>
              )}
            </header>

            {mine.length > 0 && (
              <section className="rnActions" aria-label="Action items">
                <h4>Action items <span>{open} open</span></h4>
                <ul>
                  {mine.map(item => (
                    <li key={item.id} className={item.done ? 'done' : ''}>
                      <button type="button" aria-pressed={item.done} aria-label={item.done ? 'Mark as not done' : 'Mark as done'} onClick={() => void toggle(item)}>
                        {item.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                      </button>
                      <span>
                        {item.body}
                        {(item.owner_name || item.due_text) && (
                          <small>{[item.owner_name, item.due_text ? `due ${item.due_text}` : ''].filter(Boolean).join(' · ')}</small>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {session.summary_markdown
              ? <div className="rnBody">{renderNotes(session.summary_markdown)}</div>
              : <div className="rcState">The summary is still being prepared.</div>}
          </article>
        )
      })}
    </div>
  )
}
