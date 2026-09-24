import { createClient } from '@supabase/supabase-js'
import type { Session, SupabaseClient } from '@supabase/supabase-js'

/*
 * Identity for RideArrivo's customer-facing surfaces (membership.ridearrivo.com
 * today, the rider app and ridearrivo.com account features later), kept
 * completely separate from src/lib/supabase.ts, which is the INTERNAL
 * employee workspace's auth (storageKey "ridearrivo-workspace-auth").
 * Riders are not, and must never become, accounts in that project.
 *
 * This points at its own Supabase project instead, so a customer who signs
 * in with Google or Apple here gets a real account (a real Supabase Auth
 * user), not a fake "coming soon" note. Set VITE_RIDER_SUPABASE_URL and
 * VITE_RIDER_SUPABASE_ANON_KEY (see .env.example) once that project exists
 * and has the Google and Apple providers turned on in its Auth settings.
 * Until then, riderAuthConfigured is false and callers fall back to the
 * phone/email path, so nothing breaks in the meantime.
 *
 * This does not yet make membership.ridearrivo.com share a login with the
 * rider app on Render. That is a deliberate, separate step: either the app
 * moves its own login onto this same Supabase project later, or the two
 * are reconciled some other way. Until that happens, an account created
 * here is real and persistent, but only for RideArrivo's website surfaces.
 */

const url = import.meta.env.VITE_RIDER_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_RIDER_SUPABASE_ANON_KEY as string | undefined

export const riderAuthConfigured = Boolean(url && anonKey)

export const riderAuth: SupabaseClient | null =
  riderAuthConfigured
    ? createClient(url!, anonKey!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage:
            typeof window !== 'undefined'
              ? window.localStorage
              : undefined,
          storageKey: 'ridearrivo-rider-auth',
        },
      })
    : null

export type RiderOAuthProvider = 'google' | 'apple'

export async function signInWithRiderProvider(provider: RiderOAuthProvider) {
  if (!riderAuth) {
    throw new Error('Rider sign-in is not configured yet.')
  }

  const { error } = await riderAuth.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.href,
    },
  })

  if (error) {
    throw new Error(error.message || `Unable to start ${provider} sign-in.`)
  }
}

export async function getRiderSession(): Promise<Session | null> {
  if (!riderAuth) return null

  const { data, error } = await riderAuth.auth.getSession()
  if (error) return null
  return data.session
}

export async function signOutRider() {
  if (!riderAuth) return
  await riderAuth.auth.signOut()
}

export function riderDisplayName(session: Session) {
  const meta = session.user.user_metadata || {}
  return (
    (meta.full_name as string | undefined) ||
    (meta.name as string | undefined) ||
    session.user.email ||
    ''
  )
}

export function riderProviderLabel(session: Session) {
  const provider = session.user.app_metadata?.provider
  if (provider === 'google') return 'Google'
  if (provider === 'apple') return 'Apple'
  return 'OAuth'
}

export function subscribeToRiderAuthChanges(
  callback: (session: Session | null) => void,
) {
  if (!riderAuth) return () => {}

  const { data } = riderAuth.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })

  return () => {
    data.subscription.unsubscribe()
  }
}
