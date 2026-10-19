// RA Support Command Centre: Deno glue for Twilio and Supabase.
// Everything here touches the network or the environment. All decisions that
// can be tested without either live in supportCore.ts.
//
// PArAsYtE | RA-Workspace support module

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  activityKeyForState,
  constantTimeEqual,
  type ActivityKey,
  type FormEntries,
  verifyTwilioSignature,
  webhookUrlCandidates,
} from './supportCore.ts'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function env(name: string, required = true): string {
  const value = (Deno.env.get(name) || '').trim()
  if (required && !value) throw new HttpError(500, `Missing server configuration: ${name}`)
  return value
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || ''
  const extra = env('SUPPORT_ALLOWED_ORIGINS', false).split(',').map((s) => s.trim()).filter(Boolean)
  const allowed =
    /^https:\/\/([a-z0-9-]+\.)?ridearrivo\.com$/i.test(origin) ||
    /^https:\/\/[a-z0-9-]+\.ra-workspace\.pages\.dev$/i.test(origin) ||
    /^http:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(origin) ||
    extra.includes(origin)
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://intranet.ridearrivo.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-twilio-signature, x-ra-timestamp, x-ra-signature',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function xml(req: Request, body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...cors(req), ...baseHeaders, 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

// Errors become JSON for browsers and a spoken apology for phones. A 5xx to
// Twilio makes it play its own "application error" message, which is worse.
export function errorResponse(req: Request, error: unknown, kind: 'json' | 'twiml' = 'json'): Response {
  const status = error instanceof HttpError ? error.status : 500
  const message = error instanceof HttpError ? error.message : 'Unexpected server error'
  if (!(error instanceof HttpError)) console.error('support function error', error)
  if (kind === 'twiml') {
    return xml(
      req,
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>We are sorry, something went wrong. Please try again shortly.</Say><Hangup/></Response>',
      200,
    )
  }
  return json(req, { error: message }, status)
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

export function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function requireSupportUser(req: Request) {
  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required')
  const admin = adminClient()
  const { data: userData, error: userError } = await admin.auth.getUser(authorization.slice(7))
  if (userError || !userData.user) throw new HttpError(401, 'Invalid session')
  const employeeId = userData.user.id
  const { data: allowed, error: allowedError } = await admin.rpc('support_is_staff', { p_user: employeeId })
  if (allowedError || !allowed) throw new HttpError(403, 'Support access required')
  const { data: supervisor } = await admin.rpc('support_is_supervisor', { p_user: employeeId })
  return { admin, user: userData.user, employeeId, isSupervisor: Boolean(supervisor) }
}

// Shared secret for cron callers (support-maintenance). Constant-time.
export function requireCronSecret(req: Request) {
  const expected = env('SUPPORT_CRON_SECRET')
  const supplied = req.headers.get('x-support-cron-secret') || ''
  if (expected.length < 32 || !constantTimeEqual(expected, supplied)) throw new HttpError(401, 'Unauthorized')
}

// ---------------------------------------------------------------------------
// Twilio webhook validation
// ---------------------------------------------------------------------------

export function formEntries(form: FormData): FormEntries {
  const entries: FormEntries = []
  for (const [key, value] of form.entries()) entries.push([key, String(value)])
  return entries
}

export async function validateTwilioRequest(req: Request, entries: FormEntries, functionName: string): Promise<boolean> {
  const urls = webhookUrlCandidates({
    requestUrl: req.url,
    functionName,
    supabaseUrl: env('SUPABASE_URL', false),
    baseOverride: env('TWILIO_WEBHOOK_BASE_URL', false),
  })
  return verifyTwilioSignature({
    authToken: env('TWILIO_AUTH_TOKEN'),
    signature: req.headers.get('X-Twilio-Signature') || '',
    urls,
    entries,
  })
}

// Public URL of one of our functions, used for the callbacks we hand Twilio.
export function functionUrl(name: string, query?: Record<string, string>): string {
  const base = (env('TWILIO_WEBHOOK_BASE_URL', false) || `${env('SUPABASE_URL')}/functions/v1`).replace(/\/+$/, '')
  const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : ''
  return `${base}/${name}${qs}`
}

// ---------------------------------------------------------------------------
// Voice access token
// ---------------------------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}
const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)))

