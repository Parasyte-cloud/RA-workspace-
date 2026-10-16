/*
 * The sound a chat message makes. Separate from the call ringtone, with its own
 * choice, volume and on/off, kept on this device (a phone and a laptop can
 * differ). Plain tones from the browser's audio engine, no files to host.
 *
 * It only plays while the workspace is open. With the app closed or the screen
 * asleep, the phone's own notification does the work (see public/sw.js).
 */
import type { Pattern } from './ringtone'
import { playPatternOnce } from './ringtone'

const t = (at: number, dur: number, f: number, gain = 0.2, decay = true) => ({ at, dur, freqs: [f], gain, decay })

export type ChatSoundId = 'pop' | 'drop' | 'ding' | 'knock' | 'bubble' | 'whistle'

export const CHAT_SOUNDS: { id: ChatSoundId; label: string; hint: string; pattern: Pattern }[] = [
  { id: 'pop', label: 'Pop', hint: 'A quick soft pop (default)', pattern: { cycle: 0.5, tones: [t(0, 0.12, 880, 0.22), t(0.06, 0.14, 1320, 0.14)] } },
  { id: 'drop', label: 'Water drop', hint: 'A single bright drop', pattern: { cycle: 0.8, tones: [t(0, 0.35, 1175, 0.2), t(0.02, 0.5, 2350, 0.06)] } },
  { id: 'ding', label: 'Ding', hint: 'A clear two note ding', pattern: { cycle: 1, tones: [t(0, 0.45, 988, 0.2), t(0.14, 0.7, 1319, 0.18)] } },
  { id: 'knock', label: 'Knock', hint: 'Two wooden knocks', pattern: { cycle: 0.6, tones: [{ ...t(0, 0.09, 220, 0.3), wave: 'triangle' as const }, { ...t(0.16, 0.09, 196, 0.3), wave: 'triangle' as const }] } },
  { id: 'bubble', label: 'Bubble', hint: 'A rising bubble', pattern: { cycle: 0.7, tones: [t(0, 0.1, 520, 0.18), t(0.07, 0.1, 700, 0.18), t(0.14, 0.18, 960, 0.2)] } },
  { id: 'whistle', label: 'Whistle', hint: 'A short bird whistle', pattern: { cycle: 0.9, tones: [t(0, 0.18, 1568, 0.15), t(0.2, 0.28, 2093, 0.15)] } },
]

export const DEFAULT_CHAT_SOUND: ChatSoundId = 'pop'
export const DEFAULT_CHAT_VOLUME = 0.7
export const CHAT_VIBRATE = [180, 90, 180]

export type ChatSoundPrefs = { enabled: boolean; sound: ChatSoundId; volume: number; vibrate: boolean }

const KEY = 'ra-chat-sound'

export function isChatSoundId(value: unknown): value is ChatSoundId {
  return typeof value === 'string' && CHAT_SOUNDS.some(item => item.id === value)
}

export function chatSoundPattern(id: unknown): Pattern {
  return (CHAT_SOUNDS.find(item => item.id === id) ?? CHAT_SOUNDS[0]).pattern
}

export function clampChatVolume(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_CHAT_VOLUME
  return Math.min(1, Math.max(0.2, n))
}

export function normalizeChatPrefs(raw: unknown): ChatSoundPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: o.enabled !== false,
    sound: isChatSoundId(o.sound) ? o.sound : DEFAULT_CHAT_SOUND,
    volume: clampChatVolume(o.volume ?? DEFAULT_CHAT_VOLUME),
    vibrate: o.vibrate !== false,
  }
}

export function readChatPrefs(): ChatSoundPrefs {
  try {
    return normalizeChatPrefs(JSON.parse(window.localStorage.getItem(KEY) || '{}'))
  } catch {
    return normalizeChatPrefs({})
  }
}

export function saveChatPrefs(prefs: ChatSoundPrefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(normalizeChatPrefs(prefs)))
  } catch {
    /* storage can be blocked; the choice then lasts until reload */
  }
}

// Plays the chosen sound once. Call from a tap to preview it.
export function previewChatSound(sound: ChatSoundId, volume: number): boolean {
  return playPatternOnce(chatSoundPattern(sound), volume)
}

// A message arrived while the workspace is open. Sound if the browser allows
// it, and a short buzz on phones, unless the person turned either off.
export function playChatArrival(prefs: ChatSoundPrefs = readChatPrefs()) {
  if (!prefs.enabled) return
  const played = playPatternOnce(chatSoundPattern(prefs.sound), prefs.volume)
  if (prefs.vibrate && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(CHAT_VIBRATE)
    } catch {
      /* vibration is optional */
    }
  }
  return played
}

// Should a new chat notification make a sound? Not when the person is already
// looking at that very conversation. `openConversation` is the chat they have
// open (or empty) and `visible` is whether the page is in front.
export function shouldChatSound(entityId: string | null | undefined, openConversation: string, visible: boolean): boolean {
  if (visible && entityId && openConversation && entityId === openConversation) return false
  return true
}
