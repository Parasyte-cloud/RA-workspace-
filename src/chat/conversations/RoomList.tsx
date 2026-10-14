import type {
  ConversationSummary,
} from '../types'

type RoomListProps = {
  rooms: ConversationSummary[]
  selectedId?: string
  onSelect?: (conversationId: string) => void
}

export function RoomList({
  rooms,
  selectedId,
  onSelect,
}: RoomListProps) {
  if (!rooms.length) {
    return (
      <p className="chatEmptySmall">
        No rooms available.
      </p>
    )
  }

  return (
    <div>
      {rooms.map(room => (
        <button
          key={room.id}
          type="button"
          aria-current={
            room.id === selectedId
              ? 'page'
              : undefined
          }
          onClick={() => onSelect?.(room.id)}
        >
          {room.title || 'Room'}
        </button>
      ))}
    </div>
  )
}
