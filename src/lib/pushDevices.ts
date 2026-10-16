// Plain-words labels for the Settings screen. No browser or network calls, so
// they can be tested in Node.

export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = String(userAgent || '')
  const device =
    /iphone/i.test(ua) ? 'iPhone'
    : /ipad/i.test(ua) ? 'iPad'
    : /android/i.test(ua) ? 'Android phone'
    : /windows/i.test(ua) ? 'Windows PC'
    : /macintosh|mac os x/i.test(ua) ? 'Mac'
    : /linux|cros/i.test(ua) ? 'Linux computer'
    : 'Device'
  const browser =
    /edg\//i.test(ua) ? 'Edge'
    : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /chrome|crios/i.test(ua) ? 'Chrome'
    : /safari/i.test(ua) ? 'Safari'
    : ''
  return browser ? `${device}, ${browser}` : device
}

export type DeliveryOutcome = 'sent' | 'failed' | 'gone' | 'skipped_preference' | 'skipped_quiet_hours'

export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'sent': return 'Delivered to the phone service'
    case 'failed': return 'Could not be delivered'
    case 'gone': return 'Device no longer registered'
    case 'skipped_preference': return 'Not sent (turned off in your settings)'
    case 'skipped_quiet_hours': return 'Held back by quiet hours'
    default: return outcome
  }
}

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'never'
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}
