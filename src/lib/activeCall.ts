// The call this screen is actually in right now (empty when none). Lives in
// memory only, so a freshly opened or relaunched app never claims a call from
// before it was closed. Other parts of the app use it to tell a live call from
// one that was left behind when the app was swiped away.
let activeCallId = ''

export function setActiveCallId(id: string) {
  activeCallId = id
}

export function getActiveCallId() {
  return activeCallId
}
