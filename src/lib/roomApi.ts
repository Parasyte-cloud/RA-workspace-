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

// Closes a call room that never became a call (for example the ring could not
// be started). Best effort: the database also closes call rooms by itself.
export async function endCallRoom(roomId: string) {
  if (!supabase) return
  await supabase.functions.invoke('room-session', { body: { action: 'end', room_id: roomId } }).catch(() => {})
}

export const JOIN_ROOM_EVENT = 'ra:join-room'

// callId ties the room to a chat call, so ending one ends the other.
// inPlace keeps the person where they are (for example in Chat): the call
// opens as a small window over the page instead of taking over the screen.
export type JoinRoomDetail = { code: string; audioOnly: boolean; callId?: string; inPlace?: boolean }

// Sent when a chat call is over from the other side (declined, no answer,
// cancelled, or hung up), so the call window can close by itself.
export const CALL_FINISHED_EVENT = 'ra:call-finished'

export type CallFinishedDetail = { callId: string; status: string }

// Sent to the caller's call window the moment the other person answers, so it
// can start waiting for them to arrive.
export const CALL_ACCEPTED_EVENT = 'ra:call-accepted'

export function announceCallAccepted(detail: { callId: string }) {
  window.dispatchEvent(new CustomEvent<{ callId: string }>(CALL_ACCEPTED_EVENT, { detail }))
}

export function announceCallFinished(detail: CallFinishedDetail) {
  window.dispatchEvent(new CustomEvent<CallFinishedDetail>(CALL_FINISHED_EVENT, { detail }))
}

export function requestJoinRoom(detail: JoinRoomDetail) {
  window.dispatchEvent(new CustomEvent<JoinRoomDetail>(JOIN_ROOM_EVENT, { detail }))
}
