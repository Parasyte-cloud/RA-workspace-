import { useState, type FormEvent } from 'react'
import { RideArrivoExactLogo } from './RideArrivoLogo'
import FormsHeaderNav from './FormsHeaderNav'
import { submitPublicIntakeForm, IntakeRequestError } from '../lib/intake'
import './forms-public.css'
import FormsHeroImage from './FormsHeroImage'
import './charter.css'

/*
 * boat.ridearrivo.com (see isPublicFormsSurface() in main.tsx and the
 * hostname check in FormsApp.tsx).
 *
 * ArrivoBoat -- speedboat, yacht and water-taxi charter. Same shape as
 * MoveApp (intro -> details -> contact & recap -> submit -> success),
 * submitting through the shared intake platform (slug "boat-charter") so
 * it shows up in Support's queue exactly like move-booking/charter-booking
 * do.
 *
 * Deliberately does NOT show a price estimate the way Move does. Move's
 * estimate is a real base-price table the business already prices moves
 * by; there's no equivalent pricing model for boat charters (fuel, vessel
 * type and availability swing the price too much to fake a number here),
 * so this is a pure "request a quote" flow -- the same pattern every real
 * boat/yacht charter operator uses. Support confirms the actual price
 * after reviewing the request.
 */

const CHARTER_TYPES = [
  'Point-to-point transfer',
  'Day charter / tour',
  'Event or celebration',
  'Fishing charter',
]

const VESSEL_OPTIONS = [
  { value: 'No preference', blurb: "We'll match you to what's available and best for your trip." },
  { value: 'Speedboat', blurb: 'Fast, open-air point-to-point transfers. Best for 1-8 passengers.' },
  { value: 'Yacht', blurb: 'Spacious and comfortable, ideal for day charters and events.' },
  { value: 'Catamaran', blurb: 'Stable twin-hull, great for larger groups and calmer rides.' },
  { value: 'Water taxi', blurb: 'Quick, no-frills hops across the water for a small party.' },
]

const DURATIONS = ['1-2 hours', 'Half day (up to 4 hours)', 'Full day', 'Multi-day']

const PASSENGER_COUNTS = ['1-4', '5-8', '9-15', '16-30', '30+']

type Details = {
  charterType: string
  departurePoint: string
  destination: string
  charterDate: string
  charterTime: string
  duration: string
  passengers: string
  vesselPreference: string
  specialRequests: string
}

const INITIAL_DETAILS: Details = {
  charterType: '',
  departurePoint: '',
  destination: '',
  charterDate: '',
  charterTime: '',
  duration: '',
  passengers: '',
  vesselPreference: 'No preference',
  specialRequests: '',
}

type Step = 'intro' | 'details' | 'contact' | 'success'

type Contact = {
  fullName: string
  phone: string
  email: string
}

