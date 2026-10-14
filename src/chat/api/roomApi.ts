import { supabase } from '../../lib/supabase'
import type { ConversationKind } from '../types'

export type GovernedRoomKind =
  Extract<
    ConversationKind,
    'project' | 'committee' | 'restricted'
  >

export type RoomRole =
  'member' | 'admin' | 'owner'

export type RoomHistoryPolicy =
  'full' | 'from_join_date'

function client() {
  if (!supabase) {
    throw new Error(
      'The workspace database client is unavailable.',
    )
  }

  return supabase
}

export async function createRoom(input: {
  title: string
  roomType: GovernedRoomKind
  description?: string | null
  historyPolicy?: RoomHistoryPolicy
}) {
  const { data, error } =
    await client().rpc('create_chat_room', {
      p_title: input.title,
      p_room_type: input.roomType,
      p_description: input.description ?? null,
      p_history_policy:
        input.historyPolicy ?? 'full',
    })

  if (error) throw error

  return data as string
}

export async function addRoomMember(input: {
  conversationId: string
  employeeId: string
  roomRole?: Exclude<RoomRole, 'owner'>
}) {
  const { error } =
    await client().rpc(
      'add_chat_room_member',
      {
        p_conversation_id:
          input.conversationId,
        p_employee_id: input.employeeId,
        p_room_role:
          input.roomRole ?? 'member',
      },
    )

  if (error) throw error
}

export async function removeRoomMember(input: {
  conversationId: string
  employeeId: string
}) {
  const { error } =
    await client().rpc(
      'remove_chat_room_member',
      {
        p_conversation_id:
          input.conversationId,
        p_employee_id: input.employeeId,
      },
    )

  if (error) throw error
}

export async function setRoomMemberRole(input: {
  conversationId: string
  employeeId: string
  roomRole: RoomRole
}) {
  const { error } =
    await client().rpc(
      'set_chat_room_member_role',
      {
        p_conversation_id:
          input.conversationId,
        p_employee_id: input.employeeId,
        p_room_role: input.roomRole,
      },
    )

  if (error) throw error
}

export async function archiveRoom(
  conversationId: string,
) {
  const { error } =
    await client().rpc(
      'archive_chat_room',
      {
        p_conversation_id:
          conversationId,
      },
    )

  if (error) throw error
}
