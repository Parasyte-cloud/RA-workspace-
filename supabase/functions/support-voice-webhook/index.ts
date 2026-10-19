// Twilio Voice webhook for the RA Support Command Centre.
//
// One URL, many actions (?action=...). Point the Twilio number's "A call comes
// in" at   .../support-voice-webhook?action=inbound
// and the TwiML App's Voice URL at  .../support-voice-webhook?action=outbound
//
//   inbound         new inbound call: optional IVR, ticket, enqueue to TaskRouter
//   ivr             digit from the IVR menu
//   wait            queue hold loop: music/message, callback offer, max wait
//   callback-choice digit from the callback offer
//   queue-exit      call left the queue (bridged, hung up, or we sent it away)
//   outbound        officer dialled from the softphone
//   callback-agent  the officer answered a callback task; dial the customer
//   status          call status callbacks (also agent-status, callback-status)
//   recording       recording status callback
//   announce        recording notice played to the person an officer dialled
//   dial-result     dial ended; retries over PSTN if the BYOC leg itself failed
//   voicemail-done / voicemail-recording
//                   after-hours message recorded; stored and a callback booked
//
// Every request is signature checked. Twilio retries on timeouts, so each
// action is written to be safe to run twice.
//
// PArAsYtE | RA-Workspace support module

import {
  callbackAgentTwiml,
  chooseCarrierRoute,
  closedTwiml,
  recordingNoticeTwiml,
  shouldFallBackToPstn,
  voicemailThanksTwiml,
  voicemailTwiml,
  callbackConfirmedTwiml,
  callbackOfferTwiml,
  enqueueTwiml,
  isWithheldCaller,
  ivrChoice,
  ivrMenuTwiml,
  noOfficerCallbackTwiml,
  normalizePhone,
  outboundDialTwiml,
  rejectDestinationTwiml,
  sayAndHangupTwiml,
  shouldSayHoldMessage,
  twiml,
  waitTwiml,
} from '../_shared/supportCore.ts'
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
  recordProviderEvent,
  taskRouterBase,
  twilioFormRequest,
  validateTwilioRequest,
  xml,
} from '../_shared/supportTwilio.ts'

const FN = 'support-voice-webhook'
const WAIT_LOOP_SECONDS = 15
const TERMINAL = ['completed', 'busy', 'failed', 'no-answer', 'canceled']

const url = (action: string, query: Record<string, string> = {}) => functionUrl(FN, { action, ...query })

function mapStatus(raw: string): string {
  const v = (raw || '').toLowerCase()
  if (v === 'answered') return 'in-progress'
  return v || 'unknown'
}

