// Scheduled housekeeping. Call every minute (see docs) with the header
//   x-support-cron-secret: <SUPPORT_CRON_SECRET>
//
//   1. presence hygiene   browser vanished / shift ended -> Offline, mirrored to TaskRouter
//   2. messaging routing  requeue tickets held by absent officers, hand out waiting tickets
//   3. callbacks          turn due callbacks into TaskRouter tasks
//   4. telephony          call prices, fraud and spend scan, recording retention, old quality samples
//
// Every step is independent: one failing does not stop the others, and the
// response says which failed, so a cron monitor can alert on it.
//
// PArAsYtE | RA-Workspace support module

import { cors, adminClient, deleteRecording, errorResponse, fetchCallPrice, json, mirrorPresence, queueCallbackTask, requireCronSecret } from '../_shared/supportTwilio.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    requireCronSecret(req)
    const admin = adminClient()
    const report: Record<string, unknown> = {}
    const failures: string[] = []

    try {
      const { data, error } = await admin.rpc('support_maintenance_presence', { p_stale_seconds: 90 })
      if (error) throw error
      const changed = (data || []) as Array<{ provider_worker_id: string | null; new_state: string }>
      let mirrored = 0
      for (const row of changed) if (row.provider_worker_id && (await mirrorPresence(row.provider_worker_id, row.new_state))) mirrored++
      report.presence = { changed: changed.length, mirrored }
    } catch (e) { failures.push('presence'); console.error('maintenance presence', e) }

    try {
      const requeued = await admin.rpc('support_requeue_orphaned', { p_after: '5 minutes' })
      if (requeued.error) throw requeued.error
      const assigned = await admin.rpc('support_assign_waiting', { p_limit: 50 })
      if (assigned.error) throw assigned.error
      report.messaging = { requeued: requeued.data, assigned: assigned.data }
    } catch (e) { failures.push('messaging'); console.error('maintenance messaging', e) }

    try {
      const { data, error } = await admin.rpc('support_callbacks_due', { p_limit: 25 })
      if (error) throw error
      let queued = 0, errors = 0
      for (const cb of (data || []) as Array<{ id: string; ticket_id: string; phone_number: string; priority: string }>) {
        try {
          const task = await queueCallbackTask({ callbackId: cb.id, ticketId: cb.ticket_id, phone: cb.phone_number, priority: cb.priority })
          const sid = String(task?.sid || '')
          if (!sid) throw new Error('no task sid')
          await admin.from('support_callbacks').update({ provider_task_id: sid }).eq('id', cb.id)
          queued++
        } catch (e) {
          errors++
          // Stays queued with no task id, so the next tick retries it.
          await admin.from('support_callbacks').update({ last_error: e instanceof Error ? e.message.slice(0, 200) : 'task creation failed' }).eq('id', cb.id)
        }
      }
      report.callbacks = { due: (data || []).length, queued, errors }
    } catch (e) { failures.push('callbacks'); console.error('maintenance callbacks', e) }

    // Each telephony job is separate so a Twilio outage cannot block the scan.
    try {
      const { data, error } = await admin.rpc('support_calls_needing_price', { p_limit: 25 })
      if (error) throw error
      let priced = 0
      for (const row of (data || []) as Array<{ call_id: string; provider_call_id: string }>) {
        try {
          const p = await fetchCallPrice(row.provider_call_id)
          if (!p) continue
          await admin.rpc('support_call_set_price', { p_call: row.call_id, p_price: p.price, p_unit: p.unit })
          priced++
        } catch (e) { console.warn('price lookup failed', row.provider_call_id, e instanceof Error ? e.message : e) }
      }
      report.pricing = { checked: (data || []).length, priced }
    } catch (e) { failures.push('pricing'); console.error('maintenance pricing', e) }

    try {
      const { data, error } = await admin.rpc('support_fraud_scan')
      if (error) throw error
      report.fraud = { new_alerts: data }
    } catch (e) { failures.push('fraud'); console.error('maintenance fraud scan', e) }

    try {
      const { data, error } = await admin.rpc('support_recordings_expired', { p_limit: 25 })
      if (error) throw error
      let purged = 0
      for (const row of (data || []) as Array<{ call_id: string; recording_sid: string }>) {
        if (await deleteRecording(row.recording_sid)) {
          const { error: markError } = await admin.rpc('support_recording_purged', { p_call: row.call_id })
          if (!markError) purged++
        }
      }
      const pruned = await admin.rpc('support_purge_quality_samples', { p_keep_days: 90 })
      report.retention = { due: (data || []).length, purged, quality_samples_pruned: pruned.data ?? 0 }
    } catch (e) { failures.push('retention'); console.error('maintenance retention', e) }

    return json(req, { ok: failures.length === 0, failures, ...report }, failures.length ? 207 : 200)
  } catch (error) {
    return errorResponse(req, error)
  }
})
