import { useEffect, useRef, useState, type FormEvent } from 'react'
import { RideArrivoExactLogo } from './RideArrivoLogo'
import {
  ARRIVO_API_BASE_URL,
  appleSignInConfigured,
  getStoredRiderToken,
  fetchRiderProfile,
  initAppleSignIn,
  renderGoogleButton,
  signInWithGoogleIdToken,
  signInWithAppleIdentityToken,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  signOutRider,
  type RiderUser,
  type RiderOAuthProvider,
} from '../lib/riderAuth'
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
 * no staff step in between.
 *
 * Sign-in is REQUIRED before the booking form even shows (Google, Apple,
 * or email/password -- the same backend, same accounts as the app and
 * ridearrivo-website, via src/lib/riderAuth.ts). This used to be a plain
 * "type your name and email" guest form, which could never actually
 * guarantee it wasn't creating a second account next to one someone
 * already had. Real sign-in closes that: a Google/Apple identity or a
 * password proves the account, and the backend already links a new
 * Google/Apple sign-in to an existing email-matched account rather than
 * forking a second one (findOrCreateOAuthProfile in routes/auth.js), so
 * this page can never leave someone with duplicate RideArrivo accounts.
 *
 * The one case this can't cover -- a phone-in customer with no account at
 * all and no device in hand to sign in with themselves -- is handled on
 * the STAFF side instead (POST /api/support/assisted-bookings'
 * createAccountIfMissing), not here, precisely so this page's own
 * guarantee (nobody submits without a real, signed-in account) never has
 * a silent exception.
 *
 * Once signed in, this posts straight to arrivo-backend's POST
 * /api/public/booking-requests with the rider's token, which creates the
 * durable pending booking AND starts a Paystack payment link AND sends
 * it over WhatsApp, all in the one request -- no Support queue step in
 * between. No ride is created and no card is charged here; the real ride
 * only exists once Paystack's webhook confirms a real payment, exactly
 * like every other assisted booking in this codebase.
 *
 * Scoped to one-way trips only (the everyday outage case), matching the
 * same scope limit the internal payment-link route already enforces.
 */

type Step = 'identify' | 'book' | 'success'
type EmailMode = 'signin' | 'signup'

type BookingForm = {
  pickupAddress: string
  destinationAddress: string
  flightNumber: string
  vehicleType: string
  adults: string
  children: string
  phone: string
  submittedVia: string
  agreedCancellationPolicy: boolean
}

