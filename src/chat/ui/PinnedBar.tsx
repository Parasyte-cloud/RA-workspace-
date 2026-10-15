import { useState } from 'react'
import { ChevronDown, Pin } from 'lucide-react'

export type PinnedItem = { id: string; who: string; preview: string }

type Props = { items: PinnedItem[]; onJump: (id: string) => void; onUnpin: (id: string) => void }

export function PinnedBar({ items, onJump, onUnpin }: Props) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  const first = items[0]
  return (
    <div className="cmPinned">
      <div className="cmPinnedTop">
        <Pin size={14} aria-hidden="true" />
        <button type="button" className="cmPinnedMain" onClick={() => onJump(first.id)} title="Go to the pinned message">
          <strong>{first.who}</strong>
          <span>{first.preview}</span>
        </button>
        {items.length > 1 && (
          <button
            type="button"
            className="cmPinnedMore"
            aria-expanded={open}
            aria-label={`${items.length} pinned messages`}
            onClick={() => setOpen(o => !o)}
          >
            {items.length}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <ul className="cmPinnedList">
          {items.map(item => (
            <li key={item.id}>
              <button type="button" onClick={() => { onJump(item.id); setOpen(false) }}>
                <strong>{item.who}</strong>
                <span>{item.preview}</span>
              </button>
              <button type="button" className="cmPinnedX" aria-label="Unpin" title="Unpin" onClick={() => onUnpin(item.id)}>Unpin</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
