import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  Briefcase,
  Car,
  Check,
  PawPrint,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  ShieldCheck,
  Sparkles,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import { RideArrivoExactLogo } from './RideArrivoLogo'
import { AIRPORTS, searchAirports, formatAirport, type Airport } from './airports'
import { submitPublicIntakeForm, IntakeRequestError } from '../lib/intake'
import './forms-public.css'
import './charter.css'
import './air.css'

/*
 * air.ridearrivo.com (see isPublicFormsSurface() in main.tsx and the
 * hostname check in FormsApp.tsx).
 *
 * ArrivoAir -- private jet charter. Same underlying shape as
 * MoveApp/BoatApp (intro -> details -> contact & recap -> submit ->
 * success), submitting through the shared intake platform (slug
 * "private-jet-charter") so it shows up in Support's queue like every
 * other intake form does. The submission payload keys/values below must
 * stay in lockstep with the private-jet-charter field_schema (see
 * supabase/migrations/20260927130000_seed_boat_air_intake_forms.sql) --
 * the intake edge function rejects any payload key that schema doesn't
 * declare, and any select value not listed in that field's options
 * verbatim.
 *
 * This is a deliberately heavier build than a plain form: airport
 * fields are a searchable combobox instead of bare text inputs, the
 * flow is split into three steps with a real progress stepper (trip,
 * aircraft, contact) instead of two, and the aircraft step shows a live
 * route summary the way a ride-hailing app keeps your trip visible while
 * you pick a vehicle tier. None of this changes what gets submitted --
 * it is the same payload shape as before, just built to feel like a
 * proper product instead of a bare lead form.
 *
 * No self-serve price estimate here, deliberately -- private jet pricing
 * depends on live aircraft availability and positioning cost, which
 * changes trip to trip. Every real jet charter broker (NetJets, Villiers,
 * PrivateFly, etc.) runs a "request a quote" flow for exactly this
 * reason; Support confirms the real price, aircraft and operator after
 * reviewing the request.
 */

const TRIP_TYPES = ['One-way', 'Round-trip']

type JetClassOption = {
  value: string
  blurb: string
  capacity: string
  maxPax: number | null
  icon: LucideIcon
  iconSize: number
}

const JET_CLASS_OPTIONS: JetClassOption[] = [
  {
    value: 'No preference',
    blurb: "We'll match you to the best available aircraft for your route.",
    capacity: 'Matched to your trip',
    maxPax: null,
    icon: Sparkles,
    iconSize: 18,
  },
  {
    value: 'Light jet',
    blurb: 'Best for short-to-medium hops.',
    capacity: 'Up to 6-8 passengers',
    maxPax: 8,
    icon: PlaneTakeoff,
    iconSize: 18,
  },
  {
    value: 'Midsize jet',
    blurb: 'More cabin room, medium-to-long range.',
    capacity: 'Up to 8-9 passengers',
    maxPax: 9,
    icon: Plane,
    iconSize: 20,
  },
  {
    value: 'Super-midsize jet',
    blurb: 'Stand-up cabin, long range.',
    capacity: 'Up to 9-10 passengers',
    maxPax: 10,
    icon: Plane,
    iconSize: 23,
  },
  {
    value: 'Heavy jet',
    blurb: 'Long-range / intercontinental.',
    capacity: 'Up to 10-16 passengers',
    maxPax: 16,
    icon: PlaneLanding,
    iconSize: 27,
  },
]

const PASSENGER_COUNTS = ['1-3', '4-6', '7-9', '10-14', '15+']

const ADD_ONS: { value: string; icon: LucideIcon }[] = [
  { value: 'Ground transport on arrival', icon: Car },
  { value: 'In-flight catering', icon: UtensilsCrossed },
  { value: 'Pet travel', icon: PawPrint },
]

/*
 * Rough, non-scientific mapping from a passenger headcount to the jet
 * class that headcount actually fits in, used only to show a "Best
 * match" hint on the class cards -- it never restricts what someone can
 * pick, it just points at the sane default.
 */
function recommendedJetClass(passengers: string): string {
  switch (passengers) {
    case '1-3':
    case '4-6':
      return 'Light jet'
    case '7-9':
      return 'Midsize jet'
    case '10-14':
      return 'Super-midsize jet'
    case '15+':
      return 'Heavy jet'
    default:
      return ''
  }
}

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

type Step = 'intro' | 'trip' | 'aircraft' | 'contact' | 'success'

const STEP_ORDER: Step[] = ['trip', 'aircraft', 'contact']
const STEP_LABELS: Record<Step, string> = {
  intro: '',
  trip: 'Trip',
  aircraft: 'Aircraft',
  contact: 'Contact',
  success: '',
}

type Contact = {
  fullName: string
  phone: string
  email: string
}

/*
 * Searchable airport combobox. Still a plain text field under the hood
 * (whatever the visitor types or picks is sent to the backend as-is, a
 * "City (CODE)" string under the field's 200-char limit), so a route
 * this list doesn't cover never gets blocked -- it just won't
 * autocomplete. See airports.ts for the underlying list and ranking.
 */
