// Browser-facing control plane for the Support Command Centre.
//
// Officer actions   : presence, register_device, queue_callback, sync_self
// Supervisor actions: admin_list, provision_agent, update_voice_settings,
//                     list_dial_rules, upsert_dial_rule, delete_dial_rule,
//                     telephony_list, set_business_hours, upsert_closure,
//                     delete_closure, upsert_number, delete_number,
//                     dnc_remove, resolve_alert
// Officer actions also include quality_sample and dnc_add.
//
// Presence lives in Postgres. TaskRouter is a mirror used only to decide who
// rings. If the mirror cannot be updated when an officer goes Available, we put
// them back to Away and say so, because "Available in the UI, invisible to
// routing" is the worst failure a contact centre can have: customers wait while
// the supervisor's board shows free officers.
//
// PArAsYtE | RA-Workspace support module

import { AGENT_SELECTABLE_STATES, clientIdentity, normalizePhone } from '../_shared/supportCore.ts'
import {
  cors,
  errorResponse,
  HttpError,
  json,
  mirrorPresence,
  queueCallbackTask,
  requireSupportUser,
  taskRouterBase,
  twilioFormRequest,
  activitySidForState,
} from '../_shared/supportTwilio.ts'

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const asText = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.trunc(n))) : dflt
}
const stringList = (v: unknown, max: number, lower = false) =>
  Array.isArray(v) ? v.map((x) => (lower ? asText(x, 60).toLowerCase() : asText(x, 60))).filter(Boolean).slice(0, max) : null

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const { admin, employeeId, user, isSupervisor } = await requireSupportUser(req)
    const body = await req.json().catch(() => ({}))
    const action = asText(body?.action, 40)
    const requireSupervisor = () => {
      if (!isSupervisor) throw new HttpError(403, 'Support supervisor access required')
    }
    const audit = (act: string, type: string, id: string, payload: unknown = {}) =>
      admin.rpc('support_write_audit', { p_actor: employeeId, p_action: act, p_entity_type: type, p_entity_id: id, p_payload: payload })

    // ------------------------------------------------------------ presence
    if (action === 'presence') {
      const state = asText(body?.state, 20)
      if (!(AGENT_SELECTABLE_STATES as string[]).includes(state)) throw new HttpError(400, 'That status cannot be set by hand')

      const { data: current } = await admin.from('support_agent_presence').select('state').eq('employee_id', employeeId).maybeSingle()
      if (current?.state === 'on_call') throw new HttpError(409, 'Finish the current call before changing your status')

      const { data: agent } = await admin.from('support_agents').select('provider_worker_id, voice_enabled, enabled').eq('employee_id', employeeId).maybeSingle()
      if (!agent?.enabled) throw new HttpError(403, 'You are not an enabled Support officer')

      const { data: result, error } = await admin.rpc('support_set_presence', {
        p_employee: employeeId, p_state: state, p_reason: asText(body?.reason, 80) || null, p_actor: employeeId,
      })
      if (error) {
        const msg = error.message || ''
        throw new HttpError(/not_on_shift/.test(msg) ? 409 : 400, msg.replace(/^[a-z_]+:\s*/, '') || 'Could not change status')
      }

      let routing = true
      if (agent.voice_enabled && agent.provider_worker_id) {
        routing = await mirrorPresence(agent.provider_worker_id, state)
        if (!routing && state === 'available') {
          await admin.rpc('support_set_presence', { p_employee: employeeId, p_state: 'away', p_reason: 'routing_sync_failed', p_actor: null })
          throw new HttpError(502, 'Could not connect you to call routing. You are set to Away. Try again in a moment.')
        }
      }
      return json(req, { ok: true, state, onShift: result?.on_shift ?? null, routing })
    }

    // ------------------------------------------------------------ browser device
    if (action === 'register_device') {
      const identity = clientIdentity(employeeId)
      const now = new Date().toISOString()
      const registered = Boolean(body?.registered)
      await admin.from('support_agent_voice_devices').upsert(
        { employee_id: employeeId, client_identity: identity, registered, last_registered_at: registered ? now : null, last_seen_at: now, updated_at: now },
        { onConflict: 'employee_id' },
      )
      // A browser that lost its Twilio registration cannot take calls.
      if (!registered) {
        const { data: current } = await admin.from('support_agent_presence').select('state').eq('employee_id', employeeId).maybeSingle()
        if (current?.state === 'available') {
          await admin.rpc('support_set_presence', { p_employee: employeeId, p_state: 'away', p_reason: 'softphone_unregistered', p_actor: null })
          const { data: agent } = await admin.from('support_agents').select('provider_worker_id').eq('employee_id', employeeId).maybeSingle()
          await mirrorPresence(agent?.provider_worker_id, 'away')
        }
      }
      return json(req, { ok: true, identity })
    }

    // ------------------------------------------------------------ callbacks
    if (action === 'queue_callback') {
      const ticketId = asText(body?.ticketId, 64)
      if (!uuidRe.test(ticketId)) throw new HttpError(400, 'ticketId is required')
      const phone = normalizePhone(body?.phoneNumber)
      if (!phone) throw new HttpError(400, 'That phone number is not valid')
      const { data: verdict } = await admin.rpc('support_check_dial', { p_employee: employeeId, p_number: phone })
      if (!verdict?.allowed) throw new HttpError(400, `That number cannot be called (${verdict?.reason || 'blocked'})`)

      const notBefore = body?.notBefore ? new Date(String(body.notBefore)) : null
      if (notBefore && Number.isNaN(notBefore.getTime())) throw new HttpError(400, 'notBefore is not a valid date')

      const { data: callbackId, error } = await admin.rpc('support_callback_create', {
        p_ticket: ticketId, p_phone: phone, p_origin: 'agent', p_actor: employeeId, p_not_before: notBefore?.toISOString() ?? null, p_call: null,
      })
      if (error) throw new HttpError(400, error.message)

      // Due now: hand it to TaskRouter immediately. Otherwise support-maintenance
      // picks it up when its time comes.
      let taskSid: string | null = null
      if (!notBefore || notBefore.getTime() <= Date.now()) {
        const { data: ticket } = await admin.from('support_tickets').select('priority').eq('id', ticketId).maybeSingle()
        const { data: cb } = await admin.from('support_callbacks').select('provider_task_id, status').eq('id', callbackId).maybeSingle()
        if (cb && !cb.provider_task_id && cb.status === 'queued') {
          const task = await queueCallbackTask({ callbackId, ticketId, phone, priority: ticket?.priority || 'P3' })
          taskSid = String(task?.sid || '') || null
          if (taskSid) await admin.from('support_callbacks').update({ provider_task_id: taskSid }).eq('id', callbackId)
        }
      }
      return json(req, { ok: true, callbackId, taskSid })
    }

    // ------------------------------------------------------------ officer self sync
    if (action === 'sync_self') {
      const { data: agent } = await admin.from('support_agents').select('*').eq('employee_id', employeeId).maybeSingle()
      if (!agent?.enabled) throw new HttpError(403, 'You are not an enabled Support officer')
      const worker = await upsertWorker(admin, { employeeId, fullName: user.email || employeeId, email: user.email || null, agent })
      return json(req, { ok: true, workerSid: worker.sid, identity: worker.identity })
    }

    // ------------------------------------------------------------ supervisor
    if (action === 'admin_list') {
      requireSupervisor()
      const [employees, agents, shifts, assignments, settings] = await Promise.all([
        admin.from('employee_profiles').select('id, full_name, email, role, job_title, department, active').eq('active', true).order('full_name'),
        admin.from('support_agents').select('*').order('created_at'),
        admin.from('support_shifts').select('id, name, timezone, starts_at, ends_at, active').eq('active', true).order('starts_at'),
        admin.from('support_shift_assignments').select('shift_id, employee_id, weekday, effective_from, effective_to'),
        admin.from('support_voice_settings').select('*').eq('id', true).maybeSingle(),
      ])
      const failed = employees.error || agents.error || shifts.error || assignments.error
      if (failed) throw failed
      return json(req, {
        employees: employees.data || [], agents: agents.data || [], shifts: shifts.data || [],
        assignments: assignments.data || [], voiceSettings: settings.data || null,
      })
    }

    if (action === 'provision_agent') {
      requireSupervisor()
      const target = asText(body?.employeeId, 64)
      if (!uuidRe.test(target)) throw new HttpError(400, 'employeeId is required')
      const { data: emp } = await admin.from('employee_profiles').select('id, full_name, email, active').eq('id', target).maybeSingle()
      if (!emp?.active) throw new HttpError(404, 'Active employee not found')

      const voiceEnabled = body?.voiceEnabled !== false
      const row = {
        employee_id: target,
        enabled: body?.enabled !== false,
        is_supervisor: Boolean(body?.isSupervisor),
        voice_enabled: voiceEnabled,
        messaging_enabled: body?.messagingEnabled !== false,
        email_enabled: body?.emailEnabled !== false,
        sms_enabled: body?.smsEnabled !== false,
        whatsapp_enabled: body?.whatsappEnabled !== false,
        web_chat_enabled: body?.webChatEnabled !== false,
        voice_capacity: voiceEnabled ? clampInt(body?.voiceCapacity, 0, 5, 1) : 0,
        messaging_capacity: clampInt(body?.messagingCapacity, 0, 20, 3),
        skills: stringList(body?.skills, 30, true) ?? [],
        languages: stringList(body?.languages, 20) ?? ['English'],
        updated_at: new Date().toISOString(),
      }
      const { data: agent, error } = await admin.from('support_agents').upsert(row, { onConflict: 'employee_id' }).select('*').single()
      if (error) throw new HttpError(400, error.message)

      let worker = { sid: '', identity: clientIdentity(target) }
      let routingWarning: string | null = null
      try {
        worker = await upsertWorker(admin, { employeeId: target, fullName: emp.full_name || emp.email || target, email: emp.email, agent })
      } catch (e) {
        // The officer row is saved. Say plainly that call routing is not ready
        // instead of rolling back their messaging access.
        routingWarning = e instanceof Error ? e.message : 'TaskRouter sync failed'
        console.error('provision_agent worker sync failed', routingWarning)
      }

      await admin.from('support_agent_presence').upsert(
        { employee_id: target, state: 'offline', state_reason: 'provisioned', state_changed_at: new Date().toISOString(), active_shift: false, updated_at: new Date().toISOString() },
        { onConflict: 'employee_id', ignoreDuplicates: true },
      )

      // Shift assignments: accept either {assignments:[{shiftId,weekdays}]} or the single shiftId + weekdays form.
      const wanted: Array<{ shift_id: string; employee_id: string; weekday: number }> = []
      const groups = Array.isArray(body?.assignments) ? body.assignments : body?.shiftId ? [{ shiftId: body.shiftId, weekdays: body.weekdays }] : null
      if (groups) {
        for (const g of groups) {
          const shiftId = asText(g?.shiftId, 64)
          if (!uuidRe.test(shiftId)) continue
          for (const d of Array.isArray(g?.weekdays) ? g.weekdays : []) {
            const weekday = Number(d)
            if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) wanted.push({ shift_id: shiftId, employee_id: target, weekday })
          }
        }
        const { error: delError } = await admin.from('support_shift_assignments').delete().eq('employee_id', target)
        if (delError) throw new HttpError(400, delError.message)
        if (wanted.length) {
          const { error: insError } = await admin.from('support_shift_assignments').insert(wanted)
          if (insError) throw new HttpError(400, insError.message)
        }
      }
      await audit('agent_provisioned', 'agent', target, { enabled: row.enabled, voice: voiceEnabled, shifts: wanted.length, routingWarning })
      return json(req, { ok: true, workerSid: worker.sid || null, identity: worker.identity, routingWarning })
    }

    if (action === 'update_voice_settings') {
      requireSupervisor()
      const s = (body?.settings ?? {}) as Record<string, unknown>
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('ivrEnabled' in s) patch.ivr_enabled = Boolean(s.ivrEnabled)
      if ('callbackEnabled' in s) patch.callback_enabled = Boolean(s.callbackEnabled)
      if ('recordingEnabled' in s) patch.recording_enabled = Boolean(s.recordingEnabled)
      if ('recordingConsentMode' in s) patch.recording_consent_mode = asText(s.recordingConsentMode, 20)
      if ('greetingText' in s) patch.greeting_text = asText(s.greetingText, 400)
      if ('holdMessageText' in s) patch.hold_message_text = asText(s.holdMessageText, 400)
      if ('callbackOfferAfterSeconds' in s) patch.callback_offer_after_seconds = clampInt(s.callbackOfferAfterSeconds, 0, 3600, 180)
      if ('maxQueueWaitSeconds' in s) patch.max_queue_wait_seconds = clampInt(s.maxQueueWaitSeconds, 30, 7200, 1800)
      if ('outboundLimitPer10Min' in s) patch.outbound_limit_per_10min = clampInt(s.outboundLimitPer10Min, 1, 500, 30)
      if ('timezone' in s) {
        const tz = asText(s.timezone, 60)
        try { new Intl.DateTimeFormat('en', { timeZone: tz }) } catch { throw new HttpError(400, 'Unknown time zone') }
        patch.timezone = tz
      }
      if ('hoursEnforced' in s) patch.hours_enforced = Boolean(s.hoursEnforced)
      if ('closedMessageText' in s) patch.closed_message_text = asText(s.closedMessageText, 400)
      if ('voicemailEnabled' in s) patch.voicemail_enabled = Boolean(s.voicemailEnabled)
      if ('voicemailPromptText' in s) patch.voicemail_prompt_text = asText(s.voicemailPromptText, 400)
      if ('voicemailMaxSeconds' in s) patch.voicemail_max_seconds = clampInt(s.voicemailMaxSeconds, 10, 600, 120)
      if ('recordingRetentionDays' in s) patch.recording_retention_days = clampInt(s.recordingRetentionDays, 1, 3650, 90)
      if ('voicemailRetentionDays' in s) patch.voicemail_retention_days = clampInt(s.voicemailRetentionDays, 1, 3650, 90)
      if ('byocFallbackToPstn' in s) patch.byoc_fallback_to_pstn = Boolean(s.byocFallbackToPstn)
      if ('dncEnforced' in s) patch.dnc_enforced = Boolean(s.dncEnforced)
      if ('fraudCallsPerHour' in s) patch.fraud_calls_per_hour = clampInt(s.fraudCallsPerHour, 5, 5000, 60)
      for (const [key, col] of [['spendAlertDaily', 'spend_alert_daily'], ['spendCapDaily', 'spend_cap_daily']] as const) {
        if (!(key in s)) continue
        if (s[key] === null || s[key] === '') { patch[col] = null; continue }
        const n = Number(s[key])
        if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new HttpError(400, `${key} must be a positive amount or empty`)
        patch[col] = n
      }
      if ('callerId' in s) {
        const cid = s.callerId ? normalizePhone(s.callerId) : ''
        if (s.callerId && !cid) throw new HttpError(400, 'Caller ID must be a valid E.164 number')
        patch.caller_id = cid || null
      }
      const { data, error } = await admin.from('support_voice_settings').update(patch).eq('id', true).select('*').single()
      if (error) throw new HttpError(400, error.message)
      await audit('voice_settings_updated', 'voice_settings', 'singleton', { keys: Object.keys(patch) })
      return json(req, { ok: true, settings: data })
    }

    if (action === 'list_dial_rules') {
      requireSupervisor()
      const { data, error } = await admin.from('support_dial_rules').select('*').order('prefix')
      if (error) throw error
      return json(req, { rules: data || [] })
    }

    if (action === 'upsert_dial_rule') {
      requireSupervisor()
      const prefix = asText(body?.prefix, 12)
      const rule = asText(body?.rule, 10)
      if (!/^\+[0-9]{1,8}$/.test(prefix)) throw new HttpError(400, 'Prefix must look like +234 or +44870')
      if (!['allow', 'deny'].includes(rule)) throw new HttpError(400, 'Rule must be allow or deny')
      const { error } = await admin.from('support_dial_rules').upsert({ prefix, action: rule, note: asText(body?.note, 120) || null, updated_at: new Date().toISOString() }, { onConflict: 'prefix' })
      if (error) throw new HttpError(400, error.message)
      await audit('dial_rule_set', 'dial_rule', prefix, { rule })
      return json(req, { ok: true })
    }

    if (action === 'delete_dial_rule') {
      requireSupervisor()
      const prefix = asText(body?.prefix, 12)
      const { error } = await admin.from('support_dial_rules').delete().eq('prefix', prefix)
      if (error) throw new HttpError(400, error.message)
      await audit('dial_rule_deleted', 'dial_rule', prefix)
      return json(req, { ok: true })
    }

    // ------------------------------------------------------------ call quality (officer)
    if (action === 'quality_sample') {
      const callSid = asText(body?.callSid, 64)
      if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return json(req, { ok: true, skipped: true })
      const num = (v: unknown, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(hi, n)) : 0 }
      const { error } = await admin.rpc('support_record_call_quality', {
        p_call_sid: callSid, p_employee: employeeId,
        p_rtt: num(body?.rttMs, 99999), p_jitter: num(body?.jitterMs, 99999), p_loss: num(body?.lossPct, 100), p_mos: null,
      })
      if (error) throw new HttpError(400, error.message)
      return json(req, { ok: true })
    }

    // Any officer may add a number when a customer asks to stop being called.
    if (action === 'dnc_add') {
      const phone = normalizePhone(body?.phoneNumber)
      if (!phone) throw new HttpError(400, 'That phone number is not valid')
      const source = isSupervisor && ['customer_request', 'import', 'regulator'].includes(asText(body?.source, 20)) ? asText(body?.source, 20) : 'agent'
      const { error } = await admin.from('support_do_not_contact').upsert(
        { phone, reason: asText(body?.reason, 160) || null, source, added_by: employeeId }, { onConflict: 'phone' })
      if (error) throw new HttpError(400, error.message)
      await audit('dnc_added', 'dnc', phone, { source })
      return json(req, { ok: true })
    }

    // ------------------------------------------------------------ telephony controls (supervisor)
    if (action === 'telephony_list') {
      requireSupervisor()
      const [hours, closures, numbers, dnc, alerts] = await Promise.all([
        admin.from('support_business_hours').select('*').order('weekday').order('opens_at'),
        admin.from('support_closures').select('*').order('closes_on'),
        admin.from('support_numbers').select('*').order('label'),
        admin.from('support_do_not_contact').select('*').order('created_at', { ascending: false }).limit(500),
        admin.from('support_fraud_alerts').select('*').is('resolved_at', null).order('created_at', { ascending: false }).limit(100),
      ])
      const failed = hours.error || closures.error || numbers.error || dnc.error || alerts.error
      if (failed) throw failed
      const { data: line } = await admin.rpc('support_line_status')
      return json(req, { hours: hours.data || [], closures: closures.data || [], numbers: numbers.data || [], dnc: dnc.data || [], alerts: alerts.data || [], line })
    }

    if (action === 'set_business_hours') {
      requireSupervisor()
      const rows: Array<{ weekday: number; opens_at: string; closes_at: string }> = []
      for (const r of Array.isArray(body?.hours) ? body.hours.slice(0, 40) : []) {
        const weekday = Number(r?.weekday)
        const opens = asText(r?.opensAt, 5), closes = asText(r?.closesAt, 5)
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Weekday must be 0 to 6')
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(opens) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closes)) throw new HttpError(400, 'Times must look like 08:00')
        if (closes <= opens) throw new HttpError(400, 'Closing time must be after opening time')
        rows.push({ weekday, opens_at: opens, closes_at: closes })
      }
      const del = await admin.from('support_business_hours').delete().gte('weekday', 0)
      if (del.error) throw new HttpError(400, del.error.message)
      if (rows.length) {
        const ins = await admin.from('support_business_hours').insert(rows)
        if (ins.error) throw new HttpError(400, ins.error.message)
      }
      await audit('business_hours_set', 'business_hours', 'singleton', { windows: rows.length })
      return json(req, { ok: true })
    }

    if (action === 'upsert_closure') {
      requireSupervisor()
      const day = asText(body?.date, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new HttpError(400, 'Date must look like 2026-12-25')
      const name = asText(body?.name, 80)
      if (!name) throw new HttpError(400, 'Give the closure a name')
      const { error } = await admin.from('support_closures').upsert({ closes_on: day, name }, { onConflict: 'closes_on' })
      if (error) throw new HttpError(400, error.message)
      await audit('closure_set', 'closure', day, { name })
      return json(req, { ok: true })
    }

    if (action === 'delete_closure') {
      requireSupervisor()
      const day = asText(body?.date, 10)
      const { error } = await admin.from('support_closures').delete().eq('closes_on', day)
      if (error) throw new HttpError(400, error.message)
      await audit('closure_deleted', 'closure', day)
      return json(req, { ok: true })
    }

    if (action === 'upsert_number') {
      requireSupervisor()
      const e164 = normalizePhone(body?.e164)
      if (!e164) throw new HttpError(400, 'Number must be a valid E.164 number')
      const label = asText(body?.label, 80)
      if (!label) throw new HttpError(400, 'Give the number a label')
      const prefix = asText(body?.dialPrefix, 12)
      if (prefix && !/^\+[0-9]{1,8}$/.test(prefix)) throw new HttpError(400, 'Dial prefix must look like +234')
      const kind = asText(body?.kind, 10) || 'both'
      const route = asText(body?.route, 10) || 'pstn'
      if (!['inbound', 'outbound', 'both'].includes(kind)) throw new HttpError(400, 'Kind must be inbound, outbound or both')
      if (!['pstn', 'byoc'].includes(route)) throw new HttpError(400, 'Route must be pstn or byoc')
      const isDefault = Boolean(body?.isDefaultOutbound) && kind !== 'inbound'
      if (isDefault) await admin.from('support_numbers').update({ is_default_outbound: false }).eq('is_default_outbound', true).neq('e164', e164)
      const { error } = await admin.from('support_numbers').upsert({
        e164, label, dial_prefix: prefix || null, kind, route, is_default_outbound: isDefault,
        active: body?.active !== false, note: asText(body?.note, 160) || null, updated_at: new Date().toISOString(),
      }, { onConflict: 'e164' })
      if (error) throw new HttpError(400, error.message)
      await audit('number_set', 'number', e164, { kind, route })
      return json(req, { ok: true })
    }

    if (action === 'delete_number') {
      requireSupervisor()
      const e164 = normalizePhone(body?.e164)
      const { error } = await admin.from('support_numbers').delete().eq('e164', e164)
      if (error) throw new HttpError(400, error.message)
      await audit('number_deleted', 'number', e164)
      return json(req, { ok: true })
    }

    if (action === 'dnc_remove') {
      requireSupervisor()
      const phone = normalizePhone(body?.phoneNumber)
      if (!phone) throw new HttpError(400, 'That phone number is not valid')
      const { error } = await admin.from('support_do_not_contact').delete().eq('phone', phone)
      if (error) throw new HttpError(400, error.message)
      await audit('dnc_removed', 'dnc', phone)
      return json(req, { ok: true })
    }

    if (action === 'resolve_alert') {
      requireSupervisor()
      const id = asText(body?.alertId, 64)
      if (!uuidRe.test(id)) throw new HttpError(400, 'alertId is required')
      const { error } = await admin.from('support_fraud_alerts').update({ resolved_at: new Date().toISOString(), resolved_by: employeeId }).eq('id', id).is('resolved_at', null)
      if (error) throw new HttpError(400, error.message)
      await audit('fraud_alert_resolved', 'fraud_alert', id)
      return json(req, { ok: true })
    }

    throw new HttpError(400, 'Unsupported action')
  } catch (error) {
    return errorResponse(req, error)
  }
})

// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function upsertWorker(admin: any, opts: { employeeId: string; fullName: string; email: string | null; agent: any }) {
  const identity = clientIdentity(opts.employeeId)
  const attributes = {
    employee_id: opts.employeeId,
    email: opts.email,
    skills: opts.agent.skills || [],
    voice_capacity: opts.agent.enabled && opts.agent.voice_enabled ? opts.agent.voice_capacity ?? 1 : 0,
    messaging_capacity: opts.agent.messaging_capacity ?? 3,
    contact_uri: `client:${identity}`,
  }
  let sid = String(opts.agent.provider_worker_id || '')
  if (sid) {
    // Leave ActivitySid alone on update: forcing Offline would drop an officer
    // who is mid-call when a supervisor edits their skills.
    await twilioFormRequest(`${taskRouterBase()}/Workers/${encodeURIComponent(sid)}`, {
      FriendlyName: opts.fullName, Attributes: JSON.stringify(attributes),
    })
  } else {
    const worker = await twilioFormRequest(`${taskRouterBase()}/Workers`, {
      FriendlyName: opts.fullName, ActivitySid: activitySidForState('offline'), Attributes: JSON.stringify(attributes),
    })
    sid = String(worker?.sid || '')
    if (!sid) throw new HttpError(502, 'Twilio did not return a Worker SID')
  }
  await admin.from('support_agents').update({ provider_worker_id: sid, provider_worker_synced_at: new Date().toISOString() }).eq('employee_id', opts.employeeId)
  await admin.from('support_agent_voice_devices').upsert({ employee_id: opts.employeeId, client_identity: identity, updated_at: new Date().toISOString() }, { onConflict: 'employee_id', ignoreDuplicates: true })
  return { sid, identity }
}
