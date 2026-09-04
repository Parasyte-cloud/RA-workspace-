import {
  useRef,
  useState
} from 'react'

import {
  BadgeCheck,
  CarFront,
  CreditCard,
  LoaderCircle,
  UserSearch
} from 'lucide-react'

import {
  createRideArrivoAssistedBooking
} from '../lib/ridearrivoSupport'

import type {
  AssistedBookingResult
} from '../lib/ridearrivoSupport'

import '../support-assisted-booking.css'

type BookingType =
  | 'one_way'
  | 'dropoff'
  | 'full_day'
  | 'full_week'
  | 'full_month'

type VehicleType =
  | 'sedan'
  | 'suv'
  | 'truck'
  | 'pickup'

type Draft = {
  riderId: string
  email: string
  phone: string
  bookingType: BookingType
  vehicleType: VehicleType
  pickupAddress: string
  destinationAddress: string
  flightNumber: string
  scheduledPickupAt: string
  adults: string
  children: string
  durationDays: string
  fleetSize: '0' | '2' | '3'
  securityEscort: boolean
  luxury: boolean
  agreedCancellationPolicy: boolean
}

const initialDraft: Draft = {
  riderId: '',
  email: '',
  phone: '',
  bookingType: 'one_way',
  vehicleType: 'sedan',
  pickupAddress: '',
  destinationAddress: '',
  flightNumber: '',
  scheduledPickupAt: '',
  adults: '1',
  children: '0',
  durationDays: '1',
  fleetSize: '0',
  securityEscort: false,
  luxury: false,
  agreedCancellationPolicy: false,
}

function formatNaira(
  value: number | string | undefined
) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return value === undefined
      ? '—'
      : String(value)
  }

  return new Intl.NumberFormat(
    'en-NG',
    {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 2,
    }
  ).format(numeric)
}

function formatUsd(
  value: number | string | undefined
) {
  if (value === undefined) {
    return '—'
  }

  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return String(value)
  }

  return new Intl.NumberFormat(
    'en-US',
    {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }
  ).format(numeric)
}

