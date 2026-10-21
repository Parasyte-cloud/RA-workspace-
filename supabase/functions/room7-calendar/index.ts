import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function escapeIcs(value: string) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function toIcsUtc(value: string) {
  const date = new Date(value)

  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function makeIcs(event: any) {
  const reminders = Array.isArray(event.reminder_minutes)
    ? event.reminder_minutes
    : [60, 15]

  const alarms = reminders
    .filter((value: unknown) => Number.isFinite(Number(value)))
    .map((minutes: number) => {
      const mins = Math.max(1, Math.round(Number(minutes)))

      return [
        'BEGIN:VALARM',
        `TRIGGER:-PT${mins}M`,
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcs(event.title)} starts in ${mins} minutes`,
        'END:VALARM',
      ].join('\r\n')
    })
    .join('\r\n')

  const cancelled = event.status === 'cancelled'

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RideArrivo//Room7//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${escapeIcs(event.event_code)}@room7.ridearrivo.com`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(event.starts_at)}`,
    `DTEND:${toIcsUtc(event.ends_at)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(
      [
        event.description || '',
        '',
        `Join Room7: ${event.join_url}`,
        `Event code: ${event.event_code}`,
      ].join('\n'),
    )}`,
    `LOCATION:${escapeIcs(event.join_url)}`,
    `URL:${escapeIcs(event.join_url)}`,
    `SEQUENCE:${Number(event.sequence || 0)}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    event.organizer_email
      ? `ORGANIZER;CN=${escapeIcs(
          event.organizer_name || 'RideArrivo',
        )}:MAILTO:${escapeIcs(event.organizer_email)}`
      : '',
    alarms,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .filter(Boolean)
    .join('\r\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  try {
    const url = new URL(req.url)

    const eventCode =
      url.searchParams.get('code')?.trim().toUpperCase()

    if (
      !eventCode ||
      !/^[A-Z0-9]{4,20}$/.test(eventCode)
    ) {
      return new Response(
        JSON.stringify({
          error: 'Invalid event code',
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'content-type': 'application/json',
          },
        },
      )
    }

    const supabaseUrl =
      Deno.env.get('SUPABASE_URL')

    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'Supabase server configuration missing',
      )
    }

    const supabase =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            persistSession: false,
          },
        },
      )

    const { data, error } =
      await supabase
        .from('room7_calendar_events')
        .select('*')
        .eq('event_code', eventCode)
        .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return new Response(
        JSON.stringify({
          error: 'Meeting calendar event not found',
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            'content-type': 'application/json',
          },
        },
      )
    }

    const ics = makeIcs(data)

    const safeName =
      data.title
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 70) ||
      'room7-meeting'

    return new Response(ics, {
      status: 200,
      headers: {
        ...corsHeaders,
        'content-type':
          'text/calendar; charset=utf-8',
        'content-disposition':
          `inline; filename="${safeName}.ics"`,
        'cache-control':
          'public, max-age=60',
      },
    })
  } catch (error) {
    console.error(
      'room7-calendar error',
      error,
    )

    return new Response(
      JSON.stringify({
        error: 'Unable to create calendar event',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'content-type': 'application/json',
        },
      },
    )
  }
})
