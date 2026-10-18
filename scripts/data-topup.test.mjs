import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  fetchVtpassVariations, interpretProviderAnswer, lagosStamp, runTopups, vtpassBase, vtpassProvider,
} from '../supabase/functions/_shared/dataTopupCore.ts'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const ok = (data) => ({ data, error: null })

test('lagosStamp is the Lagos clock as YYYYMMDDHHII', () => {
  assert.equal(lagosStamp(new Date('2026-10-18T04:00:00Z')), '202610180500')
  assert.equal(lagosStamp(new Date('2026-10-18T23:30:00Z')), '202610190030')
  assert.match(lagosStamp(new Date()), /^[0-9]{12}$/)
})

test('reseller answers: only an explicit delivered is delivered, unreadable means wait, refusals fail', () => {
  const body = (code, status, extra = {}) => ({ code, response_description: 'x', content: { transactions: { status, transactionId: 'T1', amount: 350, ...extra } } })
  assert.deepEqual(
    (({ status, ref, amount }) => ({ status, ref, amount }))(interpretProviderAnswer(200, body('000', 'delivered'))),
    { status: 'delivered', ref: 'T1', amount: 350 })
  assert.equal(interpretProviderAnswer(200, body('000', 'pending')).status, 'pending')
  assert.equal(interpretProviderAnswer(200, body('000', 'initiated')).status, 'pending')
  assert.equal(interpretProviderAnswer(200, { code: '099' }).status, 'pending')
  assert.equal(interpretProviderAnswer(200, { code: '000' }).status, 'pending', 'accepted is not delivered')
  assert.equal(interpretProviderAnswer(200, body('000', 'failed')).status, 'failed')
  assert.equal(interpretProviderAnswer(200, body('000', 'reversed')).status, 'failed')
  assert.equal(interpretProviderAnswer(200, { code: '016', response_description: 'TRANSACTION FAILED' }).status, 'failed')
  assert.equal(interpretProviderAnswer(200, { code: '018' }).stop, true, 'low wallet stops the run')
  for (const s of [500, 502, 503, 408, 429]) assert.equal(interpretProviderAnswer(s, null).status, 'pending', String(s))
  assert.equal(interpretProviderAnswer(200, null).status, 'pending')
  assert.equal(interpretProviderAnswer(200, 'oops').status, 'pending')
  assert.equal(interpretProviderAnswer(200, {}).status, 'pending')
})

function fakeBackend({ claims = [], waiting = [], answers = {}, requeryAnswers = {} } = {}) {
  const calls = []
  const bought = []
  const completions = []
  const rpc = async (name, args) => {
    calls.push([name, args])
    if (name === 'topup_pending') return ok(waiting)
    if (name === 'topup_claim_batch') return ok(claims)
    if (name === 'topup_complete') { completions.push(args); return ok(null) }
    throw new Error(`unexpected rpc ${name}`)
  }
  const provider = {
    async buy(row) { bought.push(row.request_id); return answers[row.request_id] ?? { status: 'delivered', code: '000', ref: 'T', amount: row.price_ngn, message: 'ok' } },
    async requery(id) { return requeryAnswers[id] ?? { status: 'pending', code: '099', ref: null, amount: null, message: 'wait' } },
  }
  return { rpc, provider, calls, bought, completions }
}

const claim = (n, extra = {}) => ({ id: `id${n}`, employee_id: `e${n}`, msisdn: `0803000000${n}`, variation: 'mtn-1gb-350', request_id: `202610180500ra00000000000${n}a1`, tier_code: 'gb1', bytes: 1073741824, price_ngn: 350, ...extra })

test('run buys what the database reserved, records every outcome, and counts them', async () => {
  const b = fakeBackend({ claims: [claim(1), claim(2), claim(3)], answers: { [claim(2).request_id]: { status: 'failed', code: '016', ref: null, amount: null, message: 'no' }, [claim(3).request_id]: { status: 'pending', code: 'network', ref: null, amount: null, message: 'timeout' } } })
  const s = await runTopups({ rpc: b.rpc, provider: b.provider, now: () => new Date('2026-10-18T04:00:00Z') })
  assert.deepEqual([s.delivered, s.failed, s.pending, s.skipped, s.stopped], [1, 1, 1, 0, null])
  assert.equal(b.bought.length, 3)
  assert.deepEqual(b.completions.map((c) => c.p_status).sort(), ['delivered', 'failed', 'pending'])
  const claimCall = b.calls.find((c) => c[0] === 'topup_claim_batch')
  assert.equal(claimCall[1].p_stamp, '202610180500')
})

test('nothing reserved means nothing bought', async () => {
  const b = fakeBackend()
  const s = await runTopups({ rpc: b.rpc, provider: b.provider })
  assert.equal(b.bought.length, 0)
  assert.equal(s.delivered, 0)
})

