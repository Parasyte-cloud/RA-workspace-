/*
 * Light / dark mode for the public forms (move, boat, air, membership,
 * easybook, contact, investor). Same rules as ridearrivo.com and
 * ArrivoExpress, so the page you arrive on matches the page you left:
 *
 *   1. ?theme=light|dark in the link (added by the site you came from)
 *   2. the shared arrivo_theme cookie (Domain=.ridearrivo.com)
 *   3. this site's own saved choice (localStorage)
 *   4. the device setting
 *
 * Importing this file applies the theme straight away, before React renders.
 */
export type FormsTheme = 'light' | 'dark'

const KEY = 'arrivo_theme'

function readCookie(): FormsTheme | null {
  const m = document.cookie.match(/(?:^|; )arrivo_theme=(light|dark)/)
  return m ? (m[1] as FormsTheme) : null
}

function writeCookie(theme: FormsTheme) {
  const host = window.location.hostname
  const domain = /(^|\.)ridearrivo\.com$/.test(host) ? '; Domain=.ridearrivo.com' : ''
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${domain}${secure}`
}

function readStored(): FormsTheme | null {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function fromUrl(): FormsTheme | null {
  const m = window.location.search.match(/[?&]theme=(light|dark)(?:&|$)/)
  return m ? (m[1] as FormsTheme) : null
}

export function currentTheme(): FormsTheme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

const SKIP = /\/(login|signup|account|track|book|driver|forgot-password|reset-password|verify-email|privacy|terms)(\.html)?$/

/** Links to our other sites carry the theme, for places cookies cannot be shared (previews). */
export function tagLinks(theme: FormsTheme) {
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    let u: URL
    try {
      u = new URL(a.getAttribute('href') || '', window.location.href)
    } catch {
      return
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return
    const sibling =
      u.hostname !== window.location.hostname &&
      (/(^|\.)ridearrivo\.com$/.test(u.hostname) || /\.pages\.dev$/.test(u.hostname))
    if (!sibling || SKIP.test(u.pathname)) return
    u.searchParams.set('theme', theme)
    a.setAttribute('href', u.href)
  })
}

function apply(theme: FormsTheme) {
  document.documentElement.setAttribute('data-theme', theme)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0A0C24' : '#F7F4EC')
}

export function setTheme(theme: FormsTheme) {
  apply(theme)
  try {
    window.localStorage.setItem(KEY, theme)
  } catch {
    /* private mode: the choice just will not be remembered */
  }
  writeCookie(theme)
  tagLinks(theme)
}

export function initTheme() {
  const fromLink = fromUrl()
  const saved = fromLink || readCookie() || readStored()
  const theme: FormsTheme =
    saved ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  apply(theme)
  if (fromLink) {
    try {
      window.localStorage.setItem(KEY, fromLink)
    } catch {
      /* ignore */
    }
    writeCookie(fromLink)
  }
}

if (typeof document !== 'undefined') initTheme()
