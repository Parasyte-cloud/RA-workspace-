import {
  useState,
} from 'react'
import {
  archiveRoom,
} from '../api/roomApi'

type RoomSettingsProps = {
  conversationId: string
  roomType: string
  canAdministerRoom: boolean
  isGlobalChatAdmin: boolean
  onArchived?: () => void
}

export function RoomSettings({
  conversationId,
  roomType,
  canAdministerRoom,
  isGlobalChatAdmin,
  onArchived,
}: RoomSettingsProps) {
  const [busy, setBusy] =
    useState(false)
  const [error, setError] =
    useState('')

  const canArchive =
    canAdministerRoom &&
    (
      roomType !== 'department' ||
      isGlobalChatAdmin
    )

  async function archive() {
    if (!canArchive) return

    setBusy(true)
    setError('')

    try {
      await archiveRoom(
        conversationId,
      )
      onArchived?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to archive room.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="cmRoomSettings">
      <h3>Room settings</h3>

      {roomType ===
        'department' && (
        <p>
          Department rooms are
          structural workspaces and
          have additional global
          administration safeguards.
        </p>
      )}

      {error && (
        <p role="alert">
          {error}
        </p>
      )}

      {canArchive && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void archive()
          }
        >
          {busy
            ? 'Archiving...'
            : 'Archive room'}
        </button>
      )}
    </section>
  )
}
