import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { RideArrivoExactLogo } from './RideArrivoLogo'
import { submitPublicIntakeForm, IntakeRequestError } from '../lib/intake'
import {
  riderAuthConfigured,
  getRiderSession,
  signInWithRiderProvider,
  signOutRider,
  subscribeToRiderAuthChanges,
  riderDisplayName,
  riderProviderLabel,
  type RiderOAuthProvider,
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
 * Google/Apple sign-in is real, but it is its own identity, separate from
 * both this project's internal workspace auth (src/lib/supabase.ts,
 * the wrong system for riders) and the rider app's own backend on Render
 * (not wired up here yet, by design - see the comment in riderAuth.ts).
 * If riderAuthConfigured is false (VITE_RIDER_SUPABASE_URL/ANON_KEY not
 * set yet), the buttons fall back to a "coming soon" note instead of
 * erroring, so this page keeps working either way.
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

type Step = 'identify' | 'plans' | 'success'

type Identity = {
  fullName: string
  phone: string
  email: string
}

function AuthComingSoonNote({ provider }: { provider: string }) {
  return (
    <p className="membershipAuthNote">
      {provider} sign-in will connect directly to your RideArrivo account once it's linked to the
      app. For now, continue with your name and phone number below.
    </p>
  )
}

export default function MembershipApp() {
  const [step, setStep] = useState<Step>('identify')
  const [identity, setIdentity] = useState<Identity>({ fullName: '', phone: '', email: '' })
  const [authNote, setAuthNote] = useState<string | null>(null)
  const [identifyError, setIdentifyError] = useState('')

  const [riderSession, setRiderSession] = useState<Session | null>(null)
  const [oauthBusy, setOauthBusy] = useState<RiderOAuthProvider | null>(null)
  const [oauthError, setOauthError] = useState('')

  const [expanded, setExpanded] = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [orgName, setOrgName] = useState('')
  const [seats, setSeats] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [reference, setReference] = useState('')

  useEffect(() => {
    let active = true

    function applySession(session: Session | null) {
      if (!active) return
      setRiderSession(session)
      setOauthBusy(null)
      if (session) {
        setIdentity(current => ({
          fullName: current.fullName || riderDisplayName(session),
          phone: current.phone,
          email: session.user.email || current.email,
        }))
      }
    }

    void getRiderSession().then(applySession)
    const unsubscribe = subscribeToRiderAuthChanges(applySession)

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  async function handleOAuthClick(provider: RiderOAuthProvider) {
    setOauthError('')

    if (!riderAuthConfigured) {
      setAuthNote(provider === 'google' ? 'Google' : 'Apple')
      return
    }

    setOauthBusy(provider)
    try {
      await signInWithRiderProvider(provider)
      // A successful call redirects the browser away to the provider, so
      // there is nothing further to do here on success.
    } catch (cause) {
      setOauthError(
        cause instanceof Error ? cause.message : `Unable to start ${provider} sign-in.`,
      )
      setOauthBusy(null)
    }
  }

  async function handleSignOut() {
    await signOutRider()
    setRiderSession(null)
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
      const signedInNote = riderSession
        ? `Signed in with ${riderProviderLabel(riderSession)} (${riderSession.user.email || 'no email on file'}).`
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
        },
      })
      setReference(submission.reference || '')
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

            {riderSession ? (
              <div className="membershipSignedIn">
                <span className="membershipSignedInBadge">
                  Signed in with {riderProviderLabel(riderSession)}
                </span>
                <strong>{riderDisplayName(riderSession)}</strong>
                {riderSession.user.email && <span>{riderSession.user.email}</span>}
                <button type="button" className="membershipSignOutLink" onClick={() => void handleSignOut()}>
                  Not you? Sign out
                </button>
              </div>
            ) : (
              <>
                <div className="membershipAuthButtons">
                  <button
                    type="button"
                    className="membershipAuthButton"
                    disabled={oauthBusy !== null}
                    onClick={() => void handleOAuthClick('google')}
                  >
                    {oauthBusy === 'google' ? 'Opening Google...' : 'Continue with Google'}
                  </button>
                  <button
                    type="button"
                    className="membershipAuthButton"
                    disabled={oauthBusy !== null}
                    onClick={() => void handleOAuthClick('apple')}
                  >
                    {oauthBusy === 'apple' ? 'Opening Apple...' : 'Continue with Apple'}
                  </button>
                </div>
                {authNote && <AuthComingSoonNote provider={authNote} />}
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
              {!riderSession && (
                <>
                  <label>
                    <span>Full Name *</span>
                    <input
                      type="text"
                      required
                      value={identity.fullName}
                      onChange={event => setIdentity(current => ({ ...current, fullName: event.target.value }))}
                    />
                  </label>
                  <label className="formsFieldWide">
                    <span>Email (optional)</span>
                    <input
                      type="email"
                      value={identity.email}
                      onChange={event => setIdentity(current => ({ ...current, email: event.target.value }))}
                    />
                  </label>
                </>
              )}
              <label className={riderSession ? 'formsFieldWide' : undefined}>
                <span>Phone Number *</span>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 080..."
                  value={identity.phone}
                  onChange={event => setIdentity(current => ({ ...current, phone: event.target.value }))}
                />
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
