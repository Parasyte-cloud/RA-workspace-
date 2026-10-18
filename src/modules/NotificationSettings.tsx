import { useEffect, useState } from 'react'
import { LOCATION_REQUEST_EVENT, LOCATION_STATE_EVENT } from '../components/DevicePresence'
import { beatEnabled, funAllowed, reduceMotion, setBeatEnabled, setFunChoice } from '../lib/islandMotion'
import { BellRing, LogOut, MapPin, MessageCircle, Phone, Play, Sparkles, Volume2 } from 'lucide-react'
import { classicCall, setClassicCall } from '../lib/callStyle'
import PhoneAlertsToggle from '../components/PhoneAlertsToggle'
import AlertPreferences from '../components/AlertPreferences'
import { moveSession, readKeepSignedIn } from '../lib/keepSignedIn'
import { AUTH_STORAGE_KEY } from '../lib/supabase'
import {
  RINGTONES,
  ensureAudioRunning,
  previewRingtone,
  readRingtone,
  readVolume,
  saveRingtone,
  saveVolume,
} from '../lib/ringtone'
import type { RingtoneId } from '../lib/ringtone'
import { CHAT_SOUNDS, previewChatSound, readChatPrefs, saveChatPrefs } from '../lib/chatSound'
import { canRoute, playOnSilentAllowed, setPlayOnSilent } from '../lib/audioRoute'
import CallRingCheck from '../components/CallRingCheck'
import type { ChatSoundId, ChatSoundPrefs } from '../lib/chatSound'

