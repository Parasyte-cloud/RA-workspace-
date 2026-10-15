import { useState } from 'react'
import { BellRing, LogOut, Play, Volume2 } from 'lucide-react'
import PhoneAlertsToggle from '../components/PhoneAlertsToggle'
import {
  RINGTONES,
  previewRingtone,
  readRingtone,
  readVolume,
  saveRingtone,
  saveVolume,
} from '../lib/ringtone'
import type { RingtoneId } from '../lib/ringtone'

// Settings card for sounds and alerts. The ringtone is kept on this device, so
// a phone and a laptop can ring differently.
export function NotificationSettings({ onSignOut }: { onSignOut?: () => void }) {
  const [tone, setTone] = useState<RingtoneId>(() => readRingtone())
  const [volume, setVolume] = useState(() => readVolume())
  const [note, setNote] = useState('')
  const [testNote, setTestNote] = useState('')

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
          {note && <small className="settingsNote">{note}</small>}
        </article>

        {onSignOut && (
          <article className="appearanceSettingCard">
            <div className="appearanceSettingCopy">
              <span className="appearanceSettingNumber"><LogOut size={16} /></span>
              <div>
                <h3>Account</h3>
                <p>Sign out of this device.</p>
              </div>
            </div>
            <button type="button" className="glassButton" onClick={onSignOut}>Sign out</button>
          </article>
        )}
      </div>
    </section>
  )
}