function AirportField({
  label,
  placeholder,
  value,
  onChange,
  required,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLLabelElement>(null)
  const results = open ? searchAirports(value) : []

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  function selectAirport(airport: Airport) {
    onChange(formatAirport(airport))
    setOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted(current => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted(current => (current - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      if (results[highlighted]) {
        event.preventDefault()
        selectAirport(results[highlighted])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <label className="airAirportField" ref={containerRef}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      <div className="airAirportInputWrap">
        <input
          type="text"
          required={required}
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onChange={event => {
            onChange(event.target.value)
            setOpen(true)
            setHighlighted(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {open && results.length > 0 && (
          <ul className="airAirportDropdown" role="listbox">
            {results.map((airport, index) => (
              <li key={airport.code} role="option" aria-selected={index === highlighted}>
                <button
                  type="button"
                  className={
                    'airAirportOption' + (index === highlighted ? ' airAirportOptionActive' : '')
                  }
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => selectAirport(airport)}
                >
                  <span className="airAirportOptionCode">{airport.code}</span>
                  <span className="airAirportOptionName">
                    {airport.city}
                    <small>
                      {airport.name}, {airport.country}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  )
}

function TripStepper({ current }: { current: Step }) {
  if (current === 'intro' || current === 'success') return null
  const currentIndex = STEP_ORDER.indexOf(current)

  return (
    <ol className="airStepper" aria-label="Request progress">
      {STEP_ORDER.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'upcoming'
        return (
          <li key={step} className={`airStepperItem airStepperItem--${state}`}>
            <span className="airStepperDot">{state === 'done' ? <Check size={14} /> : index + 1}</span>
            <span className="airStepperLabel">{STEP_LABELS[step]}</span>
            {index < STEP_ORDER.length - 1 && <span className="airStepperConnector" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

function TripSummaryBar({ details, isRoundTrip }: { details: Details; isRoundTrip: boolean }) {
  if (!details.departureAirport.trim() || !details.destinationAirport.trim()) return null

  return (
    <div className="airTripBar">
      <div className="airTripBarRoute">
        <span className="airTripBarPoint">{details.departureAirport}</span>
        <span className="airTripBarLine" aria-hidden="true">
          <Plane size={14} className="airTripBarPlane" />
        </span>
        <span className="airTripBarPoint">{details.destinationAirport}</span>
      </div>
      <div className="airTripBarMeta">
        {details.tripType && <span>{details.tripType}</span>}
        {details.departureDate && (
          <span>
            {details.departureDate}
            {isRoundTrip && details.returnDate ? ` → ${details.returnDate}` : ''}
          </span>
        )}
        {details.passengers && <span>{details.passengers} pax</span>}
      </div>
    </div>
  )
}

export default function AirApp() {
  const [step, setStep] = useState<Step>('intro')
  const [details, setDetails] = useState<Details>(INITIAL_DETAILS)
  const [tripError, setTripError] = useState('')

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
  const bestMatchJetClass = recommendedJetClass(details.passengers)

  function handleTripSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTripError('')

    if (!details.tripType) return setTripError('Please choose one-way or round-trip.')
    if (!details.departureAirport.trim()) return setTripError('Please enter a departure airport or city.')
    if (!details.destinationAirport.trim()) return setTripError('Please enter a destination airport or city.')
    if (!details.departureDate) return setTripError('Please choose a departure date.')
    if (!details.departureTime) return setTripError('Please choose a departure time.')
    if (isRoundTrip && !details.returnDate) return setTripError('Please choose a return date.')
    if (!details.passengers) return setTripError('Please choose how many passengers.')

    setStep('aircraft')
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
    <main className="formsPage charterPage airPage">
      <section className="formsShell charterShell">
        <header className="formsHeader">
          <RideArrivoExactLogo />
          <span className="formsBadge airBadge">
            <Plane size={12} />
            PRIVATE JET CHARTER
          </span>
        </header>

        <TripStepper current={step} />

        {step === 'intro' && (
          <div className="charterIntro airStepEnter">
            <span className="formsEyebrow">ARRIVOAIR</span>
            <h1>Private jets, on request. Uber for the sky.</h1>
            <p className="charterLead">
              Tell us your route, dates and party size, and our team will come back with
              aircraft options and a firm price from our network of operators.
            </p>

            <ul className="charterHighlights airHighlights">
              <li>
                <ShieldCheck size={15} /> Vetted operators and licensed aircraft, not a broker guessing game
              </li>
              <li>
                <Plane size={15} /> One-way or round-trip, any class from light jet to heavy jet
              </li>
              <li>
                <Check size={15} /> A member of our team confirms the exact price before you book
              </li>
            </ul>

            <div className="formsActions">
              <button type="button" onClick={() => setStep('trip')}>
                Request a flight
              </button>
              <small>Takes about two minutes. No payment required to request a quote.</small>
            </div>
          </div>
        )}

        {step === 'trip' && (
          <div className="charterDetails airStepEnter">
            <span className="formsEyebrow">STEP 1 OF 3</span>
            <h1>Where are you flying?</h1>
            <p className="charterLead">
              The more we know, the faster we can come back with real aircraft options.
            </p>

            <form className="formsCard formsGrid" onSubmit={handleTripSubmit}>
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

              <AirportField
                label="Departure Airport / City"
                placeholder="e.g. Lagos (LOS)"
                value={details.departureAirport}
                onChange={value => updateDetails('departureAirport', value)}
                required
              />
              <AirportField
                label="Destination Airport / City"
                placeholder="e.g. Abuja (ABV)"
                value={details.destinationAirport}
                onChange={value => updateDetails('destinationAirport', value)}
                required
              />

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

              {tripError && (
                <div className="formsError formsFieldWide" role="alert">
                  {tripError}
                </div>
              )}

              <div className="formsActions formsFieldWide">
                <button type="submit">Continue to aircraft &amp; add-ons</button>
              </div>
            </form>
          </div>
        )}

        {step === 'aircraft' && (
          <div className="charterDetails airStepEnter">
            <span className="formsEyebrow">STEP 2 OF 3</span>
            <h1>Pick an aircraft class.</h1>
            <p className="charterLead">
              Not sure what fits your group? Leave it on "No preference" and we'll match you to
              the best available aircraft.
            </p>

            <TripSummaryBar details={details} isRoundTrip={isRoundTrip} />

            <div className="formsCard formsGrid">
              <div className="formsFieldWide charterClassPicker">
                <span>Aircraft Class</span>
                <div className="charterClassOptions airClassOptions">
                  {JET_CLASS_OPTIONS.map(option => {
                    const Icon = option.icon
                    const isSelected = details.jetClass === option.value
                    const isRecommended = !isSelected && option.value === bestMatchJetClass
                    return (
                      <button
                        type="button"
                        key={option.value}
                        className={
                          'charterClassCard airClassCard' +
                          (isSelected ? ' charterClassCardSelected' : '')
                        }
                        onClick={() => updateDetails('jetClass', option.value)}
                      >
                        {isRecommended && <span className="airClassBadge">Best match</span>}
                        <span className="airClassIcon" aria-hidden="true">
                          <Icon size={option.iconSize} />
                        </span>
                        <span className="charterClassName">{option.value}</span>
                        <span className="airClassCapacity">{option.capacity}</span>
                        <span className="charterClassBlurb">{option.blurb}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="formsFieldWide charterCheckboxGroup airAddOnGroup">
                <span>Add-ons (optional)</span>
                <div className="charterCheckboxRow airAddOnRow">
                  {ADD_ONS.map(option => {
                    const Icon = option.icon
                    const checked = details.addOns.includes(option.value)
                    return (
                      <label
                        key={option.value}
                        className={'charterCheckboxField airAddOnField' + (checked ? ' airAddOnFieldChecked' : '')}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAddOn(option.value)}
                        />
                        <Icon size={15} />
                        <span>{option.value}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="formsActions formsFieldWide">
                <button type="button" onClick={() => setStep('contact')}>
                  Continue to contact details
                </button>
                <button type="button" className="charterBackButton" onClick={() => setStep('trip')}>
                  Back to trip
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'contact' && (
          <div className="charterContact airStepEnter">
            <span className="formsEyebrow">STEP 3 OF 3</span>
            <h1>Who should our team contact?</h1>

            <TripSummaryBar details={details} isRoundTrip={isRoundTrip} />

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

            <div className="formsCard charterRecap airRecap">
              <h3>Confirm your request</h3>

              <div className="airRouteVisual" aria-hidden="true">
                <span className="airRouteVisualPoint">
                  <PlaneTakeoff size={16} />
                  {details.departureAirport}
                </span>
                <span className="airRouteVisualTrack">
                  <span className="airRouteVisualPlane">
                    <Plane size={14} />
                  </span>
                </span>
                <span className="airRouteVisualPoint">
                  <PlaneLanding size={16} />
                  {details.destinationAirport}
                </span>
              </div>

              <dl>
                <div>
                  <dt>Trip</dt>
                  <dd>{details.tripType}</dd>
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
                <div>
                  <dt>Aircraft</dt>
                  <dd>
                    {details.jetClass}
                    {details.addOns.length > 0 ? ` · ${details.addOns.join(', ')}` : ''}
                  </dd>
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
                <button type="button" className="charterBackButton" onClick={() => setStep('aircraft')}>
                  Back to aircraft
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="formsSuccess charterSuccess airStepEnter">
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

/*
 * Re-exported so a future admin tool or test can validate a typed-in
 * airport against the same list this form autocompletes from, without
 * duplicating it.
 */
export { AIRPORTS }
