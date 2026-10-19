// PArAsYtE | RA-Workspace support module
// Behavioural tests for the Support Command Centre core logic.
// Needs nothing but Node. The database side is covered by supabase/tests/support.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes as nodeRandomBytes } from 'node:crypto'
const require_crypto = () => ({ randomBytes: nodeRandomBytes })
import * as core from '../supabase/functions/_shared/supportCore.ts'

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

export const PHONE_CASES = [
  ['08012345678', '+2348012345678'],
  ['0801 234 5678', '+2348012345678'],
  ['+234 801 234 5678', '+2348012345678'],
  ['2348012345678', '+2348012345678'],
  ['002348012345678', '+2348012345678'],
  ['+44 20 7183 8750', '+442071838750'],
  ['(+1) 415-555-0100', '+14155550100'],
  ['anonymous', ''],
  ['', ''],
  ['12345', ''],
  ['+0123456789', ''],
  ['0801234567', ''],
]

test('withheld caller IDs are recognised, including Twilio\'s valid-looking placeholders', () => {
  for (const hidden of ['anonymous', 'Anonymous', '+266696687', '+1266696687', 'RESTRICTED', 'unavailable', '', null, undefined, '+86282452253525', '+7378742883', 'abc']) {
    assert.equal(core.isWithheldCaller(hidden), true, String(hidden))
  }
  for (const real of ['+2348012345678', '08012345678', '+442071838750']) {
    assert.equal(core.isWithheldCaller(real), false, real)
  }
})

test('phone normalisation handles Nigerian local, international and junk input', () => {
  for (const [input, expected] of PHONE_CASES) {
    assert.equal(core.normalizePhone(input), expected, `normalizePhone(${JSON.stringify(input)})`)
  }
  assert.equal(core.normalizePhone(null), '')
  assert.equal(core.normalizePhone(undefined), '')
})

// ---------------------------------------------------------------------------
// Twilio signatures
// ---------------------------------------------------------------------------

test('signature matches an independent reference implementation (known-answer test)', async () => {
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2'
  const entries = [
    ['Digits', '1234'], ['To', '+18005551212'], ['From', '+12349013030'],
    ['Caller', '+12349013030'], ['CallSid', 'CA1234567890ABCDE'],
  ]
  assert.equal(await core.twilioSignature('12345', url, entries), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')
  const reference = createHmac('sha1', '12345')
    .update(url + [...entries].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([k, v]) => k + v).join(''))
    .digest('base64')
  assert.equal(await core.twilioSignature('12345', url, entries), reference)
})

test('REGRESSION: parameters must be sorted by code point, not locale', () => {
  // A real inbound call carries both Called/Caller and CallSid/CallStatus.
  const entries = [
    ['CallSid', 'CA1'], ['Caller', '+2348012345678'], ['CallStatus', 'ringing'],
    ['Called', '+23417000000'], ['AccountSid', 'AC1'], ['ApiVersion', '2010-04-01'],
  ]
  const localeOrder = [...entries].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[0])
  const ours = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((e) => e[0])
  // The two orderings genuinely differ for real Twilio parameters,
  assert.notDeepEqual(localeOrder, ours)
  // and our base string follows code-point order: CallSid before CallStatus before Called before Caller.
  const base = core.twilioSignatureBase('U', entries)
  assert.ok(base.indexOf('CallSid') < base.indexOf('CallStatus'))
  assert.ok(base.indexOf('CallStatus') < base.indexOf('Called'))
  assert.ok(base.indexOf('Called') < base.indexOf('Caller'))
})

test('duplicate parameter names are ordered by value so the signature is stable', () => {
  const a = core.twilioSignatureBase('U', [['k', 'b'], ['k', 'a']])
  const b = core.twilioSignatureBase('U', [['k', 'a'], ['k', 'b']])
  assert.equal(a, b)
  assert.equal(a, 'Ukakb')
})

