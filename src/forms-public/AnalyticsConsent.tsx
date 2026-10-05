import { useEffect, useState } from 'react'
import {
  analyticsAvailable,
  getConsent,
  onConsentChange,
  setConsent,
  type ConsentChoice,
} from '../lib/analytics'

/*
 * Consent banner plus a small "Analytics preferences" link, mounted once by
 * FormsApp. Renders nothing when no GTM/GA4 id is configured, so the forms
 * look exactly as before until analytics is switched on.
 */
export default function AnalyticsConsent() {
  const [choice, setChoice] = useState<ConsentChoice | null>(() => getConsent())
  const [open, setOpen] = useState(() => getConsent() === null)

  useEffect(() => onConsentChange(next => {
    setChoice(next)
    setOpen(false)
  }), [])

  if (!analyticsAvailable()) return null

  const pick = (next: ConsentChoice) => setConsent(next)

  return (
    <>
      {open && (
        <div className="raConsent" role="dialog" aria-live="polite" aria-label="Analytics choice">
          <p>
            We use Google Analytics to count visits and see where people get stuck
            in our forms. We never send what you type into a form. You can change
            this any time.
          </p>
          <div className="raConsentActions">
            <button type="button" onClick={() => pick('denied')}>Decline</button>
            <button type="button" className="raConsentAccept" onClick={() => pick('granted')}>
              Accept
            </button>
          </div>
        </div>
      )}
      {!open && (
        <button
          type="button"
          className="raConsentLink"
          onClick={() => setOpen(true)}
          aria-label={
            'Analytics preferences, currently ' +
            (choice === 'granted' ? 'accepted' : 'declined')
          }
        >
          Analytics preferences
        </button>
      )}
    </>
  )
}
