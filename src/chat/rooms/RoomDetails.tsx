import type {
  ConversationSummary,
} from '../types'
import type {
  RoomCandidate,
  RoomMember,
} from './RoomMembers'
import {
  RoomAdminPanel,
} from './RoomAdminPanel'

type RoomDetailsProps = {
  room: ConversationSummary
  members?: RoomMember[]
  candidates?: RoomCandidate[]
  canAdministerRoom?: boolean
  isGlobalChatAdmin?: boolean
  onClose?: () => void
  onChanged?: () => void
  onArchived?: () => void
}

export function RoomDetails({
  room,
  members = [],
  candidates = [],
  canAdministerRoom = false,
  isGlobalChatAdmin = false,
  onClose,
  onChanged,
  onArchived,
}: RoomDetailsProps) {
  return (
    <aside className="cmDetails">
      <header className="cmDetailsHead">
        <div>
          <small>
            {room.conversation_kind}
          </small>
          <h2>
            {room.title || 'Room'}
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close room details"
        >
          Close
        </button>
      </header>

      <RoomAdminPanel
        conversationId={room.id}
        roomType={
          room.conversation_kind
        }
        members={members}
        candidates={candidates}
        canAdministerRoom={
          canAdministerRoom
        }
        isGlobalChatAdmin={
          isGlobalChatAdmin
        }
        onChanged={onChanged}
        onArchived={onArchived}
      />
    </aside>
  )
}
