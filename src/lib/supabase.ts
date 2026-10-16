import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseAuthLink } from './authLink'
import { createAuthStorage } from './keepSignedIn'

export const AUTH_STORAGE_KEY = 'ridearrivo-workspace-auth'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Read the address bar BEFORE the client starts. The client consumes the token
// in the link and rewrites the address, so this is the only chance to know that
// the person arrived from an invite or reset email (or from a dead link).
export const initialAuthLink =
  typeof window !== 'undefined'
    ? parseAuthLink(window.location.hash, window.location.search)
    : ({ kind: 'none' } as ReturnType<typeof parseAuthLink>)

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null =
  supabaseConfigured
    ? createClient(url!, anonKey!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // Follows the "Keep me signed in" choice for this device.
          storage:
            typeof window !== 'undefined'
              ? createAuthStorage(window.localStorage, window.sessionStorage)
              : undefined,
          storageKey: AUTH_STORAGE_KEY,
        },
      })
    : null