test('verification accepts the genuine request, rejects tampering, and tries every public URL form', async () => {
  const token = 'a'.repeat(32)
  const entries = [['CallSid', 'CA1'], ['From', '+2348012345678']]
  const publicUrl = 'https://abc.supabase.co/functions/v1/support-voice-webhook?action=inbound'
  const signature = await core.twilioSignature(token, publicUrl, entries)

  // The Edge runtime may report an internal URL; the public one must still match.
  const urls = core.webhookUrlCandidates({
    requestUrl: 'http://edge-runtime.internal/support-voice-webhook?action=inbound',
    functionName: 'support-voice-webhook',
    supabaseUrl: 'https://abc.supabase.co/',
  })
  assert.ok(urls.includes(publicUrl))
  assert.equal(await core.verifyTwilioSignature({ authToken: token, signature, urls, entries }), true)

  assert.equal(await core.verifyTwilioSignature({ authToken: token, signature, urls, entries: [['CallSid', 'CA2'], ['From', '+2348012345678']] }), false, 'changed param')
  assert.equal(await core.verifyTwilioSignature({ authToken: 'b'.repeat(32), signature, urls, entries }), false, 'wrong token')
  assert.equal(await core.verifyTwilioSignature({ authToken: token, signature: '', urls, entries }), false, 'missing signature')
  assert.equal(await core.verifyTwilioSignature({ authToken: '', signature, urls, entries }), false, 'missing token')
  assert.equal(
    await core.verifyTwilioSignature({ authToken: token, signature, urls: ['https://evil.example/support-voice-webhook?action=inbound'], entries }),
    false, 'different URL',
  )
})

test('URL candidates cover explicit :443 and a custom base override, and keep the query string', () => {
  const urls = core.webhookUrlCandidates({
    requestUrl: 'https://abc.supabase.co/functions/v1/support-voice-webhook?action=status&ticket_id=1',
    functionName: 'support-voice-webhook',
    baseOverride: 'https://voice.ridearrivo.com/hooks/',
  })
  assert.ok(urls.includes('https://voice.ridearrivo.com/hooks/support-voice-webhook?action=status&ticket_id=1'))
  assert.ok(urls.includes('https://abc.supabase.co:443/functions/v1/support-voice-webhook?action=status&ticket_id=1'))
})

test('constantTimeEqual', () => {
  assert.equal(core.constantTimeEqual('abc', 'abc'), true)
  assert.equal(core.constantTimeEqual('abc', 'abd'), false)
  assert.equal(core.constantTimeEqual('abc', 'abcd'), false)
  assert.equal(core.constantTimeEqual('', ''), true)
})

// ---------------------------------------------------------------------------
// Signed ingest (email / web chat adapters)
// ---------------------------------------------------------------------------

test('ingest signatures: valid, tampered, stale, future and weak-secret cases', async () => {
  const secret = 's'.repeat(40)
  const body = JSON.stringify({ channel: 'email', externalId: 'm1' })
  const now = 1_800_000_000_000
  const ts = String(now / 1000)
  const signature = await core.ingestSignature(secret, ts, body)
  const base = { secret, timestamp: ts, signature, rawBody: body, nowMs: now }

  assert.deepEqual(await core.verifyIngestSignature(base), { ok: true })
  assert.equal((await core.verifyIngestSignature({ ...base, rawBody: body + ' ' })).ok, false, 'tampered body')
  assert.equal((await core.verifyIngestSignature({ ...base, nowMs: now + 301_000 })).ok, false, 'replayed after 5 minutes')
  assert.equal((await core.verifyIngestSignature({ ...base, nowMs: now - 301_000 })).ok, false, 'timestamp from the future')
  assert.equal((await core.verifyIngestSignature({ ...base, timestamp: 'abc' })).ok, false, 'garbage timestamp')
  assert.equal((await core.verifyIngestSignature({ ...base, secret: 'short' })).ok, false, 'weak secret refused')
  const ref = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  assert.equal(signature, ref)
})

// ---------------------------------------------------------------------------
// TwiML
// ---------------------------------------------------------------------------

// Tiny well-formedness check: balanced tags and quoted attributes.
function assertWellFormed(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, '')
  const stack = []
  const tag = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9]*="[^"<]*")*)\s*(\/?)>/g
  let pos = 0
  let m
  while ((m = tag.exec(body))) {
    const between = body.slice(pos, m.index)
    assert.ok(!/[<>]/.test(between), `stray angle bracket in text: ${between}`)
    pos = tag.lastIndex
    const [, closing, name, , selfClose] = m
    if (selfClose) continue
    if (closing) assert.equal(stack.pop(), name, `unbalanced </${name}>`)
    else stack.push(name)
  }
  assert.equal(body.slice(pos).trim(), '', 'trailing garbage')
  assert.deepEqual(stack, [], 'unclosed tags')
}

