import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import './forms-public.css'

type FormState = {
  displayName: string
  email: string
  company: string
  phone: string
  interestType: string
  investmentRange: string
  message: string
  consent: boolean
  website: string
}

const emptyForm: FormState = {
  displayName: '',
  email: '',
  company: '',
  phone: '',
  interestType: 'investment',
  investmentRange: '',
  message: '',
  consent: false,
  website: '',
}

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim() || ''

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''


function RideArrivoExactLogo() {
  const canvasRef =
    useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false

    const image =
      new Image()

    image.decoding = 'async'

    image.onload = () => {
      if (cancelled) return

      const canvas =
        canvasRef.current

      if (!canvas) return

      canvas.width =
        image.naturalWidth

      canvas.height =
        image.naturalHeight

      const context =
        canvas.getContext(
          '2d',
          {
            willReadFrequently:
              true,
          },
        )

      if (!context) return

      context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height,
      )

      context.drawImage(
        image,
        0,
        0,
      )

      const frame =
        context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        )

      const pixels =
        frame.data

      /*
       * The supplied artwork has a
       * dark navy background.
       *
       * Sample the actual top-left
       * background colour rather
       * than hard-coding a colour.
       * This preserves the exact
       * white/orange artwork.
       */
      const backgroundR =
        pixels[0]

      const backgroundG =
        pixels[1]

      const backgroundB =
        pixels[2]

      for (
        let index = 0;
        index < pixels.length;
        index += 4
      ) {
        const red =
          pixels[index]

        const green =
          pixels[index + 1]

        const blue =
          pixels[index + 2]

        const distance =
          Math.hypot(
            red - backgroundR,
            green - backgroundG,
            blue - backgroundB,
          )

        /*
         * Completely remove the
         * navy field, then feather
         * only the anti-aliased
         * boundary pixels.
         */
        if (distance <= 30) {
          pixels[index + 3] = 0
          continue
        }

        if (distance < 170) {
          const opacity =
            (distance - 30) /
            140

          pixels[index + 3] =
            Math.round(
              pixels[index + 3] *
                opacity,
            )
        }
      }

      context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height,
      )

      context.putImageData(
        frame,
        0,
        0,
      )
    }

    image.src =
      '/ridearrivo-wordmark-forms-exact.png'

    return () => {
      cancelled = true
      image.onload = null
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="formsLogoCanvas"
      width={2048}
      height={682}
      role="img"
      aria-label="RideArrivo"
    />
  )
}

