import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, NotebookPen, X } from 'lucide-react'
import RoomChat from '../room7-shared/RoomChat'
import RoomNotes from '../room7-shared/RoomNotes'
import { useRoomChat } from '../room7-shared/useRoomChat'
import '../room7-shared/room7-chat.css'

// The chat and the notes of one meeting, opened from the meeting list. Works
// for a meeting that is running and for one that finished days ago.
export default function RoomHub({
  room,
  myId,
  canModerate,
  initialTab = 'chat',
  onClose
}: {
  room: { id: string; title: string; ai_notes_enabled: boolean; status: 'active' | 'ended'; ended_at: string | null }
  myId: string
  canModerate: boolean
  initialTab?: 'chat' | 'notes'
  onClose: () => void
}) {
  const [tab, setTab] = useState<'chat' | 'notes'>(initialTab)
  const chat = useRoomChat(room.id, myId, tab === 'chat')
  const readOnly = room.status === 'ended' && room.ended_at !== null && Date.now() - Date.parse(room.ended_at) > 7 * 24 * 3600 * 1000

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="rhOverlay" role="dialog" aria-modal="true" aria-label={`${room.title} chat and notes`} onClick={onClose}>
      <div className="rhCard" onClick={event => event.stopPropagation()}>
        <header>
          <strong>{room.title}</strong>
          <button type="button" className="iconButton" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="rhTabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
            <MessageSquare size={15} /> Chat{chat.unread > 0 && tab !== 'chat' ? ` (${chat.unread})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
            <NotebookPen size={15} /> Notes
          </button>
        </div>
        <div className="rhBody">
          {tab === 'chat'
            ? <RoomChat chat={chat} myId={myId} canModerate={canModerate} readOnly={readOnly} />
            : <RoomNotes roomId={room.id} aiEnabled={room.ai_notes_enabled} />}
        </div>
      </div>
    </div>,
    document.body
  )
}
