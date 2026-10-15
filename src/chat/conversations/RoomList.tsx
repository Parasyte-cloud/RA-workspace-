import type {
  ConversationSummary,
} from '../types'

type RoomListProps = {
  rooms: ConversationSummary[]
  selectedId?: string
  onSelect?: (conversationId: string) => void
}

function roomKindLabel(
  room: ConversationSummary,
) {
  switch (room.conversation_kind) {
    case 'department':
      return 'Department room'
    case 'project':
      return 'Project room'
    case 'committee':
      return 'Committee room'
    case 'restricted':
      return 'Restricted room'
    default:
      return 'Room'
  }
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
    <div className="cmRoomList">
      {rooms.map(room => {
        const active =
          room.id === selectedId

        return (
          <button
            key={room.id}
            type="button"
            className={`cmRoomRow${active ? ' active' : ''}`}
            aria-current={
              active
                ? 'page'
                : undefined
            }
            onClick={() => onSelect?.(room.id)}
          >
            <span
              className="cmRoomMark"
              aria-hidden="true"
            >
              #
            </span>

            <span className="cmRoomRowCopy">
              <strong>
                {room.title || 'Room'}
              </strong>

              <small>
                {roomKindLabel(room)}
              </small>
            </span>

            <span
              className="cmRoomChevron"
              aria-hidden="true"
            >
              ›
            </span>
          <span className="cmRoomRowSignals">
              {room.mentioned && (
                <span
                  className="cmRoomMention"
                  aria-label="Unread mention"
                  title="You were mentioned"
                >
                  @
                </span>
              )}

              {!!room.unread && (
                <span
                  className="cmRoomUnread"
                  aria-label={`${room.unread} unread messages`}
                >
                  {room.unread > 99
                    ? '99+'
                    : room.unread}
                </span>
              )}
            </span>

            </button>
        )
      })}
    </div>
  )
}