test('waiting deliveries are re-checked first; asking again never turns them into failures', async () => {
  const b = fakeBackend({
    waiting: [{ id: 'w1', request_id: 'R1' }, { id: 'w2', request_id: 'R2' }, { id: 'w3', request_id: 'R3' }],
    requeryAnswers: {
      R1: { status: 'delivered', code: '000', ref: 'T9', amount: 350, message: 'ok' },
      R2: { status: 'failed', code: '016', ref: null, amount: null, message: 'no' },
    },
  })
  const s = await runTopups({ rpc: b.rpc, provider: b.provider })
  assert.equal(s.requeried, 3)
  assert.equal(s.delivered, 1)
  assert.deepEqual(b.completions.map((c) => c.p_id), ['w1'], 'only the confirmed delivery is written')
  assert.equal(b.calls[0][0], 'topup_pending', 'ask about waiting ones before reserving new ones')
})

test('a low wallet stops the run and hands the rest back untouched', async () => {
  const claims = [claim(1), claim(2), claim(3), claim(4)]
  const b = fakeBackend({ claims, answers: { [claims[0].request_id]: { status: 'failed', code: '018', ref: null, amount: null, message: 'Insufficient wallet', stop: true } } })
  const s = await runTopups({ rpc: b.rpc, provider: b.provider, concurrency: 1 })
  assert.equal(s.stopped, 'Insufficient wallet')
  assert.equal(b.bought.length, 1, 'no further purchases after the wallet is empty')
  assert.equal(s.skipped, 3)
  assert.equal(b.completions.filter((c) => c.p_status === 'skipped').length, 3)
})

test('an exception while buying is treated as unknown, not as failed', async () => {
  const b = fakeBackend({ claims: [claim(1)] })
  b.provider.buy = async () => { throw new Error('boom') }
  const s = await runTopups({ rpc: b.rpc, provider: b.provider })
  assert.equal(s.pending, 1)
  assert.equal(s.failed, 0)
  assert.equal(b.completions[0].p_status, 'pending')
})

test('a database error when reserving stops the run before anything is bought', async () => {
  const b = fakeBackend({ claims: [claim(1)] })
  const rpc = async (name, args) => name === 'topup_claim_batch' ? { data: null, error: { message: 'db down' } } : b.rpc(name, args)
  await assert.rejects(runTopups({ rpc, provider: b.provider }), /could not reserve/)
  assert.equal(b.bought.length, 0)
})

test('VTpass requests carry the right headers, body and endpoint, and sandbox is the safe default', async () => {
  assert.equal(vtpassBase('sandbox'), 'https://sandbox.vtpass.com')
  assert.equal(vtpassBase('live'), 'https://vtpass.com')
  const seen = []
  const fetchImpl = async (url, init) => { seen.push([url, init]); return { status: 200, json: async () => ({ code: '000', content: { transactions: { status: 'delivered', transactionId: 'X', amount: '350' } } }) } }
  const p = vtpassProvider({ env: 'sandbox', apiKey: 'AK', secretKey: 'SK_secret' }, fetchImpl)
  const out = await p.buy(claim(1))
  assert.equal(out.status, 'delivered')
  assert.equal(out.amount, 350)
  const [url, init] = seen[0]
  assert.equal(url, 'https://sandbox.vtpass.com/api/pay')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['api-key'], 'AK')
  assert.equal(init.headers['secret-key'], 'SK_secret')
  const sent = JSON.parse(init.body)
  assert.deepEqual(sent, { request_id: claim(1).request_id, serviceID: 'mtn-data', billersCode: claim(1).msisdn, variation_code: 'mtn-1gb-350', phone: claim(1).msisdn })
  await p.requery('R1')
  assert.equal(seen[1][0], 'https://sandbox.vtpass.com/api/requery')
  assert.deepEqual(JSON.parse(seen[1][1].body), { request_id: 'R1' })
})

test('network failure and timeouts are pending, never failed', async () => {
  const p = vtpassProvider({ env: 'live', apiKey: 'a', secretKey: 'b' }, async () => { throw new Error('ECONNRESET') })
  const out = await p.buy(claim(1))
  assert.equal(out.status, 'pending')
  const slow = vtpassProvider({ env: 'live', apiKey: 'a', secretKey: 'b' }, async () => ({ status: 200, json: async () => { throw new Error('bad json') } }))
  assert.equal((await slow.buy(claim(1))).status, 'pending')
})

test('bundle list uses the public key, drops duplicates and junk', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push([url, init])
    return { status: 200, json: async () => ({ content: { variations: [
      { variation_code: 'mtn-1gb-350', name: '1GB daily', variation_amount: '350.00' },
      { variation_code: 'mtn-1gb-350', name: 'dup', variation_amount: '999' },
      { variation_code: '', name: 'blank', variation_amount: '1' },
      { variation_code: 'mtn-x', name: 'no price' },
    ] } }) }
  }
  const list = await fetchVtpassVariations({ env: 'sandbox', apiKey: 'AK', secretKey: 'SK', publicKey: 'PK_1' }, fetchImpl)
  assert.deepEqual(list, [{ code: 'mtn-1gb-350', name: '1GB daily', price: 350 }])
  assert.equal(seen[0][1].headers['public-key'], 'PK_1')
  assert.equal(seen[0][1].headers['secret-key'], undefined, 'GET uses the public key only')
  await assert.rejects(fetchVtpassVariations({ env: 'sandbox', apiKey: 'a', secretKey: 'b' }, fetchImpl), /VTPASS_PUBLIC_KEY/)
})