export async function issueVoiceToken(identity: string, ttlSeconds = 3600) {
  const accountSid = env('TWILIO_ACCOUNT_SID')
  const apiKeySid = env('TWILIO_API_KEY_SID')
  const apiKeySecret = env('TWILIO_API_KEY_SECRET')
  const appSid = env('TWILIO_TWIML_APP_SID')
  const now = Math.floor(Date.now() / 1000)
  const exp = now + Math.max(300, Math.min(ttlSeconds, 86400))
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' }
  const payload = {
    jti: `${apiKeySid}-${now}-${crypto.randomUUID()}`,
    iss: apiKeySid,
    sub: accountSid,
    iat: now,
    nbf: now,
    exp,
    grants: { identity, voice: { outgoing: { application_sid: appSid }, incoming: { allow: true } } },
  }
  const unsigned = `${encodeJson(header)}.${encodeJson(payload)}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiKeySecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned)))
  return { token: `${unsigned}.${base64Url(signature)}`, expiresAt: new Date(exp * 1000).toISOString() }
}

// ---------------------------------------------------------------------------
// Twilio REST + TaskRouter
// ---------------------------------------------------------------------------

export async function twilioFormRequest(
  url: string,
  params: Record<string, string | number | boolean | undefined | null>,
  method: 'POST' | 'GET' | 'DELETE' = 'POST',
) {
  const accountSid = env('TWILIO_ACCOUNT_SID')
  const authToken = env('TWILIO_AUTH_TOKEN')
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) body.set(key, String(value))
  const response = await fetch(method === 'GET' && body.size ? `${url}?${body}` : url, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'POST' ? body : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  const text = await response.text()
  let parsed: unknown = text
  try { parsed = JSON.parse(text) } catch { /* keep text */ }
  if (!response.ok) {
    // Never echo the provider body to a browser; it can carry account detail.
    console.error('twilio request failed', response.status, typeof parsed === 'string' ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500))
    throw new HttpError(502, `Twilio request failed (${response.status})`)
  }
  // deno-lint-ignore no-explicit-any
  return parsed as any
}

export function accountBase(): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${env('TWILIO_ACCOUNT_SID')}`
}

const basicAuth = () => `Basic ${btoa(`${env('TWILIO_ACCOUNT_SID')}:${env('TWILIO_AUTH_TOKEN')}`)}`

/** Final price of a call, or null while Twilio has not priced it yet. Twilio reports costs as negative numbers. */
export async function fetchCallPrice(callSid: string): Promise<{ price: number; unit: string } | null> {
  const call = await twilioFormRequest(`${accountBase()}/Calls/${encodeURIComponent(callSid)}.json`, {}, 'GET')
  if (call?.price === null || call?.price === undefined || call?.price === '') return null
  const price = Number(call.price)
  if (!Number.isFinite(price)) return null
  return { price: Math.abs(price), unit: String(call.price_unit || 'USD') }
}

