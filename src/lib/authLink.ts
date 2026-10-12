/*
 * What the address bar says when someone arrives from an email link, and how
 * to describe sign-in problems in plain words. Pure functions, no React.
 *
 * Why this exists: an invite or reset link is single use. Many mail systems
 * open links to scan them before the person does, which uses the link up. The
 * person then lands on the sign-in page with no explanation and, understandably,
 * asks an administrator to reset the password. Showing the real reason, and a
 * one-click way to get a new link, removes most of those requests.
 */

export type AuthLink =
  | { kind: 'none' }
  | { kind: 'invite' }
  | { kind: 'recovery' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'confirm'; tokenHash: string; type: 'recovery' | 'invite' | 'signup' | 'email' }

const CONFIRM_TYPES = ['recovery', 'invite', 'signup', 'email'] as const

const params = (raw: string) => new URLSearchParams(raw.replace(/^[#?]/, ''))

export function parseAuthLink(hash: string, search: string): AuthLink {
  const fromHash = params(hash || '')
  const fromQuery = params(search || '')

  const errorCode = fromHash.get('error_code') || fromQuery.get('error_code')
  const errorName = fromHash.get('error') || fromQuery.get('error')
  if (errorCode || errorName) {
    const code = (errorCode || errorName || 'unknown').toLowerCase()
    return { kind: 'error', code, message: describeLinkError(code) }
  }

  const tokenHash = fromQuery.get('token_hash')
  const queryType = fromQuery.get('type')
  if (tokenHash && queryType && (CONFIRM_TYPES as readonly string[]).includes(queryType)) {
    return { kind: 'confirm', tokenHash, type: queryType as (typeof CONFIRM_TYPES)[number] }
  }

  const hashType = fromHash.get('type')
  if (fromHash.get('access_token') && hashType === 'invite') return { kind: 'invite' }
  if (fromHash.get('access_token') && hashType === 'recovery') return { kind: 'recovery' }

  return { kind: 'none' }
}

export function describeLinkError(code: string): string {
  if (code.includes('otp_expired') || code.includes('expired')) {
    return 'That email link has expired or was already used. Some mail systems open links before you do, which uses them up. Enter your work email below and press Forgot / Reset Password to get a fresh one.'
  }
  if (code.includes('access_denied')) {
    return 'That email link could not be used. Enter your work email below and press Forgot / Reset Password to get a fresh one.'
  }
  return 'That email link did not work. Enter your work email below and press Forgot / Reset Password to get a fresh one.'
}

type AuthErrorLike = { message?: string; status?: number; code?: string } | null | undefined

export function describeSignInError(error: AuthErrorLike): string {
  const message = error?.message || ''
  const code = (error?.code || '').toLowerCase()
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error?.status === 429 || /rate limit/i.test(message)) {
    return 'Too many attempts from this network just now. Wait a few minutes and try again.'
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'Your email has not been confirmed yet. Open the invitation email and use its link first, or use Forgot / Reset Password.'
  }
  if (code === 'invalid_credentials' || message === 'Invalid login credentials') {
    return 'That email and password did not match. Check for a capital letter or an extra space. If you were invited and never created a password, use Forgot / Reset Password below.'
  }
  return message || 'Unable to sign in.'
}

// Pasted passwords often carry a trailing space or line break. The first try
// uses exactly what was typed; only if that fails and trimming would change it
// do we try once more with the trimmed value.
export const trimmedRetry = (password: string): string | null => {
  const trimmed = password.trim()
  return trimmed && trimmed !== password ? trimmed : null
}
