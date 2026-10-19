// Authorised position of a rider or driver, for an open location session only.
//
//   POST .../support-location   (signed-in Support user)   { "sessionId": "<uuid>" }
//
// Every call is checked against the session (owner, still active, not expired, case
// still open, not polled too fast) and recorded. The position comes from the existing
// RideArrivo location service; we never keep our own GPS feed.
//
//   RA_LOCATION_API_URL  base URL that answers GET ?subject_type=rider|driver&subject_id=<uuid>
//   RA_LOCATION_API_KEY  bearer token for it
//   expected JSON: { lat, lng, heading?, speed_kmh?, accuracy_m?, recorded_at, trip?: {...} }
//
// If the service is missing or down the reply says so and shows the last position from
// the SOS event (if there is one), labelled as last known with its age. A stale position
// is never reported as live.
//
// PArAsYtE | RA-Workspace support module

import { locationFreshness, sanitizeLiveLocation } from '../_shared/supportCore.ts'
import { cors, env, errorResponse, HttpError, json, requireSupportUser } from '../_shared/supportTwilio.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REFUSALS: Record<string, string> = {
  not_found: 'That location session does not exist.',
  not_your_session: 'That location session belongs to someone else.',
  role_not_permitted: 'Your role cannot view locations.',
  awaiting_approval: 'A supervisor has not approved this request yet.',
  expired: 'This location session has expired. Request a new one.',
  ended: 'This location session has ended.',
  denied: 'This location request was denied.',
  case_closed: 'The case is closed, so location access has ended.',
  rate_limited: 'Slow down: this session is being refreshed too often.',
}

type Fetched = { ok: true; value: NonNullable<ReturnType<typeof sanitizeLiveLocation>> } | { ok: false; reason: 'not_configured' | 'unavailable' }

async function fetchLive(subjectType: string, subjectRef: string): Promise<Fetched> {
  const base = env('RA_LOCATION_API_URL', false)
  const key = env('RA_LOCATION_API_KEY', false)
  if (!base || !key) return { ok: false, reason: 'not_configured' }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 4000)
  try {
    const url = new URL(base)
    url.searchParams.set('subject_type', subjectType)
    url.searchParams.set('subject_id', subjectRef)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: ctl.signal })
    if (!res.ok) return { ok: false, reason: 'unavailable' }
    const value = sanitizeLiveLocation(await res.json().catch(() => null))
    return value ? { ok: true, value } : { ok: false, reason: 'unavailable' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const { admin, employeeId } = await requireSupportUser(req)
    const body = await req.json().catch(() => ({}))
    const sessionId = String(body?.sessionId ?? '').trim()
    if (!UUID_RE.test(sessionId)) throw new HttpError(400, 'sessionId is required')

    const { data: gate, error: gateError } = await admin.rpc('support_location_gate', { p_session: sessionId, p_actor: employeeId })
    if (gateError) throw gateError
    if (!gate?.ok) {
      const reason = String(gate?.reason ?? 'denied')
      if (reason !== 'not_found') await admin.rpc('support_location_log', { p_session: sessionId, p_actor: employeeId, p_outcome: 'denied', p_age: null })
      throw new HttpError(403, REFUSALS[reason] ?? 'Location access refused.')
    }

    const fresh = Number(gate.fresh_seconds) || 45
    const live = await fetchLive(String(gate.subject_type), String(gate.subject_ref))
    const now = Date.now()
    let state: 'live' | 'stale' | 'unavailable' | 'not_configured' = 'unavailable'
    let location: Record<string, unknown> | null = null
    let trip: unknown = null
    let trail: unknown = null
    let source: 'live_service' | 'sos_event' | null = null
    let ageSeconds: number | null = null
    let warning: string | null = null

    if (live.ok) {
      const f = locationFreshness(live.value.recorded_at, now, fresh)
      const { trip: t, trail: tr, ...pos } = live.value
      location = pos; trip = t ?? null; trail = tr ?? null; source = 'live_service'; ageSeconds = f.ageSeconds
      state = f.state === 'live' ? 'live' : 'stale'
      if (f.state === 'unknown') warning = 'The location service sent no timestamp, so this cannot be treated as live.'
      else if (f.state === 'stale') warning = 'This position is old. Treat it as the last known position, not where they are now.'
    } else {
      state = live.reason
      warning = live.reason === 'not_configured'
        ? 'The live location service is not connected yet.'
        : 'The live location service did not answer. Showing the last known position if there is one.'
      if (gate.incident_id) {
        const { data: inc } = await admin.from('support_incidents').select('last_location').eq('id', gate.incident_id).maybeSingle()
        const last = inc?.last_location as Record<string, unknown> | null
        if (last && typeof last.lat === 'number') {
          const f = locationFreshness(last.recorded_at, now, fresh)
          location = last; source = 'sos_event'; ageSeconds = f.ageSeconds
          state = f.state === 'live' ? 'live' : 'stale'
        }
      }
    }

    const outcome = state === 'live' ? 'served' : state === 'stale' ? 'stale' : state === 'not_configured' ? 'not_configured' : 'unavailable'
    await admin.rpc('support_location_log', { p_session: sessionId, p_actor: employeeId, p_outcome: outcome, p_age: ageSeconds })

    return new Response(JSON.stringify({ ok: true, state, ageSeconds, location, trip, trail, source, warning, expiresAt: gate.expires_at, freshSeconds: fresh }), {
      status: 200,
      headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return errorResponse(req, error)
  }
})
