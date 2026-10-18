// Desktop alerts for calls and messages while the workspace tab is open but
// in the background. This is not push: a fully closed tab cannot be reached.

export const OPEN_SECTION_EVENT = 'ra:open-section'

export type OpenSectionDetail = { section: string; conversationId?: string | null }

const DISMISSED_KEY = 'ra.alerts.dismissed'

export function alertsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function alertPermission(): NotificationPermission | 'unsupported' {
  return alertsSupported() ? Notification.permission : 'unsupported'
}

export async function requestAlertPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!alertsSupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

// "Later" is a snooze, not a goodbye. It used to hide the prompt for good, so
// one stray tap left a person without alerts for calls and messages with no way
// back except Settings. Now it asks again after three days (until the browser
// has been told yes or no, which ends the prompt for good).
export const ALERT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000

export function alertsPromptDismissed(now: number = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY))
    // The old "1" marker is not a time: treat it as long expired.
    return Number.isFinite(at) && at > 1 && now - at < ALERT_SNOOZE_MS
  } catch {
    return false
  }
}

export function dismissAlertsPrompt(now: number = Date.now()): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(now))
  } catch {
    // Remembering the choice is a convenience only.
  }
}

export function sectionForNotification(entityType: string | null, type: string): string | null {
  if (entityType === 'social_conversation' || type === 'call' || type === 'call_missed' || type === 'chat_message') return 'chat'
  if (entityType === 'workspace_announcement') return 'announcements'
  if (entityType === 'social_post') return 'social'
  if (entityType === 'workspace_event') return 'calendar'
  if (entityType === 'backup_health') return 'admin'
  if (entityType === 'leave_request') return type === 'leave_request_decided' ? 'profile' : 'people'
  return null
}

function tabIsBackground(): boolean {
  return document.visibilityState === 'hidden' || !document.hasFocus()
}

export function alertUrl(section?: string | null, conversationId?: string | null): string {
  if (!section) return '/'
  const query = new URLSearchParams({ section })
  if (conversationId && /^[0-9a-f-]{36}$/i.test(conversationId)) query.set('conversation', conversationId)
  return `/?${query.toString()}`
}

type AlertOptions = {
  title: string
  body?: string
  tag?: string
  urgent?: boolean
  section?: string | null
  conversationId?: string | null
}

// Android Chrome and the installed iPhone app refuse `new Notification()` (it
// throws, and the old code swallowed that, so no banner ever appeared). The
// service worker can always show one, and a tap on it comes back through the
// push bridge, so it opens the right place without reloading the app.
async function showViaWorker(options: AlertOptions): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (!registration) return false
    await registration.showNotification(options.title, {
      body: options.body || '',
      tag: options.tag,
      renotify: Boolean(options.tag),
      requireInteraction: Boolean(options.urgent),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: alertUrl(options.section, options.conversationId) },
    } as NotificationOptions)
    return true
  } catch {
    return false
  }
}

function showViaConstructor(options: AlertOptions): void {
  try {
    const alert = new Notification(options.title, {
      body: options.body || '',
      tag: options.tag,
      requireInteraction: Boolean(options.urgent)
    })
    alert.onclick = () => {
      window.focus()
      alert.close()
      if (options.section) {
        window.dispatchEvent(new CustomEvent<OpenSectionDetail>(OPEN_SECTION_EVENT, {
          detail: { section: options.section, conversationId: options.conversationId }
        }))
      }
    }
    if (options.urgent) window.setTimeout(() => alert.close(), 60_000)
  } catch {
    // Some browsers refuse the constructor; the in-app banner still shows.
  }
}

export function showDesktopAlert(options: AlertOptions): void {
  if (!alertsSupported() || Notification.permission !== 'granted' || !tabIsBackground()) return
  void showViaWorker(options).then(shown => {
    if (!shown) showViaConstructor(options)
    else if (options.urgent) {
      // A ring that was not answered should not sit in the tray for ever.
      window.setTimeout(() => {
        void navigator.serviceWorker?.getRegistration()
          .then(registration => registration?.getNotifications({ tag: options.tag }))
          .then(list => list?.forEach(item => item.close()))
          .catch(() => {})
      }, 60_000)
    }
  })
}

// Flashes the tab title until the returned function is called.
export function flashTitle(text: string): () => void {
  const original = document.title
  let on = false
  const timer = window.setInterval(() => {
    on = !on
    document.title = on ? text : original
  }, 1000)
  return () => {
    window.clearInterval(timer)
    document.title = original
  }
}
