// Chat calls use a FaceTime-style screen. Anyone who has trouble with it can
// switch back to the classic ROOM 7 call screen in Settings (per device).
const KEY = 'ra-call-classic'

export function classicCall(): boolean {
  try { return window.localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setClassicCall(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, '1')
    else window.localStorage.removeItem(KEY)
  } catch { /* storage blocked: the default screen stays */ }
}