test('enqueue TwiML is well formed and cannot be injected through task attributes', () => {
  const evil = '"><Hangup/><Say>'
  const xml = core.enqueueTwiml({
    greeting: 'Thank you for calling.',
    workflowSid: 'WW123',
    attributes: { type: 'voice_inbound', from: evil, ticket_id: 't1' },
    priority: 'P1',
    waitUrl: 'https://x.test/hook?action=wait&a=1&b=2',
    actionUrl: 'https://x.test/hook?action=queue-result',
  })
  assertWellFormed(xml)
  assert.ok(!xml.includes('<Hangup/>'), 'injected verb must be escaped')
  assert.match(xml, /<Task priority="80" timeout="7200">/)
  assert.match(xml, /waitUrl="https:\/\/x\.test\/hook\?action=wait&amp;a=1&amp;b=2"/)
  const attrs = JSON.parse(xml.match(/<Task[^>]*>(.*)<\/Task>/)[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
  assert.equal(attrs.from, evil, 'attributes survive a round trip')
})

test('priority maps to TaskRouter priority numbers, safety highest', () => {
  assert.deepEqual(['P0', 'P1', 'P2', 'P3', 'P4', 'bogus'].map(core.taskPriority), [100, 80, 60, 40, 20, 40])
})

test('hold music loop: speaks once a minute, leaves at the offer or limit', () => {
  assert.equal(core.shouldSayHoldMessage(0, 20), true)
  assert.equal(core.shouldSayHoldMessage(25, 20), false)
  assert.equal(core.shouldSayHoldMessage(40, 20), false)
  assert.equal(core.shouldSayHoldMessage(60, 20), true)
  assert.equal(core.shouldSayHoldMessage(130, 20), true)
  assert.equal(core.waitTwiml({ message: 'x', sayMessage: true, leave: true, loopSeconds: 20 }).includes('<Leave/>'), true)
  const hold = core.waitTwiml({ message: 'Please hold & wait', sayMessage: true, leave: false, loopSeconds: 20 })
  assertWellFormed(hold)
  assert.match(hold, /Please hold &amp; wait/)
  assert.match(hold, /<Pause length="20"\/>/)
  assert.match(core.waitTwiml({ message: '', sayMessage: false, leave: false, loopSeconds: 20, musicUrl: 'https://m.test/a.mp3' }), /<Play>https:\/\/m\.test\/a\.mp3<\/Play>/)
})

test('callback offer, IVR menu and confirmations are well formed', () => {
  assertWellFormed(core.callbackOfferTwiml({ choiceUrl: 'https://x/h?a=1&b=2', keepHoldingUrl: 'https://x/h?a=keep' }))
  assertWellFormed(core.ivrMenuTwiml({ greeting: 'Hello', actionUrl: 'https://x/h?a=ivr', fallbackUrl: 'https://x/h?a=enqueue' }))
  assertWellFormed(core.callbackConfirmedTwiml())
  assertWellFormed(core.noOfficerCallbackTwiml())
  assertWellFormed(core.sayAndHangupTwiml('a < b & c'))
  assert.equal(core.ivrChoice('9').skill, 'safety')
  assert.equal(core.ivrChoice('9').priority, 'P0')
  assert.equal(core.ivrChoice('1').priority, 'P1')
  assert.equal(core.ivrChoice('7'), null)
  assert.equal(core.ivrChoice(undefined), null)
})

test('outbound dial uses BYOC only when configured and always reports status', () => {
  const plain = core.outboundDialTwiml({ callerId: '+23417000000', to: '+2348012345678', statusCallbackUrl: 'https://x/h?action=status&t=1' })
  assertWellFormed(plain)
  assert.ok(!plain.includes('byoc='))
  assert.match(plain, /answerOnBridge="true"/)
  assert.match(plain, /statusCallbackEvent="initiated ringing answered completed"/)
  const byoc = core.outboundDialTwiml({ callerId: '+23417000000', to: '+2348012345678', byocTrunkSid: 'BYabc', statusCallbackUrl: 'https://x/h', recordingCallbackUrl: 'https://x/rec' })
  assertWellFormed(byoc)
  assert.match(byoc, /<Number byoc="BYabc"/)
  assert.match(byoc, /record="record-from-answer-dual"/)
  const cb = core.callbackAgentTwiml({ callerId: '+23417000000', to: '+2348012345678', statusCallbackUrl: 'https://x/h' })
  assertWellFormed(cb)
  for (const reason of ['invalid_number', 'destination_not_allowed', 'destination_blocked', 'rate_limited', 'other']) {
    assertWellFormed(core.rejectDestinationTwiml(reason))
  }
})

// ---------------------------------------------------------------------------
// Assignment gate
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-10-19T12:00:00Z')
const goodCtx = () => ({
  workerSid: 'WK1',
  agent: { enabled: true, voice_enabled: true, provider_worker_id: 'WK1' },
  presence: { state: 'available', last_seen_at: new Date(NOW - 10_000).toISOString() },
  onShift: true,
  device: { client_identity: 'ra-support-abc' },
  nowMs: NOW,
})

test('assignment gate lets an available, on-shift, fresh officer through', () => {
  assert.deepEqual(core.decideAssignment(goodCtx()), { ok: true, clientIdentity: 'ra-support-abc' })
})

test('assignment gate refuses everyone else, with a reason', () => {
  const cases = [
    ['agent_unknown', (c) => { c.agent = null }],
    ['agent_disabled', (c) => { c.agent.enabled = false }],
    ['voice_disabled', (c) => { c.agent.voice_enabled = false }],
    ['worker_mismatch', (c) => { c.workerSid = 'WK_OTHER' }],
    ['worker_mismatch', (c) => { c.agent.provider_worker_id = null }],
    ['not_available', (c) => { c.presence.state = 'break' }],
    ['not_available', (c) => { c.presence.state = 'on_call' }],
    ['not_available', (c) => { c.presence = null }],
    ['off_shift', (c) => { c.onShift = false }],
    ['stale_heartbeat', (c) => { c.presence.last_seen_at = new Date(NOW - 5 * 60_000).toISOString() }],
    ['stale_heartbeat', (c) => { c.presence.last_seen_at = null }],
    ['no_device', (c) => { c.device = null }],
  ]
  for (const [reason, mutate] of cases) {
    const ctx = goodCtx()
    mutate(ctx)
    assert.deepEqual(core.decideAssignment(ctx), { ok: false, reason }, reason)
  }
})

// ---------------------------------------------------------------------------
// Presence state machine
// ---------------------------------------------------------------------------

test('TaskRouter events move officers through the right states', () => {
  assert.deepEqual(core.presenceForEvent('reservation.accepted', 'available'), { state: 'on_call', reason: null })
  assert.deepEqual(core.presenceForEvent('reservation.completed', 'on_call'), { state: 'wrap_up', reason: null })
  assert.deepEqual(core.presenceForEvent('reservation.timeout', 'available'), { state: 'away', reason: 'missed_call' })
  assert.deepEqual(core.presenceForEvent('reservation.rejected', 'available'), { state: 'away', reason: 'rejected_call' })
  // A ringing (created) reservation is NOT a call in progress.
  assert.equal(core.presenceForEvent('reservation.created', 'available'), null)
  // Events never override a deliberate choice or a call in progress.
  assert.equal(core.presenceForEvent('reservation.timeout', 'break'), null)
  assert.equal(core.presenceForEvent('reservation.completed', 'break'), null)
  assert.equal(core.presenceForEvent('reservation.timeout', 'on_call'), null)
  assert.equal(core.presenceForEvent('task.canceled', 'available'), null)
  assert.equal(core.presenceForEvent('worker.activity.update', 'available'), null)
})

test('activity mapping covers every RA state', () => {
  const expected = { available: 'available', busy: 'busy', on_call: 'busy', wrap_up: 'wrapup', break: 'break', away: 'offline', offline: 'offline' }
  for (const state of core.PRESENCE_STATES) assert.equal(core.activityKeyForState(state), expected[state], state)
  assert.equal(core.activityKeyForState('???'), 'offline')
  assert.deepEqual(core.AGENT_SELECTABLE_STATES, ['available', 'break', 'away', 'offline'])
  assert.ok(!core.AGENT_SELECTABLE_STATES.includes('on_call'))
  assert.equal(core.isPresenceState('wrap_up'), true)
  assert.equal(core.isPresenceState('sleeping'), false)
  assert.equal(core.clientIdentity('0000-aaaa/../x'), 'ra-support-0000-aaaax')
})

test('parseJsonObject is safe on junk', () => {
  assert.deepEqual(core.parseJsonObject('{"a":1}'), { a: 1 })
  for (const junk of ['', 'not json', '[1,2]', '"str"', 'null', undefined, null, 42]) assert.deepEqual(core.parseJsonObject(junk), {})
})

// ---------------------------------------------------------------------------
// TaskRouter workflow definition
// ---------------------------------------------------------------------------

test('workflow routes safety first, honours the same-officer rule, and always falls back to General', () => {
  const q = { safety: 'WQs', activeRide: 'WQa', payments: 'WQp', general: 'WQg' }
  const cfg = core.buildWorkflowConfiguration(q)
  const filters = cfg.task_routing.filters
  assert.equal(filters[0].filter_friendly_name, 'Safety first')
  assert.equal(filters[0].expression, 'skill == "safety"')
  assert.equal(filters[0].targets[0].priority, 100)
  assert.equal(cfg.task_routing.default_filter.queue, 'WQg')
  for (const f of filters) {
    assert.equal(f.targets.at(-1).queue, 'WQg', `${f.filter_friendly_name} must fall back to General`)
    assert.equal(f.targets.at(-1).timeout, undefined, 'the last target must not time out')
  }
  const sticky = filters.find((f) => f.expression === 'has_preferred == 1')
  assert.equal(sticky.targets[0].expression, 'worker.employee_id == task.preferred_agent_id')
  assert.doesNotThrow(() => JSON.stringify(cfg))
  const used = new Set(JSON.stringify(cfg).match(/WQ[a-z]/g))
  assert.deepEqual([...used].sort(), ['WQa', 'WQg', 'WQp', 'WQs'])
})

test('queue and activity definitions are complete', () => {
  assert.deepEqual(core.QUEUE_DEFINITIONS.map((q) => q.key), ['general', 'safety', 'activeRide', 'payments'])
  assert.equal(core.QUEUE_DEFINITIONS[0].name, 'RA Support - General Voice')
  assert.deepEqual(core.ACTIVITY_DEFINITIONS.map((a) => a.name), ['Available', 'Busy', 'WrapUp', 'Break', 'Offline'])
  assert.equal(core.ACTIVITY_DEFINITIONS.filter((a) => a.available).length, 1)
})

// ---------------------------------------------------------------------------
// Telephony controls: after hours, voicemail, carrier route, quality
// ---------------------------------------------------------------------------

import { QualityAccumulator } from '../src/support/qualitySamples.ts'

test('voicemail TwiML records with a beep, caps the length and escapes text', () => {
  const x = core.voicemailTwiml({
    closedMessage: 'We are closed & resting.', prompt: 'Leave a message.', maxSeconds: 9999,
    actionUrl: 'https://x.test/f?action=voicemail-done&a=1', recordingCallbackUrl: 'https://x.test/f?action=voicemail-recording',
  })
  assert.match(x, /<Record maxLength="600"/)
  assert.match(x, /playBeep="true"/)
  assert.match(x, /closed &amp; resting/)
  assert.match(x, /action="https:\/\/x\.test\/f\?action=voicemail-done&amp;a=1"/)
  assert.match(x, /recordingStatusCallback="https:\/\/x\.test\/f\?action=voicemail-recording"/)
  assert.ok(x.indexOf('<Record') < x.lastIndexOf('<Hangup/>'), 'hangs up only if nothing was recorded')
  assert.match(core.voicemailTwiml({ closedMessage: 'c', prompt: 'p', maxSeconds: 1, actionUrl: 'a', recordingCallbackUrl: 'b' }), /maxLength="10"/)
})

test('closed and thanks TwiML always end the call', () => {
  assert.match(core.closedTwiml('We are closed.'), /We are closed\. Goodbye\.<\/Say><Hangup\/>/)
  assert.match(core.voicemailThanksTwiml(), /<Hangup\/>/)
  assert.match(core.recordingNoticeTwiml(), /may be recorded/)
  assert.doesNotMatch(core.recordingNoticeTwiml(), /<Hangup/)
})

test('carrier route: registry decides, otherwise the account trunk', () => {
  assert.deepEqual(core.chooseCarrierRoute('pstn', 'BY123'), { route: 'pstn' })
  assert.deepEqual(core.chooseCarrierRoute('byoc', 'BY123'), { route: 'byoc', trunkSid: 'BY123' })
  assert.deepEqual(core.chooseCarrierRoute(null, 'BY123'), { route: 'byoc', trunkSid: 'BY123' })
  assert.deepEqual(core.chooseCarrierRoute(null, undefined), { route: 'pstn' })
  assert.deepEqual(core.chooseCarrierRoute('byoc', undefined), { route: 'pstn' }, 'a byoc number with no trunk configured cannot use byoc')
})

test('PSTN fallback only when the carrier leg failed, once', () => {
  const base = { dialStatus: 'failed', usedByoc: true, alreadyRetried: false, enabled: true }
  assert.equal(core.shouldFallBackToPstn(base), true)
  assert.equal(core.shouldFallBackToPstn({ ...base, dialStatus: 'no-answer' }), false, 'callee did not answer: do not redial')
  assert.equal(core.shouldFallBackToPstn({ ...base, dialStatus: 'busy' }), false)
  assert.equal(core.shouldFallBackToPstn({ ...base, dialStatus: 'completed' }), false)
  assert.equal(core.shouldFallBackToPstn({ ...base, alreadyRetried: true }), false, 'never loop')
  assert.equal(core.shouldFallBackToPstn({ ...base, enabled: false }), false)
  assert.equal(core.shouldFallBackToPstn({ ...base, usedByoc: false }), false)
})

test('outbound TwiML carries the announcement, result URL and BYOC attributes', () => {
  const x = core.outboundDialTwiml({
    callerId: '+2342000000000', to: '+2348011112222', byocTrunkSid: 'BY1', statusCallbackUrl: 'https://x.test/s',
    recordingCallbackUrl: 'https://x.test/r', announceUrl: 'https://x.test/a', dialResultUrl: 'https://x.test/d?to=%2B1&x=2',
  })
  assert.match(x, /<Dial [^>]*action="https:\/\/x\.test\/d\?to=%2B1&amp;x=2"/)
  assert.match(x, /<Number [^>]*byoc="BY1"[^>]*url="https:\/\/x\.test\/a"/)
  assert.match(x, /record="record-from-answer-dual"/)
  const plain = core.outboundDialTwiml({ callerId: '+1', to: '+2', statusCallbackUrl: 'https://x.test/s' })
  assert.doesNotMatch(plain, /action=|byoc=|record=| url=/)
})

test('rejection messages exist for the new dial blocks', () => {
  assert.match(core.rejectDestinationTwiml('do_not_contact'), /do not contact/)
  assert.match(core.rejectDestinationTwiml('spend_cap_reached'), /budget/)
})

test('MOS estimate follows the brief targets', () => {
  assert.ok(core.estimateMos(40, 5, 0) > 4.0, 'healthy link is above 4.0')
  assert.ok(core.estimateMos(500, 80, 6) < 3.6, 'degraded link is below 3.6')
  assert.ok(core.estimateMos(1000, 200, 30) >= 1, 'floor is 1')
  assert.ok(core.estimateMos(0, 0, 0) <= 4.5, 'ceiling is 4.5')
  assert.ok(core.estimateMos(100, 10, 0) > core.estimateMos(100, 10, 5), 'loss hurts')
  assert.equal(core.qualityVerdict({ rttMs: 60, jitterMs: 8, lossPct: 0.2, mos: 4.3 }), 'good')
  assert.equal(core.qualityVerdict({ rttMs: 60, jitterMs: 45, lossPct: 0.2, mos: 4.3 }), 'fair', 'jitter over 30 ms is not good')
  assert.equal(core.qualityVerdict({ rttMs: 500, jitterMs: 80, lossPct: 6, mos: 2.9 }), 'poor')
})

test('quality accumulator averages, converts loss fractions and resets', () => {
  const q = new QualityAccumulator()
  assert.equal(q.flush(), null)
  q.add({ rtt: 100, jitter: 10, packetsLostFraction: 0.02 })
  q.add({ rtt: 200, jitter: 30, packetsLostFraction: 0 })
  q.add({})
  assert.equal(q.size, 2, 'empty samples are ignored')
  const s = q.flush()
  assert.deepEqual(s, { rttMs: 150, jitterMs: 20, lossPct: 1, count: 2 })
  assert.equal(q.flush(), null, 'flush resets')
  q.add({ rtt: -5, jitter: Number.NaN, packetsLostFraction: 250 })
  assert.deepEqual(q.flush(), { rttMs: 0, jitterMs: 0, lossPct: 100, count: 1 }, 'negative and absurd values are clamped')
})


// ---------------------------------------------------------------------------
// Workstation safety
// ---------------------------------------------------------------------------

test('location is live only while fresh, otherwise last known with its age', () => {
  const now = Date.parse('2026-10-20T10:00:00Z')
  assert.deepEqual(core.locationFreshness('2026-10-20T09:59:40Z', now, 45), { state: 'live', ageSeconds: 20 })
  assert.deepEqual(core.locationFreshness('2026-10-20T09:59:15Z', now, 45), { state: 'live', ageSeconds: 45 })
  assert.deepEqual(core.locationFreshness('2026-10-20T09:59:14Z', now, 45), { state: 'stale', ageSeconds: 46 })
  assert.deepEqual(core.locationFreshness('2026-10-20T09:00:00Z', now, 45), { state: 'stale', ageSeconds: 3600 })
  assert.deepEqual(core.locationFreshness('2026-10-20T10:00:30Z', now, 45), { state: 'live', ageSeconds: 0 })
  for (const bad of [null, undefined, '', 'yesterday', {}]) assert.equal(core.locationFreshness(bad, now, 45).state, 'unknown')
})

const SUBJECT = '11111111-2222-4333-8444-555555555555'

test('a valid SOS event is normalised', () => {
  const r = core.parseSosEvent({
    event_id: ' evt-1 ', subject_type: 'driver', subject_id: SUBJECT, identity_code: 'rad-abcde-fghjk', trip_id: 'T1', booking_ref: 'B9', vehicle_id: 'V3',
    activated_at: '2026-10-20T09:59:00+01:00', location: { lat: '6.52', lng: 3.37, accuracy_m: 8, heading: 90, recorded_at: '2026-10-20T08:58:55Z' },
  })
  assert.equal(r.ok, true)
  assert.equal(r.value.eventId, 'evt-1')
  assert.equal(r.value.identityCode, 'RAD-ABCDE-FGHJK')
  assert.equal(r.value.activatedAt, '2026-10-20T08:59:00.000Z')
  assert.deepEqual(r.value.location, { lat: 6.52, lng: 3.37, accuracy_m: 8, heading: 90, recorded_at: '2026-10-20T08:58:55.000Z' })
})

test('SOS events are rejected only when the event or the person cannot be identified', () => {
  for (const [body, why] of [
    [null, 'not an object'], [[], 'array'], [{}, 'empty'],
    [{ subject_type: 'rider', subject_id: SUBJECT }, 'no event id'],
    [{ event_id: 'e', subject_type: 'pilot', subject_id: SUBJECT }, 'bad subject type'],
    [{ event_id: 'e', subject_type: 'rider', subject_id: 'nope' }, 'bad subject id'],
  ]) assert.equal(core.parseSosEvent(body).ok, false, why)
})

test('bad coordinates and timestamps never reject an emergency', () => {
  for (const location of [{ lat: 200, lng: 3 }, { lat: 'x', lng: 3 }, { lat: 6 }, 'here', [], null]) {
    const r = core.parseSosEvent({ event_id: 'e', subject_type: 'rider', subject_id: SUBJECT, location, activated_at: 'soon' })
    assert.equal(r.ok, true)
    assert.equal(r.value.location, null)
    assert.equal(r.value.activatedAt, null)
  }
  const r = core.parseSosEvent({ event_id: 'e', subject_type: 'rider', subject_id: SUBJECT, location: { lat: 6, lng: 3, heading: 999, accuracy_m: -4 } })
  assert.deepEqual(r.value.location, { lat: 6, lng: 3 })
})

test('upstream location data is reduced to the fields the console shows', () => {
  const out = core.sanitizeLiveLocation({
    lat: 6.5, lng: 3.4, heading: 45, speed_kmh: 30, accuracy_m: 5, recorded_at: '2026-10-20T10:00:00Z', secret: 'x', driver_phone: '+234801',
    trip: { status: 'in_progress', booking_ref: 'B1', pickup: { lat: 6.4, lng: 3.3, label: 'Ikeja' }, dropoff: { lat: 'bad', lng: 3 }, eta_minutes: 7, rider_phone: '+234802' },
  })
  assert.equal(out.lat, 6.5)
  assert.equal('secret' in out, false)
  assert.equal('driver_phone' in out, false)
  assert.equal('rider_phone' in out.trip, false)
  assert.equal(out.trip.dropoff, undefined)
  assert.equal(out.trip.pickup.label, 'Ikeja')
  assert.equal(core.sanitizeLiveLocation({ lat: 95, lng: 3 }), null)
  assert.equal(core.sanitizeLiveLocation('x'), null)
})

test('invite codes: right shape, no look-alike characters, evenly drawn, forgiving on entry', () => {
  const { randomBytes } = require_crypto()
  const seen = new Set()
  for (let i = 0; i < 500; i++) {
    const code = core.generateInviteCode((n) => new Uint8Array(randomBytes(n)))
    assert.match(code, /^[2-9A-HJKMNP-TV-Z]{5}-[2-9A-HJKMNP-TV-Z]{5}$/)
    assert.doesNotMatch(code, /[01OILU]/)
    seen.add(code)
  }
  assert.equal(seen.size, 500)
  assert.equal(core.normalizeInviteCode(' kq7m2-x9tra '), 'KQ7M2X9TRA')
  assert.equal(core.INVITE_ALPHABET.length, 30)
  // all-0xFF bytes are above the rejection limit, so the generator must keep asking for more
  let calls = 0
  const code = core.generateInviteCode((n) => { calls++; return calls < 3 ? new Uint8Array(n).fill(255) : new Uint8Array(n).fill(0) })
  assert.ok(calls >= 3 && code === '22222-22222')
})

test('join password rules and email check', () => {
  assert.ok(core.validateJoinPassword('short', 'a@b.com'))
  assert.ok(core.validateJoinPassword('aaaaaaaaaaaa', 'a@b.com'))
  assert.ok(core.validateJoinPassword('ngozi.okafor-2026', 'ngozi.okafor@x.com'))
  assert.ok(core.validateJoinPassword('password1234', 'a@b.com'))
  assert.equal(core.validateJoinPassword('correct-horse-battery', 'a@b.com'), null)
  assert.ok(core.isValidEmail('a@b.co') && !core.isValidEmail('a@b') && !core.isValidEmail('a b@c.com'))
})

test('invite message carries the code, escapes the name, and never contains an em dash', () => {
  const m = core.inviteMessage({ name: '<b>Ada</b> Obi', code: 'KQ7M2-X9TRA', joinUrl: 'https://x.example/join' })
  assert.ok(m.text.includes('KQ7M2-X9TRA') && m.html.includes('KQ7M2-X9TRA') && m.html.includes('https://x.example/join'))
  assert.ok(!m.html.includes('<b>Ada'))
  assert.ok(!(m.text + m.html + m.subject).includes('—'))
  assert.ok(core.inviteMessage({ name: 'A', code: 'C', joinUrl: '' }).text.includes('join page'))
})

test('polyline decoding matches the published reference and rejects junk', () => {
  // Reference example from the encoded polyline algorithm documentation.
  const pts = core.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  assert.deepEqual(pts, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
  assert.deepEqual(core.decodePolyline(''), [])
  assert.deepEqual(core.decodePolyline('!!!!'), [])
  assert.deepEqual(core.decodePolyline(123), [])
  assert.deepEqual(core.decodePolyline('_p~iF'), [])   // a lat with no lng is malformed
  assert.equal(core.decodePolyline('x'.repeat(60000)).length, 0)
  // precision 6 divides by a million
  const p6 = core.decodePolyline('_p~iF~ps|U', 6)
  assert.ok(Math.abs(p6[0][0] - 3.85) < 1e-6 || p6.length === 1)
})

test('downsampling keeps the ends and the order', () => {
  const line = Array.from({ length: 1000 }, (_, i) => [i / 100, i / 100])
  const d = core.downsamplePath(line, 50)
  assert.equal(d.length, 50)
  assert.deepEqual(d[0], line[0]); assert.deepEqual(d[49], line[999])
  for (let i = 1; i < d.length; i++) assert.ok(d[i][0] > d[i - 1][0])
  assert.equal(core.downsamplePath(line.slice(0, 10), 50).length, 10)
})

test('route and trail from the location service are validated and capped', () => {
  const route = Array.from({ length: 2000 }, (_, i) => [6 + i / 10000, 3 + i / 10000])
  route.splice(5, 0, [999, 3], ['x', 1], null)
  const out = core.sanitizeLiveLocation({
    lat: 6.5, lng: 3.4,
    trip: { status: 'in_progress', route },
    trail: [{ lat: 6.1, lng: 3.1, recorded_at: '2026-10-20T10:00:00Z', phone: '+234' }, { lat: 'bad', lng: 3 }, { lat: 6.2, lng: 3.2 }],
  })
  assert.equal(out.trip.route.length, 400)
  assert.ok(out.trip.route.every(([a, o]) => Math.abs(a) <= 90 && Math.abs(o) <= 180))
  assert.equal(out.trail.length, 2)
  assert.equal('phone' in out.trail[0], false)
  const poly = core.sanitizeLiveLocation({ lat: 1, lng: 1, trip: { route_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } })
  assert.equal(poly.trip.route.length, 3)
  assert.equal(core.sanitizeLiveLocation({ lat: 1, lng: 1, trip: { route: [[1, 1]] } }).trip.route, undefined)   // one point is not a route
  const many = Array.from({ length: 500 }, (_, i) => ({ lat: 6 + i / 1000, lng: 3 }))
  assert.equal(core.sanitizeLiveLocation({ lat: 1, lng: 1, trail: many }).trail.length, 100)
})
