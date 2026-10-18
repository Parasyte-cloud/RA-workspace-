// What to tell the database when this phone hangs up.
//
// respond_chat_call only lets the caller 'cancel' a call that is still
// ringing, and only lets 'ended' close a call that was answered. Hanging up
// with 'ended' alone therefore left a ringing call ringing on the other phone
// after the caller pressed End. Each status is a harmless no-op in the wrong
// state, so the caller sends both and the right one lands.
export type CallRole = 'host' | 'member' | 'unknown'

export function hangUpStatuses(role: CallRole): Array<'cancelled' | 'ended'> {
  // The person being called cannot cancel (the database refuses), so skip it.
  return role === 'member' ? ['ended'] : ['cancelled', 'ended']
}

type Rpc = (fn: 'respond_chat_call', args: { p_call: string; p_status: string }) => PromiseLike<unknown>

export async function hangUpCall(rpc: Rpc, callId: string, role: CallRole) {
  for (const status of hangUpStatuses(role)) {
    try { await rpc('respond_chat_call', { p_call: callId, p_status: status }) } catch { /* the other status may still land */ }
  }
}
