import { useMemo, useState, type FormEvent } from 'react'
import { RideArrivoExactLogo } from './RideArrivoLogo'
import { submitPublicIntakeForm, IntakeRequestError } from '../lib/intake'
import './forms-public.css'
import './move.css'

/*
 * move.ridearrivo.com (see isPublicFormsSurface() in main.tsx and the
 * hostname check in FormsApp.tsx).
 *
 * Flow: intro (marketing copy, "Get my moving quote") -> move details
 * (date, time window, pickup/dropoff address + area + floor access,
 * property size, packing help, special items, crew size, with a live
 * estimate that updates as the form fills in) -> contact details, a
 * final recap and the estimate, then confirm -> submit (via the same
 * intake platform contact-us/charter-booking/membership-signup already
 * use, slug "move-booking") -> success.
 *
 * The estimate is a starting number, not a quote: it is computed
 * entirely client-side from a simple base price (by property size) x a
 * distance tier (same area / cross-town / interstate) plus flat add-on
 * fees (packing help, floor access, special items, crew size, an
 * evening surcharge). It is sent along with the submission as
 * estimated_price so Support has context, but the confirm screen is
 * explicit that RideArrivo's team confirms the real price, crew and
 * arrival window after reviewing the request, the same "notify before
 * confirming" pattern used on the membership signup.
 */

const MOVE_WINDOWS = ['Morning (8am to 12pm)', 'Afternoon (12pm to 4pm)', 'Evening (4pm to 8pm)']

const AREAS = [
  'Lekki / Ajah',
  'Victoria Island / Ikoyi',
  'Ikeja / Mainland',
  'Festac / Amuwo',
  'Surulere / Yaba',
  'Makoko',
  'Interstate',
  'Other',
]

const ACCESS_OPTIONS = [
  'Ground floor / drive-up access',
  'Upper floor, elevator available',
  'Upper floor, no elevator (walk-up)',
]

const PROPERTY_SIZES = [
  'Single Room / Self-Contain',
  'Studio / 1 Bedroom Flat',
  '2 Bedroom Flat',
  '3 Bedroom Flat',
  '4+ Bedroom / Duplex',
  'Office / Commercial Space',
]

const SPECIAL_ITEM_OPTIONS = [
  'None',
  'Fragile / glass items',
  'Piano or heavy furniture',
  'Large appliances (fridge, washer, etc.)',
  'Other (describe in notes)',
]

const CREW_SIZES = ['Standard crew (2 movers)', 'Large crew (4 movers)']

const BASE_PRICE: Record<string, number> = {
  'Single Room / Self-Contain': 30000,
  'Studio / 1 Bedroom Flat': 45000,
  '2 Bedroom Flat': 65000,
  '3 Bedroom Flat': 95000,
  '4+ Bedroom / Duplex': 140000,
  'Office / Commercial Space': 120000,
}

const ACCESS_FEE: Record<string, number> = {
  'Ground floor / drive-up access': 0,
  'Upper floor, elevator available': 4000,
  'Upper floor, no elevator (walk-up)': 9000,
}

const SPECIAL_ITEM_FEE: Record<string, number> = {
  'None': 0,
  'Fragile / glass items': 9000,
  'Piano or heavy furniture': 25000,
  'Large appliances (fridge, washer, etc.)': 14000,
  'Other (describe in notes)': 12000,
}

const CREW_FEE: Record<string, number> = {
  'Standard crew (2 movers)': 0,
  'Large crew (4 movers)': 18000,
}

const INTERSTATE_FLAT_FEE = 35000
const EVENING_SURCHARGE = 6000
const PACKING_HELP_FEE = 18000

function formatNaira(value: number) {
  return `₦${Math.round(value).toLocaleString('en-NG')}`
}

type MoveDetails = {
  moveDate: string
  moveWindow: string
  pickupAddress: string
  pickupArea: string
  pickupAccess: string
  pickupInterstateState: string
  dropoffAddress: string
  dropoffArea: string
  dropoffAccess: string
  dropoffInterstateState: string
  propertySize: string
  packingHelp: boolean
  specialItems: string
  crewSize: string
}

const INITIAL_DETAILS: MoveDetails = {
  moveDate: '',
  moveWindow: '',
  pickupAddress: '',
  pickupArea: '',
  pickupAccess: 'Ground floor / drive-up access',
  pickupInterstateState: '',
  dropoffAddress: '',
  dropoffArea: '',
  dropoffAccess: 'Ground floor / drive-up access',
  dropoffInterstateState: '',
  propertySize: '',
  packingHelp: false,
  specialItems: 'None',
  crewSize: 'Standard crew (2 movers)',
}

type Estimate = { low: number; high: number }

