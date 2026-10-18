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

export type Route = 'phone' | 'speaker'

type AudioSessionLike = { type: string }

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
