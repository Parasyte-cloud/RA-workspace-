import type {
  RoomCandidate,
  RoomMember,
} from './RoomMembers'
import {
  RoomMembers,
} from './RoomMembers'
import {
  RoomSettings,
} from './RoomSettings'

type RoomAdminPanelProps = {
  conversationId: string
  roomType: string
  members: RoomMember[]
  candidates?: RoomCandidate[]
  canAdministerRoom: boolean
  isGlobalChatAdmin: boolean
  onChanged?: () => void
  onArchived?: () => void
}

export function RoomAdminPanel({
  conversationId,
  roomType,
  members,
  candidates = [],
  canAdministerRoom,
  isGlobalChatAdmin,
  onChanged,
  onArchived,
}: RoomAdminPanelProps) {
  const isDepartmentRoom =
    roomType === 'department'

  const canSeeAdministration =
    canAdministerRoom ||
    isGlobalChatAdmin

  return (
    <div className="cmRoomAdminPanel">
      {canSeeAdministration &&
        isDepartmentRoom && (
          <p className="cmRoomAdminNote">
            Department Room ownership is managed by
            the department synchronization lifecycle.
            Global Chat administration remains the
            authority boundary for structural
            Department Room actions.
          </p>
        )}

      <RoomMembers
        conversationId={conversationId}
        members={members}
        candidates={candidates}
        canAdministerRoom={
          canAdministerRoom
        }
        membershipManagedByDepartment={
          isDepartmentRoom
        }
        onChanged={onChanged}
      />

      {canSeeAdministration && (
        <RoomSettings
          conversationId={conversationId}
          roomType={roomType}
          canAdministerRoom={
            canAdministerRoom
          }
          isGlobalChatAdmin={
            isGlobalChatAdmin
          }
          onArchived={onArchived}
        />
      )}
    </div>
  )
}
