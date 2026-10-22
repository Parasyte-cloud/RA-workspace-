import { supabase } from './supabase'

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
  if (!input.meetingId) {
    throw new Error('A Room7 meeting is required for calendar scheduling.')
  }

  const { data, error } = await requireSupabase().rpc(
    'save_room7_calendar_event',
    {
      p_event_code: input.eventCode.trim().toUpperCase(),
      p_meeting_id: input.meetingId,
      p_title: input.title.trim(),
      p_description: input.description?.trim() || null,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_timezone: input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos',
      p_join_url: input.joinUrl,
      p_organizer_name: input.organizerName || null,
      p_organizer_email: input.organizerEmail || null,
      p_reminder_minutes: input.reminderMinutes || [60, 15],
    },
  )

  if (error) throw error
  return data
}

export async function cancelRoom7CalendarEvent(
  eventCode: string,
) {
  const { data, error } = await requireSupabase().rpc(
    'cancel_room7_calendar_event',
    { p_event_code: eventCode.trim().toUpperCase() },
  )
  if (error) throw error
  return data
}