async function handle(req: Request, state: { eventId: number; failed?: boolean }): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  const query = new URL(req.url).searchParams
  const action = query.get('action') || 'inbound'
  const isStatusLike = ['status', 'agent-status', 'callback-status', 'recording', 'voicemail-recording'].includes(action)
  const admin = adminClient()

  try {
    const form = await req.formData().catch(() => new FormData())
    const entries = formEntries(form)
    if (!(await validateTwilioRequest(req, entries, FN))) throw new HttpError(403, 'Invalid Twilio signature')
    const input = Object.fromEntries(entries) as Record<string, string>

    const callSid = input.CallSid || ''
    const parentSid = input.ParentCallSid || callSid
    const eventKey = [action, callSid, input.CallStatus || input.DialCallStatus || input.QueueResult || input.RecordingSid || input.Digits || input.QueueTime || '', query.get('try') || ''].join(':')
    // wait/ivr loops fire repeatedly by design; only dedupe the one-shot actions.
    if (!['wait', 'ivr'].includes(action) && callSid) {
      const rec = await recordProviderEvent(admin, 'twilio-voice', eventKey, action, input)
      if (rec.duplicate) return isStatusLike ? json(req, { ok: true, duplicate: true }) : xml(req, twiml(''))
      state.eventId = rec.id
    }

    const { data: settings } = await admin.from('support_voice_settings').select('*').eq('id', true).maybeSingle()
    const cfg = settings ?? {}
    const callerId = (cfg.caller_id as string) || env('TWILIO_CALLER_ID')
    const envTrunk = env('TWILIO_BYOC_TRUNK_SID', false) || undefined
    // Caller ID and carrier route for a destination: number registry first, then settings.
    const pick = async (to: string) => {
      const { data } = await admin.rpc('support_pick_caller_id', { p_to: to })
      const number = String(data?.number || callerId || '')
      if (!number) throw new HttpError(500, 'No outbound caller ID is configured')
      return { number, ...chooseCarrierRoute(data?.route ?? null, envTrunk) }
    }

    // ---------------------------------------------------------------- inbound / ivr
    if (action === 'inbound' || action === 'ivr') {
      const tries = Number(query.get('try') || 0)

      if (action === 'inbound') {
        const { data: lineRoute } = await admin.rpc('support_voice_route')
        if (lineRoute && lineRoute.action !== 'queue') {
          const isHidden = isWithheldCaller(input.From) || !normalizePhone(input.From)
          const { error: startErr } = await admin.rpc('support_voice_start_inbound', {
            p_call_sid: callSid,
            p_from: isHidden ? '' : normalizePhone(input.From),
            p_to: normalizePhone(input.To) || input.To || '',
            p_hidden: isHidden,
            p_priority: null,
            p_category: null,
            p_ivr: 'after_hours',
          })
          if (startErr) throw startErr
          await admin.rpc('support_voice_mark_after_hours', { p_call_sid: callSid })
          if (lineRoute.action === 'voicemail') {
            return xml(req, voicemailTwiml({
              closedMessage: String(lineRoute.closed_message || 'Our support line is closed right now.'),
              prompt: String(lineRoute.voicemail_prompt || 'Please leave a message after the tone.'),
              maxSeconds: Number(lineRoute.voicemail_max_seconds || 120),
              actionUrl: url('voicemail-done'),
              recordingCallbackUrl: url('voicemail-recording'),
            }))
          }
          return xml(req, closedTwiml(String(lineRoute.closed_message || 'Our support line is closed right now.')))
        }
      }

      let choice = null as ReturnType<typeof ivrChoice>
      if (action === 'inbound' && cfg.ivr_enabled) {
        return xml(req, ivrMenuTwiml({
          greeting: String(cfg.greeting_text || ''),
          actionUrl: url('ivr'),
          fallbackUrl: url('ivr', { try: '1' }),
        }))
      }
      if (action === 'ivr') {
        choice = ivrChoice(input.Digits)
        if (!choice && tries < 1) {
          return xml(req, ivrMenuTwiml({
            greeting: 'Sorry, we did not get that.',
            actionUrl: url('ivr', { try: '1' }),
            fallbackUrl: url('ivr', { try: '2' }),
          }))
        }
        choice = choice ?? ivrChoice('3')
      }

      const hidden = isWithheldCaller(input.From)
      const from = hidden ? '' : normalizePhone(input.From)
      // A caller we cannot identify is still a customer. Take the call.
      const treatAsHidden = hidden || !from
      const { data: rows, error } = await admin.rpc('support_voice_start_inbound', {
        p_call_sid: callSid,
        p_from: treatAsHidden ? '' : from,
        p_to: normalizePhone(input.To) || input.To || '',
        p_hidden: treatAsHidden,
        p_priority: choice?.priority ?? null,
        p_category: choice?.category ?? null,
        p_ivr: choice ? `${input.Digits || 'default'}:${choice.label}` : null,
      })
      if (error) throw error
      const row = Array.isArray(rows) ? rows[0] : rows
      if (!row) throw new HttpError(500, 'Could not create the call record')

      const attributes = {
        kind: 'voice_inbound',
        channel: 'voice',
        ticket_id: row.ticket_id,
        call_id: row.call_id,
        public_id: row.public_id,
        call_sid: callSid,
        from: treatAsHidden ? null : from,
        skill: choice?.skill ?? null,
        has_preferred: row.preferred_agent ? 1 : 0,
        preferred_agent_id: row.preferred_agent ?? null,
      }
      return xml(req, enqueueTwiml({
        greeting: action === 'ivr' ? '' : String(cfg.greeting_text || ''),
        workflowSid: env('TWILIO_TASKROUTER_WORKFLOW_SID'),
        attributes,
        priority: choice?.priority ?? 'P2',
        waitUrl: url('wait'),
        actionUrl: url('queue-exit'),
      }))
    }

    // ---------------------------------------------------------------- queue hold
    if (action === 'wait') {
      const queueTime = Number(input.QueueTime || 0)
      const maxWait = Number(cfg.max_queue_wait_seconds ?? 1800)
      if (queueTime >= maxWait) return xml(req, waitTwiml({ message: '', sayMessage: false, leave: true, loopSeconds: WAIT_LOOP_SECONDS }))

      const offerAfter = Number(cfg.callback_offer_after_seconds ?? 180)
      if (cfg.callback_enabled && queueTime >= offerAfter && !query.get('held')) {
        const { data: call } = await admin.from('support_calls').select('id, caller_hidden').eq('provider_call_id', callSid).maybeSingle()
        if (call && !call.caller_hidden) {
          const { data: already } = await admin.from('support_call_events').select('id').eq('call_id', call.id).eq('event_type', 'callback_offered').limit(1)
          if (!already?.length) {
            await admin.from('support_call_events').insert({ call_id: call.id, provider_call_id: callSid, event_type: 'callback_offered', payload: { queue_time: queueTime } })
            return xml(req, callbackOfferTwiml({
              choiceUrl: url('callback-choice'),
              keepHoldingUrl: url('wait', { held: '1' }),
            }))
          }
        }
      }
      return xml(req, waitTwiml({
        message: String(cfg.hold_message_text || ''),
        sayMessage: shouldSayHoldMessage(queueTime, WAIT_LOOP_SECONDS),
        leave: false,
        loopSeconds: WAIT_LOOP_SECONDS,
        musicUrl: env('SUPPORT_HOLD_MUSIC_URL', false) || undefined,
      }))
    }

    if (action === 'callback-choice') {
      if (input.Digits !== '1') return xml(req, waitTwiml({ message: '', sayMessage: false, leave: false, loopSeconds: WAIT_LOOP_SECONDS }))
      const { data: call } = await admin.from('support_calls').select('id, ticket_id, from_number, caller_hidden').eq('provider_call_id', callSid).maybeSingle()
      if (!call || call.caller_hidden || !call.from_number) return xml(req, waitTwiml({ message: '', sayMessage: false, leave: false, loopSeconds: WAIT_LOOP_SECONDS }))
      const { error } = await admin.rpc('support_callback_create', {
        p_ticket: call.ticket_id, p_phone: call.from_number, p_origin: 'queue_offer', p_actor: null, p_not_before: null, p_call: call.id,
      })
      if (error) throw error
      // The hang-up that follows lands in queue-exit, which marks the call abandoned.
      return xml(req, callbackConfirmedTwiml())
    }

    // ---------------------------------------------------------------- left the queue
    if (action === 'queue-exit') {
      const result = (input.QueueResult || '').toLowerCase()
      if (result === 'bridged') return xml(req, twiml(''))
      const waited = Number(input.QueueTime || 0)
      const { data: rows, error } = await admin.rpc('support_call_abandon', {
        p_call_sid: callSid, p_wait_seconds: waited, p_create_callback: Boolean(cfg.callback_enabled ?? true),
      })
      if (error) throw error
      const created = Array.isArray(rows) ? rows[0] : rows
      if (result === 'leave' || result === 'queue-full' || result === 'error' || result === 'system-error') {
        return xml(req, created ? noOfficerCallbackTwiml() : sayAndHangupTwiml('We are sorry, no officer was available. Please call again shortly. Goodbye.'))
      }
      return xml(req, twiml(''))
    }

    // ---------------------------------------------------------------- outbound from the softphone
    if (action === 'outbound') {
      const identity = (input.From || '').replace(/^client:/, '')
      const { data: device } = await admin.from('support_agent_voice_devices').select('employee_id').eq('client_identity', identity).maybeSingle()
      // Do not tell an unknown caller why; there is no legitimate unknown device.
      if (!device?.employee_id) throw new HttpError(403, 'Unknown voice identity')

      const { data: agent } = await admin.from('support_agents').select('enabled, voice_enabled').eq('employee_id', device.employee_id).maybeSingle()
      if (!agent?.enabled || !agent?.voice_enabled) return xml(req, sayAndHangupTwiml('Your voice access is not enabled.'))

      const { data: verdict, error: dialError } = await admin.rpc('support_check_dial', { p_employee: device.employee_id, p_number: input.To || '' })
      if (dialError) throw dialError
      if (!verdict?.allowed) {
        await admin.rpc('support_write_audit', {
          p_actor: device.employee_id, p_action: 'dial_blocked', p_entity_type: 'call', p_entity_id: callSid,
          p_payload: { reason: verdict?.reason ?? null, number: verdict?.number ?? null },
        })
        return xml(req, rejectDestinationTwiml(String(verdict?.reason || 'blocked')))
      }

      let ticketId: string | null = (input.TicketId || '').trim() || null
      if (ticketId) {
        const { data: t } = await admin.from('support_tickets').select('id').or(`id.eq.${/^[0-9a-f-]{36}$/i.test(ticketId) ? ticketId : '00000000-0000-0000-0000-000000000000'},public_id.eq.${ticketId.replace(/[^A-Za-z0-9-]/g, '')}`).maybeSingle()
        ticketId = t?.id ?? null
      }
      const { error: startError } = await admin.rpc('support_voice_start_outbound', {
        p_call_sid: callSid, p_agent: device.employee_id, p_to: verdict.number, p_from: callerId, p_ticket: ticketId,
      })
      if (startError) throw startError

      const chosen = await pick(verdict.number)
      const record = Boolean(cfg.recording_enabled) && cfg.recording_consent_mode !== 'disabled'
      const consent = record ? String(cfg.recording_consent_mode) : 'none'
      await admin.rpc('support_call_set_meta', {
        p_call_sid: callSid, p_carrier_route: chosen.route, p_number_used: chosen.number, p_consent: consent,
      })
      return xml(req, outboundDialTwiml({
        callerId: chosen.number,
        to: verdict.number,
        byocTrunkSid: chosen.trunkSid,
        statusCallbackUrl: url('status'),
        recordingCallbackUrl: record ? url('recording') : undefined,
        announceUrl: record && cfg.recording_consent_mode === 'announcement' ? url('announce') : undefined,
        dialResultUrl: chosen.trunkSid && cfg.byoc_fallback_to_pstn
          ? url('dial-result', { to: verdict.number, cid: chosen.number, rec: record ? (cfg.recording_consent_mode === 'announcement' ? 'a' : 'r') : '0' })
          : undefined,
      }))
    }

    // ---------------------------------------------------------------- callback: officer picked up
    if (action === 'callback-agent') {
      const callbackId = query.get('callback_id') || ''
      const { data: cb } = await admin.from('support_callbacks').select('id, phone_number, assigned_agent_id, status').eq('id', callbackId).maybeSingle()
      if (!cb) throw new HttpError(404, 'Callback not found')
      if (['completed', 'failed', 'cancelled'].includes(cb.status)) return xml(req, sayAndHangupTwiml('This callback is no longer active.'))
      // Same toll-fraud policy as a manual dial.
      const { data: verdict } = await admin.rpc('support_check_dial', { p_employee: cb.assigned_agent_id, p_number: cb.phone_number })
      if (!verdict?.allowed) {
        await admin.rpc('support_callback_result', { p_callback: cb.id, p_ok: false, p_error: String(verdict?.reason || 'blocked') })
        return xml(req, rejectDestinationTwiml(String(verdict?.reason || 'blocked')))
      }
      await admin.from('support_callbacks').update({ status: 'calling' }).eq('id', cb.id)
      const chosenCb = await pick(verdict.number)
      return xml(req, callbackAgentTwiml({
        callerId: chosenCb.number,
        to: verdict.number,
        byocTrunkSid: chosenCb.trunkSid,
        statusCallbackUrl: url('callback-status', { callback_id: cb.id, task_sid: query.get('task_sid') || '' }),
      }))
    }

    // ---------------------------------------------------------------- status callbacks
    if (action === 'status' || action === 'agent-status' || action === 'callback-status') {
      const status = mapStatus(input.CallStatus || input.DialCallStatus || '')
      const duration = input.CallDuration ? Math.max(0, Number(input.CallDuration) || 0) : null
      if (action === 'status' && parentSid) {
        const { error } = await admin.rpc('support_call_apply_status', { p_call_sid: parentSid, p_status: status, p_duration: duration })
        if (error) throw error
      }
      const callbackId = query.get('callback_id') || ''
      if (callbackId && TERMINAL.includes(status)) {
        const ok = status === 'completed' && (duration ?? 0) > 0
        await admin.rpc('support_callback_result', { p_callback: callbackId, p_ok: ok, p_error: ok ? null : `call ${status}` })
        const taskSid = query.get('task_sid') || ''
        if (taskSid) {
          try { await twilioFormRequest(`${taskRouterBase()}/Tasks/${encodeURIComponent(taskSid)}`, { AssignmentStatus: 'completed', Reason: 'callback finished' }) }
          catch (e) { console.warn('callback task completion failed', e instanceof Error ? e.message : e) }
        }
      }
      return json(req, { ok: true })
    }

    if (action === 'announce') return xml(req, recordingNoticeTwiml())

    if (action === 'dial-result') {
      const used = Boolean(envTrunk)
      const retry = shouldFallBackToPstn({
        dialStatus: input.DialCallStatus || '', usedByoc: used, alreadyRetried: query.get('fb') === '1', enabled: Boolean(cfg.byoc_fallback_to_pstn),
      })
      if (!retry) return xml(req, twiml(''))
      const to = query.get('to') || ''
      const cid = query.get('cid') || ''
      const rec = query.get('rec') || '0'
      await admin.rpc('support_call_set_meta', { p_call_sid: parentSid, p_carrier_route: 'pstn_fallback' })
      await admin.rpc('support_write_audit', {
        p_actor: null, p_action: 'carrier_fallback', p_entity_type: 'call', p_entity_id: parentSid, p_payload: { to, from: cid },
      })
      return xml(req, outboundDialTwiml({
        callerId: cid,
        to,
        statusCallbackUrl: url('status'),
        recordingCallbackUrl: rec !== '0' ? url('recording') : undefined,
        announceUrl: rec === 'a' ? url('announce') : undefined,
        dialResultUrl: url('dial-result', { to, cid, rec, fb: '1' }),
      }))
    }

    if (action === 'voicemail-done' || action === 'voicemail-recording') {
      if (input.RecordingSid && parentSid) {
        const seconds = Number(input.RecordingDuration || 0) || null
        const { error } = await admin.rpc('support_voicemail_received', { p_call_sid: parentSid, p_recording_sid: input.RecordingSid, p_duration: seconds })
        if (error) throw error
      }
      return action === 'voicemail-done' ? xml(req, voicemailThanksTwiml()) : json(req, { ok: true })
    }

    if (action === 'recording') {
      if (input.RecordingSid && parentSid) {
        await admin.from('support_calls').update({ recording_sid: input.RecordingSid, updated_at: new Date().toISOString() }).eq('provider_call_id', parentSid)
      }
      return json(req, { ok: true })
    }

    throw new HttpError(400, 'Unsupported voice webhook action')
  } catch (error) {
    state.failed = true
    await finishProviderEvent(admin, state.eventId, error).catch(() => {})
    return errorResponse(req, error, isStatusLike ? 'json' : 'twiml')
  }
}

Deno.serve(async (req) => {
  const state: { eventId: number; failed?: boolean } = { eventId: 0 }
  const res = await handle(req, state)
  // Mark processed only when we are about to answer 2xx; a failure keeps the
  // row open so Twilio's retry is allowed to run it again.
  if (res.status < 400 && !state.failed && state.eventId) {
    await finishProviderEvent(adminClient(), state.eventId).catch(() => {})
  }
  return res
})
