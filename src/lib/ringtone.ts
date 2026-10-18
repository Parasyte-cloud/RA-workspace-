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

import { holdPlayback } from './audioRoute'

export type Tone = {
  at: number
  dur: number
  freqs: number[]
  gain: number
  // Defaults: a plain sine that holds its level. "decay" instead fades the
  // note away like a struck bell or key.
  wave?: 'sine' | 'triangle' | 'square'
  decay?: boolean
}
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

const CLASSIC: Pattern = {
  cycle: 3.0,
  tones: [...phrase(0), ...phrase(1.0)],
}
export const INCOMING: Pattern = CLASSIC

// ---- Ringtone choices -------------------------------------------------------
// Every sound is made from plain tones (no audio files), so a new one is just
// data. Midnight Jazz is the default.

function cricket(): Pattern {
  const tones: Tone[] = []
  for (const group of [0, 0.42, 0.84]) {
    for (let i = 0; i < 4; i++) {
      tones.push({ at: group + i * 0.065, dur: 0.04, freqs: [4300], gain: 0.1 })
    }
  }
  return { cycle: 2.6, tones }
}

function bell(): Pattern {
  const strike = (at: number): Tone[] => [
    { at, dur: 1.3, freqs: [784], gain: 0.16, decay: true },
    { at, dur: 1.0, freqs: [2163], gain: 0.07, decay: true },
    { at, dur: 0.7, freqs: [4233], gain: 0.03, decay: true },
  ]
  // Overlapping strikes are the point of a bell, so this one is exempt from
  // the "tones never overlap" rule that the original ring keeps.
  return { cycle: 3.4, tones: [...strike(0), ...strike(1.5)] }
}

function telephone(): Pattern {
  const tones: Tone[] = []
  for (const burst of [0, 0.6]) {
    for (let i = 0; i < 9; i++) {
      tones.push({ at: burst + i * 0.05, dur: 0.04, freqs: [480, 620], gain: 0.1, wave: 'triangle' })
    }
  }
  return { cycle: 3.0, tones }
}

function chime(): Pattern {
  const notes = [523.25, 659.25, 783.99, 1046.5]
  return {
    cycle: 3.2,
    tones: notes.map((f, i) => ({ at: i * 0.22, dur: 0.9, freqs: [f], gain: 0.15, decay: true })),
  }
}

function marimba(): Pattern {
  const notes = [392, 494, 587, 494, 392, 587]
  return {
    cycle: 3.0,
    tones: notes.map((f, i) => ({ at: i * 0.16, dur: 0.28, freqs: [f], gain: 0.2, wave: 'triangle' as const, decay: true })),
  }
}

function digital(): Pattern {
  const tones: Tone[] = []
  for (let i = 0; i < 3; i++) tones.push({ at: i * 0.2, dur: 0.1, freqs: [988], gain: 0.1, wave: 'square' })
  for (let i = 0; i < 3; i++) tones.push({ at: 1.1 + i * 0.2, dur: 0.1, freqs: [988], gain: 0.1, wave: 'square' })
  return { cycle: 2.4, tones }
}


// ---- Jazz ---------------------------------------------------------------
// Soft electric-piano chords under a lazy, swung lead line. Notes are spelled
// out so a sound is only data.
function chordStab(at: number, dur: number, freqs: number[], gain: number): Tone {
  return { at, dur, freqs, gain, wave: 'triangle', decay: true }
}

function midnight(): Pattern {
  const lead = (at: number, dur: number, f: number, gain = 0.2): Tone => ({ at, dur, freqs: [f], gain, decay: true })
  return {
    cycle: 4.0,
    tones: [
      // Dm9, then G13, then Cmaj9: the classic ii V I.
      chordStab(0, 0.9, [293.66, 349.23, 440, 523.25], 0.09),
      lead(0.0, 0.32, 440),
      lead(0.4, 0.22, 523.25),
      lead(0.66, 0.34, 587.33),
      chordStab(1.1, 0.9, [293.66, 349.23, 493.88, 659.25], 0.09),
      lead(1.1, 0.32, 698.46),
      lead(1.5, 0.22, 659.25),
      lead(1.76, 0.3, 587.33),
      chordStab(2.2, 1.7, [329.63, 392, 493.88, 587.33], 0.09),
      lead(2.2, 1.6, 659.25, 0.22),
    ],
  }
}

function blueNote(): Pattern {
  const lead = (at: number, dur: number, f: number, gain = 0.2): Tone => ({ at, dur, freqs: [f], gain, decay: true })
  return {
    cycle: 3.8,
    tones: [
      // A bluesy climb in C minor, with the flat fifth leaning into the fifth.
      chordStab(0, 1.2, [261.63, 311.13, 392, 466.16], 0.09),
      lead(0.0, 0.34, 523.25),
      lead(0.36, 0.3, 622.25),
      lead(0.7, 0.3, 698.46),
      lead(1.04, 0.22, 739.99),
      lead(1.3, 1.1, 783.99, 0.22),
      chordStab(2.5, 1.2, [233.08, 293.66, 349.23, 415.3], 0.09),
      lead(2.6, 1.0, 932.33, 0.18),
    ],
  }
}