function computeEstimate(details: MoveDetails): Estimate | null {
  const base = BASE_PRICE[details.propertySize]
  if (!base || !details.pickupArea || !details.dropoffArea) return null

  const isInterstate = details.pickupArea === 'Interstate' || details.dropoffArea === 'Interstate'
  const isLocal = !isInterstate && details.pickupArea === details.dropoffArea
  const zoneMultiplier = isInterstate ? 2.4 : isLocal ? 1 : 1.35

  let subtotal = base * zoneMultiplier
  subtotal += ACCESS_FEE[details.pickupAccess] || 0
  subtotal += ACCESS_FEE[details.dropoffAccess] || 0
  subtotal += SPECIAL_ITEM_FEE[details.specialItems] || 0
  subtotal += CREW_FEE[details.crewSize] || 0
  if (details.packingHelp) subtotal += PACKING_HELP_FEE
  if (details.moveWindow.startsWith('Evening')) subtotal += EVENING_SURCHARGE
  if (isInterstate) subtotal += INTERSTATE_FLAT_FEE

  const low = Math.round((subtotal * 0.92) / 500) * 500
  const high = Math.round((subtotal * 1.12) / 500) * 500

  return { low, high }
}

// Mirrors EasyBookApp's getIdempotencyKey() -- a sessionStorage-persisted
// UUID so a double-submit (double click, retry after a network hiccup)
// doesn't create two move bookings. Cleared once the request actually
// succeeds so a later, separate booking gets a fresh key.
function getMoveIdempotencyKey(): string {
  const key = window.sessionStorage.getItem('ra_move_idempotency_key')
  if (key) return key
  const fresh =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
          const random = (Math.random() * 16) | 0
          const value = char === 'x' ? random : (random & 0x3) | 0x8
          return value.toString(16)
        })
  window.sessionStorage.setItem('ra_move_idempotency_key', fresh)
  return fresh
}

type Step = 'intro' | 'details' | 'contact' | 'success'

type Contact = {
  fullName: string
  phone: string
  email: string
}

