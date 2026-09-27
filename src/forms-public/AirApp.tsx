import { useState, type FormEvent } from 'react'
import { RideArrivoExactLogo } from './RideArrivoLogo'
import { submitPublicIntakeForm, IntakeRequestError } from '../lib/intake'
import './forms-public.css'
import './charter.css'

/*
 * air.ridearrivo.com (see isPublicFormsSurface() in main.tsx and the
 * hostname check in FormsApp.tsx).
 *
 * ArrivoAir -- private jet charter. Same shape as MoveApp/BoatApp (intro
 * -> details -> contact & recap -> submit -> success), submitting through
 * the shared intake platform (slug "private-jet-charter") so it shows up
 * in Support's queue like every other intake form does.
 *
 * No self-serve price estimate here, deliberately -- private jet pricing
 * depends on live aircraft availability and positioning cost, which
 * changes trip to trip. Every real jet charter broker (NetJets, Villiers,
 * PrivateFly, etc.) runs a "request a quote" flow for exactly this
 * reason; Support confirms the real price, aircraft and operator after
 * reviewing the request.
 */

const TRIP_TYPES = ['One-way', 'Round-trip']

const JET_CLASS_OPTIONS = [
  { value: 'No preference', blurb: "We'll match you to the best available aircraft for your route." },
  { value: 'Light jet', blurb: 'Up to 6-8 passengers. Best for short-to-medium hops.' },
  { value: 'Midsize jet', blurb: 'Up to 8-9 passengers, more cabin room, medium-to-long range.' },
  { value: 'Super-midsize jet', blurb: 'Up to 9-10 passengers, stand-up cabin, long range.' },
  { value: 'Heavy jet', blurb: 'Up to 10-16 passengers, long-range / intercontinental.' },
]

const PASSENGER_COUNTS = ['1-3', '4-6', '7-9', '10-14', '15+']

const ADD_ONS = ['Ground transport on arrival', 'In-flight catering', 'Pet travel']

type Details = {
  tripType: string
  departureAirport: string
  destinationAirport: string
  departureDate: string
  departureTime: string
  returnDate: string
  passengers: string
  jetClass: string
  addOns: string[]
}

const INITIAL_DETAILS: Details = {
  tripType: '',
  departureAirport: '',
  destinationAirport: '',
  departureDate: '',
  departureTime: '',
  returnDate: '',
  passengers: '',
  jetClass: 'No preference',
  addOns: [],
}

type Step = 'intro' | 'details' | 'contact' | 'success'

type Contact = {
  fullName: string
  phone: string
  email: string
}

