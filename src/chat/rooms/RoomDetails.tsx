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

function memberInitials(name: string) {
  const parts =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)

  return (
    parts
      .map(part => part.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

function roomTypeLabel(
  room: ConversationSummary,
) {
  const type =
    room.conversation_kind

  return (
    `${type.charAt(0).toUpperCase()}${type.slice(1)} room`
  )
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
            {roomTypeLabel(room)}
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

      <section className="cmRoomDetailsSummary">
        <div className="cmRoomDetailsMark">
          #
        </div>

        <div className="cmRoomDetailsSummaryCopy">
          <strong>
            {room.title || 'Room'}
          </strong>

          <span>
            {roomTypeLabel(room)}
          </span>

          <small>
            {members.length}{' '}
            {members.length === 1
              ? 'active member'
              : 'active members'}
          </small>
        </div>

        {members.length > 0 && (
          <div
            className="cmRoomDetailsAvatars"
            aria-label={`${members.length} active room members`}
          >
            {members.slice(0, 4).map(member => (
              <span
                key={member.userId}
                className="cmRoomDetailsAvatar"
                title={`${member.name} · ${member.roomRole}`}
              >
                {memberInitials(member.name)}
              </span>
            ))}

            {members.length > 4 && (
              <span className="cmRoomDetailsAvatar cmRoomDetailsMore">
                +{members.length - 4}
              </span>
            )}
          </div>
        )}
      </section>

      {room.conversation_kind === 'department' && (
        <div className="cmRoomManagedBadge">
          Department membership is managed automatically
        </div>
      )}

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