export default function MoveApp() {
  const [step, setStep] = useState<Step>('intro')
  const [details, setDetails] = useState<MoveDetails>(INITIAL_DETAILS)
  const [detailsError, setDetailsError] = useState('')

  const [contact, setContact] = useState<Contact>({ fullName: '', phone: '', email: '' })
  const [notes, setNotes] = useState('')
  const [contactError, setContactError] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [reference, setReference] = useState('')
  const [website, setWebsite] = useState('') // honeypot field, never rendered to real visitors

  const estimate = useMemo(() => computeEstimate(details), [details])

  function updateDetails<K extends keyof MoveDetails>(key: K, value: MoveDetails[K]) {
    setDetails(current => ({ ...current, [key]: value }))
  }

  function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDetailsError('')

    if (!details.moveDate) return setDetailsError('Please choose a moving date.')
    if (!details.moveWindow) return setDetailsError('Please choose a time window.')
    if (!details.pickupAddress.trim()) return setDetailsError('Please enter the pickup address.')
    if (!details.pickupArea) return setDetailsError('Please choose the pickup area.')
    if (details.pickupArea === 'Interstate' && !details.pickupInterstateState.trim()) {
      return setDetailsError('Please tell us which state you are moving from.')
    }
    if (!details.dropoffAddress.trim()) return setDetailsError('Please enter the dropoff address.')
    if (!details.dropoffArea) return setDetailsError('Please choose the dropoff area.')
    if (details.dropoffArea === 'Interstate' && !details.dropoffInterstateState.trim()) {
      return setDetailsError('Please tell us which state you are moving to.')
    }
    if (!details.propertySize) return setDetailsError('Please choose the size of the place you are moving.')

    setStep('contact')
  }

  async function confirmBooking() {
    if (busy) return
    setContactError('')
    setSubmitError('')

    if (!contact.fullName.trim()) return setContactError('Please tell us your name.')
    if (!contact.phone.trim()) return setContactError('A phone number is required so our crew can reach you.')

    setBusy(true)
    try {
      const submission = await submitPublicIntakeForm({
        slug: 'move-booking',
        payload: {
          move_date: details.moveDate,
          move_window: details.moveWindow,
          pickup_address: details.pickupAddress.trim(),
          pickup_area: details.pickupArea,
          pickup_access: details.pickupAccess,
          pickup_interstate_state:
            details.pickupArea === 'Interstate' ? details.pickupInterstateState.trim() : '',
          dropoff_address: details.dropoffAddress.trim(),
          dropoff_area: details.dropoffArea,
          dropoff_access: details.dropoffAccess,
          dropoff_interstate_state:
            details.dropoffArea === 'Interstate' ? details.dropoffInterstateState.trim() : '',
          property_size: details.propertySize,
          packing_help: details.packingHelp,
          special_items: details.specialItems,
          crew_size: details.crewSize,
          full_name: contact.fullName.trim(),
          phone: contact.phone.trim(),
          email: contact.email.trim(),
          notes: notes.trim(),
          estimated_price: estimate ? `${formatNaira(estimate.low)} to ${formatNaira(estimate.high)}` : '',
          // Note: not yet a field the intake backend/schema is confirmed to
          // dedupe on -- see getMoveIdempotencyKey()'s comment.
          idempotencyKey: getMoveIdempotencyKey(),
        },
        website,
      })
      setReference(submission.reference || '')
      window.sessionStorage.removeItem('ra_move_idempotency_key')
      setStep('success')
    } catch (cause) {
      setSubmitError(
        cause instanceof IntakeRequestError
          ? cause.fields.join(' ') || cause.message
          : cause instanceof Error
            ? cause.message
            : 'Unable to submit your booking.',
      )
    } finally {
      setBusy(false)
    }
  }

  function bookAnotherMove() {
    setDetails(INITIAL_DETAILS)
    setContact({ fullName: '', phone: '', email: '' })
    setNotes('')
    setReference('')
    setStep('intro')
  }

  return (
    <main className="formsPage movePage">
      <section className="formsShell moveShell">
        <header className="formsHeader">
          <RideArrivoExactLogo />
          <span className="formsBadge">MOVING</span>
        </header>

        {step === 'intro' && (
          <div className="moveIntro">
            <span className="formsEyebrow">RIDEARRIVO MOVING</span>
            <h1>Need to move from your old apartment to a new one? Book us now.</h1>
            <p className="moveLead">
              A truck, a careful crew and one point of contact for your whole move, from a single
              room to a full house or office relocation. Tell us the details and see a starting
              price before you book anything.
            </p>

            <ul className="moveHighlights">
              <li>Vetted moving crews, not a stranger with a truck</li>
              <li>See a price estimate before you commit to anything</li>
              <li>One booking covers loading, transport and unloading</li>
            </ul>

            <div className="formsActions">
              <button type="button" onClick={() => setStep('details')}>
                Get my moving quote
              </button>
              <small>Takes about two minutes. No payment required to get an estimate.</small>
            </div>
          </div>
        )}

        {step === 'details' && (
          <div className="moveDetails">
            <span className="formsEyebrow">STEP 1 OF 2</span>
            <h1>Tell us about your move.</h1>
            <p className="moveLead">
              The more we know, the more accurate your estimate and your moving crew will be.
            </p>

            <form className="formsCard formsGrid" onSubmit={handleDetailsSubmit}>
              <label>
                <span>Moving Date *</span>
                <input
                  type="date"
                  required
                  value={details.moveDate}
                  onChange={event => updateDetails('moveDate', event.target.value)}
                />
              </label>
              <label>
                <span>Time Window *</span>
                <select
                  required
                  value={details.moveWindow}
                  onChange={event => updateDetails('moveWindow', event.target.value)}
                >
                  <option value="">Choose a window</option>
                  {MOVE_WINDOWS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="formsFieldWide">
                <span>Pickup Address *</span>
                <input
                  type="text"
                  required
                  placeholder="Street, building, landmark"
                  value={details.pickupAddress}
                  onChange={event => updateDetails('pickupAddress', event.target.value)}
                />
              </label>
              <label>
                <span>Pickup Area *</span>
                <select
                  required
                  value={details.pickupArea}
                  onChange={event => updateDetails('pickupArea', event.target.value)}
                >
                  <option value="">Choose an area</option>
                  {AREAS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Pickup Floor Access *</span>
                <select
                  required
                  value={details.pickupAccess}
                  onChange={event => updateDetails('pickupAccess', event.target.value)}
                >
                  {ACCESS_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              {details.pickupArea === 'Interstate' && (
                <label className="formsFieldWide">
                  <span>Which state are you moving from? *</span>
                  <input
                    type="text"
                    required
                    value={details.pickupInterstateState}
                    onChange={event => updateDetails('pickupInterstateState', event.target.value)}
                  />
                </label>
              )}

              <label className="formsFieldWide">
                <span>Dropoff Address *</span>
                <input
                  type="text"
                  required
                  placeholder="Street, building, landmark"
                  value={details.dropoffAddress}
                  onChange={event => updateDetails('dropoffAddress', event.target.value)}
                />
              </label>
              <label>
                <span>Dropoff Area *</span>
                <select
                  required
                  value={details.dropoffArea}
                  onChange={event => updateDetails('dropoffArea', event.target.value)}
                >
                  <option value="">Choose an area</option>
                  {AREAS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Dropoff Floor Access *</span>
                <select
                  required
                  value={details.dropoffAccess}
                  onChange={event => updateDetails('dropoffAccess', event.target.value)}
                >
                  {ACCESS_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              {details.dropoffArea === 'Interstate' && (
                <label className="formsFieldWide">
                  <span>Which state are you moving to? *</span>
                  <input
                    type="text"
                    required
                    value={details.dropoffInterstateState}
                    onChange={event => updateDetails('dropoffInterstateState', event.target.value)}
                  />
                </label>
              )}

              <label>
                <span>Size of the Place *</span>
                <select
                  required
                  value={details.propertySize}
                  onChange={event => updateDetails('propertySize', event.target.value)}
                >
                  <option value="">Choose a size</option>
                  {PROPERTY_SIZES.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Crew Size</span>
                <select
                  value={details.crewSize}
                  onChange={event => updateDetails('crewSize', event.target.value)}
                >
                  {CREW_SIZES.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Special Items</span>
                <select
                  value={details.specialItems}
                  onChange={event => updateDetails('specialItems', event.target.value)}
                >
                  {SPECIAL_ITEM_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="moveCheckboxField">
                <input
                  type="checkbox"
                  checked={details.packingHelp}
                  onChange={event => updateDetails('packingHelp', event.target.checked)}
                />
                <span>Pack for me (boxes, wrapping and labeling included)</span>
              </label>

              <div className="moveEstimateBox formsFieldWide">
                {estimate ? (
                  <>
                    <span className="moveEstimateLabel">Estimated cost</span>
                    <strong>
                      {formatNaira(estimate.low)} to {formatNaira(estimate.high)}
                    </strong>
                    <small>
                      A starting estimate based on your answers so far. Final pricing is confirmed
                      by our team after reviewing your move.
                    </small>
                  </>
                ) : (
                  <span className="moveEstimatePlaceholder">
                    Fill in the areas and the size of the place to see your estimate.
                  </span>
                )}
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
          <div className="moveContact">
            <span className="formsEyebrow">STEP 2 OF 2</span>
            <h1>Who should our crew contact?</h1>

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
                  placeholder="+2348012345678"
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

              <label className="formsHoney" aria-hidden="true">
                Website
                <input tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
              </label>

              {contactError && (
                <div className="formsError formsFieldWide" role="alert">
                  {contactError}
                </div>
              )}
            </div>

            <div className="formsCard moveRecap">
              <h3>Confirm your move</h3>
              <dl>
                <div>
                  <dt>From</dt>
                  <dd>
                    {details.pickupAddress}, {details.pickupArea}
                  </dd>
                </div>
                <div>
                  <dt>To</dt>
                  <dd>
                    {details.dropoffAddress}, {details.dropoffArea}
                  </dd>
                </div>
                <div>
                  <dt>When</dt>
                  <dd>
                    {details.moveDate} &middot; {details.moveWindow}
                  </dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{details.propertySize}</dd>
                </div>
              </dl>

              {estimate && (
                <p className="moveRecapPrice">
                  Estimated cost: <strong>{formatNaira(estimate.low)} to {formatNaira(estimate.high)}</strong>
                </p>
              )}

              <p className="moveRecapNote">
                This is a starting estimate, not a final price. Before your move is confirmed, a
                member of the RideArrivo Moving team will contact you to confirm the exact price,
                crew and arrival window.
              </p>

              {submitError && (
                <div className="formsError" role="alert">
                  {submitError}
                </div>
              )}

              <div className="formsActions">
                <button type="button" disabled={busy} onClick={() => void confirmBooking()}>
                  {busy ? 'Booking...' : 'Confirm & book my move'}
                </button>
                <button type="button" className="moveBackButton" onClick={() => setStep('details')}>
                  Back to move details
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="formsSuccess moveSuccess">
            <span className="formsEyebrow">BOOKING RECEIVED</span>
            <h1>Your move is booked in for review.</h1>
            <p>
              A member of the RideArrivo Moving team will review your details and reach out to{' '}
              {contact.phone} to confirm your exact price, crew and arrival window ahead of{' '}
              {details.moveDate || 'your moving date'}.
              {reference ? ` Reference: ${reference}.` : ''}
            </p>
            <div className="moveSuccessActions">
              <button type="button" onClick={bookAnotherMove}>
                Book another move
              </button>
              <a href="https://www.ridearrivo.com">
                <button type="button" className="moveBackButton">
                  Back to ridearrivo.com
                </button>
              </a>
            </div>
          </div>
        )}

        <footer className="formsFooter">
          <span>RideArrivo Limited</span>
          <span>Moving</span>
        </footer>
      </section>
    </main>
  )
}