test('function wiring: schedule secret or admin only, sandbox default, no keys in git', () => {
  const fn = read('../supabase/functions/data-topup/index.ts')
  assert.match(fn, /CRON_DISPATCH_SECRET/)
  assert.match(fn, /admin_data_topup_overview/)
  assert.match(fn, /VTPASS_ENV"\) \|\| "sandbox"/)
  assert.match(read('../supabase/config.toml'), /\[functions\.data-topup\]\s+enabled = true\s+verify_jwt = false/)
  assert.doesNotMatch(fn, /SK_[A-Za-z0-9]{6,}/)
})

test('migration: delivery off by default, service-only claim functions, admin-only controls, cron guarded', () => {
  const sql = read('../supabase/migrations/20261018010000_data_topups.sql')
  assert.match(sql, /topup_enabled boolean not null default false/)
  for (const f of ['topup_claim_batch\\(text, integer\\)', 'topup_pending\\(integer\\)', 'topup_complete\\(uuid, text, text, numeric, text\\)']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f} from public, anon, authenticated`), f)
    assert.match(sql, new RegExp(`grant execute on function public\\.${f} to service_role`), f)
  }
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /unique \(employee_id, day\)/)
  assert.match(sql, /exception when others then\s+raise notice 'data-topup schedule skipped/)
  for (const fn of sql.match(/create or replace function public\.\w+/g)) {
    const body = sql.slice(sql.indexOf(fn), sql.indexOf(fn) + 1500)
    assert.match(body, /set search_path/, fn)
  }
  assert.ok(!sql.includes('—'))
})

import { deliveryLabel, naira, parsePhoneLines, topupBlockers } from '../src/lib/dataAllocationModel.ts'

test('screen helpers: naira, labels, blockers and pasted numbers', () => {
  assert.equal(naira(1234.4), 'NGN 1,234')
  assert.equal(naira(null), 'NGN 0')
  assert.equal(deliveryLabel('delivered'), 'Delivered')
  assert.equal(deliveryLabel('pending'), 'Waiting for MTN')
  assert.equal(deliveryLabel(null), 'Not yet today')
  const tiers = (v) => [{ code: 'gb1', label: '1 GB', daily_bytes: 1, provider_variation: v, price_ngn: v ? 350 : null }]
  assert.deepEqual(topupBlockers(null, ''), ['Loading'])
  assert.equal(topupBlockers({ tiers: tiers('') }, '').length, 2)
  assert.equal(topupBlockers({ tiers: tiers('mtn-1gb-350') }, '20,000').length, 0)
  assert.equal(topupBlockers({ tiers: tiers('mtn-1gb-350') }, '0').length, 1)
  assert.deepEqual(
    parsePhoneLines('email,phone\nada@x.com, 0803 123 4567\n\nbola@x.com\t08065550101\njunk line\ncee@x.com;+234 806 555 0101'),
    [{ email: 'ada@x.com', phone: '0803 123 4567' }, { email: 'bola@x.com', phone: '08065550101' }, { email: 'cee@x.com', phone: '+234 806 555 0101' }])
})

test('screens: delivery panel mounted, no leftover gateway or password controls, card shows delivery', () => {
  const admin = read('../src/modules/AdminDataAllocation.tsx')
  assert.match(admin, /<AdminDataDelivery onChanged/)
  assert.doesNotMatch(admin, /issuePassword|resetNetworkPassword|saveDataDevice|DATA_RADIUS_URL/)
  const panel = read('../src/modules/AdminDataDelivery.tsx')
  assert.match(panel, /window\.confirm\('Delivery is LIVE/)
  assert.match(panel, /disabled=\{busy \|\| blockers\.length > 0\}/)
  assert.match(read('../src/components/MyDataCard.tsx'), /loadMyDelivery/)
  assert.doesNotMatch(read('../src/components/MyDataCard.tsx'), /rotateMyNetworkPassword/)
  assert.match(read('../src/data-allocation.css'), /html\[data-ra-theme='dark'\] \.dataAllocation input/)
})

test('no em dash in the delivery files', () => {
  for (const f of ['../src/modules/AdminDataDelivery.tsx', '../src/modules/AdminDataAllocation.tsx', '../src/components/MyDataCard.tsx',
    '../supabase/functions/_shared/dataTopupCore.ts', '../supabase/functions/data-topup/index.ts', '../supabase/checks/data-topups.sql', '../docs/data-allocation.md']) {
    assert.ok(!read(f).includes('—'), f)
  }
})
