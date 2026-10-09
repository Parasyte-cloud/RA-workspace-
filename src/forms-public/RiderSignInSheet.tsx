import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  renderGoogleButton,
  signInWithEmailPassword,
  signInWithGoogleIdToken,
  signUpWithEmailPassword,
  type RiderUser,
} from '../lib/riderAuth'

/*
 * Sign-in sheet opened by the header booking button when nobody is signed in.
 *
 * Three ways forward, so nobody is stuck: sign in, create an account, or
 * continue as a guest. Guest simply means "carry on to the form", where the
 * app's own contact step collects name and phone as it always has. Signing in
 * lets the form prefill those fields. Nothing the visitor has typed on the
 * page behind the sheet is touched.
 */

type Props = {
  onDone: (user: RiderUser | null) => void
  onClose: () => void
}

export default function RiderSignInSheet({ onDone, onClose }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const googleRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLElement>('input,button')?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose])

  useEffect(() => {
    if (!googleRef.current) return
    // Fails quietly if Google's script is blocked: email and guest still work.
    void renderGoogleButton(googleRef.current, idToken => {
      setBusy(true)
      setError('')
      signInWithGoogleIdToken(idToken)
        .then(({ user }) => onDone(user))
        .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to sign in with Google.'))
        .finally(() => setBusy(false))
    }).catch(() => {})
  }, [onDone])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!email.trim() || !password) return setError('Please enter your email and password.')
    if (mode === 'signup') {
      if (!firstName.trim() || !lastName.trim()) return setError('Please enter your first and last name.')
      if (password.length < 8) return setError('Please choose a password of at least 8 characters.')
      if (!agreed) return setError('Please agree to the terms to create an account.')
    }
    setBusy(true)
    try {
      const result =
        mode === 'signin'
          ? await signInWithEmailPassword(email.trim(), password)
          : await signUpWithEmailPassword({
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: email.trim(),
              password,
              phone: phone.trim(),
              agreedToTerms: agreed,
            })
      onDone(result.user)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="formsSheetOverlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="formsSheet" role="dialog" aria-modal="true" aria-labelledby="formsSheetTitle" ref={dialogRef}>
        <button type="button" className="formsSheetClose" aria-label="Close" onClick={onClose}>
          &times;
        </button>
        <h2 id="formsSheetTitle">{mode === 'signin' ? 'Sign in to book' : 'Create your account'}</h2>
        <p className="formsSheetLead">
          Signed-in riders get their details filled in for them. You can also carry on as a guest.
        </p>

        <div ref={googleRef} className="formsSheetGoogle" />

        <form onSubmit={submit} className="formsSheetForm">
          {mode === 'signup' && (
            <div className="formsSheetRow">
              <input placeholder="First name" autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} />
              <input placeholder="Last name" autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} />
            </div>
          )}
          <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
          {mode === 'signup' && (
            <input type="tel" placeholder="Phone (optional)" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} />
          )}
          <input
            type="password"
            placeholder="Password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {mode === 'signup' && (
            <label className="formsSheetCheck">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>
                I agree to the <a href="https://www.ridearrivo.com/terms.html" target="_blank" rel="noopener noreferrer">Terms</a> and{' '}
                <a href="https://www.ridearrivo.com/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              </span>
            </label>
          )}
          {error && <p className="formsSheetError" role="alert">{error}</p>}
          <button type="submit" className="formsSheetPrimary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in and continue' : 'Create account and continue'}
          </button>
        </form>

        <button
          type="button"
          className="formsSheetLink"
          onClick={() => {
            setError('')
            setMode(mode === 'signin' ? 'signup' : 'signin')
          }}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
        <button type="button" className="formsSheetGuest" onClick={() => onDone(null)}>
          Continue as guest
        </button>
      </div>
    </div>
  )
}
