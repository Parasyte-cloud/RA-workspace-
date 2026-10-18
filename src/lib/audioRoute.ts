/*
 * Where call sound comes out: the earpiece ("Phone") or the loudspeaker.
 *
 * iPhone Safari and the installed app cannot list outputs, but they have the
 * Audio Session API: "play-and-record" is a phone call (sound from the
 * earpiece, held to the ear) and "playback" is media (the loudspeaker).
 * Without it, call sound goes to the loudspeaker, which is what made the
 * earpiece unusable. A headset or Bluetooth device always wins when connected:
 * the phone routes to it by itself.
 *
 * Browsers that list outputs (Chrome, Edge, Android) use the device list
 * instead, handled by the call screen.
 */

import { getActiveCallId } from './activeCall'

export type Route = 'phone' | 'speaker'

type AudioSessionLike = {
  type: string
  state?: string
  addEventListener?: (name: string, handler: () => void) => void
  removeEventListener?: (name: string, handler: () => void) => void
}

function session(): AudioSessionLike | null {
  const found = typeof navigator !== 'undefined' ? (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession : undefined
  return found && 'type' in found ? found : null
}

export function canRoute(): boolean {
  return session() !== null
}

// A voice call is held to the ear; a video call is looked at, so it plays out loud.
export function defaultRoute(voice: boolean): Route {
  return voice ? 'phone' : 'speaker'
}

export function applyRoute(route: Route): boolean {
  const audio = session()
  if (!audio) return false
  try {
    audio.type = route === 'phone' ? 'play-and-record' : 'playback'
    return true
  } catch {
    return false
  }
}

export function releaseRoute() {
  const audio = session()
  try { if (audio) audio.type = 'auto' } catch { /* nothing to release */ }
}

export function routeType(route: Route): string {
  return route === 'phone' ? 'play-and-record' : 'playback'
}

// Sets the route only when the phone has drifted from it. iOS quietly puts the
// session back to its own choice whenever the microphone restarts (mute and
// unmute, a camera switch, a Siri or phone-call interruption), so applying the
// route once at the start of a call is not enough.
export function reassertRoute(route: Route): boolean {
  const audio = session()
  if (!audio) return false
  if (audio.type === routeType(route)) return false
  return applyRoute(route)
}

// Keeps a call on its chosen route for as long as the call lasts: whenever the
// phone reports the session changed, the page comes back to the front, and on a
// slow beat as a safety net. Returns a function that stops watching.
export function watchRoute(getRoute: () => Route, everyMs = 4000): () => void {
  if (!session() || typeof document === 'undefined') return () => {}
  const check = () => { reassertRoute(getRoute()) }
  const audio = session()
  audio?.addEventListener?.('statechange', check)
  const onVisible = () => { if (document.visibilityState === 'visible') check() }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pageshow', check)
  const timer = window.setInterval(check, everyMs)
  return () => {
    audio?.removeEventListener?.('statechange', check)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pageshow', check)
    window.clearInterval(timer)
  }
}

/*
 * Ring and message sounds on a phone that is on silent.
 *
 * The browser's audio engine follows the ring/silent switch on iPhone, so with
 * the switch down a call rang with no sound at all. Setting the audio session to
 * "playback" while a ring or message sound plays makes it audible, like a
 * media app, and is put back to "auto" afterwards. It is skipped during a call,
 * where the call screen owns the route. Per device, on by default, and the
 * person can turn it off in Settings.
 */
const SILENT_KEY = 'ra-sound-on-silent'

export function playOnSilentAllowed(): boolean {
  try { return window.localStorage.getItem(SILENT_KEY) !== '0' } catch { return true }
}

export function setPlayOnSilent(on: boolean) {
  try { window.localStorage.setItem(SILENT_KEY, on ? '1' : '0') } catch { /* lasts until reload */ }
}

let holds = 0
let held = false

// Call before playing a sound; call the returned function when it has finished.
export function holdPlayback(): () => void {
  const audio = session()
  if (!audio || !playOnSilentAllowed() || getActiveCallId()) return () => {}
  holds += 1
  if (!held) {
    try { audio.type = 'playback'; held = true } catch { /* the browser refused; sound still tries */ }
  }
  let done = false
  return () => {
    if (done) return
    done = true
    holds = Math.max(0, holds - 1)
    if (holds === 0 && held) {
      held = false
      // A call that started meanwhile has chosen its own route: leave it.
      if (!getActiveCallId()) { try { audio.type = 'auto' } catch { /* nothing to restore */ } }
    }
  }
}

// The same output listed twice (a default entry and the real one) is one choice.
export function uniqueOutputs<T extends { label?: string; groupId?: string; deviceId: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const device of list) {
    if (device.deviceId === 'default' || device.deviceId === 'communications') continue
    const key = (device.label || device.deviceId).toLowerCase().replace(/^(default|communications)\s*-\s*/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(device)
  }
  return out.length ? out : [...list].slice(0, 1)
}