export default function SupportAssistedBookingPanel() {
  const [draft, setDraft] =
    useState<Draft>(initialDraft)

  const [submitting, setSubmitting] =
    useState(false)

  const [error, setError] =
    useState('')

  const [result, setResult] =
    useState<AssistedBookingResult | null>(
      null
    )

  const idempotencyKeyRef =
    useRef(crypto.randomUUID())

  function update<K extends keyof Draft>(
    key: K,
    value: Draft[K]
  ) {
    setDraft(current => ({
      ...current,
      [key]: value,
    }))

    /*
     * A changed draft is a different booking intent.
     * A retry of an unchanged draft deliberately keeps
     * the same key so network retries remain idempotent.
     */
    idempotencyKeyRef.current =
      crypto.randomUUID()

    setResult(null)
    setError('')
  }

  async function submit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()

    if (submitting) {
      return
    }

    const riderIdText =
      draft.riderId.trim()

    const email =
      draft.email.trim().toLowerCase()

    const phone =
      draft.phone.trim()

    if (
      !riderIdText &&
      !email &&
      !phone
    ) {
      setError(
        'Identify the customer using Rider ID, email or phone.'
      )
      return
    }

    let riderId: number | undefined

    if (riderIdText) {
      const parsed =
        Number(riderIdText)

      if (
        !Number.isInteger(parsed) ||
        parsed < 1
      ) {
        setError(
          'Rider ID must be a positive whole number.'
        )
        return
      }

      riderId = parsed
    }

    const adults =
      Number(draft.adults)

    const children =
      Number(draft.children)

    const durationDays =
      Number(draft.durationDays)

    if (
      !Number.isInteger(adults) ||
      adults < 1
    ) {
      setError(
        'Adults must be a positive whole number.'
      )
      return
    }

    if (
      !Number.isInteger(children) ||
      children < 0
    ) {
      setError(
        'Children must be zero or a positive whole number.'
      )
      return
    }

    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1
    ) {
      setError(
        'Duration must be a positive whole number.'
      )
      return
    }

    if (
      !draft.agreedCancellationPolicy
    ) {
      setError(
        'Confirm that the customer agreed to the Cancellation & Refund Policy.'
      )
      return
    }

    let scheduledPickupAt:
      string | undefined

    if (draft.scheduledPickupAt) {
      const parsed =
        new Date(
          draft.scheduledPickupAt
        )

      if (
        Number.isNaN(
          parsed.getTime()
        )
      ) {
        setError(
          'Scheduled pickup date/time is invalid.'
        )
        return
      }

      scheduledPickupAt =
        parsed.toISOString()
    }

    setSubmitting(true)
    setError('')

    try {
      const created =
        await createRideArrivoAssistedBooking({
          idempotencyKey:
            idempotencyKeyRef.current,

          ...(riderId
            ? { riderId }
            : {
                email:
                  email || undefined,
                phone:
                  phone || undefined,
              }),

          bookingType:
            draft.bookingType,

          vehicleType:
            draft.vehicleType,

          pickupAddress:
            draft.pickupAddress.trim(),

          destinationAddress:
            draft.destinationAddress
              .trim() || undefined,

          flightNumber:
            draft.flightNumber
              .trim() || undefined,

          scheduledPickupAt,

          adults,
          children,
          durationDays,

          fleetSize:
            Number(
              draft.fleetSize
            ) as 0 | 2 | 3,

          securityEscort:
            draft.securityEscort,

          luxury:
            draft.luxury,

          agreedCancellationPolicy:
            true,
        })

      setResult(created)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to create the assisted booking.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  const oneWayStyle =
    draft.bookingType === 'one_way' ||
    draft.bookingType === 'dropoff'

  return (
    <section
      className="supportAssistedBooking glassCard"
      aria-labelledby="support-assisted-booking-title"
    >
      <header className="supportAssistedHeader">
        <div>
          <span className="eyebrow">
            ASSISTED BOOKING
          </span>

          <h3 id="support-assisted-booking-title">
            Create a booking for an existing rider
          </h3>

          <p>
            Support prepares the booking request.
            RideArrivo calculates the authoritative
            fare and keeps the booking pending until
            the customer completes payment.
          </p>
        </div>

        <div className="supportAssistedGuard">
          <BadgeCheck size={17}/>
          Governed Support action
        </div>
      </header>

      <form
        className="supportAssistedForm"
        onSubmit={submit}
      >
        <fieldset>
          <legend>
            <UserSearch size={17}/>
            Customer
          </legend>

          <p className="supportAssistedHint">
            Use Rider ID when known. Otherwise use
            the customer's registered email or phone.
            Customer passwords are never required.
          </p>

          <div className="supportAssistedGrid three">
            <label>
              Rider ID
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={draft.riderId}
                onChange={event =>
                  update(
                    'riderId',
                    event.target.value
                  )
                }
                placeholder="e.g. 1452"
              />
            </label>

            <label>
              Registered email
              <input
                type="email"
                value={draft.email}
                onChange={event =>
                  update(
                    'email',
                    event.target.value
                  )
                }
                placeholder="customer@example.com"
              />
            </label>

            <label>
              Registered phone
              <input
                type="tel"
                value={draft.phone}
                onChange={event =>
                  update(
                    'phone',
                    event.target.value
                  )
                }
                placeholder="+234..."
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <CarFront size={17}/>
            Trip
          </legend>

          <div className="supportAssistedGrid two">
            <label>
              Booking type
              <select
                value={draft.bookingType}
                onChange={event =>
                  update(
                    'bookingType',
                    event.target.value as BookingType
                  )
                }
              >
                <option value="one_way">
                  Airport pickup / one way
                </option>

                <option value="dropoff">
                  Airport drop-off
                </option>

                <option value="full_day">
                  Full day
                </option>

                <option value="full_week">
                  Full week
                </option>

                <option value="full_month">
                  Full month
                </option>
              </select>
            </label>

            <label>
              Vehicle
              <select
                value={draft.vehicleType}
                onChange={event =>
                  update(
                    'vehicleType',
                    event.target.value as VehicleType
                  )
                }
              >
                <option value="sedan">
                  Sedan
                </option>
                <option value="suv">
                  SUV
                </option>
                <option value="truck">
                  Truck
                </option>
                <option value="pickup">
                  Pickup
                </option>
              </select>
            </label>
          </div>

          <div className="supportAssistedGrid two">
            <label>
              Pickup address
              <input
                required
                value={draft.pickupAddress}
                onChange={event =>
                  update(
                    'pickupAddress',
                    event.target.value
                  )
                }
                placeholder="Pickup location"
              />
            </label>

            <label>
              Destination
              <input
                required={oneWayStyle}
                value={draft.destinationAddress}
                onChange={event =>
                  update(
                    'destinationAddress',
                    event.target.value
                  )
                }
                placeholder={
                  oneWayStyle
                    ? 'Required destination'
                    : 'Optional for this booking type'
                }
              />
            </label>
          </div>

          <div className="supportAssistedGrid two">
            <label>
              Flight number
              <input
                required={
                  draft.bookingType ===
                  'one_way'
                }
                value={draft.flightNumber}
                onChange={event =>
                  update(
                    'flightNumber',
                    event.target.value
                  )
                }
                placeholder="e.g. BA123"
              />
            </label>

            <label>
              Scheduled pickup
              <input
                type="datetime-local"
                required={
                  draft.bookingType ===
                  'dropoff'
                }
                value={draft.scheduledPickupAt}
                onChange={event =>
                  update(
                    'scheduledPickupAt',
                    event.target.value
                  )
                }
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>
            Passengers & options
          </legend>

          <div className="supportAssistedGrid four">
            <label>
              Adults
              <input
                type="number"
                min="1"
                max="100"
                required
                value={draft.adults}
                onChange={event =>
                  update(
                    'adults',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Children
              <input
                type="number"
                min="0"
                max="100"
                required
                value={draft.children}
                onChange={event =>
                  update(
                    'children',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Duration days
              <input
                type="number"
                min="1"
                required
                value={draft.durationDays}
                onChange={event =>
                  update(
                    'durationDays',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Fleet size
              <select
                value={draft.fleetSize}
                onChange={event =>
                  update(
                    'fleetSize',
                    event.target.value as
                      '0' | '2' | '3'
                  )
                }
              >
                <option value="0">
                  Standard
                </option>
                <option value="2">
                  2 vehicles
                </option>
                <option value="3">
                  3 vehicles
                </option>
              </select>
            </label>
          </div>

          <div className="supportAssistedChecks">
            <label>
              <input
                type="checkbox"
                checked={
                  draft.securityEscort
                }
                onChange={event =>
                  update(
                    'securityEscort',
                    event.target.checked
                  )
                }
              />
              Security escort
            </label>

            <label>
              <input
                type="checkbox"
                checked={draft.luxury}
                onChange={event =>
                  update(
                    'luxury',
                    event.target.checked
                  )
                }
              />
              Luxury service
            </label>
          </div>
        </fieldset>

        <div className="supportAssistedPolicy">
          <label>
            <input
              type="checkbox"
              required
              checked={
                draft.agreedCancellationPolicy
              }
              onChange={event =>
                update(
                  'agreedCancellationPolicy',
                  event.target.checked
                )
              }
            />

            <span>
              I confirm that the customer agreed
              to RideArrivo's Cancellation & Refund
              Policy before this booking request
              was submitted.
            </span>
          </label>
        </div>

        <div className="supportAssistedPayment">
          <CreditCard size={18}/>

          <div>
            <strong>
              Customer payment remains required
            </strong>

            <p>
              Support does not collect or enter
              customer card details in this
              workstation. The real ride is created
              only after the verified payment path.
            </p>
          </div>
        </div>

        {error && (
          <div
            className="supportAssistedError"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="supportAssistedActions">
          <button
            type="submit"
            className="glassButton"
            disabled={submitting}
          >
            {submitting
              ? (
                <>
                  <LoaderCircle
                    size={16}
                    className="supportAssistedSpinner"
                  />
                  Creating...
                </>
              )
              : 'Create assisted booking'
            }
          </button>
        </div>
      </form>

      {result && (
        <div
          className="supportAssistedResult"
          aria-live="polite"
        >
          <div className="supportAssistedResultHeader">
            <BadgeCheck size={19}/>
            <div>
              <strong>
                Assisted booking recorded
              </strong>
              <p>
                The request is preserved with
                Support employee provenance.
              </p>
            </div>
          </div>

          <dl>
            <div>
              <dt>Reference</dt>
              <dd>
                #{result.assistedBooking.id}
              </dd>
            </div>

            <div>
              <dt>Rider</dt>
              <dd>
                #{result.assistedBooking.riderId}
              </dd>
            </div>

            <div>
              <dt>Fare</dt>
              <dd>
                {formatNaira(
                  result.assistedBooking.fareNaira
                )}
              </dd>
            </div>

            <div>
              <dt>USD quote</dt>
              <dd>
                {formatUsd(
                  result.assistedBooking
                    .quotedUsdAmount
                )}
              </dd>
            </div>

            <div>
              <dt>Payment</dt>
              <dd>
                {result.assistedBooking
                  .paymentStatus}
              </dd>
            </div>

            <div>
              <dt>Ride</dt>
              <dd>
                {result.assistedBooking.rideId ??
                  'Not created yet'}
              </dd>
            </div>

            <div>
              <dt>Customer payment required</dt>
              <dd>
                {result.assistedBooking
                  .requiresCustomerPayment
                  ? 'Yes'
                  : 'No'}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  )
}
