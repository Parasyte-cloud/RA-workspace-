import {
  useState,
  type FormEvent,
} from 'react'
import {
  createRoom,
  type GovernedRoomKind,
  type RoomHistoryPolicy,
} from '../api/roomApi'

type RoomCreatorProps = {
  canCreateRoom: boolean
  onCreated?: (
    conversationId: string,
  ) => void
}

export function RoomCreator({
  canCreateRoom,
  onCreated,
}: RoomCreatorProps) {
  const [title, setTitle] =
    useState('')
  const [description, setDescription] =
    useState('')
  const [roomType, setRoomType] =
    useState<GovernedRoomKind>(
      'project',
    )
  const [
    historyPolicy,
    setHistoryPolicy,
  ] =
    useState<RoomHistoryPolicy>(
      'full',
    )
  const [busy, setBusy] =
    useState(false)
  const [error, setError] =
    useState('')

  if (!canCreateRoom) {
    return null
  }

  async function submit(
    event: FormEvent,
  ) {
    event.preventDefault()

    const cleanTitle =
      title.trim()

    if (
      cleanTitle.length < 2 ||
      cleanTitle.length > 120
    ) {
      setError(
        'Room title must be between 2 and 120 characters.',
      )
      return
    }

    setBusy(true)
    setError('')

    try {
      const conversationId =
        await createRoom({
          title: cleanTitle,
          roomType,
          description:
            description.trim() || null,
          historyPolicy,
        })

      setTitle('')
      setDescription('')
      setRoomType('project')
      setHistoryPolicy('full')

      onCreated?.(
        conversationId,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to create room.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="cmRoomCreator"
      onSubmit={submit}
    >
      <h3>Create room</h3>

      <label>
        <span>Name</span>
        <input
          value={title}
          maxLength={120}
          onChange={event =>
            setTitle(
              event.target.value,
            )
          }
          placeholder="Operations project"
          required
        />
      </label>

      <label>
        <span>Type</span>
        <select
          value={roomType}
          onChange={event =>
            setRoomType(
              event.target
                .value as GovernedRoomKind,
            )
          }
        >
          <option value="project">
            Project
          </option>
          <option value="committee">
            Committee
          </option>
          <option value="restricted">
            Restricted
          </option>
        </select>
      </label>

      <label>
        <span>
          Message history
        </span>
        <select
          value={historyPolicy}
          onChange={event =>
            setHistoryPolicy(
              event.target
                .value as RoomHistoryPolicy,
            )
          }
        >
          <option value="full">
            Full history
          </option>
          <option value="from_join_date">
            From join date
          </option>
        </select>
      </label>

      <label>
        <span>Description</span>
        <textarea
          value={description}
          maxLength={1000}
          onChange={event =>
            setDescription(
              event.target.value,
            )
          }
          placeholder="What this room is for"
        />
      </label>

      {error && (
        <p role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
      >
        {busy
          ? 'Creating...'
          : 'Create room'}
      </button>
    </form>
  )
}
