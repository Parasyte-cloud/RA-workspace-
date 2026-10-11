import { supabase } from './supabase'

export type CallRoom = { room: { id: string; room_code: string; title: string } }

// Creates a private ROOM 7 room for a call. Same service ROOM 7 uses, with
// AI notes off. The caller is the host and joins it next.
export async function createCallRoom(title: string): Promise<CallRoom> {
  if (!supabase) throw new Error('Workspace authentication is not configured.')
  const { data, error } = await supabase.functions.invoke('room-session', {
    body: { action: 'create', title, ai_notes_enabled: false },
  })
  if (error) {
    const response = (error as { context?: unknown }).context
    if (response instanceof Response) {
      const body = await response.clone().json().catch(() => null)
      if (body && typeof body.error === 'string') throw new Error(body.error)
    }
    throw error
  }
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    throw new Error(data.error)
  }
  if (!data?.room?.room_code) throw new Error('ROOM 7 service returned an incomplete session.')
  return data as CallRoom
}

export const JOIN_ROOM_EVENT = 'ra:join-room'

export type JoinRoomDetail = { code: string; audioOnly: boolean }

export function requestJoinRoom(detail: JoinRoomDetail) {
  window.dispatchEvent(new CustomEvent<JoinRoomDetail>(JOIN_ROOM_EVENT, { detail }))
}