const INITIAL_BOOKING: BookingForm = {
  pickupAddress: '',
  destinationAddress: '',
  flightNumber: '',
  vehicleType: 'sedan',
  adults: '1',
  children: '0',
  phone: '',
  submittedVia: '',
  agreedCancellationPolicy: false,
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
  const [step, setStep] = useState<Step>('identify')

  const [rider, setRider] = useState<RiderUser | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

  const [oauthBusy, setOauthBusy] = useState<RiderOAuthProvider | null>(null)
  const [oauthError, setOauthError] = useState('')
  const googleButtonRef = useRef<HTMLDivElement>(null)
  const appleButtonRef = useRef<HTMLButtonElement>(null)

  const [emailMode, setEmailMode] = useState<EmailMode>('signin')
  const [emailForm, setEmailForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    phone: '',
    agreedToTerms: false,
  })
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState('')

  const [form, setForm] = useState<BookingForm>(INITIAL_BOOKING)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState<SubmitResult | null>(null)

  // Resume an existing session (already signed in from a prior visit)
  // rather than making a returning customer sign in again every time.
  useEffect(() => {
    const token = getStoredRiderToken()
    if (!token) {
      setCheckingSession(false)
      return
    }
    let cancelled = false
    fetchRiderProfile(token)
      .then(profile => {
        if (cancelled) return
        if (profile) {
          setRider(profile)
          setForm(current => ({ ...current, phone: current.phone || profile.whatsapp_number || profile.phone || '' }))
          setStep('book')
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (step !== 'identify' || rider) return

    function handleGoogleIdToken(idToken: string) {
      setOauthBusy('google')
      setOauthError('')
      signInWithGoogleIdToken(idToken)
        .then(result => {
          setRider(result.user)
          setForm(current => ({ ...current, phone: current.phone || result.user.whatsapp_number || result.user.phone || '' }))
          setStep('book')
        })
        .catch(err => setOauthError(err instanceof Error ? err.message : 'Google sign-in failed.'))
        .finally(() => setOauthBusy(null))
    }

    function handleAppleCredential(identityToken: string, fullName?: { givenName?: string; familyName?: string }) {
      setOauthBusy('apple')
      setOauthError('')
      signInWithAppleIdentityToken(identityToken, fullName)
        .then(result => {
          setRider(result.user)
          setForm(current => ({ ...current, phone: current.phone || result.user.whatsapp_number || result.user.phone || '' }))
          setStep('book')
        })
        .catch(err => setOauthError(err instanceof Error ? err.message : 'Apple sign-in failed.'))
        .finally(() => setOauthBusy(null))
    }

    if (googleButtonRef.current) {
      void renderGoogleButton(googleButtonRef.current, handleGoogleIdToken).catch(() => {})
    }
    if (appleButtonRef.current) {
      void initAppleSignIn(appleButtonRef.current, handleAppleCredential).catch(() => {})
    }
  }, [step, rider])

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEmailError('')

    if (!emailForm.email.trim()) return setEmailError('Please enter your email.')
    if (!emailForm.password) return setEmailError('Please enter a password.')

    if (emailMode === 'signup') {
      if (!emailForm.firstName.trim()) return setEmailError('Please enter your first name.')
      if (!emailForm.lastName.trim()) return setEmailError('Please enter your last name.')
      if (emailForm.password.length < 8) return setEmailError('Password must be at least 8 characters.')
      if (!emailForm.agreedToTerms) return setEmailError("Please agree to RideArrivo's terms to create an account.")
    }

    setEmailBusy(true)
    try {
      const result =
        emailMode === 'signin'
          ? await signInWithEmailPassword(emailForm.email.trim(), emailForm.password)
          : await signUpWithEmailPassword({
              firstName: emailForm.firstName.trim(),
              lastName: emailForm.lastName.trim(),
              email: emailForm.email.trim(),
              password: emailForm.password,
              phone: emailForm.phone.trim() || undefined,
              agreedToTerms: emailForm.agreedToTerms,
            })
      setRider(result.user)
      setForm(current => ({
        ...current,
        phone: current.phone || result.user.whatsapp_number || result.user.phone || emailForm.phone.trim(),
      }))
      setStep('book')
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setEmailBusy(false)
    }
  }

  function update<K extends keyof BookingForm>(key: K, value: BookingForm[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function handleBookingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError('')

    const token = getStoredRiderToken()
    if (!token) {
      setSubmitError('Your session expired. Please sign in again.')
      setStep('identify')
      return
    }

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          idempotencyKey: getIdempotencyKey(),
          phone: form.phone.trim(),
          pickupAddress: form.pickupAddress.trim(),
          destinationAddress: form.destinationAddress.trim(),
          flightNumber: form.flightNumber.trim(),
          vehicleType: form.vehicleType,
          adults: Number(form.adults) || 1,
          children: Number(form.children) || 0,
          submittedVia: form.submittedVia.trim(),
          agreedCancellationPolicy: form.agreedCancellationPolicy,
        }),
      })

      const data = (await response.json().catch(() => ({}))) as SubmitResult

      if (!response.ok) {
        if (response.status === 401) {
          setSubmitError('Your session expired. Please sign in again.')
          setRider(null)
          setStep('identify')
          setBusy(false)
          return
        }
        setSubmitError(data.error || 'Something went wrong. Please try again.')
        setBusy(false)
        return
      }

      setResult(data)
      setStep('success')
      setBusy(false)
    } catch {
      setSubmitError('Could not reach RideArrivo right now. Check your connection and try again.')
      setBusy(false)
    }
  }

  function bookAnother() {
    setForm(current => ({ ...INITIAL_BOOKING, phone: current.phone }))
    setResult(null)
    setSubmitError('')
    setStep('book')
    window.sessionStorage.removeItem('ra_easybook_idempotency_key')
  }

  function switchAccount() {
    signOutRider()
    setRider(null)
    setForm(INITIAL_BOOKING)
    setResult(null)
    setStep('identify')
  }

  if (checkingSession) {
    return (
      <main className="formsPage">
        <div className="formsStatus">CHECKING YOUR SESSION</div>
      </main>
    )
  }

  return (
    <main className="formsPage">
      <section className="formsShell" style={{ maxWidth: 640 }}>
        <header className="formsHeader">
          <RideArrivoExactLogo />
          <span className="formsBadge">QUICK BOOK</span>
        </header>

        {step === 'identify' && (
          <div className="formsCard" style={{ marginTop: 30 }}>
            <span className="formsEyebrow">SIGN IN TO BOOK</span>
            <h1 style={{ fontSize: 'clamp(26px,4vw,36px)', margin: '10px 0 6px' }}>
              Sign in, then get a payment link in a minute
            </h1>
            <p style={{ color: '#aeb9c8', margin: '0 0 24px', lineHeight: 1.6 }}>
              Same account as the RideArrivo app and website -- so if you've booked with us before, this picks up
              your existing account rather than starting a new one.
            </p>

            <div style={{ display: 'grid', gap: 12, marginBottom: 22 }}>
              <div ref={googleButtonRef} style={{ minHeight: 44 }} />
              <button
                ref={appleButtonRef}
                type="button"
                style={{
                  display: appleSignInConfigured ? 'flex' : 'none',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 44,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,.18)',
                  background: '#000',
                  color: '#fff',
                  fontWeight: 700,
                }}
              >
                Continue with Apple
              </button>
              {oauthBusy && <small style={{ color: '#aeb9c8' }}>Signing in with {oauthBusy === 'google' ? 'Google' : 'Apple'}...</small>}
              {oauthError && (
                <div className="formsError" role="alert">
                  {oauthError}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0', color: '#6f7d90', fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.09)' }} />
              OR
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.09)' }} />
            </div>

            <div className="formsActions" style={{ marginTop: 0, marginBottom: 18 }}>
              <button
                type="button"
                onClick={() => setEmailMode('signin')}
                style={emailMode === 'signin' ? undefined : { background: 'transparent', color: '#f5f7fa' }}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setEmailMode('signup')}
                style={emailMode === 'signup' ? undefined : { background: 'transparent', color: '#f5f7fa' }}
              >
                Create account
              </button>
            </div>

            <form onSubmit={event => void handleEmailSubmit(event)}>
              <div className="formsGrid">
                {emailMode === 'signup' && (
                  <>
                    <label>
                      <span>First name</span>
                      <input
                        type="text"
                        autoComplete="given-name"
                        value={emailForm.firstName}
                        onChange={event => setEmailForm(current => ({ ...current, firstName: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>Last name</span>
                      <input
                        type="text"
                        autoComplete="family-name"
                        value={emailForm.lastName}
                        onChange={event => setEmailForm(current => ({ ...current, lastName: event.target.value }))}
                      />
                    </label>
                  </>
                )}
                <label className="formsFieldWide">
                  <span>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={emailForm.email}
                    onChange={event => setEmailForm(current => ({ ...current, email: event.target.value }))}
                  />
                </label>
                <label className="formsFieldWide">
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete={emailMode === 'signin' ? 'current-password' : 'new-password'}
                    value={emailForm.password}
                    onChange={event => setEmailForm(current => ({ ...current, password: event.target.value }))}
                  />
                </label>
                {emailMode === 'signup' && (
                  <label className="formsFieldWide">
                    <span>WhatsApp number (optional)</span>
                    <input
                      type="tel"
                      placeholder="+2348012345678"
                      autoComplete="tel"
                      value={emailForm.phone}
                      onChange={event => setEmailForm(current => ({ ...current, phone: event.target.value }))}
                    />
                  </label>
                )}
              </div>

              {emailMode === 'signup' && (
                <label className="formsConsent">
                  <input
                    type="checkbox"
                    checked={emailForm.agreedToTerms}
                    onChange={event => setEmailForm(current => ({ ...current, agreedToTerms: event.target.checked }))}
                  />
                  <span>
                    I agree to RideArrivo's{' '}
                    <a href="https://ridearrivo.com/terms.html" target="_blank" rel="noopener noreferrer">
                      Terms
                    </a>{' '}
                    and{' '}
                    <a href="https://ridearrivo.com/privacy.html" target="_blank" rel="noopener noreferrer">
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>
              )}

              {emailError && (
                <div className="formsError" role="alert">
                  {emailError}
                </div>
              )}

              <div className="formsActions">
                <button type="submit" disabled={emailBusy}>
                  {emailBusy ? 'Please wait...' : emailMode === 'signin' ? 'Sign in' : 'Create account'}
                </button>
              </div>
            </form>
          </div>
        )}

        {step === 'book' && rider && (
          <div className="formsCard" style={{ marginTop: 30 }}>
            <span className="formsEyebrow">BOOK A RIDE</span>
            <h1 style={{ fontSize: 'clamp(26px,4vw,36px)', margin: '10px 0 6px' }}>
              Signed in as {rider.name || rider.email}
            </h1>
            <p style={{ color: '#aeb9c8', margin: '0 0 24px', lineHeight: 1.6 }}>
              Fill this in and we'll text you a payment link. Your ride is confirmed as soon as it's paid.{' '}
              <a
                href="#"
                onClick={event => {
                  event.preventDefault()
                  switchAccount()
                }}
                style={{ color: '#ff9f0a' }}
              >
                Not you?
              </a>
            </p>

            <form onSubmit={event => void handleBookingSubmit(event)}>
              <div className="formsGrid">
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

        {step === 'success' && result && (
          <div className="formsSuccess" style={{ marginTop: 30 }}>
            <span className="formsEyebrow">{result.authorizationUrl ? 'FARE LOCKED IN' : 'REQUEST RECEIVED'}</span>
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
