// Sends the alerts that the database queued: web push, SMS, WhatsApp and phone calls.
//
// The database decides WHO gets WHAT and WHEN (support_alert_rules, support_notify). This file only
// delivers what is due, records the result, and never throws past its caller: a broken provider must
// not stop the maintenance run or an SOS intake.
//
// Providers are optional. A channel with no configuration fails with a plain reason that shows up in the
// delivery report, so "SMS is not set up" is visible instead of silent.
//
// PArAsYtE | RA-Workspace support module

import { escapeXml, normalizePhone } from './supportCore.ts'
import { accountBase, env, twilioFormRequest } from './supportTwilio.ts'
import { sendWebPush } from './webPush.ts'

// deno-lint-ignore no-explicit-any
type Admin = any

type Claimed = {
  delivery_id: number; channel: 'push' | 'sms' | 'whatsapp' | 'voice'; attempts: number
  recipient_id: string; recipient_name: string | null; phone: string | null
  kind: string; severity: 'info' | 'warning' | 'critical'; title: string; body: string
  entity_type: string | null; entity_id: string | null; data: Record<string, unknown> | null
}
type Sent = { ok: boolean; retry: boolean; provider?: string; error?: string }

export function pushConfigured(): boolean {
  return Boolean(env('VAPID_PUBLIC_KEY', false) && env('VAPID_PRIVATE_KEY', false))
}

