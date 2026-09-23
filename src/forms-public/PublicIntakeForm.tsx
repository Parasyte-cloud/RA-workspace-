import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { RideArrivoExactLogo } from './RideArrivoLogo'
import './forms-public.css'

/*
 * Generic public-facing page for any form published through the reusable
 * intake platform (supabase/functions/intake + src/lib/intake.ts on
 * feat/reusable-intake-platform, merged here). Unlike InvestorInterestForm
 * (a one-off, hard-coded form hitting a different edge function), this
 * fetches a form's field_schema by slug and renders whatever fields that
 * schema defines, so it works for contact-us, charter-booking, and any
 * future form seeded/created through the intake platform without a
 * frontend change.
 *
 * Contract with supabase/functions/intake (see index.ts + validation.mjs):
 *   GET  /functions/v1/intake?slug=<public_slug>  -> { form: { title,
 *        description, category, version, fields: [...] } }
 *   POST /functions/v1/intake  body { slug, payload, website }
 *        -> 201 { ok, submission: { id, reference, status, submittedAt } }
 *        -> 422 { error, fields: string[] }  (validation.mjs returns an
 *           array of human-readable messages here, not per-field errors)
 *
 * Field types actually in use by contact-us/charter-booking today: text,
 * email, phone, textarea, date, select. The backend also accepts number,
 * integer, multiselect, checkbox and url for future forms; those render
 * as a plain text input here until a form actually needs them, rather
 * than guessing at UI for a type nothing uses yet.
 */

type IntakeFieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'integer'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'date'
  | 'url'

type IntakeField = {
  key: string
  label: string
  type: IntakeFieldType
  required?: boolean
  maxLength?: number
  placeholder?: string
  helpText?: string
  options?: string[]
}

type IntakeFormSchema = {
  slug: string
  title: string
  description: string | null
  category: { slug: string; title: string }
  version: number
  fields: IntakeField[]
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; schema: IntakeFormSchema }

function emptyValues(fields: IntakeField[]) {
  const values: Record<string, string> = {}
  for (const field of fields) values[field.key] = ''
  return values
}

function StatusShell({ badge, eyebrow, title, children }: {
  badge: string
  eyebrow: string
  title: string
  children: ReactNode
}) {
  return (
    <main className="formsPage">
      <section className="formsShell formsSuccessShell">
        <header className="formsHeader">
          <RideArrivoExactLogo />
          <span className="formsBadge">{badge}</span>
        </header>

        <div className="formsSuccess">
          <span className="formsEyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          {children}
        </div>
      </section>
    </main>
  )
}

