import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Forward, LoaderCircle, Search, X } from 'lucide-react'
import { MAX_FORWARD_TARGETS, filterTargets, toggleTarget } from '../forward'
import type { ForwardTarget } from '../forward'

/*
 * Pick up to five chats or people to forward one message to, with an optional
 * note that goes after it. Native dialog: focus stays inside, Escape closes.
 */
export default function ForwardDialog({
  senderName,
  preview,
  targets,
  busy,
  onSend,
  onClose,
}: {
  senderName: string
  preview: string
  targets: ForwardTarget[]
  busy: boolean
  onSend: (keys: string[], note: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    document.documentElement.classList.add('cm-fwd-lock')
    return () => document.documentElement.classList.remove('cm-fwd-lock')
  }, [])

  const shown = useMemo(() => filterTargets(targets, query), [targets, query])
  const full = selected.length >= MAX_FORWARD_TARGETS

  return (
    <dialog
      ref={ref}
      className="cmFwd"
      aria-labelledby="cmFwdTitle"
      onClose={onClose}
      onCancel={event => { if (busy) event.preventDefault() }}
      onClick={event => { if (event.target === ref.current && !busy) onClose() }}
    >
      <header>
        <h3 id="cmFwdTitle"><Forward size={18} /> Forward message</h3>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button>
      </header>

      <blockquote className="cmFwdPreview">
        <strong>{senderName}</strong>
        <span>{preview}</span>
      </blockquote>

      <label className="cmFwdSearch">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search chats and people"
          aria-label="Search chats and people"
          autoComplete="off"
        />
      </label>

      <ul className="cmFwdList" role="listbox" aria-multiselectable="true" aria-label="Where to forward">
        {shown.map(item => {
          const on = selected.includes(item.key)
          const blocked = !on && full
          return (
            <li key={item.key}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                disabled={busy || blocked}
                className={on ? 'on' : ''}
                onClick={() => setSelected(current => toggleTarget(current, item.key))}
              >
                <span className="cmFwdMark" aria-hidden="true">{item.kind === 'room' ? '#' : (item.title.trim()[0] || '?').toUpperCase()}</span>
                <span className="cmFwdCopy"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                <span className="cmFwdTick" aria-hidden="true">{on && <Check size={15} />}</span>
              </button>
            </li>
          )
        })}
        {shown.length === 0 && <li className="cmFwdEmpty">No chat or person matches.</li>}
      </ul>

      <input
        className="cmFwdNote"
        value={note}
        onChange={event => setNote(event.target.value.slice(0, 2000))}
        placeholder="Add a note (optional)"
        aria-label="Add a note"
        autoComplete="off"
        disabled={busy}
      />

      <footer>
        <small>{selected.length === 0 ? `Choose up to ${MAX_FORWARD_TARGETS}` : `${selected.length} of ${MAX_FORWARD_TARGETS} selected`}</small>
        <button type="button" className="cmFwdSend" disabled={busy || selected.length === 0} onClick={() => onSend(selected, note)}>
          {busy ? <><LoaderCircle size={16} className="cmSpin" /> Sending...</> : <>Forward <Forward size={16} /></>}
        </button>
      </footer>
    </dialog>
  )
}
