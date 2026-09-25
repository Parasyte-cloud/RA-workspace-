import { useState, type FormEvent } from 'react'
import { RideArrivoExactLogo } from './RideArrivoLogo'
import { ARRIVO_API_BASE_URL } from '../lib/riderAuth'
import './forms-public.css'

/*
 * easybook.ridearrivo.com (see isPublicFormsSurface() in main.tsx and the
 * hostname check in FormsApp.tsx).
 *
 * Built for one specific gap: a customer who can't get through the
 * normal app/website booking flow right now -- an outage, or they found
 * RideArrivo through social media and don't have the app yet -- needs a
 * link support, a social-media manager, or a friend can just hand them
 * (or fill in together on the spot) that ends with a real payment link,
 * no app install and no staff step in between.
 *
 * That's why this page is deliberately NOT built on the shared intake
 * platform every other forms-public page uses (PublicIntakeForm /
 * submitPublicIntakeForm, slug + Support's review queue) -- a queued
 * submission still needs a human to open it, decide it's real, and
 * separately trigger payment. This posts straight to arrivo-backend's
 * POST /api/public/booking-requests instead (same backend
 * membership.ridearrivo.com already talks to directly, see
 * src/lib/riderAuth.ts's ARRIVO_API_BASE_URL), which creates the
 * durable pending booking AND starts the Paystack payment link AND
 * sends it over WhatsApp, all in the one request. No ride is created
 * and no card is charged here -- exactly like every other assisted
 * booking in this codebase, the real ride only exists once Paystack's
 * webhook confirms a real payment.
 *
 * Scoped to one-way trips only (the everyday outage case), matching the
 * same scope limit the internal payment-link route already enforces --
 * fleet/escort/luxury/full-day-week-month bookings stay a staff job
 * through the normal SupportAssistedBookingPanel flow.
 */

type FormState = {
  name: string
  email: string
  phone: string
  pickupAddress: string
  destinationAddress: string
  flightNumber: string
  vehicleType: string
  adults: string
  children: string
  submittedVia: string
  agreedCancellationPolicy: boolean
  website: string // honeypot, never shown to a real visitor
}

const INITIAL_STATE: FormState = {
  name: '',
  email: '',
  phone: '',
  pickupAddress: '',
  destinationAddress: '',
  flightNumber: '',
  vehicleType: 'sedan',
  adults: '1',
  children: '0',
  submittedVia: '',
  agreedCancellationPolicy: false,
  website: '',
}

type SubmitResult = {
  ok: boolean
  fareNaira?: number
  authorizationUrl?: string | null
  whatsappSent?: boolean
  message?: string
  error?: string
}

function getIdempotencyKey(): string {
  const key = window.sessionStorage.getItem('ra_easybook_idempotency_key')
  if (key) return key
  const fresh =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
          const random = (Math.random() * 16) | 0
          const value = char === 'x' ? random : (random & 0x3) | 0x8
          return value.toString(16)
        })
  window.sessionStorage.setItem('ra_easybook_idempotency_key', fresh)
  return fresh
}

