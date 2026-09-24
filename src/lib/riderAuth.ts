/*
 * Real rider identity for RideArrivo's customer-facing surfaces
 * (membership.ridearrivo.com today), backed by the SAME backend the
 * rider and driver apps already use (Parasyte-cloud/Arrivo's
 * arrivo-backend on Render), not a separate identity system. A
 * membership sign-up here is the exact account the app already
 * knows, the same way ridearrivo-website's login.html/signup.html do
 * it: Google Identity Services / Sign in with Apple JS run in the
 * browser, hand back a provider ID token, and arrivo-backend verifies
 * that token itself (services/oauth.js) before minting its own JWT.
 * That JWT (not a Supabase session) is what gets stored here, under
 * the same localStorage key ridearrivo-website uses, and it is what
 * every authenticated call to the backend (GET /api/auth/me and so
 * on) is sent with.
 *
 * Kept completely separate from src/lib/supabase.ts, which is the
 * INTERNAL employee workspace's auth. Riders are not, and must never
 * become, accounts in that project - this file never touches it.
 *
 * Google is already configured server-side (GOOGLE_OAUTH_CLIENT_IDS
 * on Render includes the web client id below, alongside the apps'
 * iOS/Android ones), so the Google button works immediately. Apple
 * sign-in on the web needs an Apple Services ID from Apple Developer,
 * which is not set up on ANY RideArrivo website yet (the same blank
 * APPLE_WEB_SERVICES_ID in ridearrivo-website's login.html) - so
 * appleSignInConfigured is false and the Apple button stays hidden
 * until that exists, exactly the graceful fallback the main site
 * already uses. Nothing here breaks in the meantime.
 */

export const ARRIVO_API_BASE_URL =
  (import.meta.env.VITE_ARRIVO_API_BASE_URL as string | undefined) ||
  'https://arrivo-backend-g1ku.onrender.com'

// Public web client id - not a secret, Google Identity Services hands it
// to the browser regardless. Same value ridearrivo-website's login.html
// uses, already whitelisted in this backend's GOOGLE_OAUTH_CLIENT_IDS.
const GOOGLE_WEB_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined) ||
  '425853448895-r6ha3gh7b4i4lcsl3lohncuk3ecblsl3.apps.googleusercontent.com'

// Blank until an Apple Services ID exists for this domain (Apple
// Developer -> Services ID, with membership.ridearrivo.com added as an
// authorized domain and return URL, then that Services ID also added to
// APPLE_BUNDLE_IDS on Render alongside the app bundle ids). See the same
// setup note in ridearrivo-website/login.html - it's identical here.
const APPLE_WEB_SERVICES_ID =
  (import.meta.env.VITE_APPLE_WEB_SERVICES_ID as string | undefined) || ''

export const appleSignInConfigured = Boolean(APPLE_WEB_SERVICES_ID)

const TOKEN_KEY = 'arrivo_rider_token'

export type RiderUser = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  whatsapp_number: string | null
  country_of_residence: string | null
  passport_number: string | null
  role: string
}

export type RiderOAuthProvider = 'google' | 'apple'

type AuthResult = { token: string; user: RiderUser; isNewAccount: boolean }

async function postAuth(path: string, payload: Record<string, unknown>): Promise<AuthResult> {
  const res = await fetch(`${ARRIVO_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Unable to sign in. Please try again.')
  }
  return data as AuthResult
}

export function getStoredRiderToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function storeRiderToken(token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Private browsing / storage disabled - the session just won't
    // persist across a reload, which isn't fatal for this page.
  }
}

export function signOutRider() {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

export async function fetchRiderProfile(token: string): Promise<RiderUser | null> {
  const res = await fetch(`${ARRIVO_API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  return (data as { user?: RiderUser } | null)?.user || null
}

export async function signInWithGoogleIdToken(idToken: string): Promise<AuthResult> {
  const result = await postAuth('/api/auth/google', {
    idToken,
    role: 'rider',
    agreedToTerms: true,
  })
  storeRiderToken(result.token)
  return result
}

export async function signInWithAppleIdentityToken(
  identityToken: string,
  fullName?: { givenName?: string; familyName?: string },
): Promise<AuthResult> {
  const result = await postAuth('/api/auth/apple', {
    identityToken,
    fullName,
    role: 'rider',
    agreedToTerms: true,
  })
  storeRiderToken(result.token)
  return result
}

// Loads a <script> tag once and resolves once it's actually on the page.
// Both the Google Identity Services and Apple JS SDKs attach a global
// (window.google, window.AppleID) instead of exporting anything, so
// there's nothing to import - just wait for the tag to finish.
function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve()
      else existing.addEventListener('load', () => resolve())
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true'
      resolve()
    })
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
    document.head.appendChild(script)
  })
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void
          renderButton: (
            container: HTMLElement,
            options: { theme: string; size: string; text: string; width: number },
          ) => void
        }
      }
    }
    AppleID?: {
      auth: {
        init: (config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }) => void
        signIn: () => Promise<{
          authorization: { id_token: string }
          user?: { name?: { firstName?: string; lastName?: string } }
        }>
      }
    }
  }
}

// Renders Google's own "Continue with Google" button into `container` and
// calls `onIdToken` with the verified-by-Google credential once someone
// picks an account.
export function renderGoogleButton(container: HTMLElement, onIdToken: (idToken: string) => void): Promise<void> {
  return loadScriptOnce('https://accounts.google.com/gsi/client').then(
    () =>
      new Promise<void>((resolve, reject) => {
        let attemptsLeft = 40
        function attempt() {
          if (window.google?.accounts?.id) {
            window.google.accounts.id.initialize({
              client_id: GOOGLE_WEB_CLIENT_ID,
              callback: response => onIdToken(response.credential),
            })
            window.google.accounts.id.renderButton(container, {
              theme: 'outline',
              size: 'large',
              text: 'continue_with',
              width: Math.max(200, Math.min(300, container.clientWidth || 300)),
            })
            resolve()
          } else if (attemptsLeft-- > 0) {
            setTimeout(attempt, 150)
          } else {
            reject(new Error('Google sign-in did not load.'))
          }
        }
        attempt()
      }),
  )
}

// Wires Apple's button (already in the markup, hidden by default) and
// reveals it once Apple's SDK is ready. A no-op when appleSignInConfigured
// is false, so the button simply stays hidden.
export function initAppleSignIn(
  button: HTMLElement,
  onCredential: (identityToken: string, fullName?: { givenName?: string; familyName?: string }) => void,
): Promise<void> {
  if (!appleSignInConfigured) return Promise.resolve()

  return loadScriptOnce('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js').then(
    () =>
      new Promise<void>((resolve, reject) => {
        let attemptsLeft = 40
        function attempt() {
          if (window.AppleID) {
            window.AppleID!.auth.init({
              clientId: APPLE_WEB_SERVICES_ID,
              scope: 'name email',
              redirectURI: window.location.origin + window.location.pathname,
              usePopup: true,
            })
            button.style.display = 'flex'
            button.addEventListener('click', () => {
              window
                .AppleID!.auth.signIn()
                .then(res => {
                  onCredential(res.authorization.id_token, {
                    givenName: res.user?.name?.firstName,
                    familyName: res.user?.name?.lastName,
                  })
                })
                .catch(() => {
                  // User cancelled - no error needed, same as login.html.
                })
            })
            resolve()
          } else if (attemptsLeft-- > 0) {
            setTimeout(attempt, 150)
          } else {
            reject(new Error('Apple sign-in did not load.'))
          }
        }
        attempt()
      }),
  )
}
