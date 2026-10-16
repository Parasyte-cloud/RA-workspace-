import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, MessageCircle, UserRound, X } from 'lucide-react'
import Room7LobbyChat from '../room7-shared/Room7LobbyChat'
import '../room7-shared/room7-lobby-chat.css'
import type { Invoke } from '../lib/room7Share'

type Waiting = { id: string; display_name: string; email: string; room_id: string }

/*
 * The host's side of the approval queue. It floats above the call (it renders
 * in a portal on <body>) so the host can admit people without leaving the
 * meeting. It only polls while an event actually asks for approval; otherwise
 * it checks now and then in case the host switches approval on.
 */
export default function GuestAdmissionPanel({
  roomIds,
  invoke,
}: {
  roomIds: string[]
  invoke: Invoke
}) {
  const [waiting, setWaiting] = useState<Waiting[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  // Rooms this person may not control (a plain participant): never ask again.
  const skip = useRef(new Set<string>())
  const approvalOn = useRef(false)
  const roomKey = roomIds.join(',')

  const poll = useCallback(async () => {
    const found: Waiting[] = []
    let anyHost = false

    for (const id of roomKey.split(',').filter(Boolean)) {
      if (skip.current.has(id)) continue

      try {
        const data = await invoke({ action: 'join_requests', room_id: id }) as unknown as {
          requests?: Array<{ id: string; display_name: string; email: string }>
          admission?: string
        }

        if (data.admission === 'host') anyHost = true

        for (const request of data.requests ?? []) {
          found.push({ ...request, room_id: id })
        }
      } catch (cause) {
        if (cause instanceof Error && /only the room 7 host|manager or administrator/i.test(cause.message)) {
          skip.current.add(id)
        }
      }
    }

    approvalOn.current = anyHost
    setWaiting(found)
  }, [invoke, roomKey])

  useEffect(() => {
    if (!roomKey) return

    let cancelled = false
    let timer = 0

    const loop = async () => {
      if (document.visibilityState !== 'hidden') await poll()
      if (cancelled) return
      timer = window.setTimeout(() => void loop(), approvalOn.current ? 4000 : 30000)
    }

    void loop()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [poll, roomKey])

  const decide = async (decision: 'admit' | 'deny', target: Waiting | 'all') => {
    const roomId = target === 'all' ? waiting[0]?.room_id : target.room_id
    if (!roomId) return

    setBusy(target === 'all' ? 'all' : target.id)
    setError('')

    try {
      await invoke(
        target === 'all'
          ? { action: 'decide_request', room_id: roomId, decision, all: true }
          : { action: 'decide_request', room_id: roomId, decision, request_id: target.id },
      )
      await poll()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update that guest.')
    } finally {
      setBusy('')
    }
  }

  const chatRoom = waiting[0]?.room_id || ''
  const lobbyTransport = useCallback(
    (action: 'lobby_chat_list' | 'lobby_chat_send', text?: string) =>
      invoke({ action, room_id: chatRoom, ...(text ? { body: text } : {}) }) as unknown as Promise<{
        messages?: import('../room7-shared/Room7LobbyChat').LobbyMessage[]
      }>,
    [invoke, chatRoom],
  )

  if (!waiting.length) return null

  return createPortal(
    <div className="roomAdmit" role="alertdialog" aria-label="Guests waiting to join">
      <div className="roomAdmitHead">
        <strong>
          {waiting.length === 1 ? '1 guest is waiting' : `${waiting.length} guests are waiting`}
        </strong>
        <button
          type="button"
          className="roomAdmitChatToggle"
          aria-expanded={chatOpen}
          onClick={() => setChatOpen(open => !open)}
        >
          <MessageCircle size={14} />Chat
        </button>
        {waiting.length > 1 && (
          <button type="button" disabled={!!busy} onClick={() => void decide('admit', 'all')}>
            Admit all
          </button>
        )}
      </div>

      {waiting.map(person => (
        <div className="roomAdmitRow" key={person.id}>
          <UserRound size={16} aria-hidden="true" />
          <span>
            <b>{person.display_name}</b>
            <small>{person.email}</small>
          </span>
          <button
            type="button"
            className="roomAdmitYes"
            disabled={!!busy}
            onClick={() => void decide('admit', person)}
            aria-label={`Admit ${person.display_name}`}
          >
            <Check size={14} />Admit
          </button>
          <button
            type="button"
            className="roomAdmitNo"
            disabled={!!busy}
            onClick={() => void decide('deny', person)}
            aria-label={`Deny ${person.display_name}`}
          >
            <X size={14} />
          </button>
        </div>
      ))}

      {chatOpen && chatRoom && (
        <Room7LobbyChat transport={lobbyTransport} hostView title="Chat with waiting guests" />
      )}

      {error && <p className="roomAdmitError" role="alert">{error}</p>}
    </div>,
    document.body,
  )
}