async function deliverPush(admin: Admin, c: Claimed): Promise<Sent> {
  if (!pushConfigured()) return { ok: false, retry: false, error: 'Web push is not configured (VAPID keys)' }
  const { data: targets } = await admin.rpc('support_push_targets', { p_employee: c.recipient_id })
  const list = (targets || []) as Array<{ endpoint: string; p256dh: string; auth: string }>
  if (!list.length) return { ok: false, retry: false, error: 'no device registered for push' }
  const vapid = { subject: env('VAPID_SUBJECT', false) || 'mailto:support@ridearrivo.com', publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY') }
  const payload = {
    title: c.title, body: c.body, severity: c.severity, kind: c.kind,
    tag: `${c.kind}:${c.entity_id || c.delivery_id}`.slice(0, 80),
    entityType: c.entity_type, entityId: c.entity_id, tab: (c.data || {}).tab || null,
    requireInteraction: c.severity === 'critical',
  }
  let ok = 0, retry = false, lastError = ''
  for (const t of list) {
    const r = await sendWebPush({
      endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth, payload, vapid,
      urgency: c.severity === 'critical' ? 'high' : 'normal', ttlSeconds: c.severity === 'critical' ? 600 : 3600,
    })
    await admin.rpc('support_push_result', { p_employee: c.recipient_id, p_endpoint: t.endpoint, p_ok: r.ok, p_gone: r.gone })
    if (r.ok) ok++
    else { lastError = r.detail; if (r.retry) retry = true }
  }
  return ok > 0 ? { ok: true, retry: false, provider: `${ok}/${list.length} devices` } : { ok: false, retry, error: lastError || 'push failed' }
}

const smsText = (c: Claimed) => `${c.title}. ${c.body}`.replace(/\s+/g, ' ').slice(0, 300)

async function deliverSms(c: Claimed): Promise<Sent> {
  const to = normalizePhone(c.phone)
  if (!to) return { ok: false, retry: false, error: 'no valid phone number' }
  const service = env('SUPPORT_ALERT_MESSAGING_SERVICE_SID', false)
  const from = env('SUPPORT_ALERT_SMS_FROM', false)
  if (!env('TWILIO_ACCOUNT_SID', false) || (!service && !from)) return { ok: false, retry: false, error: 'SMS is not configured (SUPPORT_ALERT_SMS_FROM or SUPPORT_ALERT_MESSAGING_SERVICE_SID)' }
  const res = await twilioFormRequest(`${accountBase()}/Messages.json`, { To: to, Body: smsText(c), ...(service ? { MessagingServiceSid: service } : { From: from }) })
  return { ok: true, retry: false, provider: String(res?.sid || '') }
}

async function deliverWhatsApp(c: Claimed): Promise<Sent> {
  const to = normalizePhone(c.phone)
  if (!to) return { ok: false, retry: false, error: 'no valid phone number' }
  const from = normalizePhone(env('SUPPORT_ALERT_WA_FROM', false))
  if (!env('TWILIO_ACCOUNT_SID', false) || !from) return { ok: false, retry: false, error: 'WhatsApp is not configured (SUPPORT_ALERT_WA_FROM)' }
  const contentSid = env('SUPPORT_ALERT_WA_CONTENT_SID', false)
  // Alerts start the conversation, so WhatsApp requires an approved template. Without one Twilio only
  // delivers inside an open 24 hour window and this will fail, which the delivery report will show.
  const params: Record<string, string> = { To: `whatsapp:${to}`, From: `whatsapp:${from}` }
  if (contentSid) { params.ContentSid = contentSid; params.ContentVariables = JSON.stringify({ '1': c.title.slice(0, 120), '2': c.body.slice(0, 200) }) }
  else params.Body = smsText(c)
  const res = await twilioFormRequest(`${accountBase()}/Messages.json`, params)
  return { ok: true, retry: false, provider: String(res?.sid || '') }
}

export function alertTwiml(title: string): string {
  const say = escapeXml(`R I D E Arrivo support alert. ${title}. Open the support workspace now.`)
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="alice" language="en-GB">${say}</Say><Pause length="1"/><Say voice="alice" language="en-GB">${say}</Say></Response>`
}

async function deliverVoice(c: Claimed): Promise<Sent> {
  const to = normalizePhone(c.phone)
  if (!to) return { ok: false, retry: false, error: 'no valid phone number' }
  const from = env('TWILIO_CALLER_ID', false)
  if (!env('TWILIO_ACCOUNT_SID', false) || !from) return { ok: false, retry: false, error: 'Calls are not configured (TWILIO_CALLER_ID)' }
  const res = await twilioFormRequest(`${accountBase()}/Calls.json`, { To: to, From: from, Twiml: alertTwiml(c.title), Timeout: 25 })
  return { ok: true, retry: false, provider: String(res?.sid || '') }
}

async function deliverOne(admin: Admin, c: Claimed): Promise<void> {
  let result: Sent
  try {
    result = c.channel === 'push' ? await deliverPush(admin, c)
      : c.channel === 'sms' ? await deliverSms(c)
      : c.channel === 'whatsapp' ? await deliverWhatsApp(c)
      : await deliverVoice(c)
  } catch (e) {
    // Twilio helpers throw on a non-2xx. Treat as retryable; the database stops after three tries.
    result = { ok: false, retry: true, error: e instanceof Error ? e.message.slice(0, 150) : 'send failed' }
  }
  await admin.rpc('support_delivery_result', {
    p_id: c.delivery_id, p_ok: result.ok, p_provider: result.provider ?? null, p_error: result.error ?? null, p_retry: result.retry,
  })
}

export async function dispatchDeliveries(admin: Admin, opts: { limit?: number; budgetMs?: number } = {}): Promise<{ claimed: number; done: number }> {
  const started = Date.now()
  const budget = opts.budgetMs ?? 20_000
  let claimed = 0, done = 0
  try {
    while (Date.now() - started < budget) {
      const { data, error } = await admin.rpc('support_claim_deliveries', { p_limit: Math.min(opts.limit ?? 25, 25) })
      if (error) throw error
      const rows = (data || []) as Claimed[]
      if (!rows.length) break
      claimed += rows.length
      // Five at a time: fast enough for an emergency, gentle on providers.
      for (let i = 0; i < rows.length; i += 5) {
        await Promise.all(rows.slice(i, i + 5).map((r) => deliverOne(admin, r).then(() => { done++ })))
      }
      if (rows.length < (opts.limit ?? 25)) break
    }
  } catch (e) {
    console.error('dispatchDeliveries', e)
  }
  return { claimed, done }
}
