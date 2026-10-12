import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  currentSubscription,
  currentSupport,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupport,
} from '../lib/pushClient'

const HINT: Record<Exclude<PushSupport, 'ready'>, string> = {
  unsupported: 'This browser cannot receive phone alerts.',
  'needs-install': 'On iPhone, add RideArrivo to your Home Screen first (Share, then Add to Home Screen), then open it from there.',
  blocked: 'Notifications are blocked for this site. Allow them in the browser settings, then try again.',
  'not-configured': '',
}

// "Phone alerts": ring and notify this device even when the app is closed.
export default function PhoneAlertsToggle() {
  const [support] = useState<PushSupport>(() => currentSupport())
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (support !== 'ready') return
    void currentSubscription()
      .then(subscription => setOn(Boolean(subscription)))
      .catch(() => {})
  }, [support])

  // Nothing to show until an admin has set up the keys.
  if (support === 'not-configured') return null

  const turnOn = async () => {
    setBusy(true)
    setMessage('')
    try {
      const sub = await subscribeToPush()
      const { error } = await supabase!.rpc('save_push_subscription', {
        p_endpoint: sub.endpoint,
        p_p256dh: sub.p256dh,
        p_auth: sub.auth,
        p_user_agent: navigator.userAgent,
      })
      if (error) throw error
      setOn(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not turn on phone alerts.')
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    setMessage('')
    try {
      const endpoint = await unsubscribeFromPush()
      if (endpoint) await supabase!.from('push_subscriptions').delete().eq('endpoint', endpoint)
      setOn(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not turn off phone alerts.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="phoneAlerts">
      <div>
        <strong><BellRing size={14} /> Phone alerts</strong>
        <small>
          {support === 'ready'
            ? on
              ? 'On for this device. Calls ring even when the app is closed.'
              : 'Ring and notify this device even when the app is closed.'
            : HINT[support]}
        </small>
        {message && <small className="phoneAlertsError">{message}</small>}
      </div>
      {support === 'ready' && (
        <button type="button" className="glassButton" disabled={busy} onClick={() => void (on ? turnOff() : turnOn())}>
          {busy ? 'Working...' : on ? 'Turn off' : 'Turn on'}
        </button>
      )}
    </div>
  )
}