/** Delete a recording at Twilio. A recording that is already gone counts as deleted. */
export async function deleteRecording(recordingSid: string): Promise<boolean> {
  const res = await fetch(`${accountBase()}/Recordings/${encodeURIComponent(recordingSid)}.json`, {
    method: 'DELETE',
    headers: { Authorization: basicAuth() },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 404) return true
  if (!res.ok) { console.error('recording delete failed', res.status); return false }
  return true
}

/** Fetch recording audio from Twilio. Caller must have authorised the request already. */
export async function fetchRecordingAudio(recordingSid: string): Promise<Response> {
  return await fetch(`${accountBase()}/Recordings/${encodeURIComponent(recordingSid)}.mp3`, {
    headers: { Authorization: basicAuth() },
    signal: AbortSignal.timeout(20_000),
  })
}

export function taskRouterBase(): string {
  return `https://taskrouter.twilio.com/v1/Workspaces/${env('TWILIO_TASKROUTER_WORKSPACE_SID')}`
}

const ACTIVITY_ENV: Record<ActivityKey, string> = {
  available: 'TWILIO_TASKROUTER_AVAILABLE_ACTIVITY_SID',
  busy: 'TWILIO_TASKROUTER_BUSY_ACTIVITY_SID',
  wrapup: 'TWILIO_TASKROUTER_WRAPUP_ACTIVITY_SID',
  break: 'TWILIO_TASKROUTER_BREAK_ACTIVITY_SID',
  offline: 'TWILIO_TASKROUTER_OFFLINE_ACTIVITY_SID',
}

export function activitySidForState(state: string): string {
  return env(ACTIVITY_ENV[activityKeyForState(state)])
}

export async function setWorkerActivity(workerSid: string, activitySid: string) {
  return twilioFormRequest(`${taskRouterBase()}/Workers/${encodeURIComponent(workerSid)}`, { ActivitySid: activitySid })
}

// Best effort mirror of RA presence into TaskRouter. Presence in our database
// is the source of truth; a failed mirror must never fail the officer's click.
export async function mirrorPresence(workerSid: string | null | undefined, state: string): Promise<boolean> {
  if (!workerSid) return false
  try {
    await setWorkerActivity(workerSid, activitySidForState(state))
    return true
  } catch (error) {
    console.error('mirrorPresence failed', workerSid, state, error instanceof Error ? error.message : error)
    return false
  }
}

// Create a TaskRouter task that will ring an officer and then place the
// outbound leg of a callback. attributes.kind = 'callback' is what the
// assignment handler keys off.
export async function queueCallbackTask(opts: {
  callbackId: string
  ticketId: string
  phone: string
  priority: string
}) {
  const workflowSid = env('TWILIO_TASKROUTER_WORKFLOW_SID')
  const attributes = {
    kind: 'callback',
    callback_id: opts.callbackId,
    ticket_id: opts.ticketId,
    phone: opts.phone,
    skill: null,
    has_preferred: 0,
  }
  const priority = ({ P0: 100, P1: 80, P2: 60, P3: 40, P4: 20 } as Record<string, number>)[opts.priority] ?? 40
  return twilioFormRequest(`${taskRouterBase()}/Tasks`, {
    WorkflowSid: workflowSid,
    Attributes: JSON.stringify(attributes),
    Priority: priority,
    Timeout: 3600,
    TaskChannel: 'voice',
  })
}

// ---------------------------------------------------------------------------
// Provider event idempotency
//
// Twilio retries webhooks. recordProviderEvent returns duplicate=true when this
// exact event was already seen AND finished, so a retry after a crash (not yet
// processed) is allowed to run again instead of being swallowed.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export async function recordProviderEvent(admin: any, provider: string, eventKey: string, eventType: string, payload: unknown) {
  const { data: inserted, error } = await admin
    .from('support_provider_events')
    .insert({ provider, event_key: eventKey, event_type: eventType, payload })
    .select('id')
    .maybeSingle()
  if (inserted) return { id: inserted.id as number, duplicate: false }
  if (error && error.code !== '23505') throw new HttpError(500, 'Could not record provider event')
  const { data: existing } = await admin
    .from('support_provider_events')
    .select('id, processed_at, attempts')
    .eq('provider', provider)
    .eq('event_key', eventKey)
    .maybeSingle()
  if (!existing) return { id: 0, duplicate: false }
  if (existing.processed_at) return { id: existing.id as number, duplicate: true }
  await admin.from('support_provider_events').update({ attempts: (existing.attempts ?? 0) + 1 }).eq('id', existing.id)
  return { id: existing.id as number, duplicate: false }
}

// deno-lint-ignore no-explicit-any
export async function finishProviderEvent(admin: any, id: number, error?: unknown) {
  if (!id) return
  await admin
    .from('support_provider_events')
    .update({
      processed_at: error ? null : new Date().toISOString(),
      processing_error: error ? String(error instanceof Error ? error.message : error).slice(0, 500) : null,
    })
    .eq('id', id)
}