export default function BoatApp() {
  const [step, setStep] = useState<Step>('intro')
  const [details, setDetails] = useState<Details>(INITIAL_DETAILS)
  const [detailsError, setDetailsError] = useState('')

  const [contact, setContact] = useState<Contact>({ fullName: '', phone: '', email: '' })
  const [notes, setNotes] = useState('')
  const [contactError, setContactError] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [reference, setReference] = useState('')

  function updateDetails<K extends keyof Details>(key: K, value: Details[K]) {
    setDetails(current => ({ ...current, [key]: value }))
  }

  const isPointToPoint = details.charterType === 'Point-to-point transfer'

  function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDetailsError('')

    if (!details.charterType) return setDetailsError('Please choose the type of charter.')
    if (!details.departurePoint.trim()) return setDetailsError('Please enter a departure point (marina, jetty or beach).')
    if (isPointToPoint && !details.destination.trim()) return setDetailsError('Please enter a destination.')
    if (!details.charterDate) return setDetailsError('Please choose a date.')
    if (!details.charterTime) return setDetailsError('Please choose a time.')
    if (!isPointToPoint && !details.duration) return setDetailsError('Please choose how long you need the vessel.')
    if (!details.passengers) return setDetailsError('Please choose how many passengers.')

    setStep('contact')
  }

  async function confirmBooking() {
    if (busy) return
    setContactError('')
    setSubmitError('')

    if (!contact.fullName.trim()) return setContactError('Please tell us your name.')
    if (!contact.phone.trim()) return setContactError('A phone number is required so our team can reach you.')

    setBusy(true)
    try {
      const submission = await submitPublicIntakeForm({
        slug: 'boat-charter',
        payload: {
          charter_type: details.charterType,
          departure_point: details.departurePoint.trim(),
          destination: isPointToPoint ? details.destination.trim() : '',
          charter_date: details.charterDate,
          charter_time: details.charterTime,
          duration: isPointToPoint ? '' : details.duration,
          passengers: details.passengers,
          vessel_preference: details.vesselPreference,
          special_requests: details.specialRequests.trim(),
          full_name: contact.fullName.trim(),
          phone: contact.phone.trim(),
          email: contact.email.trim(),
          notes: notes.trim(),
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

  function requestAnother() {
    setDetails(INITIAL_DETAILS)
    setContact({ fullName: '', phone: '', email: '' })
    setNotes('')
    setReference('')
    setStep('intro')
  }

  return (
    <main className="formsPage charterPage">
      <section className="formsShell charterShell">
        <header className="formsHeader">
          <RideArrivoExactLogo />
          <span className="formsBadge">BOAT &amp; YACHT CHARTER</span>
          <FormsHeaderNav />
        </header>

        {step === 'intro' && <FormsHeroImage variant="boat" />}

        {step === 'intro' && (
          <div className="charterIntro">
            <span className="formsEyebrow">ARRIVOBOAT</span>
            <h1>Speedboats, yachts and water taxis, on request.</h1>
            <p className="charterLead">
              Point-to-point water transfers, a day out on a yacht, or a fishing charter --
              tell us what you need and we'll come back with a vessel and a price.
            </p>

            <ul className="charterHighlights">
              <li>Vetted captains and vessels, not a stranger with a boat</li>
              <li>Point-to-point transfers, day charters, events and fishing trips</li>
              <li>A member of our team confirms the exact price before you book</li>
            </ul>

            <div className="formsActions">
              <button type="button" onClick={() => setStep('details')}>
                Request a charter
              </button>
              <small>Takes about two minutes. No payment required to request a quote.</small>
            </div>
          </div>
        )}

        {step === 'details' && (
          <div className="charterDetails">
            <span className="formsEyebrow">STEP 1 OF 2</span>
            <h1>Tell us about your charter.</h1>
            <p className="charterLead">
              The more we know, the more accurate your quote and the better we can match a vessel.
            </p>

            <form className="formsCard formsGrid" onSubmit={handleDetailsSubmit}>
              <label className="formsFieldWide">
                <span>Charter Type *</span>
                <select
                  required
                  value={details.charterType}
                  onChange={event => updateDetails('charterType', event.target.value)}
                >
                  <option value="">Choose a charter type</option>
                  {CHARTER_TYPES.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Departure Point *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Landmark Jetty, Lekki"
                  value={details.departurePoint}
                  onChange={event => updateDetails('departurePoint', event.target.value)}
                />
              </label>
              {isPointToPoint ? (
                <label>
                  <span>Destination *</span>
                  <input
                    type="text"
                    required
                    placeholder="Where are you headed?"
                    value={details.destination}
                    onChange={event => updateDetails('destination', event.target.value)}
                  />
                </label>
              ) : (
                <label>
                  <span>Duration *</span>
                  <select
                    required
                    value={details.duration}
                    onChange={event => updateDetails('duration', event.target.value)}
                  >
                    <option value="">Choose a duration</option>
                    {DURATIONS.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label>
                <span>Date *</span>
                <input
                  type="date"
                  required
                  value={details.charterDate}
                  onChange={event => updateDetails('charterDate', event.target.value)}
                />
              </label>
              <label>
                <span>Time *</span>
                <input
                  type="time"
                  required
                  value={details.charterTime}
                  onChange={event => updateDetails('charterTime', event.target.value)}
                />
              </label>

              <label>
                <span>Passengers *</span>
                <select
                  required
                  value={details.passengers}
                  onChange={event => updateDetails('passengers', event.target.value)}
                >
                  <option value="">Choose a headcount</option>
                  {PASSENGER_COUNTS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <div className="formsFieldWide charterClassPicker">
                <span>Vessel Preference</span>
                <div className="charterClassOptions">
                  {VESSEL_OPTIONS.map(option => (
                    <button
                      type="button"
                      key={option.value}
                      className={
                        'charterClassCard' +
                        (details.vesselPreference === option.value ? ' charterClassCardSelected' : '')
                      }
                      onClick={() => updateDetails('vesselPreference', option.value)}
                    >
                      <span className="charterClassName">{option.value}</span>
                      <span className="charterClassBlurb">{option.blurb}</span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="formsFieldWide">
                <span>Special Requests (optional)</span>
                <textarea
                  rows={3}
                  placeholder="Catering, decorations, watersports equipment, life jackets for children, etc."
                  value={details.specialRequests}
                  onChange={event => updateDetails('specialRequests', event.target.value)}
                />
              </label>

              {detailsError && (
                <div className="formsError formsFieldWide" role="alert">
                  {detailsError}
                </div>
              )}

              <div className="formsActions formsFieldWide">
                <button type="submit">Continue to contact details</button>
              </div>
            </form>
          </div>
        )}

        {step === 'contact' && (
          <div className="charterContact">
            <span className="formsEyebrow">STEP 2 OF 2</span>
            <h1>Who should our team contact?</h1>

            <div className="formsCard formsGrid">
              <label>
                <span>Full Name *</span>
                <input
                  type="text"
                  required
                  value={contact.fullName}
                  onChange={event => setContact(current => ({ ...current, fullName: event.target.value }))}
                />
              </label>
              <label>
                <span>Phone Number *</span>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 080..."
                  value={contact.phone}
                  onChange={event => setContact(current => ({ ...current, phone: event.target.value }))}
                />
              </label>
              <label className="formsFieldWide">
                <span>Email (optional)</span>
                <input
                  type="email"
                  value={contact.email}
                  onChange={event => setContact(current => ({ ...current, email: event.target.value }))}
                />
              </label>
              <label className="formsFieldWide">
                <span>Anything else we should know? (optional)</span>
                <textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} />
              </label>

              {contactError && (
                <div className="formsError formsFieldWide" role="alert">
                  {contactError}
                </div>
              )}
            </div>

            <div className="formsCard charterRecap">
              <h3>Confirm your request</h3>
              <dl>
                <div>
                  <dt>Charter</dt>
                  <dd>{details.charterType}</dd>
                </div>
                <div>
                  <dt>From</dt>
                  <dd>
                    {details.departurePoint}
                    {isPointToPoint && details.destination ? ` → ${details.destination}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>When</dt>
                  <dd>
                    {details.charterDate} &middot; {details.charterTime}
                  </dd>
                </div>
                <div>
                  <dt>Passengers</dt>
                  <dd>{details.passengers}</dd>
                </div>
              </dl>

              <p className="charterRecapNote">
                This is a request, not a confirmed booking. A member of the RideArrivo Boat team
                will review the details and contact you with vessel options and a firm price.
              </p>

              {submitError && (
                <div className="formsError" role="alert">
                  {submitError}
                </div>
              )}

              <div className="formsActions">
                <button type="button" disabled={busy} onClick={() => void confirmBooking()}>
                  {busy ? 'Sending...' : 'Send charter request'}
                </button>
                <button type="button" className="charterBackButton" onClick={() => setStep('details')}>
                  Back to charter details
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="formsSuccess charterSuccess">
            <span className="formsEyebrow">REQUEST RECEIVED</span>
            <h1>Your charter request is in.</h1>
            <p>
              A member of the RideArrivo Boat team will review your details and reach out to{' '}
              {contact.phone} with vessel options and a firm price ahead of{' '}
              {details.charterDate || 'your requested date'}.
              {reference ? ` Reference: ${reference}.` : ''}
            </p>
            <div className="charterSuccessActions">
              <button type="button" onClick={requestAnother}>
                Request another charter
              </button>
              <a href="https://www.ridearrivo.com">
                <button type="button" className="charterBackButton">
                  Back to ridearrivo.com
                </button>
              </a>
            </div>
          </div>
        )}

        <footer className="formsFooter">
          <span>RideArrivo Limited</span>
          <span>ArrivoBoat</span>
        </footer>
      </section>
    </main>
  )
}
