import { useEffect, useState } from 'react'
import { Volume2, X } from 'lucide-react'
import { SOUND_BLOCKED_EVENT, audioBlocked, ensureAudioRunning, primeAudio } from '../lib/ringtone'
import { readChatPrefs, saveChatPrefs, previewChatSound } from '../lib/chatSound'
import PhoneAlertsToggle from './PhoneAlertsToggle'
import './sound-on-prompt.css'

const SEEN = 'ra-sound-prompt-v1'
const LAST = 'ra-sound-prompt-at'
// A message sound that was blocked brings the prompt back, but no more than
// once a day, so it never nags.
const REASK_MS = 24 * 60 * 60 * 1000

function alreadyAnswered() {
  try { return window.localStorage.getItem(SEEN) === '1' } catch { return false }
}
function markAnswered() {
  try {
    window.localStorage.setItem(SEEN, '1')
    window.localStorage.setItem(LAST, String(Date.now()))
  } catch { /* lasts until reload */ }
}
function askedRecently() {
  try { return Date.now() - Number(window.localStorage.getItem(LAST) || 0) < REASK_MS } catch { return true }
}

// First sign-in on a device: browsers keep sound locked until the person taps
// something, so a new install is silent unless we ask. One tap turns message
// sound on, unlocks audio for calls, and plays the sound so they hear it works.
export default function SoundOnPrompt() {
  const [open, setOpen] = useState(false)
  const [played, setPlayed] = useState<boolean | null>(null)

  useEffect(() => {
    if (alreadyAnswered()) return
    const id = window.setTimeout(() => setOpen(true), 1200)
    return () => window.clearTimeout(id)
  }, [])

  // Sound went quiet again (the phone pauses it when the app is backgrounded):
  // one tap brings it back, so ask for that tap when a message could not play.
  useEffect(() => {
    const onBlocked = () => { if (audioBlocked() && !askedRecently()) { setPlayed(null); setOpen(true) } }
    window.addEventListener(SOUND_BLOCKED_EVENT, onBlocked)
    return () => window.removeEventListener(SOUND_BLOCKED_EVENT, onBlocked)
  }, [])

  if (!open) return null

  const close = () => { markAnswered(); setOpen(false) }

  const turnOn = async () => {
    // Inside the tap itself, before anything is awaited: iPhone only honours
    // the unlock when it is started synchronously by the gesture.
    primeAudio()
    const prefs = { ...readChatPrefs(), enabled: true }
    saveChatPrefs(prefs)
    markAnswered()
    const running = await ensureAudioRunning()
    const ok = running && previewChatSound(prefs.sound, prefs.volume)
    setPlayed(ok)
    if (ok) window.setTimeout(() => setOpen(false), 1600)
  }

  return (
    <div className="soundPrompt" role="dialog" aria-label="Turn sound on">
      <button type="button" className="soundPromptClose" onClick={close} aria-label="Not now"><X size={16} /></button>
      <div className="soundPromptHead">
        <Volume2 size={22} />
        <div>
          <strong>Turn sound on</strong>
          <p>Hear new messages and incoming calls. Your phone needs one tap to allow it.</p>
        </div>
      </div>
      {played === false && <p className="soundPromptWarn">Still silent. Check the volume and the silent switch, then tap again.</p>}
      {played === true && <p className="soundPromptOk">Sound is on. You can change it in Settings.</p>}
      <div className="soundPromptActions">
        <button type="button" className="primaryButton" onClick={() => void turnOn()}><Volume2 size={15} /> Turn sound on</button>
        <button type="button" className="glassButton" onClick={close}>Not now</button>
      </div>
      <div className="soundPromptAlerts"><PhoneAlertsToggle /></div>
    </div>
  )
}