function lounge(): Pattern {
  // A slow walking bass line with brushed chords on the off beats.
  const walk = [196, 220, 246.94, 261.63, 246.94, 220]
  const bass: Tone[] = walk.map((f, i) => ({ at: i * 0.5, dur: 0.42, freqs: [f, f * 2], gain: 0.13, wave: 'triangle' as const, decay: true }))
  return {
    cycle: 3.6,
    tones: [
      ...bass,
      chordStab(0.25, 0.4, [329.63, 392, 493.88, 587.33], 0.07),
      chordStab(1.25, 0.4, [349.23, 440, 523.25, 659.25], 0.07),
      chordStab(2.25, 0.5, [329.63, 392, 493.88, 587.33], 0.07),
      { at: 3.0, dur: 0.5, freqs: [523.25], gain: 0.2, decay: true },
    ],
  }
}

export type RingtoneId = 'midnight' | 'bluenote' | 'lounge' | 'cricket' | 'bell' | 'telephone' | 'chime' | 'marimba' | 'digital' | 'classic'

export const RINGTONES: { id: RingtoneId; label: string; hint: string; pattern: Pattern }[] = [
  { id: 'midnight', label: 'Midnight Jazz', hint: 'Smoky piano chords and a lazy lead (default)', pattern: midnight() },
  { id: 'bluenote', label: 'Blue Note', hint: 'A bluesy climb in C minor', pattern: blueNote() },
  { id: 'lounge', label: 'Lounge', hint: 'Walking bass and soft chords', pattern: lounge() },
  { id: 'cricket', label: 'Cricket', hint: 'Soft evening chirps', pattern: cricket() },
  { id: 'bell', label: 'Bell', hint: 'Two clear bell strikes', pattern: bell() },
  { id: 'telephone', label: 'Telephone', hint: 'An old desk phone', pattern: telephone() },
  { id: 'chime', label: 'Chime', hint: 'Four rising notes', pattern: chime() },
  { id: 'marimba', label: 'Marimba', hint: 'A warm wooden tune', pattern: marimba() },
  { id: 'digital', label: 'Digital', hint: 'Short electronic beeps', pattern: digital() },
  { id: 'classic', label: 'Classic', hint: 'The original RideArrivo ring', pattern: CLASSIC },
]

export const DEFAULT_RINGTONE: RingtoneId = 'midnight'
export const DEFAULT_VOLUME = 0.8

export function isRingtoneId(value: unknown): value is RingtoneId {
  return typeof value === 'string' && RINGTONES.some(item => item.id === value)
}

export function ringtonePattern(id: unknown): Pattern {
  return (RINGTONES.find(item => item.id === id) ?? RINGTONES[0]).pattern
}

export function clampVolume(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_VOLUME
  return Math.min(1, Math.max(0.2, n))
}

const TONE_KEY = 'ra-ringtone'
const VOLUME_KEY = 'ra-ringtone-volume'

export function readRingtone(): RingtoneId {
  try {
    const value = window.localStorage.getItem(TONE_KEY)
    return isRingtoneId(value) ? value : DEFAULT_RINGTONE
  } catch {
    return DEFAULT_RINGTONE
  }
}

export function saveRingtone(id: RingtoneId) {
  try {
    window.localStorage.setItem(TONE_KEY, id)
  } catch {
    /* storage can be blocked; the choice then lasts until reload */
  }
}

export function readVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY)
    return raw === null ? DEFAULT_VOLUME : clampVolume(raw)
  } catch {
    return DEFAULT_VOLUME
  }
}

export function saveVolume(value: number) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(clampVolume(value)))
  } catch {
    /* see saveRingtone */
  }
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

// Safari reports a context it paused itself (a phone call, Siri, the screen
// locking) as "interrupted", which the standard type list does not know. Treat
// it like "suspended": it has to be resumed before it can make a sound.
function notRunning(ctx: AudioContext): boolean {
  return String(ctx.state) !== 'running'
}

function wake(ctx: AudioContext) {
  if (notRunning(ctx) && String(ctx.state) !== 'closed') void ctx.resume().catch(() => undefined)
}

export function audioBlocked(): boolean {
  const ctx = context()
  return !!ctx && notRunning(ctx)
}

// One silent sample played inside a real tap. Safari only treats the audio
// engine as unlocked once something has actually been started in a gesture.
function playSilentSample(ctx: AudioContext) {
  try {
    const source = ctx.createBufferSource()
    source.buffer = ctx.createBuffer(1, 1, 22050)
    source.connect(ctx.destination)
    source.start(0)
  } catch {
    /* the resume above is enough on other browsers */
  }
}

