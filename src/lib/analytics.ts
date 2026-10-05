/*
 * Analytics for the PUBLIC forms surfaces only (forms / bookings / membership
 * / move / boat / air / easybook .ridearrivo.com). Google Tag Manager is the
 * single loader; GA4 is configured inside the GTM container. If no container
 * id is set, a direct GA4 tag is used as a fallback.
 *
 * Why it is built this way:
 *  - It is NEVER called from InternalApp. The employee workspace handles
 *    staff and customer PII, so no third party script may load there.
 *  - Consent Mode v2 defaults to denied. The GTM/GA script is not even
 *    requested until the visitor accepts, so there is no network call to
 *    Google before consent.
 *  - Only a whitelist of event parameters is forwarded, and values that
 *    look like an email or phone number are dropped. Form answers (names,
 *    addresses, phone numbers) are never sent.
 *
 * Config (build-time env, see .env.example):
 *   VITE_GTM_ID              GTM-XXXXXXX (preferred)
 *   VITE_GA4_MEASUREMENT_ID  G-XXXXXXXXXX (fallback when no GTM id)
 * With neither set, every function here is a safe no-op.
 */

type Params = Record<string, string | number | boolean>

export type ConsentChoice = 'granted' | 'denied'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const CONSENT_KEY = 'ridearrivo.forms.analytics.consent.v1'
const CONSENT_EVENT = 'ra-analytics-consent-changed'

const GTM_ID = (import.meta.env.VITE_GTM_ID || '').trim()
const GA4_ID = (import.meta.env.VITE_GA4_MEASUREMENT_ID || '').trim()

const GTM_PATTERN = /^GTM-[A-Z0-9]{4,12}$/
const GA4_PATTERN = /^G-[A-Z0-9]{6,14}$/

const ALLOWED_PARAMS = new Set([
  'form_slug',
  'step',
  'step_index',
  'source_host',
  'page_path',
  'page_title',
  'success',
  'error_kind',
])

const PII_LIKE = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/,
  /\+?\d[\d\s().-]{7,}\d/,
]

let loaded = false
const seenOnce = new Set<string>()

function validId() {
  if (GTM_PATTERN.test(GTM_ID)) return { kind: 'gtm' as const, id: GTM_ID }
  if (GA4_PATTERN.test(GA4_ID)) return { kind: 'ga4' as const, id: GA4_ID }
  return null
}

/** True when an id is configured and we are in a normal top-level tab. */
export function analyticsAvailable() {
  if (typeof window === 'undefined') return false
  if (!validId()) return false
  try {
    if (window.self !== window.top) return false
  } catch {
    return false
  }
  return true
}

export function getConsent(): ConsentChoice | null {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null
  }
}

function ensureGtag() {
  window.dataLayer = window.dataLayer || []
  if (!window.gtag) {
    // gtag must push the real `arguments` object, not an array.
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments)
    }
  }
  return window.gtag
}

function applyDefaultConsent() {
  ensureGtag()('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'granted',
    wait_for_update: 500,
  })
}

function loadScript(src: string) {
  const script = document.createElement('script')
  script.async = true
  script.src = src
  document.head.appendChild(script)
}

function loadVendor() {
  if (loaded) return
  const cfg = validId()
  if (!cfg) return
  loaded = true
  const gtag = ensureGtag()
  if (cfg.kind === 'gtm') {
    window.dataLayer!.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
    loadScript(
      'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(cfg.id),
    )
  } else {
    gtag('js', new Date())
    gtag('config', cfg.id, { send_page_view: false, anonymize_ip: true })
    loadScript(
      'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.id),
    )
  }
}

function pushConsentUpdate(choice: ConsentChoice) {
  ensureGtag()('consent', 'update', {
    analytics_storage: choice,
    // Ads signals are never used by this surface.
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
}

export function setConsent(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice)
  } catch {
    /* private mode: keep going for this page view */
  }
  if (analyticsAvailable()) {
    pushConsentUpdate(choice)
    if (choice === 'granted') {
      loadVendor()
      trackPageView()
    }
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }))
}

export function onConsentChange(handler: (choice: ConsentChoice) => void) {
  const listener = (event: Event) =>
    handler((event as CustomEvent<ConsentChoice>).detail)
  window.addEventListener(CONSENT_EVENT, listener)
  return () => window.removeEventListener(CONSENT_EVENT, listener)
}

/** Call once at startup of the public forms surface. */
export function initAnalytics() {
  if (!analyticsAvailable()) return
  applyDefaultConsent()
  if (getConsent() === 'granted') {
    pushConsentUpdate('granted')
    loadVendor()
    trackPageView()
  }
}

function clean(params?: Params) {
  const out: Params = {}
  if (!params) return out
  for (const [key, value] of Object.entries(params)) {
    if (!ALLOWED_PARAMS.has(key)) continue
    if (typeof value === 'string') {
      if (value.length > 100) continue
      if (PII_LIKE.some(pattern => pattern.test(value))) continue
    }
    out[key] = value
  }
  return out
}

function emit(name: string, params?: Params) {
  if (!analyticsAvailable()) return
  if (getConsent() !== 'granted') return
  loadVendor()
  window.dataLayer!.push({ event: name, ...clean(params) })
}

export function trackPageView() {
  emit('page_view', {
    page_path: window.location.pathname,
    page_title: document.title,
    source_host: window.location.hostname,
  })
}

/** Fires at most once per page load for a given name and slug. */
export function trackOnce(name: string, formSlug: string) {
  const key = name + ':' + formSlug
  if (seenOnce.has(key)) return
  seenOnce.add(key)
  emit(name, { form_slug: formSlug, source_host: window.location.hostname })
}

export function trackFormStep(formSlug: string, step: string) {
  emit('form_step', {
    form_slug: formSlug,
    step,
    source_host: window.location.hostname,
  })
}

export function trackFormSubmit(formSlug: string, success: boolean, errorKind?: string) {
  emit('form_submit', {
    form_slug: formSlug,
    success,
    ...(errorKind ? { error_kind: errorKind } : {}),
    source_host: window.location.hostname,
  })
}
