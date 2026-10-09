import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IntakeRequestError, submitPublicIntakeForm } from '../lib/intake'
import {
  LATE_SUPPORT,
  MIN_HOURS,
  describeLead,
  formatLagos,
  mailtoHref,
  phoneHasEnoughDigits,
  supportMessage,
  whatsappHref,
  type SummaryRow,
  type TimeZoneReading,
} from './lateBooking'
import './lateBooking.css'

/*
 * Shown instead of letting someone submit a booking that is sooner than
 * MIN_HOURS away. It never dead-ends: the rider can fix the time in one tap,
 * or send exactly what they filled in to Support as a request, or reach a
 * person on WhatsApp, a call or email. The form behind it is left untouched,
 * so nothing they typed is lost.
 *
 * The request goes through the same intake form as a normal booking. The
 * parent builds the payload (buildPayload) so the dialog can never add a key
 * the intake function would reject, and the parent decides how the late flag
 * is written into the form's notes.
 */

export type LateContact = { fullName: string; phone: string }

type Props = {
  serviceName: string
  slug: string
  when: Date
  // 'lagos' (default) labels the time as Lagos time. Air passes 'local' when the
  // departure airport is outside Nigeria, so the time is shown as typed.
  zone?: TimeZoneReading
  summary: SummaryRow[]
  buildPayload: (contact: LateContact) => Record<string, unknown>
  initialName?: string
  initialPhone?: string
  earliest?: { label: string; onUse: () => void }
  // The rider chose to change the time. The parent puts focus back on the date field.
  onAdjust: () => void
  // Closed without sending anything.
  onClose: () => void
  // The request is now with Support. The parent clears any idempotency key and
  // keeps the contact details so its own success step can show them.
  onSent: (reference: string, contact: LateContact) => void
  // The rider is finished with the confirmation. The parent shows its success step.
  onDone: () => void
}

export default function LateBookingDialog({
  serviceName,
  slug,
  when,
  zone = 'lagos',
  summary,
  buildPayload,
  initialName = '',
  initialPhone = '',
  earliest,
  onAdjust,
  onClose,
  onSent,
  onDone,
}: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [website, setWebsite] = useState('') // honeypot, never shown to real visitors
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reference, setReference] = useState<string | null>(null)

  const sent = reference !== null
  const message = supportMessage(summary, serviceName)

  function requestClose() {
    if (sent) onDone()
    else onClose()
  }

  // Keep the latest close handler reachable from the key listener without
  // re-binding it on every render.
  const closeRef = useRef(requestClose)
  closeRef.current = requestClose

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([data-honeypot])',
        ) ?? [],
      )
    // Focus lands on the dialog itself, not on a button. A screen reader then
    // announces the title, and the browser does not scroll a short phone screen
    // past the heading to reach a control further down. Tab goes to the first
    // control from there.
    dialogRef.current?.focus({ preventScroll: true })

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = focusable()
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
      returnTo?.focus?.()
    }
  }, [])

  async function send() {
    if (busy) return
    setError('')
    const fullName = name.trim()
    const phoneText = phone.trim()
    if (!fullName || !phoneHasEnoughDigits(phoneText)) {
      setError('Please add your name and a phone number we can reach you on.')
      return
    }
    if (website) return
    setBusy(true)
    try {
      const receipt = await submitPublicIntakeForm({
        slug,
        payload: buildPayload({ fullName, phone: phoneText }),
        website,
      })
      const ref = receipt.reference || ''
      setReference(ref)
      onSent(ref, { fullName, phone: phoneText })
    } catch (cause) {
      setError(
        cause instanceof IntakeRequestError && (cause.fields.join(' ') || cause.message)
          ? cause.fields.join(' ') || cause.message
          : 'We could not send that just now. Please use WhatsApp or Call below and we will sort it out.',
      )
    } finally {
      setBusy(false)
    }
  }

  const contacts = (
    <>
      <p className="lateDlgMuted lateDlgSmall">For the fastest answer, message or call us:</p>
      <div className="lateDlgContacts">
        <a className="lateDlgBtn" href={whatsappHref(message)} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
        <a className="lateDlgBtn" href={`tel:${LATE_SUPPORT.phone}`}>
          Call
        </a>
        <a className="lateDlgBtn" href={mailtoHref(message, serviceName)}>
          Email
        </a>
      </div>
    </>
  )

  return createPortal(
    <div
      className="lateDlgOverlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <div
        className="lateDlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <button type="button" className="lateDlgX" aria-label="Close" onClick={requestClose}>
          &times;
        </button>

        {sent ? (
          <>
            <h2 id={titleId}>Your request is with Support</h2>
            <p>
              Thank you. We will reach you on {phone.trim()}.
              {reference ? ` Your reference is ${reference}.` : ''}
            </p>
            {contacts}
            <div className="lateDlgActions">
              <button type="button" className="lateDlgBtn lateDlgPrimary" onClick={onDone}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id={titleId}>That time is sooner than we can book online</h2>
            <p>
              Online bookings need at least {MIN_HOURS} hours&rsquo; notice. The time you picked,{' '}
              {formatLagos(when, zone === 'lagos')}, {describeLead(when)}.
            </p>
            <p className="lateDlgMuted">
              Nothing you filled in has been lost. Pick a later time, or send it to Support as it is and we will
              confirm if we can make it work.
            </p>

            {summary.some(row => row.value) ? (
              <div className="lateDlgSummary">
                {summary
                  .filter(row => row.value)
                  .map(row => (
                    <div key={row.label}>
                      <b>{row.label}</b>
                      <span>{row.value}</span>
                    </div>
                  ))}
              </div>
            ) : null}

            <div className="lateDlgActions">
              {earliest ? (
                <button type="button" className="lateDlgBtn lateDlgPrimary" onClick={earliest.onUse}>
                  {earliest.label}
                </button>
              ) : null}
              <button
                type="button"
                className={earliest ? 'lateDlgBtn' : 'lateDlgBtn lateDlgPrimary'}
                onClick={onAdjust}
              >
                Change my time
              </button>
            </div>

            <h3>Or send it to Support as a request</h3>
            <div className="lateDlgField">
              <label htmlFor={`${titleId}-name`}>Your name</label>
              <input
                id={`${titleId}-name`}
                type="text"
                autoComplete="name"
                maxLength={160}
                value={name}
                onChange={event => setName(event.target.value)}
              />
            </div>
            <div className="lateDlgField">
              <label htmlFor={`${titleId}-phone`}>Phone or WhatsApp number</label>
              <input
                id={`${titleId}-phone`}
                type="tel"
                autoComplete="tel"
                maxLength={40}
                placeholder="e.g. 0801 234 5678"
                value={phone}
                onChange={event => setPhone(event.target.value)}
              />
            </div>
            <input
              data-honeypot
              className="lateDlgHp"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={website}
              onChange={event => setWebsite(event.target.value)}
            />
            {error ? (
              <p className="lateDlgErr" role="alert">
                {error}
              </p>
            ) : null}
            <button type="button" className="lateDlgBtn lateDlgPrimary" disabled={busy} onClick={send}>
              {busy ? 'Sending...' : 'Send request to Support'}
            </button>

            {contacts}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