export default function EasyBookApp() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState<SubmitResult | null>(null)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError('')

    if (form.website.trim() !== '') {
      // Honeypot tripped -- answer like a normal success and do nothing.
      setResult({ ok: true, message: "Thanks! We'll be in touch shortly." })
      return
    }

    if (!form.name.trim()) return setSubmitError('Please enter your name.')
    if (!form.email.trim()) return setSubmitError('Please enter your email.')
    if (!form.phone.trim()) return setSubmitError('Please enter your WhatsApp number, with country code.')
    if (!form.pickupAddress.trim()) return setSubmitError('Please enter a pickup address.')
    if (!form.destinationAddress.trim()) return setSubmitError('Please enter a drop-off address.')
    if (!form.flightNumber.trim()) return setSubmitError('Please enter your flight number.')
    if (!form.agreedCancellationPolicy) {
      return setSubmitError('Please confirm you agree to the Cancellation & Refund Policy.')
    }

    setBusy(true)
    try {
      const response = await fetch(`${ARRIVO_API_BASE_URL}/api/public/booking-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: getIdempotencyKey(),
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          pickupAddress: form.pickupAddress.trim(),
          destinationAddress: form.destinationAddress.trim(),
          flightNumber: form.flightNumber.trim(),
          vehicleType: form.vehicleType,
          adults: Number(form.adults) || 1,
          children: Number(form.children) || 0,
          submittedVia: form.submittedVia.trim(),
          agreedCancellationPolicy: form.agreedCancellationPolicy,
          website: form.website,
        }),
      })

      const data = (await response.json().catch(() => ({}))) as SubmitResult

      if (!response.ok) {
        setSubmitError(data.error || 'Something went wrong. Please try again.')
        setBusy(false)
        return
      }

      setResult(data)
      setBusy(false)
    } catch {
      setSubmitError('Could not reach RideArrivo right now. Check your connection and try again.')
      setBusy(false)
    }
  }

  function bookAnother() {
    setForm(INITIAL_STATE)
    setResult(null)
    setSubmitError('')
    window.sessionStorage.removeItem('ra_easybook_idempotency_key')
  }

  return (
    <main className="formsPage">
      <section className="formsShell" style={{ maxWidth: 640 }}>
        <header className="formsHeader">
          <RideArrivoExactLogo />
          <span className="formsBadge">QUICK BOOK</span>
        </header>

        {!result && (
          <div className="formsCard" style={{ marginTop: 30 }}>
            <span className="formsEyebrow">BOOK A RIDE, NO APP NEEDED</span>
            <h1 style={{ fontSize: 'clamp(26px,4vw,36px)', margin: '10px 0 6px' }}>
              Fill this in and we'll text you a payment link
            </h1>
            <p style={{ color: '#aeb9c8', margin: '0 0 24px', lineHeight: 1.6 }}>
              Your ride is confirmed as soon as it's paid. No account or app install required.
            </p>

            <form onSubmit={event => void handleSubmit(event)}>
              <label className="formsHoney">
                <span>Leave this field blank</span>
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={event => update('website', event.target.value)}
                />
              </label>

              <div className="formsGrid">
                <label>
                  <span>Full name</span>
                  <input
                    type="text"
                    autoComplete="name"
                    value={form.name}
                    onChange={event => update('name', event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={event => update('email', event.target.value)}
                    required
                  />
                </label>
                <label className="formsFieldWide">
                  <span>WhatsApp number (include country code)</span>
                  <input
                    type="tel"
                    placeholder="+2348012345678"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={event => update('phone', event.target.value)}
                    required
                  />
                </label>
                <label className="formsFieldWide">
                  <span>Pickup address</span>
                  <input
                    type="text"
                    value={form.pickupAddress}
                    onChange={event => update('pickupAddress', event.target.value)}
                    required
                  />
                </label>
                <label className="formsFieldWide">
                  <span>Drop-off address</span>
                  <input
                    type="text"
                    value={form.destinationAddress}
                    onChange={event => update('destinationAddress', event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Flight number</span>
                  <input
                    type="text"
                    placeholder="e.g. BA075"
                    value={form.flightNumber}
                    onChange={event => update('flightNumber', event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Vehicle</span>
                  <select value={form.vehicleType} onChange={event => update('vehicleType', event.target.value)}>
                    <option value="sedan">Sedan</option>
                    <option value="suv">SUV</option>
                    <option value="truck">Truck</option>
                    <option value="pickup">Pickup</option>
                  </select>
                </label>
                <label>
                  <span>Adults</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={form.adults}
                    onChange={event => update('adults', event.target.value)}
                  />
                </label>
                <label>
                  <span>Children</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={form.children}
                    onChange={event => update('children', event.target.value)}
                  />
                </label>
                <label className="formsFieldWide">
                  <span>How did you hear about this? (optional)</span>
                  <input
                    type="text"
                    placeholder="e.g. Instagram, a friend, RideArrivo support"
                    value={form.submittedVia}
                    onChange={event => update('submittedVia', event.target.value)}
                  />
                </label>
              </div>

              <label className="formsConsent">
                <input
                  type="checkbox"
                  checked={form.agreedCancellationPolicy}
                  onChange={event => update('agreedCancellationPolicy', event.target.checked)}
                />
                <span>
                  I agree to RideArrivo's{' '}
                  <a href="https://ridearrivo.com/terms.html" target="_blank" rel="noopener noreferrer">
                    Cancellation &amp; Refund Policy
                  </a>
                  .
                </span>
              </label>

              {submitError && (
                <div className="formsError" role="alert">
                  {submitError}
                </div>
              )}

              <div className="formsActions">
                <button type="submit" disabled={busy}>
                  {busy ? 'Sending...' : 'Get my payment link'}
                </button>
                <small>Takes about a minute. Nothing is charged until you pay.</small>
              </div>
            </form>
          </div>
        )}

        {result && (
          <div className="formsSuccess" style={{ marginTop: 30 }}>
            <span className="formsEyebrow">
              {result.authorizationUrl ? 'FARE LOCKED IN' : 'REQUEST RECEIVED'}
            </span>
            <h1>{result.authorizationUrl ? "You're almost booked" : 'Thanks -- we have your request'}</h1>
            <p>{result.message}</p>
            {typeof result.fareNaira === 'number' && (
              <p style={{ fontSize: 28, fontWeight: 800, color: '#f5f7fa', margin: '18px 0 6px' }}>
                NGN {result.fareNaira.toLocaleString('en-NG')}
              </p>
            )}
            {result.authorizationUrl && (
              <a href={result.authorizationUrl} target="_blank" rel="noopener noreferrer">
                <button type="button">Pay now</button>
              </a>
            )}
            <div style={{ marginTop: 26 }}>
              <button type="button" onClick={bookAnother} style={{ background: 'transparent', color: '#f5f7fa' }}>
                Book another ride
              </button>
            </div>
          </div>
        )}

        <footer className="formsFooter">
          <span>RideArrivo Limited</span>
          <span>Quick Book</span>
        </footer>
      </section>
    </main>
  )
}
