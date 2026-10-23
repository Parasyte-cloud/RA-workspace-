import { supabase } from './supabase'
import { isValidTimeZone } from './room7Calendar'

export type SaveRoom7CalendarInput = {
  eventCode: string
  meetingId?: string | null
  title: string
  description?: string
  startsAt: string
  endsAt: string
  timezone?: string
  joinUrl: string
  organizerName?: string
  organizerEmail?: string
  reminderMinutes?: number[]
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured for this environment.',
    )
  }

  return supabase
}

export async function saveRoom7CalendarEvent(
  input: SaveRoom7CalendarInput,
) {
  const client = requireSupabase()

  const {
    data: auth,
    error: authError,
  } = await client.auth.getUser()

  if (authError) {
    throw authError
  }

  if (!auth.user) {
    throw new Error(
      'You must be signed in to schedule a meeting.',
    )
  }

  const title = input.title.trim()
  if (title.length < 2) {
    throw new Error('Give the meeting a title before scheduling it.')
  }

  const start = new Date(input.startsAt)
  const end = new Date(input.endsAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Enter a valid start and end time.')
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error('The meeting must end after it starts.')
  }

  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const timezone = [input.timezone, browserZone, 'Africa/Lagos'].find(
    zone => isValidTimeZone(zone),
  ) as string

  // Keep only sensible reminders: whole minutes, one day at most, no repeats.
  const reminders = Array.from(
    new Set(
      (input.reminderMinutes || [60, 15])
        .map(value => Math.round(Number(value)))
        .filter(value => Number.isFinite(value) && value >= 1 && value <= 1440),
    ),
  ).slice(0, 5)

  const payload = {
    event_code:
      input.eventCode
        .trim()
        .toUpperCase(),
    meeting_id:
      input.meetingId || null,
    title,
    description:
      input.description?.trim() ||
      null,
    starts_at:
      input.startsAt,
    ends_at:
      input.endsAt,
    timezone,
    join_url:
      input.joinUrl,
    organizer_name:
      input.organizerName ||
      null,
    organizer_email:
      input.organizerEmail ||
      null,
    reminder_minutes:
      reminders.length ? reminders : [60, 15],
    status:
      'confirmed',
    created_by:
      auth.user.id,
    updated_at:
      new Date().toISOString(),
  }

  const {
    data,
    error,
  } = await client
    .from(
      'room7_calendar_events',
    )
    .upsert(
      payload,
      {
        onConflict: 'event_code',
      },
    )
    .select()
    .single()

  if (error) {
    throw error
  }

  return data
}


export async function cancelRoom7CalendarEvent(
  eventCode: string,
) {
  const client = requireSupabase()

  const {
    data: auth,
    error: authError,
  } = await client.auth.getUser()

  if (authError) {
    throw authError
  }

  if (!auth.user) {
    throw new Error(
      'You must be signed in to update a scheduled meeting.',
    )
  }

  const code =
    eventCode
      .trim()
      .toUpperCase()

  const {
    data: existing,
    error: existingError,
  } = await client
    .from('room7_calendar_events')
    .select('event_code,status')
    .eq('event_code', code)
    .maybeSingle()

  if (existingError) {
    throw existingError
  }

  if (!existing) {
    return null
  }

  if (existing.status === 'cancelled') {
    return existing
  }

  const {
    data,
    error,
  } = await client
    .from('room7_calendar_events')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('event_code', code)
    .select()
    .single()

  if (error) {
    throw error
  }

  return data
}
