// Inbound SMS from Twilio -> ticket. Point the number's "A message comes in"
// webhook (HTTP POST) at this function. Replying is done by officers from the
// workspace; this endpoint only records and routes the customer's message.
//
// PArAsYtE | RA-Workspace support module

import { normalizePhone } from '../_shared/supportCore.ts'
import { adminClient, cors, errorResponse, formEntries, HttpError, json, validateTwilioRequest, xml } from '../_shared/supportTwilio.ts'

const FN = 'support-sms-webhook'
const EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response/>'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const form = await req.formData().catch(() => new FormData())
    const entries = formEntries(form)
    if (!(await validateTwilioRequest(req, entries, FN))) throw new HttpError(403, 'Invalid Twilio signature')
    const input = Object.fromEntries(entries) as Record<string, string>
    if (!input.MessageSid) throw new HttpError(400, 'MessageSid is required')

    const phone = normalizePhone(input.From)
    const admin = adminClient()
    const { error } = await admin.rpc('support_ingest_interaction', {
      p_channel: 'sms',
      p_direction: 'inbound',
      p_provider: 'twilio',
      p_external_id: input.MessageSid,
      p_identity_type: phone ? 'phone' : 'external',
      p_identity_value: phone || `sms:${(input.From || 'unknown').slice(0, 40)}`,
      p_display_name: null,
      p_subject: null,
      p_body: (input.Body || '').slice(0, 4000),
      p_metadata: { to: input.To || null, num_media: Number(input.NumMedia || 0), from_city: input.FromCity || null, from_country: input.FromCountry || null },
      p_source_reference: null,
      p_priority: null,
      p_category: null,
      p_extra_identities: [],
      p_occurred_at: new Date().toISOString(),
    })
    // A duplicate delivery returns normally (idempotent). A real failure must be
    // a 5xx so Twilio retries instead of the customer's message vanishing.
    if (error) throw new HttpError(500, 'Could not record the message')
    return xml(req, EMPTY)
  } catch (error) {
    if (error instanceof HttpError && error.status === 500) return json(req, { error: error.message }, 500)
    return errorResponse(req, error)
  }
})
