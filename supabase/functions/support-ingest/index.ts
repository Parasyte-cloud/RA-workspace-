// Signed ingest for channels without a native Twilio webhook: email relays,
// the web chat widget, and website forms.
//
//   POST .../support-ingest
//   x-ra-timestamp: <unix seconds>
//   x-ra-signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with SUPPORT_INGEST_SECRET>
//   body: { "channel": "email"|"web_chat"|"form", "external_id": "...",
//           "from": { "email": "...", "phone": "...", "name": "..." },
//           "subject": "...", "body": "...", "metadata": {} }
//
// The timestamp window blocks replay; external_id makes redelivery harmless.
//
// PArAsYtE | RA-Workspace support module

import { normalizePhone, verifyIngestSignature } from '../_shared/supportCore.ts'
import { adminClient, cors, env, errorResponse, HttpError, json } from '../_shared/supportTwilio.ts'

const MAX_BYTES = 256 * 1024
const CHANNELS = ['email', 'web_chat', 'form']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const raw = await req.text()
    if (raw.length > MAX_BYTES) throw new HttpError(413, 'Payload too large')
    const check = await verifyIngestSignature({
      secret: env('SUPPORT_INGEST_SECRET'),
      timestamp: req.headers.get('x-ra-timestamp') || '',
      signature: req.headers.get('x-ra-signature') || '',
      rawBody: raw,
      nowMs: Date.now(),
    })
    if (!check.ok) throw new HttpError(401, 'Unauthorized')

    let body: Record<string, unknown>
    try { body = JSON.parse(raw) } catch { throw new HttpError(400, 'Body must be JSON') }

    const channel = String(body.channel || '')
    if (!CHANNELS.includes(channel)) throw new HttpError(400, 'channel must be email, web_chat or form')
    const externalId = String(body.external_id || '').trim().slice(0, 200)
    if (!externalId) throw new HttpError(400, 'external_id is required')
    const from = (body.from ?? {}) as Record<string, unknown>

    const email = String(from.email || '').trim().toLowerCase()
    const phone = normalizePhone(from.phone)
    const identities: Array<{ type: string; value: string }> = []
    if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) identities.push({ type: 'email', value: email })
    if (phone) identities.push({ type: 'phone', value: phone })
    // Anonymous web chat visitors get a session identity so the thread stays together.
    if (!identities.length) {
      const session = String((body.metadata as Record<string, unknown> | undefined)?.session_id || externalId).slice(0, 100)
      identities.push({ type: 'external', value: `${channel}:${session}` })
    }
    const [primary, ...extra] = identities

    const admin = adminClient()
    const { data, error } = await admin.rpc('support_ingest_interaction', {
      p_channel: channel,
      p_direction: 'inbound',
      p_provider: 'ra-ingest',
      p_external_id: externalId,
      p_identity_type: primary.type,
      p_identity_value: primary.value,
      p_display_name: String(from.name || '').trim().slice(0, 120) || null,
      p_subject: String(body.subject || '').trim().slice(0, 300) || null,
      p_body: String(body.body || '').slice(0, 20000),
      p_metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
      p_source_reference: null,
      p_priority: null,
      p_category: null,
      p_extra_identities: extra.map((i) => ({ type: i.type, value: i.value })),
      p_occurred_at: new Date().toISOString(),
    })
    if (error) throw new HttpError(500, 'Could not record the message')
    const row = Array.isArray(data) ? data[0] : data
    return json(req, { ok: true, ticketId: row?.ticket_id ?? null, publicId: row?.public_id ?? null, duplicate: Boolean(row?.duplicate) })
  } catch (error) {
    return errorResponse(req, error)
  }
})
