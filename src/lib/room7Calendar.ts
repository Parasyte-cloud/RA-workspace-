export type Room7CalendarEvent = {
  eventCode: string
  title: string
  description?: string
  startsAt: string
  endsAt: string
  timezone?: string
  joinUrl: string
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
    import.meta.env.VITE_SUPABASE_URL

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
      details: [
        event.description || '',
        '',
        `Join Room7: ${event.joinUrl}`,
        `Event code: ${event.eventCode}`,
      ].join('\n'),
      location: event.joinUrl,
    })

  return (
    'https://calendar.google.com/calendar/render?' +
    params.toString()
  )
}

export function outlookCalendarUrl(
  event: Room7CalendarEvent,
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
      body: [
        event.description || '',
        '',
        `Join Room7: ${event.joinUrl}`,
        `Event code: ${event.eventCode}`,
      ].join('\n'),
      location: event.joinUrl,
    })

  return (
    'https://outlook.office.com/calendar/0/deeplink/compose?' +
    params.toString()
  )
}
