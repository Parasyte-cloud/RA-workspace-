import { useState } from 'react'
import { Award, Pin, PinOff, Plus, SmilePlus } from 'lucide-react'
import { QUICK_REACTIONS, reactionTitle } from '../../lib/chatExtras'
import type { ReactionGroup } from '../../lib/chatExtras'
import { EmojiPicker } from './EmojiPicker'

type ChipsProps = {
  groups: ReactionGroup[]
  nameOf: (id: string) => string
  me: string | null
  onToggle: (emoji: string) => void
  disabled?: boolean
}

// The reactions already on a message, shown under the bubble.
export function ReactionChips({ groups, nameOf, me, onToggle, disabled }: ChipsProps) {
  if (!groups.length) return null
  return (
    <div className="cmReactions" role="group" aria-label="Reactions">
      {groups.map(group => {
        const who = reactionTitle(group, nameOf, me)
        return (
          <button
            key={group.emoji}
            type="button"
            className={`cmChip${group.mine ? ' mine' : ''}`}
            title={who}
            aria-label={`${group.emoji} ${group.count}. ${who}. ${group.mine ? 'Tap to remove your reaction' : 'Tap to react too'}`}
            aria-pressed={group.mine}
            disabled={disabled}
            onClick={() => onToggle(group.emoji)}
          >
            <span>{group.emoji}</span>
            <b>{group.count}</b>
          </button>
        )
      })}
    </div>
  )
}

type ToolbarProps = {
  canReact: boolean
  pinned: boolean
  canPin: boolean
  onReact: (emoji: string) => void
  onTogglePin: () => void
  onRibbon?: () => void
}

// Shown above a bubble on hover: quick reactions, more emoji, and pin.
export function MessageToolbar({ canReact, pinned, canPin, onReact, onTogglePin, onRibbon }: ToolbarProps) {
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  if (!canReact && !canPin && !onRibbon) return null
  return (
    <div className={`cmToolbar${open || more ? ' open' : ''}`}>
      {canReact && (
        <button
          type="button"
          className="cmToolBtn"
          aria-label="React to this message"
          aria-expanded={open}
          title="React"
          onClick={() => { setOpen(o => !o); setMore(false) }}
        >
          <SmilePlus size={15} />
        </button>
      )}
      {onRibbon && (
        <button
          type="button"
          className="cmToolBtn cmRibbonBtn"
          aria-label="Give a ribbon for this message"
          title="Give a ribbon"
          onClick={onRibbon}
        >
          <Award size={15} />
        </button>
      )}
      {canPin && (
        <button
          type="button"
          className="cmToolBtn"
          aria-label={pinned ? 'Unpin this message' : 'Pin this message'}
          aria-pressed={pinned}
          title={pinned ? 'Unpin' : 'Pin'}
          onClick={onTogglePin}
        >
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
      )}
      {open && !more && (
        <div className="cmQuick" role="menu" aria-label="Quick reactions">
          {QUICK_REACTIONS.map(emoji => (
            <button key={emoji} type="button" role="menuitem" aria-label={`React ${emoji}`} onClick={() => { onReact(emoji); setOpen(false) }}>
              {emoji}
            </button>
          ))}
          <button type="button" role="menuitem" aria-label="More emoji" title="More" onClick={() => setMore(true)}>
            <Plus size={16} />
          </button>
        </div>
      )}
      {more && (
        <EmojiPicker
          className="cmEmojiOver"
          onPick={emoji => { onReact(emoji); setMore(false); setOpen(false) }}
          onClose={() => { setMore(false); setOpen(false) }}
        />
      )}
    </div>
  )
}