// Settings card for sounds and alerts. The ringtone is kept on this device, so
// a phone and a laptop can ring differently.
export function NotificationSettings({ onSignOut, onSignOutEverywhere }: { onSignOut?: () => void; onSignOutEverywhere?: () => void }) {
  const [tone, setTone] = useState<RingtoneId>(() => readRingtone())
  const [volume, setVolume] = useState(() => readVolume())
  const [note, setNote] = useState('')
  const [testNote, setTestNote] = useState('')
  const [chat, setChat] = useState<ChatSoundPrefs>(() => readChatPrefs())
  const [chatNote, setChatNote] = useState('')
  const [locShared, setLocShared] = useState(() => (window.localStorage.getItem('ridearrivo-location-sharing') ?? '').startsWith('granted:'))
  useEffect(() => {
    const onState = (event: Event) => setLocShared(Boolean((event as CustomEvent<{ shared: boolean }>).detail?.shared))
    window.addEventListener(LOCATION_STATE_EVENT, onState)
    return () => window.removeEventListener(LOCATION_STATE_EVENT, onState)
  }, [])
  const changeLocation = (next: boolean) => {
    setLocShared(next)
    window.dispatchEvent(new CustomEvent(LOCATION_REQUEST_EVENT, { detail: next }))
  }
  const [onSilent, setOnSilent] = useState(() => playOnSilentAllowed())
  const [fun, setFun] = useState(() => funAllowed())
  const [beat, setBeat] = useState(() => beatEnabled())
  const [classic, setClassic] = useState(() => classicCall())
  const [systemReduce] = useState(() => reduceMotion())
  const changeFun = (next: boolean) => {
    setFun(next)
    setFunChoice(next ? 'always' : 'off')
  }
  const changeBeat = (next: boolean) => {
    setBeat(next)
    setBeatEnabled(next)
  }
  const [keep, setKeep] = useState(() => readKeepSignedIn(window.localStorage))
  const changeKeep = (next: boolean) => {
    setKeep(next)
    moveSession(window.localStorage, window.sessionStorage, AUTH_STORAGE_KEY, next)
  }

  const updateChat = (patch: Partial<ChatSoundPrefs>) => {
    const next = { ...chat, ...patch }
    setChat(next)
    saveChatPrefs(next)
  }
  const pickChat = async (id: ChatSoundId) => {
    updateChat({ sound: id, enabled: true })
    const played = (await ensureAudioRunning()) && previewChatSound(id, chat.volume)
    setChatNote(played ? '' : 'Your browser is keeping sound off. Tap the page once, check the volume and silent switch, then try again.')
  }

  const pick = async (id: RingtoneId) => {
    setTone(id)
    saveRingtone(id)
    const played = await previewRingtone(id, volume)
    setNote(played ? '' : 'Your browser is keeping sound off. Tap the page once, check the volume and silent switch, then try again.')
  }

  const changeVolume = (value: number) => {
    setVolume(value)
    saveVolume(value)
  }

  const sendTest = async () => {
    setTestNote('')
    try {
      if (!('Notification' in window)) {
        setTestNote('This browser cannot show notifications.')
        return
      }
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      if (permission !== 'granted') {
        setTestNote('Notifications are not allowed for this site. Allow them in the browser or phone settings first.')
        return
      }
      const registration = await navigator.serviceWorker.ready
      await registration.showNotification('RideArrivo test', {
        body: 'If you can see this, alerts work on this device.',
        tag: 'ra-test',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      })
      setTestNote('Sent. Lock the screen or close the app to see how it arrives.')
    } catch {
      setTestNote('Could not show a test notification on this device.')
    }
  }

  return (
    <section className="appearanceSettings notificationSettings">
      <div className="appearanceHeading">
        <div>
          <span className="eyebrow">THIS DEVICE</span>
          <h2>Notifications and sound</h2>
          <p>Choose how incoming calls ring and make sure alerts reach you when the app is closed.</p>
        </div>
      </div>

      <div className="appearanceSettingsGrid">
        <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber"><BellRing size={16} /></span>
            <div>
              <h3>Alerts when the app is closed</h3>
              <p>Calls and messages arrive like any other app. On iPhone and iPad, add RideArrivo to your Home Screen first.</p>
            </div>
          </div>
          <PhoneAlertsToggle />
          <button type="button" className="glassButton" onClick={() => void sendTest()}>Send a test notification</button>
          {testNote && <small className="settingsNote">{testNote}</small>}
          <CallRingCheck />
          <small className="settingsNote">
            While the app is open it plays the ringtone you pick. With the app closed, your device plays its own
            notification sound, because phones do not let a web app choose it.
          </small>
        </article>

        <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber"><Volume2 size={16} /></span>
            <div>
              <h3>Ringtone</h3>
              <p>Tap one to hear it. It plays when someone calls you while the app is open.</p>
            </div>
          </div>
          <div className="ringtoneList" role="radiogroup" aria-label="Ringtone">
            {RINGTONES.map(item => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={tone === item.id}
                className={`ringtoneOption${tone === item.id ? ' active' : ''}`}
                onClick={() => void pick(item.id)}
              >
                <Play size={14} />
                <span><strong>{item.label}</strong><small>{item.hint}</small></span>
              </button>
            ))}
          </div>
          <label className="ringtoneVolume">
            <span>Volume</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={volume}
              onChange={event => changeVolume(Number(event.target.value))}
              onPointerUp={() => void previewRingtone(tone, volume)}
            />
          </label>
          {canRoute() && (
            <label className="settingsToggle">
              <input type="checkbox" checked={onSilent} onChange={event => { setOnSilent(event.target.checked); setPlayOnSilent(event.target.checked) }} />
              <span>Play sounds even when the phone is on silent</span>
            </label>
          )}
          {note && <small className="settingsNote">{note}</small>}
        </article>

        <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber"><LogOut size={16} /></span>
            <div>
              <h3>Keep me signed in</h3>
              <p>On: this device stays signed in, even after you close the app or leave it idle. Off: you are signed out when the browser or app is closed, and after 30 minutes without activity. Turn it off on any shared device. This setting is per device.</p>
            </div>
          </div>
          <label className="settingsToggle">
            <input type="checkbox" checked={keep} onChange={event => changeKeep(event.target.checked)} />
            <span>Keep me signed in on this device</span>
          </label>
        </article>
        <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber"><MapPin size={16} /></span>
            <div>
              <h3>Work location sharing</h3>
              <p>On: your precise sign-in location is sent to RideArrivo for account security and workplace administration. Off: only your device and time zone are recorded. To remove the browser permission too, use the site settings of your browser.</p>
            </div>
          </div>
          <label className="settingsToggle">
            <input type="checkbox" checked={locShared} onChange={event => changeLocation(event.target.checked)} />
            <span>Share my work location from this device</span>
          </label>
        </article>
        <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber"><Sparkles size={16} /></span>
            <div>
              <h3>Playful island motion</h3>
              <p>On a phone, the top bar and the bottom dock bounce when they shrink and grow, a soft liquid glow drifts behind them, and the names and icons pulse gently. {systemReduce ? 'This phone has Reduce Motion turned on, so the motion starts off. You can switch it on here.' : 'You can switch any of it off here.'} These settings are per device.</p>
            </div>
          </div>
          <label className="settingsToggle">
            <input type="checkbox" checked={fun} onChange={event => changeFun(event.target.checked)} />
            <span>Bounce and liquid glow</span>
          </label>
          <label className="settingsToggle">
            <input type="checkbox" checked={beat} disabled={!fun} onChange={event => changeBeat(event.target.checked)} />
            <span>Pulse the names and icons{fun ? '' : ' (needs the motion above)'}</span>
          </label>
        </article>
        <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber"><Phone size={16} /></span>
            <div>
              <h3>Call screen</h3>
              <p>Voice and video calls from Chat use a FaceTime-style screen: the other person fills the screen, your camera is a small window you can drag, and the controls float at the bottom. If it ever gives you trouble, switch back to the classic ROOM 7 screen. This applies from your next call, on this device.</p>
            </div>
          </div>
          <label className="settingsToggle">
            <input type="checkbox" checked={classic} onChange={event => { setClassic(event.target.checked); setClassicCall(event.target.checked) }} />
            <span>Use the classic call screen</span>
          </label>
        </article>
        <AlertPreferences />
        <article className="appearanceSettingCard">
          <div className="appearanceSettingCopy">
            <span className="appearanceSettingNumber"><MessageCircle size={16} /></span>
            <div>
              <h3>Chat messages</h3>
              <p>A short sound and buzz for each new message while the app is open. Separate from the call ringtone.</p>
            </div>
          </div>
          <label className="settingsToggle">
            <input type="checkbox" checked={chat.enabled} onChange={event => updateChat({ enabled: event.target.checked })} />
            <span>Play a sound for new messages</span>
          </label>
          <label className="settingsToggle">
            <input type="checkbox" checked={chat.vibrate} onChange={event => updateChat({ vibrate: event.target.checked })} />
            <span>Buzz on phones</span>
          </label>
          <div className="ringtoneList" role="radiogroup" aria-label="Message sound">
            {CHAT_SOUNDS.map(item => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={chat.sound === item.id}
                className={`ringtoneOption${chat.sound === item.id ? ' active' : ''}`}
                onClick={() => void pickChat(item.id)}
              >
                <Play size={14} />
                <span><strong>{item.label}</strong><small>{item.hint}</small></span>
              </button>
            ))}
          </div>
          <label className="ringtoneVolume">
            <span>Volume</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={chat.volume}
              onChange={event => updateChat({ volume: Number(event.target.value) })}
              onPointerUp={() => previewChatSound(chat.sound, chat.volume)}
            />
          </label>
          {chatNote && <small className="settingsNote">{chatNote}</small>}
          <small className="settingsNote">
            A chat you have muted stays silent. You are not beeped about the chat you are reading. With the app closed or the screen asleep, your phone plays its own notification sound for every message.
          </small>
        </article>

        {onSignOut && (
          <article className="appearanceSettingCard">
            <div className="appearanceSettingCopy">
              <span className="appearanceSettingNumber"><LogOut size={16} /></span>
              <div>
                <h3>Account</h3>
                <p>Signing out only ends the session on this device. Your other devices stay signed in. To end every session at once (for example after losing a phone), use Sign out of all devices.</p>
              </div>
            </div>
            <div className="authActions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="glassButton" onClick={onSignOut}>Sign out</button>
              {onSignOutEverywhere && (
                <button type="button" className="glassButton" onClick={() => { if (window.confirm('Sign out of every device you are signed in on?')) onSignOutEverywhere() }}>Sign out of all devices</button>
              )}
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
