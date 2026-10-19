// Signed events from the RideArrivo backend: SOS activations and identity codes.
//
//   POST .../support-sos-ingest
//   x-ra-timestamp: <unix seconds>
//   x-ra-signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with SUPPORT_SOS_SECRET>
//
//   SOS:           { "event_id": "...", "subject_type": "rider"|"driver", "subject_id": "<uuid>",
//                    "identity_code": "RAR-XXXXX-XXXXX", "trip_id": "...", "booking_ref": "...", "vehicle_id": "...",
//                    "activated_at": "<ISO time of the button press>",
//                    "location": { "lat": 6.5, "lng": 3.3, "accuracy_m": 10, "heading": 90, "recorded_at": "<ISO>" } }
//   Identity code: { "kind": "identity_code", "subject_type": "rider"|"driver", "subject_id": "<uuid>" }
//
// The secret is separate from the other ingest secret so a leak of one cannot raise the other.
//
// Delivery contract for the sender: sign every attempt freshly (5 minute window), treat
// anything but a 2xx as "not received" and retry with the same event_id. Retrying is
// always safe. We answer 400 only for a body that can never succeed, so a sender that
// retries 5xx and 429 but not 4xx will never lose an emergency to a transient fault.
//
// PArAsYtE | RA-Workspace support module

import { parseSosEvent, verifyIngestSignature } from '../_shared/supportCore.ts'
import { dispatchDeliveries } from '../_shared/supportNotify.ts'
import { adminClient, cors, env, errorResponse, HttpError, json } from '../_shared/supportTwilio.ts'

const MAX_BYTES = 64 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)
  const started = Date.now()

  try {
    const raw = await req.text()
    if (raw.length > MAX_BYTES) throw new HttpError(413, 'Payload too large')
    const check = await verifyIngestSignature({
      secret: env('SUPPORT_SOS_SECRET'),
      timestamp: req.headers.get('x-ra-timestamp') || '',
      signature: req.headers.get('x-ra-signature') || '',
      rawBody: raw,
      nowMs: Date.now(),
    })
    if (!check.ok) throw new HttpError(401, 'Unauthorized')

    let body: Record<string, unknown>
    try { body = JSON.parse(raw) } catch { throw new HttpError(400, 'Body must be JSON') }
    const admin = adminClient()

    if (body?.kind === 'identity_code') {
      const type = body.subject_type
      const id = String(body.subject_id ?? '')
      if ((type !== 'rider' && type !== 'driver') || !UUID_RE.test(id)) throw new HttpError(400, 'subject_type and subject_id are required')
      const { data, error } = await admin.rpc('support_issue_identity_code', { p_type: type, p_subject_ref: id })
      if (error) throw new HttpError(500, 'Could not issue the code')
      return json(req, { ok: true, code: data })
    }

    const parsed = parseSosEvent(body)
    if (!parsed.ok) throw new HttpError(400, parsed.error)
    const e = parsed.value

    const { data, error } = await admin.rpc('support_sos_ingest', {
      p_source_event_id: e.eventId,
      p_subject_type: e.subjectType,
      p_subject_ref: e.subjectId,
      p_identity_code: e.identityCode,
      p_trip_ref: e.tripRef,
      p_booking_ref: e.bookingRef,
      p_vehicle_ref: e.vehicleRef,
      p_activated_at: e.activatedAt,
      p_location: e.location,
      p_payload: body,
    })
    if (error) {
      // 5xx so the sender retries. Never reached for a bad body (handled above).
      console.error(JSON.stringify({ evt: 'sos_ingest_failed', eventId: e.eventId, message: error.message?.slice(0, 200) }))
      throw new HttpError(500, 'Could not record the event')
    }
    const row = Array.isArray(data) ? data[0] : data
    console.log(JSON.stringify({ evt: 'sos_ingested', incident: row?.incident_ref, duplicate: Boolean(row?.is_duplicate), assigned: Boolean(row?.responder_id), ms: Date.now() - started }))
    // Send the first alerts now instead of waiting for the next minute. The emergency is already safely
    // recorded; this must never delay or fail the reply, so it runs after the response when the runtime allows.
    if (!row?.is_duplicate) {
      const send = dispatchDeliveries(admin, { limit: 25, budgetMs: 8000 }).catch((err) => console.error('sos dispatch', err))
      // deno-lint-ignore no-explicit-any
      const runtime = (globalThis as any).EdgeRuntime
      if (runtime?.waitUntil) runtime.waitUntil(send)
      else await Promise.race([send, new Promise((r) => setTimeout(r, 4000))])
    }
    return json(req, { ok: true, incidentRef: row?.incident_ref ?? null, duplicate: Boolean(row?.is_duplicate), responderAssigned: Boolean(row?.responder_id) })
  } catch (error) {
    return errorResponse(req, error)
  }
})
