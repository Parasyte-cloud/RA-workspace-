import { useEffect, useState } from 'react'
import { currentSubscription, currentSupport } from '../lib/pushClient'
import { soundStatus } from '../lib/ringtone'
import { canRoute, playOnSilentAllowed } from '../lib/audioRoute'

type Check = { label: string; ok: boolean; fix: string }

// Why a phone does not ring is nearly always one of a few things on the phone
// itself. This lists them for this device, with what to change.
export default function CallRingCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const support = currentSupport()
      const sub = await currentSubscription().catch(() => null)
      const permission = 'Notification' in window ? Notification.permission : 'denied'
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
      const list: Check[] = [
        { label: 'Alerts are allowed for RideArrivo', ok: permission === 'granted', fix: 'Allow notifications for RideArrivo in your phone settings, then turn on "Alerts when the app is closed" above.' },
        { label: 'This phone is registered for alerts', ok: Boolean(sub), fix: 'Turn on "Alerts when the app is closed" above. Without it a call can only ring while the app is open on screen.' }
      ]
      const sound = soundStatus()
      list.push({
        label: 'Sound is switched on in the app',
        ok: sound.running,
        fix: 'The phone keeps sound off until you tap the app once, and again after the app has been in the background. Tap anywhere, then check the volume.'
      })
      if (ios) {
        list.push({
          label: 'Rings and message sounds play even on silent',
          ok: canRoute() && playOnSilentAllowed(),
          fix: canRoute()
            ? 'Turn on "Play sounds even when the phone is on silent" under Ringtone below.'
            : 'This iPhone software is too old for the app to override the silent switch. Switch the ring/silent switch to ring, or update iOS.'
        })
      }
      if (ios) list.push({ label: 'Opened from the Home Screen icon', ok: standalone, fix: 'On iPhone, alerts only work for the app added to the Home Screen. Open RideArrivo from that icon, not from Safari.' })
      if (support === 'not-configured') list.push({ label: 'Alerts are set up on the server', ok: false, fix: 'Ask Admin to finish the push alert setup.' })
      if (alive) setChecks(list)
    })()
    return () => { alive = false }
  }, [])

  if (!checks) return null
  const bad = checks.filter(item => !item.ok)
  return (
    <div className="callRingCheck" role="group" aria-label="Incoming call check">
      <strong>Incoming call check</strong>
      <ul>
        {checks.map(item => (
          <li key={item.label} className={item.ok ? 'ok' : 'bad'}>
            <span aria-hidden="true">{item.ok ? '✓' : '✗'}</span> {item.label}
            {!item.ok && <small>{item.fix}</small>}
          </li>
        ))}
      </ul>
      <small className="settingsNote">
        {bad.length === 0
          ? 'This phone is ready. If a call still stays silent, check that Focus or Do Not Disturb is not hiding RideArrivo (Settings, Focus, Allowed Apps), and that the ring switch is not on silent.'
          : 'Fix the items marked ✗ and a call will ring when the app is closed or the phone is locked.'}
      </small>
    </div>
  )
}
