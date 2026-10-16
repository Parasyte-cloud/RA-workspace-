import {
  useMemo,
  useState,
} from 'react'
import {
  addRoomMember,
  removeRoomMember,
  setMemberRemoveRight,
  setRoomMemberRole,
  type RoomRole,
} from '../api/roomApi'

export type RoomMember = {
  userId: string
  name: string
  email?: string
  roomRole: RoomRole
  canRemoveMembers?: boolean
}

export type RoomCandidate = {
  userId: string
  name: string
  email?: string
}

type RoomMembersProps = {
  conversationId: string
  members: RoomMember[]
  candidates?: RoomCandidate[]
  canAdministerRoom: boolean
  canRemoveMembers?: boolean
  currentUserId?: string
  membershipManagedByDepartment?: boolean
  onChanged?: () => void
}

export function RoomMembers({
  conversationId,
  members,
  candidates = [],
  canAdministerRoom,
  canRemoveMembers = false,
  currentUserId = '',
  membershipManagedByDepartment = false,
  onChanged,
}: RoomMembersProps) {
  const [candidateId, setCandidateId] =
    useState('')
  const [busyKey, setBusyKey] =
    useState('')
  const [error, setError] =
    useState('')
  const [confirmId, setConfirmId] =
    useState('')

  async function toggleRight(member: RoomMember) {
    setBusyKey(`right:${member.userId}`)
    setError('')
    try {
      await setMemberRemoveRight({
        conversationId,
        employeeId: member.userId,
        allowed: !member.canRemoveMembers,
      })
      onChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to change this right.')
    } finally {
      setBusyKey('')
    }
  }

  const availableCandidates =
    useMemo(() => {
      const memberIds =
        new Set(
          members.map(member => member.userId),
        )

      return candidates.filter(
        candidate =>
          !memberIds.has(candidate.userId),
      )
    }, [candidates, members])

  async function changeRole(
    member: RoomMember,
    roomRole: RoomRole,
  ) {
    setBusyKey(`role:${member.userId}`)
    setError('')

    try {
      await setRoomMemberRole({
        conversationId,
        employeeId: member.userId,
        roomRole,
      })

      onChanged?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to change member role.',
      )
    } finally {
      setBusyKey('')
    }
  }

  async function remove(
    member: RoomMember,
  ) {
    setBusyKey(`remove:${member.userId}`)
    setError('')

    try {
      await removeRoomMember({
        conversationId,
        employeeId: member.userId,
      })

      setConfirmId('')
      onChanged?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to remove room member.',
      )
    } finally {
      setBusyKey('')
    }
  }

  async function add() {
    if (!candidateId) return

    setBusyKey('add')
    setError('')

    try {
      await addRoomMember({
        conversationId,
        employeeId: candidateId,
        roomRole: 'member',
      })

      setCandidateId('')
      onChanged?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to add room member.',
      )
    } finally {
      setBusyKey('')
    }
  }

  return (
    <section className="cmRoomMembers">
      <div className="cmRoomSectionHead">
        <div>
          <h3>Members</h3>
          <small>
            {members.length}{' '}
            {members.length === 1
              ? 'member'
              : 'members'}
          </small>
        </div>
      </div>

      {membershipManagedByDepartment && (
        <p className="cmRoomAdminNote">
          Membership in this Department Room is
          synchronized from active department
          assignments. Manual member additions and
          removals are disabled here.
        </p>
      )}

      {error && (
        <p
          className="cmRoomError"
          role="alert"
        >
          {error}
        </p>
      )}

      {canAdministerRoom &&
        !membershipManagedByDepartment && (
          <div className="cmRoomAddMember">
            <select
              value={candidateId}
              aria-label="Employee to add"
              onChange={event =>
                setCandidateId(
                  event.target.value,
                )
              }
            >
              <option value="">
                Select employee
              </option>

              {availableCandidates.map(
                candidate => (
                  <option
                    key={candidate.userId}
                    value={candidate.userId}
                  >
                    {candidate.name}
                    {candidate.email
                      ? ` · ${candidate.email}`
                      : ''}
                  </option>
                ),
              )}
            </select>

            <button
              type="button"
              disabled={
                !candidateId ||
                busyKey === 'add'
              }
              onClick={() => void add()}
            >
              {busyKey === 'add'
                ? 'Adding...'
                : 'Add member'}
            </button>
          </div>
        )}

      {members.length === 0 && (
        <p>No active room members.</p>
      )}

      {members.map(member => {
        const changingRole =
          busyKey === `role:${member.userId}`
        const removing =
          busyKey === `remove:${member.userId}`

        return (
          <div
            key={member.userId}
            className="cmRoomMember"
          >
            <div>
              <strong>{member.name}</strong>

              {member.email && (
                <small>{member.email}</small>
              )}
            </div>

            <span>{member.roomRole}</span>

            {canAdministerRoom && (
              <div>
                <select
                  aria-label={`Role for ${member.name}`}
                  value={member.roomRole}
                  disabled={
                    changingRole ||
                    removing
                  }
                  onChange={event =>
                    void changeRole(
                      member,
                      event.target
                        .value as RoomRole,
                    )
                  }
                >
                  <option value="member">
                    Member
                  </option>
                  <option value="admin">
                    Admin
                  </option>
                  <option value="owner">
                    Owner
                  </option>
                </select>

                {member.roomRole === 'member' && (
                  <label className="cmRoomRight">
                    <input
                      type="checkbox"
                      checked={member.canRemoveMembers === true}
                      disabled={changingRole || removing || busyKey === `right:${member.userId}`}
                      onChange={() => void toggleRight(member)}
                    />
                    Can remove members
                  </label>
                )}
              </div>
            )}

            {canRemoveMembers &&
              !membershipManagedByDepartment &&
              member.userId !== currentUserId &&
              (canAdministerRoom || member.roomRole === 'member') && (
                <div className="cmRoomRemove">
                  {confirmId === member.userId ? (
                    <>
                      <span>Remove {member.name} from this room?</span>
                      <button type="button" className="danger" disabled={removing} onClick={() => void remove(member)}>
                        {removing ? 'Removing...' : 'Yes, remove'}
                      </button>
                      <button type="button" disabled={removing} onClick={() => setConfirmId('')}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={removing} onClick={() => setConfirmId(member.userId)}>
                      Remove
                    </button>
                  )}
                </div>
              )}
          </div>
        )
      })}
    </section>
  )
}
