// The call this screen is actually in right now (empty when none). Lives in
// memory only, so a freshly opened or relaunched app never claims a call from
// before it was closed. Other parts of the app use it to tell a live call from
// one that was left behind when the app was swiped away.
let activeCallId = ''
const listeners = new Set<(id: string) => void>()

export function setActiveCallId(id: string) {
  if (id === activeCallId) return
  activeCallId = id
  listeners.forEach(listener => listener(id))
}

export function getActiveCallId() {
  return activeCallId
}

// Lets the ringing card step aside while the call screen is up, so the same
// call is never drawn twice. Returns the way to stop listening.
export function subscribeActiveCall(listener: (id: string) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
