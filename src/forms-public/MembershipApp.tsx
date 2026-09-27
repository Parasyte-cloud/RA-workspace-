import { useEffect, useRef, useState, type FormEvent } from 'react'
import { RideArrivoExactLogo } from './RideArrivoLogo'
import { submitPublicIntakeForm, IntakeRequestError } from '../lib/intake'
import {
  appleSignInConfigured,
  fetchRiderProfile,
  getStoredRiderToken,
  initAppleSignIn,
  renderGoogleButton,
  signInWithAppleIdentityToken,
  signInWithGoogleIdToken,
  signOutRider,
  type RiderOAuthProvider,
  type RiderUser,
} from '../lib/riderAuth'
import './forms-public.css'
import './membership.css'

/*
 * membership.ridearrivo.com (see isPublicFormsSurface() in main.tsx and
 * the hostname check in FormsApp.tsx).
 *
 * Flow: identify (Google or Apple through src/lib/riderAuth.ts, or name +
 * phone/email) -> pick a plan, see its full benefits, expand/compare
 * freely -> submit (via the same intake platform contact-us/charter-
 * booking already use, slug "membership-signup") -> success, with a
 * "start riding" link to ridearrivo.com.
 *
 * Google/Apple sign-in here is the SAME account as the rider app and
 * ridearrivo.com: this posts straight to arrivo-backend on Render
 * (the exact endpoints and flow ridearrivo-website's login.html/signup.html
 * already use), not a separate identity system. Google is already
 * configured server-side. Apple sign-in on the web needs an Apple
 * Services ID that has not been set up on any RideArrivo site yet
 * (appleSignInConfigured is false until it is), so that button stays
 * hidden until then, same graceful fallback the main site uses.
 */

type Plan = {
  key: string
  tagline: string
  price: string
  km: string
  headline: string
  benefits: string[]
  isCorporate?: boolean
}

const PLANS: Plan[] = [
  {
    key: 'RideArrivo Plus',
    tagline: 'For everyday errands and short commutes',
    price: '₦120,000/month',
    km: '300 km/month (~10 km/day)',
    headline: '2% of every trip back to your wallet',
    benefits: [
      '2% of every trip fare paid back to your RideArrivo wallet',
      '300 km covered per month (~10 km/day)',
      '2-minute free cancellation window',
      'Referral bonus: wallet credit for you and your friend',
      'Delivery & courier service at standard rates',
    ],
  },
  {
    key: 'RideArrivo Plus+',
    tagline: 'Replace the hassle of a personal driver',
    price: '₦250,000/month',
    km: '600 km/month (~20 km/day)',
    headline: '2% of every trip back to your wallet',
    benefits: [
      '2% of every trip fare paid back to your RideArrivo wallet',
      '600 km covered per month (~20 km/day)',
      'Priority pickup queueing at peak times',
      '2-minute free cancellation window',
      'Referral bonus: wallet credit for you and your friend',
      'Delivery & courier service at standard rates',
    ],
  },
  {
    key: 'RideArrivo Premium',
    tagline: 'For daily riders and busy households',
    price: '₦650,000/month',
    km: '1,800 km/month (~60 km/day)',
    headline: '5% of every trip back to your wallet',
    benefits: [
      '5% of every trip fare paid back to your RideArrivo wallet',
      '1,800 km covered per month (~60 km/day)',
      'Verified, top-rated drivers only',
      'Priority customer support queue',
      '5-minute free cancellation window',
      '₦15,000 wallet bonus in your birthday month',
      'Discounted delivery & courier service',
      'Referral bonus: wallet credit for you and your friend',
    ],
  },
  {
    key: 'RideArrivo Executive',
    tagline: 'Status, security, and near-unlimited mobility',
    price: '₦1,050,000/month',
    km: '3,000 km/month (~100 km/day)',
    headline: '5% back, plus a 5% code to share',
    benefits: [
      '5% of every trip fare paid back to your RideArrivo wallet',
      '3,000 km covered per month (~100 km/day)',
      'A 5% discount code to share with friends & family (capped use)',
      'Dedicated safety desk & priority SOS line',
      'Verified, top-rated drivers only',
      'Airport pickup fast-track with meet & greet',
      'Monthly free delivery & courier allowance',
      '10-minute free cancellation window',
      '₦50,000 wallet bonus in your birthday month',
    ],
  },
  {
    key: 'RideArrivo Corporate',
    tagline: 'For offices, churches, schools & teams',
    price: '₦10,000–₦15,000 / seat / month',
    km: 'Pooled 80 km per seat/month',
    headline: '3% back to a shared organization wallet',
    benefits: [
      'One consolidated monthly invoice for the whole organization',
      'Admin dashboard to add/remove riders and set spending caps',
      'Pooled km shared flexibly across your team, not locked per person',
      '3% of every trip fare paid back to a shared organization wallet',
      'Volume pricing: ₦15,000/seat (10–24), ₦12,500/seat (25–49), ₦10,000/seat (50+)',
      'Optional verified-driver-only routing, recommended for school transport',
    ],
    isCorporate: true,
  },
]

