// TaskRouter callbacks for the RA Support Command Centre.
//
//   ?action=assignment   Workflow "Assignment Callback URL". TaskRouter has
//                        picked a worker and asks us what to do. We re-check
//                        everything against live data and answer dequeue,
//                        call, or reject.
//   ?action=event        Workspace "Event Callback URL". Reservation and task
//                        events update RA presence and the call record.
//
// Why the assignment gate exists: TaskRouter's view of a worker (its activity)
// can be minutes stale. Without this gate an officer whose browser closed, or
// whose shift ended, would still be rung and the customer would sit in a dead
// ring for the full reservation timeout.
//
// PArAsYtE | RA-Workspace support module

import { decideAssignment, parseJsonObject, presenceForEvent } from '../_shared/supportCore.ts'
import {
  adminClient,
  cors,
  env,
  errorResponse,
  finishProviderEvent,
  formEntries,
  functionUrl,
  HttpError,
  json,
  mirrorPresence,
  recordProviderEvent,
  validateTwilioRequest,
} from '../_shared/supportTwilio.ts'

const FN = 'support-taskrouter-webhook'

async function handle(req: Request, state: { eventId: number; failed?: boolean }): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  const admin = adminClient()
  try {
    const form = await req.formData().catch(() => new FormData())
    const entries = formEntries(form)
    if (!(await validateTwilioRequest(req, entries, FN))) throw new HttpError(403, 'Invalid Twilio signature')
    const input = Object.fromEntries(entries) as Record<string, string>

    const action = new URL(req.url).searchParams.get('action') || 'assignment'
    const taskAttrs = parseJsonObject(input.TaskAttributes)
    const workerAttrs = parseJsonObject(input.WorkerAttributes)
    const workerSid = input.WorkerSid || ''
    const employeeId = String(workerAttrs.employee_id || '')
    const offlineActivity = env('TWILIO_TASKROUTER_OFFLINE_ACTIVITY_SID')

    // ------------------------------------------------------------ assignment
    if (action === 'assignment') {
      const reject = (reason: string) => {
        console.warn('assignment rejected', reason, workerSid, input.TaskSid)
        return json(req, { instruction: 'reject', activity_sid: offlineActivity })
      }
      if (!employeeId || !workerSid) return reject('missing_worker_identity')

      const [agent, presence, onShift, device, settings] = await Promise.all([
        admin.from('support_agents').select('enabled, voice_enabled, provider_worker_id').eq('employee_id', employeeId).maybeSingle(),
        admin.from('support_agent_presence').select('state, last_seen_at').eq('employee_id', employeeId).maybeSingle(),
        admin.rpc('support_is_employee_on_shift', { p_employee_id: employeeId, p_at: new Date().toISOString() }),
        admin.from('support_agent_voice_devices').select('client_identity').eq('employee_id', employeeId).maybeSingle(),
        admin.from('support_voice_settings').select('caller_id, recording_enabled, recording_consent_mode').eq('id', true).maybeSingle(),
      ])

      const decision = decideAssignment({
        workerSid,
        agent: agent.data ?? null,
        presence: presence.data ?? null,
        onShift: onShift.data === true,
        device: device.data ?? null,
        nowMs: Date.now(),
      })
      if (!decision.ok) {
        // A worker TaskRouter thinks is Available but we know is not: fix our
        // record, otherwise the next task is offered to the same ghost.
        if (['stale_heartbeat', 'off_shift', 'no_device'].includes(decision.reason)) {
          await admin.rpc('support_set_presence', { p_employee: employeeId, p_state: 'offline', p_reason: decision.reason, p_actor: null })
        }
        return reject(decision.reason)
      }

      const callerId = settings.data?.caller_id || env('TWILIO_CALLER_ID')
      const to = `client:${decision.clientIdentity}`

      if (taskAttrs.kind === 'callback') {
        const callbackId = String(taskAttrs.callback_id || '')
        if (!callbackId) throw new HttpError(400, 'Callback task is missing callback_id')
        await admin.from('support_callbacks')
          .update({ status: 'reserved', assigned_agent_id: employeeId, provider_task_id: input.TaskSid })
          .eq('id', callbackId).in('status', ['queued', 'reserved'])
        return json(req, {
          instruction: 'call',
          to,
          from: callerId,
          url: functionUrl('support-voice-webhook', { action: 'callback-agent', callback_id: callbackId, task_sid: input.TaskSid }),
          status_callback_url: functionUrl('support-voice-webhook', { action: 'agent-status', task_sid: input.TaskSid }),
          accept: true,
          timeout: 25,
        })
      }

      if (taskAttrs.call_id) {
        await admin.rpc('support_call_mark_ringing', { p_call_id: taskAttrs.call_id, p_task_sid: input.TaskSid, p_agent: employeeId })
      }
      const record = settings.data?.recording_enabled && settings.data?.recording_consent_mode !== 'disabled'
      return json(req, {
        instruction: 'dequeue',
        to,
        from: callerId,
        post_work_activity_sid: env('TWILIO_TASKROUTER_WRAPUP_ACTIVITY_SID'),
        timeout: 25,
        record: record ? 'record-from-answer' : 'do-not-record',
      })
    }

    // ------------------------------------------------------------ events
    if (action === 'event') {
      const eventType = input.EventType || ''
      const key = [eventType, input.ResourceSid || input.ReservationSid || input.TaskSid || '', input.Timestamp || ''].join(':')
      const rec = await recordProviderEvent(admin, 'twilio-taskrouter', key, eventType, input)
      if (rec.duplicate) return json(req, { ok: true, duplicate: true })
      state.eventId = rec.id

      if (employeeId) {
        const { data: presence } = await admin.from('support_agent_presence').select('state').eq('employee_id', employeeId).maybeSingle()
        const next = presenceForEvent(eventType, presence?.state ?? 'offline')
        if (next) {
          const { error } = await admin.rpc('support_set_presence', {
            p_employee: employeeId, p_state: next.state, p_reason: next.reason, p_actor: null,
          })
          if (error) console.warn('presence update failed', error.message)
          if (next.state !== 'wrap_up') await mirrorPresence(workerSid, next.state === 'on_call' ? 'busy' : next.state)
        }
        if (eventType === 'reservation.accepted' && input.TaskSid) {
          await admin.rpc('support_call_mark_answered', { p_task_sid: input.TaskSid, p_agent: employeeId })
        }
      }

      // A callback task that dies (cancelled, deleted, or timed out with no
      // officer) must go back to the due list instead of staying "reserved".
      if (taskAttrs.kind === 'callback' && /^task\.(canceled|deleted)$/.test(eventType)) {
        const callbackId = String(taskAttrs.callback_id || '')
        if (callbackId) {
          await admin.from('support_callbacks')
            .update({ status: 'queued', provider_task_id: null, assigned_agent_id: null })
            .eq('id', callbackId).in('status', ['queued', 'reserved'])
        }
      }

      if (taskAttrs.ticket_id && eventType === 'task.completed') {
        await admin.from('support_ticket_events').insert({
          ticket_id: taskAttrs.ticket_id,
          event_type: 'voice_task_completed',
          payload: { task_sid: input.TaskSid, worker_sid: workerSid },
        })
      }
      return json(req, { ok: true })
    }

    throw new HttpError(400, 'Unsupported TaskRouter webhook action')
  } catch (error) {
    state.failed = true
    await finishProviderEvent(adminClient(), state.eventId, error).catch(() => {})
    return errorResponse(req, error, 'json')
  }
}

Deno.serve(async (req) => {
  const state: { eventId: number; failed?: boolean } = { eventId: 0 }
  const res = await handle(req, state)
  if (res.status < 400 && !state.failed && state.eventId) {
    await finishProviderEvent(adminClient(), state.eventId).catch(() => {})
  }
  return res
})
