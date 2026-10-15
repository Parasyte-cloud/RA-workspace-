import { useRef, useState } from 'react'
import { Camera, Trash2, X } from 'lucide-react'
import { STATUS_DURATIONS, STATUS_PRESETS, statusUntil } from '../../lib/chatExtras'
import type { ChatStatus } from '../../lib/chatExtras'
import { ChatAvatar } from './ChatAvatar'
import { EmojiPicker } from './EmojiPicker'

type MineProps = {
  name: string
  initialsText: string
  avatarUrl: string | null
  status: ChatStatus | null
  busy: boolean
  onUpload: (file: File) => void
  onRemovePhoto: () => void
  onSaveStatus: (status: ChatStatus) => void
  onClose: () => void
}

// "My chat profile": the picture colleagues see in chat, and a status.
export function MyChatProfile({ name, initialsText, avatarUrl, status, busy, onUpload, onRemovePhoto, onSaveStatus, onClose }: MineProps) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [emoji, setEmoji] = useState(status?.emoji || '')
  const [text, setText] = useState(status?.text || '')
  const [hours, setHours] = useState<string>('-1')
  const [picking, setPicking] = useState(false)

  const save = () => {
    const clean = text.trim().slice(0, 80)
    if (!emoji && !clean) { onSaveStatus({ emoji: null, text: null, until: null }); return }
    onSaveStatus({ emoji: emoji || null, text: clean || null, until: statusUntil(hours === 'null' ? null : Number(hours)) })
  }

  return (
    <div className="cmModalBack" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="cmModal" role="dialog" aria-modal="true" aria-label="My chat profile">
        <header>
          <h3>My chat profile</h3>
          <button type="button" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>

        <section className="cmProfilePhoto">
          <ChatAvatar name={name} initialsText={initialsText} url={avatarUrl} size={88} />
          <div>
            <p>This picture is shown to your colleagues in chat. It is separate from your private HR headshot.</p>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp"
              onChange={event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) onUpload(file)
              }}
            />
            <div className="cmProfileBtns">
              <button type="button" className="cmBtn" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Camera size={15} /> {avatarUrl ? 'Change photo' : 'Add a photo'}
              </button>
              {avatarUrl && (
                <button type="button" className="cmBtn" disabled={busy} onClick={onRemovePhoto}>
                  <Trash2 size={15} /> Remove
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="cmProfileStatus">
          <h4>Status</h4>
          <div className="cmStatusRow">
            <div className="cmStatusEmojiWrap">
              <button type="button" className="cmStatusEmoji" aria-label="Choose a status emoji" onClick={() => setPicking(p => !p)}>
                {emoji || '🙂'}
              </button>
              {picking && <EmojiPicker className="cmEmojiOver cmEmojiDown" onPick={e => { setEmoji(e); setPicking(false) }} onClose={() => setPicking(false)} />}
            </div>
            <input
              type="text"
              value={text}
              maxLength={80}
              placeholder="What are you up to?"
              aria-label="Status message"
              onChange={event => setText(event.target.value)}
            />
          </div>
          <div className="cmPresets">
            {STATUS_PRESETS.map(p => (
              <button key={p.text} type="button" onClick={() => { setEmoji(p.emoji); setText(p.text) }}>
                <span>{p.emoji}</span> {p.text}
              </button>
            ))}
          </div>
          <label className="cmStatusFor">
            Clear after
            <select value={hours} onChange={event => setHours(event.target.value)}>
              {STATUS_DURATIONS.map(d => (
                <option key={d.label} value={String(d.hours)}>{d.label}</option>
              ))}
            </select>
          </label>
        </section>

        <footer>
          {status && (
            <button type="button" className="cmBtn" disabled={busy} onClick={() => { setEmoji(''); setText(''); onSaveStatus({ emoji: null, text: null, until: null }) }}>
              Clear status
            </button>
          )}
          <button type="button" className="cmBtn primary" disabled={busy} onClick={() => { save(); onClose() }}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  )
}

type CardProps = {
  name: string
  initialsText: string
  avatarUrl: string | null
  title: string
  status: ChatStatus | null
  onClose: () => void
}

// A colleague's card: picture, role and status.
export function PersonCard({ name, initialsText, avatarUrl, title, status, onClose }: CardProps) {
  return (
    <div className="cmModalBack" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="cmModal cmCard" role="dialog" aria-modal="true" aria-label={name}>
        <button type="button" className="cmCardX" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <ChatAvatar name={name} initialsText={initialsText} url={avatarUrl} size={112} />
        <h3>{name}</h3>
        {title && <p className="cmCardTitle">{title}</p>}
        {status && (
          <p className="cmCardStatus">
            {status.emoji && <span aria-hidden="true">{status.emoji}</span>} {status.text}
          </p>
        )}
      </div>
    </div>
  )
}
