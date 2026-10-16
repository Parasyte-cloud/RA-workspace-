// Pure helpers for Administration > Chat. No React, so they are testable.

export type AdminRoom = {
  conversation_id: string
  title: string
  room_type: string
  department: string | null
  description: string | null
  status: string
  problem: string | null
  active_members: number
  blocked_members: number
  last_message_at: string | null
}

export type AdminRoomMember = {
  user_id: string
  full_name: string | null
  email: string | null
  employee_role: string | null
  department: string | null
  profile_active: boolean
  room_role: 'member' | 'admin' | 'owner' | string
  joined_at: string | null
  removed_at: string | null
  can_post: boolean
  block_reason: string | null
}

export function roomNeedsAttention(room: AdminRoom): boolean {
  return !!room.problem || room.blocked_members > 0
}

export function roomSummary(rooms: AdminRoom[]) {
  return {
    total: rooms.length,
    archived: rooms.filter(room => room.status === 'archived').length,
    broken: rooms.filter(room => !!room.problem).length,
    withBlocked: rooms.filter(room => room.blocked_members > 0).length,
  }
}

export function filterRooms(rooms: AdminRoom[], query: string, onlyProblems: boolean): AdminRoom[] {
  const q = query.trim().toLowerCase()
  return rooms.filter(room => {
    if (onlyProblems && !roomNeedsAttention(room)) return false
    if (!q) return true
    return `${room.title} ${room.room_type} ${room.department || ''}`.toLowerCase().includes(q)
  })
}

// Plain words for the error a member sees when they cannot post.
export function explainWriteError(message: string): string {
  if (/write access required/i.test(message)) {
    return 'You can see this room but you are not allowed to post in it right now. It may be archived, or your membership may have been removed. Ask a Chat administrator to check it in Administration, Chat.'
  }
  if (/too quickly/i.test(message)) return 'You are sending messages too quickly. Wait a few seconds and try again.'
  return message
}

export function roleLabel(role: string): string {
  return role === 'owner' ? 'Owner' : role === 'admin' ? 'Room admin' : 'Member'
}

export function typeLabel(type: string): string {
  switch (type) {
    case 'department': return 'Department'
    case 'project': return 'Project'
    case 'committee': return 'Committee'
    case 'restricted': return 'Restricted'
    default: return type
  }
}