function renderField(field: IntakeField, value: string, onChange: (value: string) => void) {
  if (field.type === 'textarea') {
    return (
      <textarea
        id={`field-${field.key}`}
        required={field.required}
        rows={5}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <select
        id={`field-${field.key}`}
        required={field.required}
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        <option value="" disabled>
          Choose an option
        </option>
        {(field.options || []).map(option => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }

  if (field.type === 'date') {
    return (
      <input
        id={`field-${field.key}`}
        type="date"
        required={field.required}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    )
  }

  const inputType = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'
  const autoComplete = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : undefined

  return (
    <input
      id={`field-${field.key}`}
      type={inputType}
      required={field.required}
      maxLength={field.maxLength}
      placeholder={field.placeholder}
      autoComplete={autoComplete}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  )
}

export default function PublicIntakeForm({ slug }: { slug: string }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [values, setValues] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('') // honeypot field, never rendered
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    setSubmitted(null)
    setError('')

    async function loadForm() {
      if (!supabaseUrl) {
        if (!cancelled) {
          setLoad({ status: 'error', message: 'This form is temporarily unavailable. Please try again shortly.' })
        }
        return
      }

      try {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/intake?slug=${encodeURIComponent(slug)}`,
          { headers: supabaseAnonKey ? { apikey: supabaseAnonKey } : undefined },
        )
        const result = await response.json().catch(() => ({}))

        if (!response.ok || !result?.form) {
          throw new Error(result?.error || 'This form could not be found.')
        }

        if (cancelled) return

        const schema = result.form as IntakeFormSchema
        setLoad({ status: 'ready', schema })
        setValues(emptyValues(schema.fields))
      } catch (cause) {
        if (!cancelled) {
          setLoad({
            status: 'error',
            message: cause instanceof Error ? cause.message : 'This form could not be loaded.',
          })
        }
      }
    }

    loadForm()

    return () => {
      cancelled = true
    }
  }, [slug])

  function setValue(key: string, value: string) {
    setValues(current => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || load.status !== 'ready') return

    setError('')

    const schema = load.schema

    const missing = schema.fields.filter(field => field.required && !values[field.key]?.trim())
    if (missing.length > 0) {
      setError(`Please fill in: ${missing.map(field => field.label).join(', ')}.`)
      return
    }

    if (!consent) {
      setError('Please confirm that RideArrivo may contact you about this request.')
      return
    }

    if (!supabaseUrl) {
      setError('This form is temporarily unavailable. Please try again shortly.')
      return
    }

    setBusy(true)

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/intake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(supabaseAnonKey ? { apikey: supabaseAnonKey } : {}),
        },
        body: JSON.stringify({
          slug,
          payload: values,
          website,
        }),
      })

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        const messages = Array.isArray(result?.fields) ? result.fields.join(' ') : null
        throw new Error(messages || result?.error || 'Unable to submit your request.')
      }

      setSubmitted({ reference: result?.submission?.reference || '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit your request.')
    } finally {
      setBusy(false)
    }
  }

  if (load.status === 'loading') {
    return (
      <main className="formsPage">
        <div className="formsStatus">Loading form…</div>
      </main>
    )
  }

  if (load.status === 'error') {
    return (
      <StatusShell badge="UNAVAILABLE" eyebrow="FORM UNAVAILABLE" title="We can't load this form right now.">
        <p>{load.message}</p>
      </StatusShell>
    )
  }

  const schema = load.schema

  if (submitted) {
    return (
      <StatusShell badge="SUBMITTED" eyebrow="REQUEST RECEIVED" title="Thank you — we've got it.">
        <p>
          Your {schema.title.toLowerCase()} has been securely received. A member of the RideArrivo
          team will review it and follow up using the details you provided.
          {submitted.reference ? ` Reference: ${submitted.reference}.` : ''}
        </p>
        <button
          type="button"
          onClick={() => {
            setSubmitted(null)
            setValues(emptyValues(schema.fields))
            setConsent(false)
            setWebsite('')
          }}
        >
          Submit another
        </button>
      </StatusShell>
    )
  }

  return (
    <main className="formsPage">
      <section className="formsShell">
        <header className="formsHeader">
          <RideArrivoExactLogo />
          <span className="formsBadge">SECURE FORM</span>
        </header>

        <div className="formsHero formsHeroCompact">
          <div>
            <span className="formsEyebrow">{schema.category.title.toUpperCase()}</span>
            <h1>{schema.title}</h1>
            {schema.description && <p>{schema.description}</p>}
          </div>
        </div>

        <form className="formsCard" onSubmit={submit}>
          <div className="formsGrid">
            {schema.fields.map(field => (
              <label key={field.key} className={field.type === 'textarea' ? 'formsFieldWide' : undefined}>
                <span>
                  {field.label}
                  {field.required ? ' *' : ''}
                </span>
                {renderField(field, values[field.key] || '', value => setValue(field.key, value))}
                {field.helpText && <small>{field.helpText}</small>}
              </label>
            ))}
          </div>

          <label className="formsHoney" aria-hidden="true">
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
          </label>

          <label className="formsConsent">
            <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
            <span>
              I agree that RideArrivo Limited may contact me using the details above about this
              request.
            </span>
          </label>

          {error && (
            <div className="formsError" role="alert">
              {error}
            </div>
          )}

          <div className="formsActions">
            <button type="submit" disabled={busy}>
              {busy ? 'Submitting...' : 'Submit request'}
            </button>
          </div>
        </form>

        <footer className="formsFooter">
          <span>RideArrivo Limited</span>
          <span>Secure request intake</span>
        </footer>
      </section>
    </main>
  )
}
