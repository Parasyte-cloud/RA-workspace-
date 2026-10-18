// Talks to the service worker for phone and browser notifications.
//
// 1. Tapping a notification while the app is open used to reload the page.
//    Now the service worker asks the app to open that place itself, so a live
//    call or a half-written message is not interrupted.
// 2. Opening the app clears the notifications still sitting in the tray: the
//    bell inside the app already shows them.
import { OPEN_SECTION_EVENT, type OpenSectionDetail } from './desktopAlerts'

const IN_APP_SECTIONS = new Set(['chat', 'mail', 'calendar', 'announcements', 'social', 'settings'])

export function parseOpenUrl(raw: string, origin = window.location.origin): OpenSectionDetail | null {
  try {
    const url = new URL(raw, origin)
    if (url.origin !== origin) return null
    const section = url.searchParams.get('section')
    if (!section) return url.pathname === '/' ? { section: 'overview' } : null
    // A Room 7 link carries a room code the page reads when it loads, so that
    // one is left to a normal navigation.
    if (!IN_APP_SECTIONS.has(section)) return null
    const conversation = url.searchParams.get('conversation')
    return { section, conversationId: conversation && /^[0-9a-f-]{36}$/i.test(conversation) ? conversation : null }
  } catch {
    return null
  }
}

async function clearTray() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    const shown = (await registration?.getNotifications()) || []
    // Calls that are still ringing keep their notice.
    shown.filter(item => !String(item.tag || '').startsWith('call-')).forEach(item => item.close())
  } catch {
    /* optional */
  }
}

export function startPushBridge(): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {}
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null
    if (data?.type !== 'ra-open' || typeof data.url !== 'string') return
    const detail = parseOpenUrl(data.url)
    if (detail) {
      if (detail.section !== 'overview') window.dispatchEvent(new CustomEvent<OpenSectionDetail>(OPEN_SECTION_EVENT, { detail }))
      event.ports?.[0]?.postMessage({ handled: true })
    } else {
      event.ports?.[0]?.postMessage({ handled: false })
    }
  }
  const onVisible = () => { if (document.visibilityState === 'visible') void clearTray() }
  navigator.serviceWorker.addEventListener('message', onMessage)
  document.addEventListener('visibilitychange', onVisible)
  onVisible()
  return () => {
    navigator.serviceWorker.removeEventListener('message', onMessage)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
