// Issues a short-lived Twilio Voice access token to a signed-in Support officer.
// The identity is derived from the authenticated user id, never from the request,
// so one officer cannot mint a token that rings or dials as someone else.
//
// PArAsYtE | RA-Workspace support module

import { clientIdentity } from '../_shared/supportCore.ts'
import { cors, errorResponse, HttpError, issueVoiceToken, json, requireSupportUser } from '../_shared/supportTwilio.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const { admin, employeeId } = await requireSupportUser(req)
    const { data: agent, error } = await admin
      .from('support_agents')
      .select('enabled, voice_enabled')
      .eq('employee_id', employeeId)
      .maybeSingle()
    if (error) throw error
    if (!agent?.enabled || !agent?.voice_enabled) throw new HttpError(403, 'Voice access is not enabled for this Support officer')

    const identity = clientIdentity(employeeId)
    const issued = await issueVoiceToken(identity, 3600)

    const now = new Date().toISOString()
    await admin.from('support_agent_voice_devices').upsert(
      { employee_id: employeeId, provider: 'twilio', client_identity: identity, last_seen_at: now, updated_at: now },
      { onConflict: 'employee_id' },
    )
    return json(req, { identity, ...issued })
  } catch (error) {
    return errorResponse(req, error)
  }
})
