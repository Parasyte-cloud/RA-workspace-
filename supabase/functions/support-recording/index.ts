// Audited playback of a call recording or voicemail.
//
// The browser sends its Supabase session token and a call id. We check the
// role (supervisor, or the officer who handled the call), write an audit row,
// then stream the audio from Twilio with our credentials. The audio never has
// a public URL and the Twilio credentials never reach the browser.
//
// PArAsYtE | RA-Workspace support module

import { cors, errorResponse, fetchRecordingAudio, HttpError, json, requireSupportUser } from '../_shared/supportTwilio.ts'

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const { admin, employeeId } = await requireSupportUser(req)
    const body = await req.json().catch(() => ({}))
    const callId = String(body?.callId ?? '').trim()
    if (!uuidRe.test(callId)) throw new HttpError(400, 'callId is required')

    const { data, error } = await admin.rpc('support_recording_ref', { p_call: callId, p_actor: employeeId })
    if (error) {
      if (error.code === '42501') throw new HttpError(403, 'You are not allowed to play this recording')
      if (error.code === 'P0002') throw new HttpError(404, 'This recording is not available')
      throw error
    }
    const row = Array.isArray(data) ? data[0] : data
    if (!row?.recording_sid) throw new HttpError(404, 'This recording is not available')

    const audio = await fetchRecordingAudio(String(row.recording_sid))
    if (!audio.ok || !audio.body) throw new HttpError(502, 'The recording could not be fetched')
    return new Response(audio.body, {
      status: 200,
      headers: { ...cors(req), 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return errorResponse(req, error)
  }
})
