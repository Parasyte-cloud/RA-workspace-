import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { makeIcs } from './ics.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const url = new URL(req.url)

    const eventCode =
      url.searchParams.get('code')?.trim().toUpperCase()

    if (
      !eventCode ||
      !/^[A-Z0-9]{4,20}$/.test(eventCode)
    ) {
      return jsonResponse({ error: 'Invalid event code' }, 400)
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
      return jsonResponse(
        { error: 'Meeting calendar event not found' },
        404,
      )
    }

    const ics = makeIcs(data)

    const safeName =
      String(data.title || '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 70) ||
      'room7-meeting'

    return new Response(req.method === 'HEAD' ? null : ics, {
      status: 200,
      headers: {
        ...corsHeaders,
        'content-type':
          'text/calendar; charset=utf-8',
        // "attachment" so desktop browsers save the file for the calendar app
        // instead of showing it as text; phones still offer "Add to Calendar".
        'content-disposition':
          `attachment; filename="${safeName}.ics"`,
        'cache-control':
          'public, max-age=60',
      },
    })
  } catch (error) {
    console.error(
      'room7-calendar error',
      error,
    )

    return jsonResponse(
      { error: 'Unable to create calendar event' },
      500,
    )
  }
})
