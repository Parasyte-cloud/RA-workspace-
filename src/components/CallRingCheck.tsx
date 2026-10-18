import { useEffect, useState } from 'react'
import { currentSubscription, currentSupport } from '../lib/pushClient'

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
