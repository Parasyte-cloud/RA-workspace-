import type { SupabaseClient } from '@supabase/supabase-js'

// Signing out ends the session on THIS device only.
//
// supabase-js signs out with scope "global" unless told otherwise, which
// revokes the refresh token of every device the person is signed in on. That
// made "Keep me signed in" look broken: signing out (or an idle timeout) on a
// laptop silently ended the phone's session as well. Every sign-out in the app
// now goes through here with scope "local". "Sign out everywhere" is a
// separate, deliberate choice.

const REASON_KEY = 'ridearrivo-signout-reason'
let deliberate = false

export type SignOutReason = 'idle' | 'user' | 'everywhere' | 'password'

export function markDeliberateSignOut() {
  deliberate = true
}

export function wasDeliberateSignOut() {
  return deliberate
}

export function resetDeliberateSignOut() {
  deliberate = false
}

export function rememberSignOutReason(reason: SignOutReason) {
  try { window.sessionStorage.setItem(REASON_KEY, reason) } catch { /* storage blocked */ }
}

export function takeSignOutReason(): string {
  try {
    const value = window.sessionStorage.getItem(REASON_KEY) || ''
    window.sessionStorage.removeItem(REASON_KEY)
    return value
  } catch {
    return ''
  }
}

export function signOutMessage(reason: string): string {
  if (reason === 'idle') return 'You were signed out after 30 minutes without activity. Tick "Keep me signed in" to stay signed in on this device.'
  if (reason === 'everywhere') return 'You signed out of all devices. Sign in again to continue.'
  return ''
}

export async function signOutThisDevice(client: SupabaseClient | null, reason: SignOutReason = 'user') {
  if (!client) return { error: null }
  markDeliberateSignOut()
  rememberSignOutReason(reason)
  const result = await client.auth.signOut({ scope: 'local' })
  return result
}

export async function signOutEverywhere(client: SupabaseClient | null) {
  if (!client) return { error: null }
  markDeliberateSignOut()
  rememberSignOutReason('everywhere')
  return client.auth.signOut({ scope: 'global' })
}

// Ask the browser not to clear this site's storage under storage pressure, which
// is a quiet way for a saved sign-in to disappear.
export function protectSavedSignIn() {
  try {
    void navigator.storage?.persist?.()
  } catch { /* not supported */ }
}