// Call from a click, tap or key press. Safe to call many times.
export function primeAudio() {
  const ctx = context()
  if (ctx) {
    wake(ctx)
    playSilentSample(ctx)
  }
  primed = true
}

let gestureWired = false

// Unlocks sound on a touch anywhere, so a call or message that arrives later
// can make a sound. The listeners stay for the life of the page: the phone
// pauses sound again whenever the app is backgrounded or the screen locks, and
// the next tap has to be able to bring it back. (They used to be removed after
// the first success, which left the app silent until it was reloaded.)
// "click", "touchend" and "pointerup" are the events iPhone counts as a tap;
// "touchstart" and "pointerdown" alone do not unlock sound there.
export function wireAudioUnlock() {
  if (gestureWired || typeof window === 'undefined') return
  gestureWired = true
  const unlock = () => { if (audioBlocked()) primeAudio() }
  for (const name of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown']) {
    window.addEventListener(name, unlock, { passive: true, capture: true })
  }
  // Coming back to the app: try to resume without waiting for a tap. Allowed
  // when the person has tapped before; otherwise the next tap does it.
  const refresh = () => {
    if (document.visibilityState === 'visible') { const ctx = context(); if (ctx) wake(ctx) }
  }
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('pageshow', refresh)
  window.addEventListener('focus', refresh)
}

function playCycle(ctx: AudioContext, pattern: Pattern, volume = 1) {
  const base = ctx.currentTime + 0.02
  for (const tone of pattern.tones) {
    for (const freq of tone.freqs) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = tone.wave ?? 'sine'
      osc.frequency.value = freq
      const start = base + tone.at
      const end = start + tone.dur
      const level = tone.gain * volume
      gain.gain.setValueAtTime(0.0001, start)
      if (tone.decay) {
        // A quick attack, then a smooth fade to silence.
        gain.gain.linearRampToValueAtTime(level, start + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, end)
      } else {
        // Short fade in and out so the tone never clicks.
        const fade = Math.min(0.02, tone.dur / 3)
        gain.gain.linearRampToValueAtTime(level, start + fade)
        gain.gain.setValueAtTime(level, Math.max(start + fade, end - fade * 2))
        gain.gain.linearRampToValueAtTime(0.0001, end)
      }
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
  const pattern = kind === 'incoming' ? ringtonePattern(readRingtone()) : RINGBACK
  const volume = kind === 'incoming' ? readVolume() : 1
  let stopped = false
  let timer = 0
  const release = holdPlayback()

  const tick = () => {
    if (stopped) return
    const ctx = context()
    if (ctx) wake(ctx)
    const blocked = !ctx || notRunning(ctx)
    onBlocked?.(blocked)
    if (ctx && !blocked) {
      try {
        playCycle(ctx, pattern, volume)
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
    release()
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

// Plays a pattern once (a message sound). Returns false when the browser is
// still keeping sound off, so the caller can fall back to a buzz.
export function playPatternOnce(pattern: Pattern, volume: number): boolean {
  const ctx = context()
  if (!ctx) return false
  wake(ctx)
  if (notRunning(ctx)) return false
  const release = holdPlayback()
  try {
    playCycle(ctx, pattern, clampVolume(volume))
    // Give the sound its full length (a bell rings past its cycle) before the
    // phone goes back to normal.
    const end = pattern.tones.reduce((latest, tone) => Math.max(latest, tone.at + tone.dur), 0)
    window.setTimeout(release, (end + 0.4) * 1000)
    return true
  } catch {
    release()
    return false
  }
}

export const hasBeenPrimed = () => primed

// Resolves true once the audio engine is really running. resume() is
// asynchronous, so a sound started in the same breath as the tap that unlocked
// it can find the engine still waking up and wrongly report "blocked".
export async function ensureAudioRunning(): Promise<boolean> {
  const ctx = context()
  if (!ctx) return false
  primed = true
  try {
    if (notRunning(ctx)) await ctx.resume()
    playSilentSample(ctx)
  } catch {
    /* the state check below decides */
  }
  return !notRunning(ctx)
}

// Raised when a sound could not play because the browser still keeps audio off.
export const SOUND_BLOCKED_EVENT = 'ra:sound-blocked'

// What the self-check in Settings shows: is sound ready on this device?
export function soundStatus(): { supported: boolean; running: boolean; state: string } {
  const ctx = context()
  return { supported: !!ctx, running: !!ctx && !notRunning(ctx), state: ctx ? String(ctx.state) : 'unsupported' }
}

// Plays one round of a ringtone so it can be heard before it is chosen.
// Call from a tap. Resolves to false when the browser still blocks sound.
export async function previewRingtone(id: RingtoneId, volume = readVolume()): Promise<boolean> {
  const ctx = context()
  if (!ctx) return false
  primed = true
  try {
    if (notRunning(ctx)) await ctx.resume()
    if (notRunning(ctx)) return false
    return playPatternOnce(ringtonePattern(id), volume)
  } catch {
    return false
  }
}