// Mirrors EasyBookApp's getIdempotencyKey() -- a sessionStorage-persisted
// UUID so a double-submit (double click, retry after a network hiccup)
// doesn't create two membership requests. Cleared once the request
// actually succeeds so a later, separate signup gets a fresh key.
function getMembershipIdempotencyKey(): string {
  const key = window.sessionStorage.getItem('ra_membership_idempotency_key')
  if (key) return key
  const fresh =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
          const random = (Math.random() * 16) | 0
          const value = char === 'x' ? random : (random & 0x3) | 0x8
          return value.toString(16)
        })
  window.sessionStorage.setItem('ra_membership_idempotency_key', fresh)
  return fresh
}

type Step = 'identify' | 'plans' | 'success'

type Identity = {
  fullName: string
  phone: string
  email: string
}

export default function MembershipApp() {
  const [step, setStep] = useState<Step>('identify')
  const [identity, setIdentity] = useState<Identity>({ fullName: '', phone: '', email: '' })
  const [identifyError, setIdentifyError] = useState('')

  const [riderUser, setRiderUser] = useState<RiderUser | null>(null)
  const [riderProvider, setRiderProvider] = useState<RiderOAuthProvider | null>(null)
  const [oauthBusy, setOauthBusy] = useState<RiderOAuthProvider | null>(null)
  const [oauthError, setOauthError] = useState('')
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const appleButtonRef = useRef<HTMLButtonElement | null>(null)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [orgName, setOrgName] = useState('')
  const [seats, setSeats] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [reference, setReference] = useState('')
  const [website, setWebsite] = useState('') // honeypot field, never rendered to real visitors

  function applyRiderUser(user: RiderUser, provider: RiderOAuthProvider | null) {
    setRiderUser(user)
    setRiderProvider(provider)
    setIdentity(current => ({
      fullName: current.fullName || user.name || '',
      phone: current.phone || user.phone || '',
      email: user.email || current.email,
    }))
  }

  // A returning visitor who signed in before (token still in localStorage)
  // skips straight past the buttons - same as ridearrivo-website checking
  // arrivo_rider_token on load.
  useEffect(() => {
    let active = true
    const token = getStoredRiderToken()
    if (!token) return
    void fetchRiderProfile(token).then(user => {
      if (!active) return
      if (user) applyRiderUser(user, null)
      else signOutRider()
    })
    return () => {
      active = false
    }
  }, [])

  // Renders Google's real button and wires Apple's (revealed only once
  // appleSignInConfigured, exactly like ridearrivo-website's login.html).
  // Re-runs if the buttons need to reappear (e.g. after a sign-out).
  useEffect(() => {
    if (step !== 'identify' || riderUser) return

    function handleGoogleIdToken(idToken: string) {
      setOauthError('')
      setOauthBusy('google')
      signInWithGoogleIdToken(idToken)
        .then(({ user }) => applyRiderUser(user, 'google'))
        .catch(cause => {
          setOauthError(cause instanceof Error ? cause.message : 'Unable to sign in with Google.')
        })
        .finally(() => setOauthBusy(null))
    }

    function handleAppleCredential(
      identityToken: string,
      fullName?: { givenName?: string; familyName?: string },
    ) {
      setOauthError('')
      setOauthBusy('apple')
      signInWithAppleIdentityToken(identityToken, fullName)
        .then(({ user }) => applyRiderUser(user, 'apple'))
        .catch(cause => {
          setOauthError(cause instanceof Error ? cause.message : 'Unable to sign in with Apple.')
        })
        .finally(() => setOauthBusy(null))
    }

    if (googleButtonRef.current) {
      // Fails silently on a network hiccup or ad-blocker - name + phone
      // below still works, so this isn't worth alarming anyone over.
      void renderGoogleButton(googleButtonRef.current, handleGoogleIdToken).catch(() => {})
    }
    if (appleButtonRef.current) {
      void initAppleSignIn(appleButtonRef.current, handleAppleCredential).catch(() => {})
    }
  }, [step, riderUser])

  function handleSignOut() {
    signOutRider()
    setRiderUser(null)
    setRiderProvider(null)
    setIdentity({ fullName: '', phone: '', email: '' })
  }

  function handleIdentify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIdentifyError('')

    if (!identity.fullName.trim()) {
      setIdentifyError('Please tell us your name.')
      return
    }
    if (!identity.phone.trim()) {
      setIdentifyError('A phone number is required so we can reach you about your membership.')
      return
    }

    setStep('plans')
  }

  async function confirmPlan() {
    if (!selectedPlan || busy) return
    setSubmitError('')

    if (selectedPlan.isCorporate && !orgName.trim()) {
      setSubmitError('Please enter your organization name.')
      return
    }

    setBusy(true)
    try {
      const providerLabel = riderProvider === 'google' ? 'Google' : riderProvider === 'apple' ? 'Apple' : null
      const signedInNote = riderUser
        ? providerLabel
          ? `Signed in with ${providerLabel} (${riderUser.email || 'no email on file'}).`
          : `Signed in (${riderUser.email || 'no email on file'}).`
        : ''
      const combinedNotes = [signedInNote, notes.trim()].filter(Boolean).join(' ')

      const submission = await submitPublicIntakeForm({
        slug: 'membership-signup',
        payload: {
          plan: selectedPlan.key,
          full_name: identity.fullName.trim(),
          phone: identity.phone.trim(),
          email: identity.email.trim(),
          organization_name: selectedPlan.isCorporate ? orgName.trim() : '',
          seats_estimate: selectedPlan.isCorporate ? seats.trim() : '',
          notes: combinedNotes,
          // Note: not yet a field the intake backend/schema is confirmed to
          // dedupe on -- see getMembershipIdempotencyKey()'s comment.
          idempotencyKey: getMembershipIdempotencyKey(),
        },
        website,
      })
      setReference(submission.reference || '')
      window.sessionStorage.removeItem('ra_membership_idempotency_key')
      setStep('success')
    } catch (cause) {
      setSubmitError(
        cause instanceof IntakeRequestError
          ? cause.fields.join(' ') || cause.message
          : cause instanceof Error
            ? cause.message
            : 'Unable to submit your request.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="formsPage membershipPage">
      <section className="formsShell membershipShell">
        <header className="formsHeader">
          <RideArrivoExactLogo />
          <span className="formsBadge">MEMBERSHIP</span>
        </header>

        {step === 'identify' && (
          <div className="membershipIdentify">
            <span className="formsEyebrow">RIDEARRIVO MEMBERSHIP</span>
            <h1>Ride more, pay less, every single trip.</h1>
            <p className="membershipLead">
              Join RideArrivo Membership for priority rides, cashback to your wallet on every
              trip, and perks built for how you actually move. Tell us who you are, then pick your
              plan.
            </p>

            {riderUser ? (
              <div className="membershipSignedIn">
                <span className="membershipSignedInBadge">
                  {riderProvider === 'google' ? 'Signed in with Google' : riderProvider === 'apple' ? 'Signed in with Apple' : 'Signed in'}
                </span>
                <strong>{riderUser.name || riderUser.email || 'RideArrivo rider'}</strong>
                {riderUser.email && <span>{riderUser.email}</span>}
                <button type="button" className="membershipSignOutLink" onClick={handleSignOut}>
                  Not you? Sign out
                </button>
              </div>
            ) : (
              <>
                <div className="membershipAuthButtons">
                  <div ref={googleButtonRef} className="membershipGoogleButtonSlot" />
                  <button
                    ref={appleButtonRef}
                    type="button"
                    className="membershipAuthButton membershipAppleButton"
                    style={{ display: appleSignInConfigured ? undefined : 'none' }}
                    disabled={oauthBusy !== null}
                  >
                    Continue with Apple
                  </button>
                </div>
                {oauthBusy && (
                  <p className="membershipAuthNote">
                    Signing you in with {oauthBusy === 'google' ? 'Google' : 'Apple'}...
                  </p>
                )}
                {oauthError && (
                  <div className="formsError" role="alert">
                    {oauthError}
                  </div>
                )}

                <div className="membershipDivider">
                  <span>or continue with your details</span>
                </div>
              </>
            )}

            <form className="formsCard membershipIdentifyForm" onSubmit={handleIdentify}>
              {(!riderUser || !identity.fullName.trim()) && (
                <label>
                  <span>Full Name *</span>
                  <input
                    type="text"
                    required
                    value={identity.fullName}
                    onChange={event => setIdentity(current => ({ ...current, fullName: event.target.value }))}
                  />
                </label>
              )}
              {!riderUser && (
                <label className="formsFieldWide">
                  <span>Email (optional)</span>
                  <input
                    type="email"
                    value={identity.email}
                    onChange={event => setIdentity(current => ({ ...current, email: event.target.value }))}
                  />
                </label>
              )}
              <label className={riderUser ? 'formsFieldWide' : undefined}>
                <span>Phone Number *</span>
                <input
                  type="tel"
                  required
                  placeholder="+2348012345678"
                  value={identity.phone}
                  onChange={event => setIdentity(current => ({ ...current, phone: event.target.value }))}
                />
              </label>

              <label className="formsHoney" aria-hidden="true">
                Website
                <input tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
              </label>

              {identifyError && (
                <div className="formsError" role="alert">
                  {identifyError}
                </div>
              )}

              <div className="formsActions">
                <button type="submit">Choose my plan</button>
              </div>
            </form>
          </div>
        )}

        {step === 'plans' && (
          <div className="membershipPlans">
            <span className="formsEyebrow">WELCOME, {identity.fullName.split(' ')[0].toUpperCase()}</span>
            <h1>Choose your plan.</h1>
            <p className="membershipLead">
              Tap a plan to see everything it includes. You can compare all four before deciding.
            </p>

            <div className="planGrid">
              {PLANS.map(plan => {
                const isOpen = expanded === plan.key
                const isSelected = selectedPlan?.key === plan.key
                return (
                  <div
                    key={plan.key}
                    className={
                      'planCard' +
                      (isOpen ? ' planCardOpen' : '') +
                      (isSelected ? ' planCardSelected' : '')
                    }
                  >
                    <button
                      type="button"
                      className="planCardHeader"
                      onClick={() => setExpanded(isOpen ? null : plan.key)}
                    >
                      <div>
                        <strong>{plan.key.replace('RideArrivo ', '')}</strong>
                        <span className="planTagline">{plan.tagline}</span>
                      </div>
                      <div className="planPrice">
                        <span>{plan.price}</span>
                        <small>{plan.km}</small>
                      </div>
                    </button>

                    <p className="planHeadline">{plan.headline}</p>

                    {isOpen && (
                      <ul className="planBenefits">
                        {plan.benefits.map(benefit => (
                          <li key={benefit}>{benefit}</li>
                        ))}
                      </ul>
                    )}

                    <button
                      type="button"
                      className="planChooseButton"
                      onClick={() => {
                        setSelectedPlan(plan)
                        setExpanded(plan.key)
                        setSubmitError('')
                      }}
                    >
                      {isSelected ? 'Selected ✓' : `Choose ${plan.key.replace('RideArrivo ', '')}`}
                    </button>
                  </div>
                )
              })}
            </div>

            {selectedPlan && (
              <div className="formsCard membershipConfirm">
                <h3>Confirm your {selectedPlan.key} membership</h3>

                {selectedPlan.isCorporate && (
                  <div className="formsGrid">
                    <label>
                      <span>Organization Name *</span>
                      <input type="text" required value={orgName} onChange={event => setOrgName(event.target.value)} />
                    </label>
                    <label>
                      <span>Estimated Seats</span>
                      <input
                        type="number"
                        min={1}
                        placeholder="e.g. 25"
                        value={seats}
                        onChange={event => setSeats(event.target.value)}
                      />
                    </label>
                  </div>
                )}

                <label className="formsFieldWide">
                  <span>Anything else we should know? (optional)</span>
                  <textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} />
                </label>

                {submitError && (
                  <div className="formsError" role="alert">
                    {submitError}
                  </div>
                )}

                <div className="formsActions">
                  <button type="button" disabled={busy} onClick={() => void confirmPlan()}>
                    {busy ? 'Submitting...' : `Confirm ${selectedPlan.key}`}
                  </button>
                  <small>Our team will reach out to activate your membership and set up billing.</small>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'success' && (
          <div className="formsSuccess membershipSuccess">
            <span className="formsEyebrow">REQUEST RECEIVED</span>
            <h1>You're on the list for {selectedPlan?.key}.</h1>
            <p>
              A member of the RideArrivo team will reach out to {identity.phone} to confirm your
              membership and set up billing.
              {reference ? ` Reference: ${reference}.` : ''}
            </p>
            <a href="https://www.ridearrivo.com">
              <button type="button">Start browsing rides on ridearrivo.com</button>
            </a>
          </div>
        )}

        <footer className="formsFooter">
          <span>RideArrivo Limited</span>
          <span>Membership</span>
        </footer>
      </section>
    </main>
  )
}
