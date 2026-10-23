export type Room7CalendarEvent = {
  eventCode: string
  title: string
  description?: string
  startsAt: string
  endsAt: string
  timezone?: string
  joinUrl: string
}

// True for a real IANA zone such as Africa/Lagos. Free text like "Lagos" is not.
export function isValidTimeZone(value: string | null | undefined) {
  const zone = String(value || '').trim()
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date())
    return true
  } catch {
    return false
  }
}

// Calendar links carry everything in the address. Browsers and the calendar
// sites cut very long addresses, so the description is trimmed and the join
// link, the part that matters, always survives.
const MAX_LINK_DESCRIPTION = 900

function linkDetails(event: Room7CalendarEvent) {
  const description = (event.description || '').trim()
  const trimmed =
    description.length > MAX_LINK_DESCRIPTION
      ? `${description.slice(0, MAX_LINK_DESCRIPTION - 1).trimEnd()}…`
      : description

  return [
    trimmed,
    '',
    `Join Room7: ${event.joinUrl}`,
    `Event code: ${event.eventCode}`,
  ].join('\n')
}

function compactGoogleDate(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

export function room7IcsUrl(
  eventCode: string,
) {
  const supabaseUrl =
    String(import.meta.env?.VITE_SUPABASE_URL || '').replace(/\/+$/, '')

  return (
    `${supabaseUrl}/functions/v1/room7-calendar` +
    `?code=${encodeURIComponent(
      eventCode.toUpperCase(),
    )}`
  )
}

export function googleCalendarUrl(
  event: Room7CalendarEvent,
) {
  const params =
    new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates:
        `${compactGoogleDate(event.startsAt)}/` +
        `${compactGoogleDate(event.endsAt)}`,
      details: linkDetails(event),
      location: event.joinUrl,
    })

  return (
    'https://calendar.google.com/calendar/render?' +
    params.toString()
  )
}

export function outlookCalendarUrl(
  event: Room7CalendarEvent,
  // Work and school accounts use outlook.office.com. Personal Outlook.com,
  // Hotmail and Live accounts use outlook.live.com and cannot open the other.
  account: 'work' | 'personal' = 'work',
) {
  const params =
    new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: event.title,
      startdt:
        new Date(
          event.startsAt,
        ).toISOString(),
      enddt:
        new Date(
          event.endsAt,
        ).toISOString(),
      body: linkDetails(event),
      location: event.joinUrl,
    })

  const host =
    account === 'personal'
      ? 'outlook.live.com'
      : 'outlook.office.com'

  return (
    `https://${host}/calendar/0/deeplink/compose?` +
    params.toString()
  )
}
