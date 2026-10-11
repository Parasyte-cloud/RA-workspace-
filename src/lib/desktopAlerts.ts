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

export function alertsPromptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissAlertsPrompt(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Remembering the choice is a convenience only.
  }
}

export function sectionForNotification(entityType: string | null, type: string): string | null {
  if (entityType === 'social_conversation' || type === 'call' || type === 'call_missed' || type === 'chat_message') return 'chat'
  if (entityType === 'workspace_announcement') return 'announcements'
  if (entityType === 'social_post') return 'social'
  if (entityType === 'workspace_event') return 'calendar'
  if (entityType === 'leave_request') return type === 'leave_request_decided' ? 'profile' : 'people'
  return null
}

function tabIsBackground(): boolean {
  return document.visibilityState === 'hidden' || !document.hasFocus()
}

export function showDesktopAlert(options: {
  title: string
  body?: string
  tag?: string
  urgent?: boolean
  section?: string | null
  conversationId?: string | null
}): void {
  if (!alertsSupported() || Notification.permission !== 'granted' || !tabIsBackground()) return
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