export default function AirApp() {
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

  function toggleAddOn(option: string) {
    setDetails(current => ({
      ...current,
      addOns: current.addOns.includes(option)
        ? current.addOns.filter(item => item !== option)
        : [...current.addOns, option],
    }))
  }

  const isRoundTrip = details.tripType === 'Round-trip'

  function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDetailsError('')

    if (!details.tripType) return setDetailsError('Please choose one-way or round-trip.')
    if (!details.departureAirport.trim()) return setDetailsError('Please enter a departure airport or city.')
    if (!details.destinationAirport.trim()) return setDetailsError('Please enter a destination airport or city.')
    if (!details.departureDate) return setDetailsError('Please choose a departure date.')
    if (!details.departureTime) return setDetailsError('Please choose a departure time.')
    if (isRoundTrip && !details.returnDate) return setDetailsError('Please choose a return date.')
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
        slug: 'private-jet-charter',
        payload: {
          trip_type: details.tripType,
          departure_airport: details.departureAirport.trim(),
          destination_airport: details.destinationAirport.trim(),
          departure_date: details.departureDate,
          departure_time: details.departureTime,
          return_date: isRoundTrip ? details.returnDate : '',
          passengers: details.passengers,
          jet_class: details.jetClass,
          add_ons: details.addOns.join(', '),
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
          <span className="formsBadge">PRIVATE JET CHARTER</span>
        </header>

        {step === 'intro' && (
          <div className="charterIntro">
            <span className="formsEyebrow">ARRIVOAIR</span>
            <h1>Private jets, on request. Uber for the sky.</h1>
            <p className="charterLead">
              Tell us your route, dates and party size, and our team will come back with
              aircraft options and a firm price from our network of operators.
            </p>

            <ul className="charterHighlights">
              <li>Vetted operators and licensed aircraft, not a broker guessing game</li>
              <li>One-way or round-trip, any class from light jet to heavy jet</li>
              <li>A member of our team confirms the exact price before you book</li>
            </ul>

            <div className="formsActions">
              <button type="button" onClick={() => setStep('details')}>
                Request a flight
              </button>
              <small>Takes about two minutes. No payment required to request a quote.</small>
            </div>
          </div>
        )}

        {step === 'details' && (
          <div className="charterDetails">
            <span className="formsEyebrow">STEP 1 OF 2</span>
            <h1>Tell us about your trip.</h1>
            <p className="charterLead">
              The more we know, the faster we can come back with real aircraft options.
            </p>

            <form className="formsCard formsGrid" onSubmit={handleDetailsSubmit}>
              <label className="formsFieldWide">
                <span>Trip Type *</span>
                <select
                  required
                  value={details.tripType}
                  onChange={event => updateDetails('tripType', event.target.value)}
                >
                  <option value="">Choose a trip type</option>
                  {TRIP_TYPES.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Departure Airport / City *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Lagos (LOS)"
                  value={details.departureAirport}
                  onChange={event => updateDetails('departureAirport', event.target.value)}
                />
              </label>
              <label>
                <span>Destination Airport / City *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Abuja (ABV)"
                  value={details.destinationAirport}
                  onChange={event => updateDetails('destinationAirport', event.target.value)}
                />
              </label>

              <label>
                <span>Departure Date *</span>
                <input
                  type="date"
                  required
                  value={details.departureDate}
                  onChange={event => updateDetails('departureDate', event.target.value)}
                />
              </label>
              <label>
                <span>Departure Time *</span>
                <input
                  type="time"
                  required
                  value={details.departureTime}
                  onChange={event => updateDetails('departureTime', event.target.value)}
                />
              </label>
              {isRoundTrip && (
                <label>
                  <span>Return Date *</span>
                  <input
                    type="date"
                    required
                    value={details.returnDate}
                    onChange={event => updateDetails('returnDate', event.target.value)}
                  />
                </label>
              )}

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
                <span>Aircraft Class</span>
                <div className="charterClassOptions">
                  {JET_CLASS_OPTIONS.map(option => (
                    <button
                      type="button"
                      key={option.value}
                      className={
                        'charterClassCard' +
                        (details.jetClass === option.value ? ' charterClassCardSelected' : '')
                      }
                      onClick={() => updateDetails('jetClass', option.value)}
                    >
                      <span className="charterClassName">{option.value}</span>
                      <span className="charterClassBlurb">{option.blurb}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="formsFieldWide charterCheckboxGroup">
                <span>Add-ons (optional)</span>
                <div className="charterCheckboxRow">
                  {ADD_ONS.map(option => (
                    <label key={option} className="charterCheckboxField">
                      <input
                        type="checkbox"
                        checked={details.addOns.includes(option)}
                        onChange={() => toggleAddOn(option)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </div>

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
                  <dt>Trip</dt>
                  <dd>{details.tripType}</dd>
                </div>
                <div>
                  <dt>Route</dt>
                  <dd>
                    {details.departureAirport} &rarr; {details.destinationAirport}
                  </dd>
                </div>
                <div>
                  <dt>When</dt>
                  <dd>
                    {details.departureDate} &middot; {details.departureTime}
                    {isRoundTrip && details.returnDate ? ` (return ${details.returnDate})` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Passengers</dt>
                  <dd>{details.passengers}</dd>
                </div>
              </dl>

              <p className="charterRecapNote">
                This is a request, not a confirmed booking. A member of the RideArrivo Air team
                will review the details and contact you with aircraft options and a firm price.
              </p>

              {submitError && (
                <div className="formsError" role="alert">
                  {submitError}
                </div>
              )}

              <div className="formsActions">
                <button type="button" disabled={busy} onClick={() => void confirmBooking()}>
                  {busy ? 'Sending...' : 'Send flight request'}
                </button>
                <button type="button" className="charterBackButton" onClick={() => setStep('details')}>
                  Back to trip details
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="formsSuccess charterSuccess">
            <span className="formsEyebrow">REQUEST RECEIVED</span>
            <h1>Your flight request is in.</h1>
            <p>
              A member of the RideArrivo Air team will review your details and reach out to{' '}
              {contact.phone} with aircraft options and a firm price ahead of{' '}
              {details.departureDate || 'your requested date'}.
              {reference ? ` Reference: ${reference}.` : ''}
            </p>
            <div className="charterSuccessActions">
              <button type="button" onClick={requestAnother}>
                Request another flight
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
          <span>ArrivoAir</span>
        </footer>
      </section>
    </main>
  )
}
