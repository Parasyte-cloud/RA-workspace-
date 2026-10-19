// Pure logic for the RA Support Command Centre.
//
// No Deno APIs, no network, no Supabase client. That is deliberate: this file
// runs unchanged inside the Edge Functions (Deno) and inside the Node test
// suite, so everything that decides who gets a call, whether a webhook is
// genuine, and what Twilio is told to do is unit-tested.
//
// Keep it erasable TypeScript (no enums, no parameter properties) so Node can
// run it directly with type stripping.

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

export const PRESENCE_STATES = ['available', 'busy', 'on_call', 'wrap_up', 'break', 'away', 'offline'] as const
export type PresenceState = (typeof PRESENCE_STATES)[number]

// What an officer may pick for themselves. on_call, busy and wrap_up are
// driven by the call itself, never by a dropdown.
export const AGENT_SELECTABLE_STATES: PresenceState[] = ['available', 'break', 'away', 'offline']

export function isPresenceState(value: unknown): value is PresenceState {
  return typeof value === 'string' && (PRESENCE_STATES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Phone numbers. Mirrors public.support_normalize_phone() in SQL exactly; the
// test suite compares the two on a shared table of cases.
// ---------------------------------------------------------------------------

export function normalizePhone(raw: unknown): string {
  let v = String(raw ?? '').replace(/[^0-9+]/g, '')
  if (/^00[0-9]+$/.test(v)) v = '+' + v.slice(2)
  if (/^0[0-9]{10}$/.test(v)) v = '+234' + v.slice(1)
  if (/^234[0-9]{10}$/.test(v)) v = '+' + v
  return /^\+[1-9][0-9]{7,14}$/.test(v) ? v : ''
}

// Twilio does not send an empty From for withheld caller ID; it sends a
// placeholder that is a perfectly valid E.164 number (+266696687 spells
// ANONYMOUS on a keypad). Treat those as "no number", or the system would
// open a customer record for, and try to call back, a number that does not exist.
const WITHHELD_WORDS = new Set(['', 'anonymous', 'unknown', 'restricted', 'unavailable', 'private', 'blocked', 'withheld'])
const WITHHELD_NUMBERS = new Set(['+266696687', '+1266696687', '+86282452253525', '+7378742883', '+464', '+2562533'])

export function isWithheldCaller(raw: unknown): boolean {
  const text = String(raw ?? '').trim().toLowerCase()
  if (WITHHELD_WORDS.has(text)) return true
  const digits = text.replace(/[^0-9+]/g, '')
  if (WITHHELD_NUMBERS.has(digits)) return true
  return normalizePhone(raw) === ''
}

export function clientIdentity(employeeId: string): string {
  return `ra-support-${String(employeeId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100)}`
}

// ---------------------------------------------------------------------------
// Twilio webhook signatures
//
// Twilio signs: full URL + every POST parameter as name+value, parameters
// sorted by name in plain code-point order. Sorting with localeCompare is a
// bug: it puts "Caller" before "CallSid" while Twilio puts "CallSid" first,
// and every real inbound call carries both.
// ---------------------------------------------------------------------------

export type FormEntries = Array<[string, string]>

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function twilioSignatureBase(url: string, entries: FormEntries): string {
  const sorted = [...entries].sort((x, y) => compareCodeUnits(x[0], y[0]) || compareCodeUnits(x[1], y[1]))
  let out = url
  for (const [key, value] of sorted) out += key + value
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

async function hmac(hash: 'SHA-1' | 'SHA-256', secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

export async function twilioSignature(authToken: string, url: string, entries: FormEntries): Promise<string> {
  return bytesToBase64(await hmac('SHA-1', authToken, twilioSignatureBase(url, entries)))
}

export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

// The URL Twilio signed is the one configured in the console. Inside a
// Supabase Edge Function the runtime may see a different scheme, host or path
// than the public one, so try the public form as well as what we received.
export function webhookUrlCandidates(opts: {
  requestUrl: string
  functionName: string
  supabaseUrl?: string
  baseOverride?: string
}): string[] {
  const search = new URL(opts.requestUrl).search
  const out = new Set<string>()
  const trim = (value: string) => value.replace(/\/+$/, '')
  const add = (url: string) => {
    out.add(url)
    try {
      const u = new URL(url)
      if (u.protocol === 'https:' && !u.port) out.add(url.replace(u.host, `${u.host}:443`))
      else if (u.protocol === 'https:' && u.port === '443') out.add(url.replace(`:443`, ''))
    } catch { /* ignore malformed candidate */ }
  }
  if (opts.baseOverride) add(`${trim(opts.baseOverride)}/${opts.functionName}${search}`)
  if (opts.supabaseUrl) add(`${trim(opts.supabaseUrl)}/functions/v1/${opts.functionName}${search}`)
  add(opts.requestUrl)
  return [...out]
}

export async function verifyTwilioSignature(opts: {
  authToken: string
  signature: string
  urls: string[]
  entries: FormEntries
}): Promise<boolean> {
  if (!opts.authToken || !opts.signature) return false
  let ok = false
  for (const url of opts.urls) {
    const expected = await twilioSignature(opts.authToken, url, opts.entries)
    if (constantTimeEqual(expected, opts.signature)) ok = true
  }
  return ok
}

// ---------------------------------------------------------------------------
// Signed ingest for email / web chat adapters: HMAC-SHA256 over
// "<unix seconds>.<raw body>", with a clock-skew window against replay.
// ---------------------------------------------------------------------------

export async function ingestSignature(secret: string, timestamp: string, rawBody: string): Promise<string> {
  return 'sha256=' + bytesToHex(await hmac('SHA-256', secret, `${timestamp}.${rawBody}`))
}

export async function verifyIngestSignature(opts: {
  secret: string
  timestamp: string
  signature: string
  rawBody: string
  nowMs: number
  toleranceSeconds?: number
}): Promise<{ ok: boolean; reason?: string }> {
  if (!opts.secret || opts.secret.length < 32) return { ok: false, reason: 'ingest secret is not configured' }
  const ts = Number(opts.timestamp)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'missing or invalid timestamp' }
  const skew = Math.abs(opts.nowMs / 1000 - ts)
  if (skew > (opts.toleranceSeconds ?? 300)) return { ok: false, reason: 'timestamp outside the allowed window' }
  const expected = await ingestSignature(opts.secret, opts.timestamp, opts.rawBody)
  return constantTimeEqual(expected, opts.signature || '')
    ? { ok: true }
    : { ok: false, reason: 'bad signature' }
}

// ---------------------------------------------------------------------------
// TwiML
// ---------------------------------------------------------------------------

export function escapeXml(value: unknown): string {
  return String(value ?? '').replace(/[<>&"']/g, (ch) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' } as Record<string, string>)[ch] || ch)
}

export function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`
}

const SAY_LANG = 'en-GB'
function say(text: string): string {
  return `<Say language="${SAY_LANG}">${escapeXml(text)}</Say>`
}

export function sayAndHangupTwiml(message: string): string {
  return twiml(`${say(message)}<Hangup/>`)
}

export function taskPriority(priority: string): number {
  return ({ P0: 100, P1: 80, P2: 60, P3: 40, P4: 20 } as Record<string, number>)[priority] ?? 40
}

export type IvrOption = { label: string; skill: string | null; priority: string; category: string | null }
export const IVR_OPTIONS: Record<string, IvrOption> = {
  '1': { label: 'active ride', skill: 'active_ride', priority: 'P1', category: 'active_ride' },
  '2': { label: 'bookings and payments', skill: 'payments', priority: 'P2', category: 'payment' },
  '3': { label: 'everything else', skill: null, priority: 'P3', category: null },
  '9': { label: 'safety', skill: 'safety', priority: 'P0', category: 'safety' },
}
export const IVR_PROMPT =
  'For an active ride, press 1. For bookings and payments, press 2. For anything else, press 3. If you are in danger, press 9.'

export function ivrChoice(digit: string | undefined | null): IvrOption | null {
  return IVR_OPTIONS[String(digit ?? '').trim()] ?? null
}

export function ivrMenuTwiml(opts: { greeting: string; actionUrl: string; fallbackUrl: string; prompt?: string }): string {
  return twiml(
    (opts.greeting ? say(opts.greeting) : '') +
    `<Gather input="dtmf" numDigits="1" timeout="6" action="${escapeXml(opts.actionUrl)}" method="POST">` +
    say(opts.prompt || IVR_PROMPT) +
    `</Gather>` +
    `<Redirect method="POST">${escapeXml(opts.fallbackUrl)}</Redirect>`,
  )
}

export type TaskAttributes = Record<string, unknown>

export function enqueueTwiml(opts: {
  greeting?: string
  workflowSid: string
  attributes: TaskAttributes
  priority: string
  waitUrl: string
  actionUrl: string
}): string {
  const attrs = escapeXml(JSON.stringify(opts.attributes))
  return twiml(
    (opts.greeting ? say(opts.greeting) : '') +
    `<Enqueue workflowSid="${escapeXml(opts.workflowSid)}" waitUrl="${escapeXml(opts.waitUrl)}" waitUrlMethod="POST" ` +
    `action="${escapeXml(opts.actionUrl)}" method="POST">` +
    `<Task priority="${taskPriority(opts.priority)}" timeout="7200">${attrs}</Task></Enqueue>`,
  )
}

// Said once a minute rather than on every loop, so hold is not a loop of nagging.
export function shouldSayHoldMessage(queueTimeSeconds: number, loopSeconds: number): boolean {
  const t = Math.max(0, Math.floor(queueTimeSeconds))
  return t < loopSeconds || t % 60 < loopSeconds
}

export function waitTwiml(opts: { message: string; sayMessage: boolean; leave: boolean; loopSeconds: number; musicUrl?: string }): string {
  if (opts.leave) return twiml('<Leave/>')
  const body = (opts.sayMessage ? say(opts.message) : '') +
    (opts.musicUrl ? `<Play>${escapeXml(opts.musicUrl)}</Play>` : `<Pause length="${Math.max(1, Math.floor(opts.loopSeconds))}"/>`)
  return twiml(body)
}

export function callbackOfferTwiml(opts: { choiceUrl: string; keepHoldingUrl: string }): string {
  return twiml(
    `<Gather input="dtmf" numDigits="1" timeout="8" action="${escapeXml(opts.choiceUrl)}" method="POST">` +
    say('All of our support officers are busy. To have us call you back without waiting, press 1. To keep holding, press 2.') +
    `</Gather>` +
    `<Redirect method="POST">${escapeXml(opts.keepHoldingUrl)}</Redirect>`,
  )
}

export function callbackConfirmedTwiml(): string {
  return sayAndHangupTwiml('Thank you. We will call you back on this number as soon as an officer is free. Goodbye.')
}

export function noOfficerCallbackTwiml(): string {
  return sayAndHangupTwiml('We are sorry we could not reach you in time. We will call you back on this number shortly. Goodbye.')
}

function numberNoun(opts: { to: string; byocTrunkSid?: string; statusCallbackUrl: string; announceUrl?: string }): string {
  const attrs = [
    opts.byocTrunkSid ? `byoc="${escapeXml(opts.byocTrunkSid)}"` : '',
    opts.announceUrl ? `url="${escapeXml(opts.announceUrl)}" method="POST"` : '',
    `statusCallback="${escapeXml(opts.statusCallbackUrl)}"`,
    `statusCallbackEvent="initiated ringing answered completed"`,
    `statusCallbackMethod="POST"`,
  ].filter(Boolean).join(' ')
  return `<Number ${attrs}>${escapeXml(opts.to)}</Number>`
}

export function outboundDialTwiml(opts: {
  callerId: string
  to: string
  byocTrunkSid?: string
  statusCallbackUrl: string
  recordingCallbackUrl?: string
  /** Played to the person who answers, before the officer is connected. */
  announceUrl?: string
  /** Called when the dial ends; lets the webhook retry over PSTN if the BYOC leg failed. */
  dialResultUrl?: string
}): string {
  const record = opts.recordingCallbackUrl
    ? ` record="record-from-answer-dual" recordingStatusCallback="${escapeXml(opts.recordingCallbackUrl)}" recordingStatusCallbackMethod="POST"`
    : ''
  return twiml(
    `<Dial callerId="${escapeXml(opts.callerId)}" answerOnBridge="true" timeout="40"${record}${opts.dialResultUrl ? ` action="${escapeXml(opts.dialResultUrl)}" method="POST"` : ''}>${numberNoun(opts)}</Dial>`,
  )
}

export function callbackAgentTwiml(opts: {
  callerId: string
  to: string
  byocTrunkSid?: string
  statusCallbackUrl: string
}): string {
  return twiml(
    say('You are connecting to a RideArrivo support callback.') +
    `<Dial callerId="${escapeXml(opts.callerId)}" answerOnBridge="true" timeout="40">${numberNoun(opts)}</Dial>`,
  )
}

export function rejectDestinationTwiml(reason: string): string {
  const spoken = ({
    invalid_number: 'That number is not valid. Please check it and try again.',
    destination_not_allowed: 'Calls to that destination are not permitted from this line.',
    destination_blocked: 'Calls to that destination are blocked.',
    rate_limited: 'You have placed too many calls in a short time. Please wait a few minutes.',
    do_not_contact: 'That number is on the do not contact list.',
    spend_cap_reached: 'The daily calling budget has been reached. Please ask your supervisor.',
  } as Record<string, string>)[reason] || 'This call cannot be placed.'
  return sayAndHangupTwiml(spoken)
}

// ---------------------------------------------------------------------------
// Who may receive a TaskRouter reservation
// ---------------------------------------------------------------------------

export type AssignmentContext = {
  workerSid: string
  agent: { enabled: boolean; voice_enabled: boolean; provider_worker_id: string | null } | null
  presence: { state: string; last_seen_at: string | null } | null
  onShift: boolean
  device: { client_identity: string } | null
  nowMs: number
  staleSeconds?: number
}

export type AssignmentDecision =
  | { ok: true; clientIdentity: string }
  | { ok: false; reason: string }

// TaskRouter picks a worker, then asks us. This is the last gate, and it
// re-checks everything against live data because TaskRouter's idea of the
// worker can be minutes old.
export function decideAssignment(ctx: AssignmentContext): AssignmentDecision {
  if (!ctx.agent) return { ok: false, reason: 'agent_unknown' }
  if (!ctx.agent.enabled) return { ok: false, reason: 'agent_disabled' }
  if (!ctx.agent.voice_enabled) return { ok: false, reason: 'voice_disabled' }
  if (!ctx.agent.provider_worker_id || ctx.agent.provider_worker_id !== ctx.workerSid) return { ok: false, reason: 'worker_mismatch' }
  if (!ctx.presence || ctx.presence.state !== 'available') return { ok: false, reason: 'not_available' }
  if (!ctx.onShift) return { ok: false, reason: 'off_shift' }
  const seen = ctx.presence.last_seen_at ? Date.parse(ctx.presence.last_seen_at) : NaN
  const stale = (ctx.staleSeconds ?? 120) * 1000
  if (!Number.isFinite(seen) || ctx.nowMs - seen > stale) return { ok: false, reason: 'stale_heartbeat' }
  if (!ctx.device?.client_identity) return { ok: false, reason: 'no_device' }
  return { ok: true, clientIdentity: ctx.device.client_identity }
}

// ---------------------------------------------------------------------------
// TaskRouter events -> RA presence
//
// A reservation that times out or is rejected means the officer did not pick
// up. Contact centres move them to "not ready" (Away) so one missed call does
// not become ten. A ringing reservation is NOT on a call; only an accepted
// one is.
// ---------------------------------------------------------------------------

export function presenceForEvent(eventType: string, current: string): { state: PresenceState; reason: string | null } | null {
  switch (eventType) {
    case 'reservation.accepted':
      return { state: 'on_call', reason: null }
    case 'reservation.rejected':
      return current === 'available' ? { state: 'away', reason: 'rejected_call' } : null
    case 'reservation.timeout':
      return current === 'available' ? { state: 'away', reason: 'missed_call' } : null
    case 'reservation.completed':
      return current === 'on_call' ? { state: 'wrap_up', reason: null } : null
    default:
      return null
  }
}

export function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Activity mapping
// ---------------------------------------------------------------------------

export type ActivityKey = 'available' | 'busy' | 'wrapup' | 'break' | 'offline'

export function activityKeyForState(state: string): ActivityKey {
  switch (state) {
    case 'available': return 'available'
    case 'busy':
    case 'on_call': return 'busy'
    case 'wrap_up': return 'wrapup'
    case 'break': return 'break'
    default: return 'offline'
  }
}

// ---------------------------------------------------------------------------
// TaskRouter workflow definition, shared by the provisioning script and tests
// ---------------------------------------------------------------------------

export function buildWorkflowConfiguration(queues: { safety: string; activeRide: string; payments: string; general: string }) {
  return {
    task_routing: {
      filters: [
        {
          filter_friendly_name: 'Safety first',
          expression: 'skill == "safety"',
          targets: [
            { queue: queues.safety, priority: 100, timeout: 20 },
            { queue: queues.general, priority: 100 },
          ],
        },
        {
          filter_friendly_name: 'Same officer as before',
          expression: 'has_preferred == 1',
          targets: [
            { queue: queues.general, expression: 'worker.employee_id == task.preferred_agent_id', priority: 60, timeout: 10 },
            { queue: queues.general, priority: 60 },
          ],
        },
        {
          filter_friendly_name: 'Active ride',
          expression: 'skill == "active_ride"',
          targets: [
            { queue: queues.activeRide, priority: 80, timeout: 30 },
            { queue: queues.general, priority: 80 },
          ],
        },
        {
          filter_friendly_name: 'Payments',
          expression: 'skill == "payments"',
          targets: [
            { queue: queues.payments, priority: 60, timeout: 30 },
            { queue: queues.general, priority: 60 },
          ],
        },
      ],
      default_filter: { queue: queues.general },
    },
  }
}

export const QUEUE_DEFINITIONS = [
  { key: 'general', name: 'RA Support - General Voice', targetWorkers: 'voice_capacity > 0' },
  { key: 'safety', name: 'RA Support - Safety', targetWorkers: 'voice_capacity > 0 AND skills HAS "safety"' },
  { key: 'activeRide', name: 'RA Support - Active Ride', targetWorkers: 'voice_capacity > 0 AND skills HAS "active_ride"' },
  { key: 'payments', name: 'RA Support - Payments', targetWorkers: 'voice_capacity > 0 AND skills HAS "payments"' },
] as const

export const ACTIVITY_DEFINITIONS: Array<{ key: ActivityKey; name: string; available: boolean }> = [
  { key: 'available', name: 'Available', available: true },
  { key: 'busy', name: 'Busy', available: false },
  { key: 'wrapup', name: 'WrapUp', available: false },
  { key: 'break', name: 'Break', available: false },
  { key: 'offline', name: 'Offline', available: false },
]

// ---------------------------------------------------------------------------
// After hours, voicemail, carrier route
// ---------------------------------------------------------------------------

export function closedTwiml(message: string): string {
  return sayAndHangupTwiml(`${message} Goodbye.`)
}

export function voicemailTwiml(opts: {
  closedMessage: string
  prompt: string
  maxSeconds: number
  actionUrl: string
  recordingCallbackUrl: string
}): string {
  const max = Math.max(10, Math.min(600, Math.floor(opts.maxSeconds || 120)))
  return twiml(
    say(opts.closedMessage) +
    say(opts.prompt) +
    `<Record maxLength="${max}" timeout="5" playBeep="true" finishOnKey="#" action="${escapeXml(opts.actionUrl)}" method="POST" recordingStatusCallback="${escapeXml(opts.recordingCallbackUrl)}" recordingStatusCallbackMethod="POST"/>` +
    say('We did not receive a message. Goodbye.') + '<Hangup/>',
  )
}

export function voicemailThanksTwiml(): string {
  return sayAndHangupTwiml('Thank you. We have your message and will call you back when we open. Goodbye.')
}

export function recordingNoticeTwiml(): string {
  return twiml(say('This call may be recorded for quality and training. Please hold while we connect you.'))
}

/**
 * Which carrier route to try first. A number in the registry says how it must
 * leave (pstn or byoc); with no registry entry the account-wide trunk, if one
 * is configured, is used.
 */
export function chooseCarrierRoute(registryRoute: string | null | undefined, envTrunkSid: string | undefined): { route: 'byoc' | 'pstn'; trunkSid?: string } {
  if (registryRoute === 'pstn') return { route: 'pstn' }
  if (envTrunkSid && (registryRoute === 'byoc' || !registryRoute)) return { route: 'byoc', trunkSid: envTrunkSid }
  return { route: 'pstn' }
}

/** Retry over PSTN only when the carrier leg itself failed, never when the callee did not answer. */
export function shouldFallBackToPstn(opts: { dialStatus: string; usedByoc: boolean; alreadyRetried: boolean; enabled: boolean }): boolean {
  return opts.enabled && opts.usedByoc && !opts.alreadyRetried && String(opts.dialStatus || '').toLowerCase() === 'failed'
}

/** Mean opinion score from network samples (simplified ITU-T G.107), same maths as the database. */
export function estimateMos(rttMs: number, jitterMs: number, lossPct: number): number {
  const d = Math.max(0, rttMs) / 2 + Math.max(0, jitterMs) * 2 + 10
  let r = 93.2 - (d < 177.3 ? 0.024 * d : 0.024 * d + 0.11 * (d - 177.3)) - 2.5 * Math.max(0, lossPct)
  r = Math.max(0, Math.min(100, r))
  const mos = 1 + 0.035 * r + r * (r - 60) * (100 - r) * 0.000007
  return Math.round(Math.max(1, Math.min(4.5, mos)) * 100) / 100
}

/** Brief quality targets: delay under 150 ms, jitter under 30 ms, loss under 1%, MOS above 4.0. */
export function qualityVerdict(s: { rttMs: number; jitterMs: number; lossPct: number; mos: number }): 'good' | 'fair' | 'poor' {
  if (s.mos >= 4.0 && s.jitterMs <= 30 && s.lossPct <= 1 && s.rttMs / 2 <= 150) return 'good'
  if (s.mos >= 3.6) return 'fair'
  return 'poor'
}

// ---------------------------------------------------------------------------
// Workstation safety: location freshness and SOS event parsing
// ---------------------------------------------------------------------------

export type LocationFreshness = { state: 'live' | 'stale' | 'unknown'; ageSeconds: number | null }

/**
 * A position is only "live" while it is newer than the freshness limit. Older
 * positions are shown as last known with their age, never as live. A clock a
 * little ahead of ours counts as age 0; a timestamp that cannot be read is unknown.
 */
export function locationFreshness(recordedAt: unknown, nowMs: number, freshSeconds: number): LocationFreshness {
  const ms = typeof recordedAt === 'number' ? recordedAt : Date.parse(String(recordedAt ?? ''))
  if (!Number.isFinite(ms)) return { state: 'unknown', ageSeconds: null }
  const age = Math.max(0, Math.round((nowMs - ms) / 1000))
  return { state: age <= freshSeconds ? 'live' : 'stale', ageSeconds: age }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SosLocation = { lat: number; lng: number; accuracy_m?: number; heading?: number; recorded_at?: string }
export type SosEvent = {
  eventId: string
  subjectType: 'rider' | 'driver'
  subjectId: string
  identityCode: string | null
  tripRef: string | null
  bookingRef: string | null
  vehicleRef: string | null
  activatedAt: string | null
  location: SosLocation | null
}

function shortText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim().slice(0, max)
  return text || null
}

function finite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Validate a signed SOS event from the RideArrivo backend. Fields that identify
 * the event and the person are required. Everything else is best effort: a bad
 * coordinate or timestamp is dropped rather than rejecting an emergency.
 */
export function parseSosEvent(body: unknown): { ok: true; value: SosEvent } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object' }
  const b = body as Record<string, unknown>
  const eventId = shortText(b.event_id, 200)
  if (!eventId) return { ok: false, error: 'event_id is required' }
  const subjectType = b.subject_type === 'rider' || b.subject_type === 'driver' ? b.subject_type : null
  if (!subjectType) return { ok: false, error: 'subject_type must be rider or driver' }
  const subjectId = String(b.subject_id ?? '').trim()
  if (!UUID_RE.test(subjectId)) return { ok: false, error: 'subject_id must be a uuid' }

  let location: SosLocation | null = null
  const loc = b.location
  if (loc && typeof loc === 'object' && !Array.isArray(loc)) {
    const l = loc as Record<string, unknown>
    const lat = finite(l.lat)
    const lng = finite(l.lng)
    if (lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      location = { lat, lng }
      const accuracy = finite(l.accuracy_m)
      const heading = finite(l.heading)
      if (accuracy !== undefined && accuracy >= 0) location.accuracy_m = accuracy
      if (heading !== undefined && heading >= 0 && heading <= 360) location.heading = heading
      const when = typeof l.recorded_at === 'string' ? Date.parse(l.recorded_at) : NaN
      if (Number.isFinite(when)) location.recorded_at = new Date(when).toISOString()
    }
  }

  const activated = typeof b.activated_at === 'string' ? Date.parse(b.activated_at) : NaN
  return {
    ok: true,
    value: {
      eventId,
      subjectType,
      subjectId,
      identityCode: shortText(b.identity_code, 20)?.toUpperCase() ?? null,
      tripRef: shortText(b.trip_id, 100),
      bookingRef: shortText(b.booking_ref, 100),
      vehicleRef: shortText(b.vehicle_id, 100),
      activatedAt: Number.isFinite(activated) ? new Date(activated).toISOString() : null,
      location,
    },
  }
}

export type LatLng = [number, number]

/** Decode a Google-style encoded polyline (precision 5 or 6). Returns [] for anything malformed. */
export function decodePolyline(encoded: unknown, precision = 5): LatLng[] {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 50_000) return []
  const factor = Math.pow(10, precision === 6 ? 6 : 5)
  const out: LatLng[] = []
  let index = 0, lat = 0, lng = 0
  const next = (): number | null => {
    let result = 0, shift = 0, byte: number
    do {
      if (index >= encoded.length) return null
      byte = encoded.charCodeAt(index++) - 63
      if (byte < 0 || byte > 63) return null
      result |= (byte & 0x1f) << shift
      shift += 5
      if (shift > 35) return null
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < encoded.length) {
    const dLat = next(); const dLng = next()
    if (dLat === null || dLng === null) return []
    lat += dLat; lng += dLng
    const la = lat / factor, ln = lng / factor
    if (Math.abs(la) > 90 || Math.abs(ln) > 180) return []
    out.push([la, ln])
  }
  return out
}

/** Keep the first and last point and spread the rest evenly, so a long route still draws quickly. */
export function downsamplePath(points: LatLng[], max: number): LatLng[] {
  if (points.length <= max || max < 2) return points
  const out: LatLng[] = []
  const step = (points.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)])
  return out
}

function readPath(raw: unknown, max: number): LatLng[] {
  if (!Array.isArray(raw)) return []
  const pts: LatLng[] = []
  for (const p of raw.slice(0, 5000)) {
    let a: number | undefined, o: number | undefined
    if (Array.isArray(p)) { a = finite(p[0]); o = finite(p[1]) }
    else if (p && typeof p === 'object') { a = finite((p as Record<string, unknown>).lat); o = finite((p as Record<string, unknown>).lng) }
    if (a !== undefined && o !== undefined && Math.abs(a) <= 90 && Math.abs(o) <= 180) pts.push([a, o])
  }
  return downsamplePath(pts, max)
}

export type LiveLocation = {
  lat: number; lng: number; heading?: number; speed_kmh?: number; accuracy_m?: number; recorded_at?: string
  trip?: Record<string, unknown>; trail?: Array<{ lat: number; lng: number; recorded_at?: string }>
}

/** Keep only the fields the console needs from the upstream location service. */
export function sanitizeLiveLocation(raw: unknown): LiveLocation | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const lat = finite(r.lat)
  const lng = finite(r.lng)
  if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const out: LiveLocation = { lat, lng }
  const heading = finite(r.heading); if (heading !== undefined && heading >= 0 && heading <= 360) out.heading = heading
  const speed = finite(r.speed_kmh); if (speed !== undefined && speed >= 0 && speed < 400) out.speed_kmh = speed
  const accuracy = finite(r.accuracy_m); if (accuracy !== undefined && accuracy >= 0) out.accuracy_m = accuracy
  const when = typeof r.recorded_at === 'string' ? Date.parse(r.recorded_at) : NaN
  if (Number.isFinite(when)) out.recorded_at = new Date(when).toISOString()
  const t = r.trip
  if (t && typeof t === 'object') {
    const trip = t as Record<string, unknown>
    const point = (p: unknown) => {
      if (!p || typeof p !== 'object') return undefined
      const q = p as Record<string, unknown>
      const a = finite(q.lat), o = finite(q.lng)
      return a !== undefined && o !== undefined ? { lat: a, lng: o, label: shortText(q.label, 120) } : undefined
    }
    // Planned route: either a list of points or an encoded polyline. At most 400 points are kept.
    let route = readPath(trip.route, 400)
    if (!route.length && typeof trip.route_polyline === 'string') {
      route = downsamplePath(decodePolyline(trip.route_polyline, finite(trip.route_precision) === 6 ? 6 : 5), 400)
    }
    out.trip = {
      status: shortText(trip.status, 40),
      booking_ref: shortText(trip.booking_ref, 100),
      pickup: point(trip.pickup),
      dropoff: point(trip.dropoff),
      eta_minutes: finite(trip.eta_minutes),
      vehicle: shortText(trip.vehicle, 120),
      driver_name: shortText(trip.driver_name, 120),
      route: route.length >= 2 ? route : undefined,
    }
  }
  // Where they have actually been: the last 100 positions, oldest first.
  if (Array.isArray(r.trail)) {
    const trail: Array<{ lat: number; lng: number; recorded_at?: string }> = []
    for (const p of r.trail.slice(-300)) {
      if (!p || typeof p !== 'object') continue
      const q = p as Record<string, unknown>
      const a = finite(q.lat), o = finite(q.lng)
      if (a === undefined || o === undefined || Math.abs(a) > 90 || Math.abs(o) > 180) continue
      const w = typeof q.recorded_at === 'string' ? Date.parse(q.recorded_at) : NaN
      trail.push({ lat: a, lng: o, recorded_at: Number.isFinite(w) ? new Date(w).toISOString() : undefined })
    }
    if (trail.length) out.trail = trail.slice(-100)
  }
  return out
}

// ---------------------------------------------------------------------------
// Staff invites
// ---------------------------------------------------------------------------

// 30 characters with no 0/O/1/I/L/U look-alikes. Ten characters is about 49 bits,
// and a code also needs the matching email, expires in 48 hours and locks after 5 misses.
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateInviteCode(randomBytes: (n: number) => Uint8Array): string {
  const out: string[] = []
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % INVITE_ALPHABET.length)
  while (out.length < 10) {
    for (const byte of randomBytes(16)) {
      if (byte < limit && out.length < 10) out.push(INVITE_ALPHABET[byte % INVITE_ALPHABET.length])
    }
  }
  return `${out.slice(0, 5).join('')}-${out.slice(5).join('')}`
}

// People type codes from a phone screen. Forgive case, spaces and dashes.
export function normalizeInviteCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
}

export function validateJoinPassword(password: unknown, email: string): string | null {
  const p = String(password ?? '')
  if (p.length < 10) return 'Use at least 10 characters.'
  if (p.length > 128) return 'That password is too long.'
  const local = email.split('@')[0]?.toLowerCase() || ''
  if (p.toLowerCase().includes(local) && local.length >= 4) return 'Do not use your email name in your password.'
  if (/^(.)\1+$/.test(p)) return 'Choose a less repetitive password.'
  if (/^(password|12345678|qwertyuiop|letmein)/i.test(p)) return 'That password is too easy to guess.'
  return null
}

export function isValidEmail(raw: unknown): boolean {
  const e = String(raw ?? '').trim()
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)
}

export function inviteMessage(opts: { name: string; code: string; joinUrl: string; hours?: number }) {
  const hours = opts.hours ?? 48
  const first = opts.name.trim().split(/\s+/)[0] || 'there'
  const link = opts.joinUrl ? `Open ${opts.joinUrl} and enter this code with your email address.` : 'Open the RideArrivo Support join page your administrator shared and enter this code with your email address.'
  const text =
    `Hello ${first},\n\nYou have been invited to join the RideArrivo Support team.\n\n` +
    `Your one-time code: ${opts.code}\n\n${link}\nThen choose a password. The code works once and expires in ${hours} hours. ` +
    `Never share it with anyone.\n\nIf you were not expecting this, ignore this message.\n\nRideArrivo Support`
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111">` +
    `<h2 style="margin:0 0 12px">Welcome to RideArrivo Support</h2>` +
    `<p>Hello ${esc(first)}, you have been invited to join the RideArrivo Support team.</p>` +
    `<p style="margin:20px 0 4px">Your one-time code</p>` +
    `<p style="font-size:28px;letter-spacing:3px;font-weight:700;background:#f3f4f6;padding:14px 18px;border-radius:8px;display:inline-block;margin:0">${esc(opts.code)}</p>` +
    (opts.joinUrl ? `<p style="margin:20px 0"><a href="${esc(opts.joinUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Set up your account</a></p>` : '') +
    `<p style="color:#555;font-size:13px">Enter your email address and this code, then choose a password. The code works once and expires in ${hours} hours. Never share it with anyone. If you were not expecting this, ignore this message.</p>` +
    `<p style="color:#999;font-size:12px;margin-top:28px">RideArrivo Support</p></div>`
  return { subject: 'Your RideArrivo Support invitation', text, html }
}