export default function FormsApp() {
  const [form, setForm] =
    useState<FormState>(emptyForm)

  const [busy, setBusy] =
    useState(false)

  const [error, setError] =
    useState('')

  const [submitted, setSubmitted] =
    useState(false)

  async function submit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (busy) return

    setError('')

    if (
      !form.displayName.trim() ||
      !form.email.trim()
    ) {
      setError(
        'Your name and email address are required.',
      )
      return
    }

    if (!form.consent) {
      setError(
        'Please confirm that RideArrivo may contact you about this enquiry.',
      )
      return
    }

    if (
      !supabaseUrl ||
      !supabaseAnonKey
    ) {
      setError(
        'This form is temporarily unavailable. Please try again shortly.',
      )
      return
    }

    setBusy(true)

    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/ridearrivo-public-forms`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
            apikey:
              supabaseAnonKey,
          },
          body: JSON.stringify({
            action:
              'submit_investor_interest',
            display_name:
              form.displayName,
            email:
              form.email,
            company:
              form.company,
            phone:
              form.phone,
            interest_type:
              form.interestType,
            investment_range:
              form.investmentRange,
            message:
              form.message,
            contact_consent:
              form.consent,
            website:
              form.website,
          }),
        },
      )

      const result =
        await response
          .json()
          .catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          result?.error ||
            'Unable to submit your request.',
        )
      }

      setSubmitted(true)
      setForm(emptyForm)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to submit your request.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (submitted) {
    return (
      <main className="formsPage">
        <section className="formsShell formsSuccessShell">
          <header className="formsHeader">
            <RideArrivoExactLogo />

            <span className="formsBadge">
              PRIVATE ENQUIRY
            </span>
          </header>

          <div className="formsSuccess">
            <span className="formsEyebrow">
              REQUEST RECEIVED
            </span>

            <h1>
              Thank you for your interest
              in RideArrivo.
            </h1>

            <p>
              Your information has been
              securely received. A member
              of the RideArrivo team will
              review your enquiry and
              follow up using the contact
              details you provided.
            </p>

            <button
              type="button"
              onClick={() =>
                setSubmitted(false)
              }
            >
              Submit another enquiry
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="formsPage">
      <section className="formsShell">
        <header className="formsHeader">
          <RideArrivoExactLogo />

          <span className="formsBadge">
            SECURE FORM
          </span>
        </header>

        <div className="formsHero">
          <div>
            <span className="formsEyebrow">
              INVESTOR & STAKEHOLDER
              INTEREST
            </span>

            <h1>
              Continue the conversation
              with RideArrivo.
            </h1>

            <p>
              Tell us how you would like
              to engage with RideArrivo.
              Your enquiry will be
              reviewed privately by our
              team.
            </p>
          </div>

          <aside>
            <span>
              PRIVATE FOLLOW-UP
            </span>

            <strong>
              Professional mobility.
              Built for scale.
            </strong>

            <p>
              Investment, strategic
              partnerships, information
              requests and meeting
              enquiries are welcome.
            </p>
          </aside>
        </div>

        <form
          className="formsCard"
          onSubmit={submit}
        >
          <div className="formsGrid">
            <label>
              <span>Your name *</span>
              <input
                required
                maxLength={180}
                autoComplete="name"
                value={form.displayName}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    displayName:
                      event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Email *</span>
              <input
                required
                type="email"
                maxLength={320}
                autoComplete="email"
                value={form.email}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    email:
                      event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>
                Company / organisation
              </span>
              <input
                maxLength={180}
                autoComplete="organization"
                value={form.company}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    company:
                      event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Phone</span>
              <input
                maxLength={40}
                autoComplete="tel"
                value={form.phone}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    phone:
                      event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>
                Area of interest *
              </span>
              <select
                required
                value={
                  form.interestType
                }
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    interestType:
                      event.target.value,
                  }))
                }
              >
                <option value="investment">
                  Investment
                </option>
                <option value="partnership">
                  Strategic partnership
                </option>
                <option value="information">
                  Information
                </option>
                <option value="meeting">
                  Meeting
                </option>
              </select>
            </label>

            <label>
              <span>
                Investment range
              </span>
              <input
                maxLength={120}
                placeholder="Optional"
                value={
                  form.investmentRange
                }
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    investmentRange:
                      event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <label className="formsMessage">
            <span>Message</span>
            <textarea
              rows={5}
              maxLength={2000}
              placeholder="Tell the RideArrivo team what you would like to discuss."
              value={form.message}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  message:
                    event.target.value,
                }))
              }
            />
            <small>
              {form.message.length}/2000
            </small>
          </label>

          <label
            className="formsHoney"
            aria-hidden="true"
          >
            Website
            <input
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  website:
                    event.target.value,
                }))
              }
            />
          </label>

          <label className="formsConsent">
            <input
              type="checkbox"
              checked={form.consent}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  consent:
                    event.target.checked,
                }))
              }
            />

            <span>
              I agree that RideArrivo
              Limited may contact me using
              the details above about this
              enquiry.
            </span>
          </label>

          {error && (
            <div
              className="formsError"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="formsActions">
            <button
              type="submit"
              disabled={busy}
            >
              {busy
                ? 'Submitting...'
                : 'Request follow-up'}
            </button>

            <small>
              Your submission is kept
              separate from ROOM 7
              attendance and event
              analytics.
            </small>
          </div>
        </form>

        <footer className="formsFooter">
          <span>
            RideArrivo Limited
          </span>

          <span>
            Secure investor &
            stakeholder enquiries
          </span>
        </footer>
      </section>
    </main>
  )
}
