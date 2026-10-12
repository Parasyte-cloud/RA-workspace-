/*
 * Phone sounds for calls, made with the browser's own audio engine so there
 * is no sound file to download or host.
 *
 * Incoming: a short rising phrase, twice, then a pause, repeating (a ringing
 * phone). Ringback: the steady tone a caller hears while the other phone
 * rings. Both are plain data (see the patterns below) so they can be tested.
 *
 * Browsers refuse to play sound until the person has touched the page once.
 * primeAudio() is wired to the first click, tap or key press, and the player
 * reports when sound is still blocked so the screen can say so.
 */

export type Tone = { at: number; dur: number; freqs: number[]; gain: number }
export type Pattern = { cycle: number; tones: Tone[] }

const E5 = 659.25
const G5 = 783.99
const A5 = 880

function phrase(start: number): Tone[] {
  return [
    { at: start, dur: 0.14, freqs: [E5], gain: 0.16 },
    { at: start + 0.18, dur: 0.14, freqs: [G5], gain: 0.16 },
    { at: start + 0.36, dur: 0.3, freqs: [A5], gain: 0.18 },
  ]
}

export const INCOMING: Pattern = {
  cycle: 3.0,
  tones: [...phrase(0), ...phrase(1.0)],
}

// 425 Hz for one second, then three seconds of quiet.
export const RINGBACK: Pattern = {
  cycle: 4.0,
  tones: [{ at: 0, dur: 1.0, freqs: [425], gain: 0.1 }],
}

export const VIBRATE_INCOMING = [400, 200, 400, 1800]

let sharedContext: AudioContext | null = null
let primed = false

function context(): AudioContext | null {
  try {
    if (!sharedContext) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      sharedContext = new Ctor()
    }
    return sharedContext
  } catch {
    return null
  }
}

export function audioBlocked(): boolean {
  const ctx = context()
  return !!ctx && ctx.state !== 'running'
}

// Call from a click, tap or key press. Safe to call many times.
export function primeAudio() {
  const ctx = context()
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  primed = true
}

let gestureWired = false

// Unlocks sound on the first touch anywhere, so a call that arrives later can ring.
export function wireAudioUnlock() {
  if (gestureWired || typeof window === 'undefined') return
  gestureWired = true
  const unlock = () => {
    primeAudio()
    if (!audioBlocked()) {
      for (const name of ['pointerdown', 'keydown', 'touchstart']) {
        window.removeEventListener(name, unlock)
      }
    }
  }
  for (const name of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(name, unlock, { passive: true })
  }
}

function playCycle(ctx: AudioContext, pattern: Pattern) {
  const base = ctx.currentTime + 0.02
  for (const tone of pattern.tones) {
    for (const freq of tone.freqs) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = base + tone.at
      const end = start + tone.dur
      // Short fade in and out so the tone never clicks.
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.linearRampToValueAtTime(tone.gain, start + 0.02)
      gain.gain.setValueAtTime(tone.gain, Math.max(start + 0.02, end - 0.04))
      gain.gain.linearRampToValueAtTime(0.0001, end)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(end + 0.02)
    }
  }
}

// Starts a repeating tone. Returns a function that stops it. onBlocked is told
// whether the browser is still refusing sound, so the screen can explain.
export function startTone(
  kind: 'incoming' | 'ringback',
  onBlocked?: (blocked: boolean) => void,
): () => void {
  const pattern = kind === 'incoming' ? INCOMING : RINGBACK
  let stopped = false
  let timer = 0

  const tick = () => {
    if (stopped) return
    const ctx = context()
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    const blocked = !ctx || ctx.state !== 'running'
    onBlocked?.(blocked)
    if (ctx && !blocked) {
      try {
        playCycle(ctx, pattern)
      } catch {
        /* no sound this round; the banner is still on screen */
      }
    }
    if (kind === 'incoming' && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(VIBRATE_INCOMING)
      } catch {
        /* vibration is optional */
      }
    }
  }

  tick()
  timer = window.setInterval(tick, pattern.cycle * 1000)

  return () => {
    stopped = true
    window.clearInterval(timer)
    if (kind === 'incoming' && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(0)
      } catch {
        /* ignore */
      }
    }
    onBlocked?.(false)
  }
}

export const hasBeenPrimed = () => primed
