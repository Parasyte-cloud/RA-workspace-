import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import {
  DATA_TIERS, GB, MB, TB, commitmentFor, csvEscape, filterUsers, formatBytes, formatDuration,
  gatewayState, poolBanner, sizeToBytes, usageCsv, usageLevel, usagePercent, tierBytes,
} from '../src/lib/dataAllocationModel.ts'
import { authReply, constantTimeEqual, handleRadius, readAttributes } from '../supabase/functions/_shared/dataRadiusCore.ts'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('tiers are exactly 500 MB, 1, 2, 3 and 5 GB and match the database seed', () => {
  assert.deepEqual(DATA_TIERS.map((t) => t.label), ['500 MB', '1 GB', '2 GB', '3 GB', '5 GB'])
  const sql = read('../supabase/migrations/20261018000000_data_allocation.sql')
  for (const t of DATA_TIERS) {
    assert.match(sql, new RegExp(`'${t.code}',\\s*'${t.label}',\\s*${t.bytes}`), `${t.code} seed`)
  }
  assert.equal(tierBytes('gb5'), 5 * GB)
  assert.equal(tierBytes('nope'), 0)
})

test('formatBytes and sizeToBytes agree and reject nonsense', () => {
  assert.equal(formatBytes(0), '0 MB')
  assert.equal(formatBytes(500 * MB), '500 MB')
  assert.equal(formatBytes(1.5 * GB), '1.5 GB')
  assert.equal(formatBytes(1500 * GB), '1.46 TB')
  assert.equal(formatBytes(2 * TB), '2 TB')
  assert.equal(formatBytes(-GB), '-1 GB')
  assert.equal(sizeToBytes('1500', 'GB'), 1500 * GB)
  assert.equal(sizeToBytes('1.5', 'TB'), 1.5 * TB)
  assert.equal(sizeToBytes('1,500', 'GB'), 1500 * GB)
  assert.equal(sizeToBytes('250', 'MB'), 250 * MB)
  for (const bad of ['', 'abc', '0', '-5', 'NaN', 'Infinity']) assert.equal(sizeToBytes(bad, 'GB'), null, bad)
})

test('usage levels and percentages', () => {
  assert.equal(usagePercent(50, 100), 50)
  assert.equal(usagePercent(500, 100), 100)
  assert.equal(usagePercent(0, 0), 0)
  assert.equal(usageLevel(0, 0), 'none')
  assert.equal(usageLevel(10, 100), 'ok')
  assert.equal(usageLevel(80, 100), 'warn')
  assert.equal(usageLevel(100, 100), 'out')
  assert.equal(formatDuration(3700), '1h 1m')
  assert.equal(formatDuration(90), '1m')
})

test('gateway state and pool banner', () => {
  const now = Date.parse('2026-10-18T12:00:00Z')
  assert.equal(gatewayState(null, now), 'never')
  assert.equal(gatewayState('2026-10-18T11:50:00Z', now), 'live')
  assert.equal(gatewayState('2026-10-18T10:00:00Z', now), 'quiet')
  const base = { purchased_bytes: 100, remaining_bytes: 50, pool_low: false, pool_exhausted: false, low_pool_percent: 15, runway_days_commitment: 9 }
  assert.equal(poolBanner(null), null)
  assert.equal(poolBanner({ ...base, purchased_bytes: 0 }), null)
  assert.equal(poolBanner(base), null)
  assert.equal(poolBanner({ ...base, pool_low: true }).tone, 'warning')
  assert.equal(poolBanner({ ...base, pool_exhausted: true, pool_low: true }).tone, 'danger')
})

test('filtering, commitment and csv', () => {
  const row = (id, name, tier, status = 'active', dept = 'Ops') => ({
    employee_id: id, full_name: name, email: `${name.toLowerCase()}@x.test`, department: dept,
    tier_code: tier, plan_status: tier ? status : null, daily_bytes: tierBytes(tier), allowance_bytes: tierBytes(tier),
    used_bytes: 0, last_seen: null, has_credential: false,
  })
  const rows = [row('1', 'Ada', 'gb1'), row('2', 'Bola', 'gb5'), row('3', 'Chi', null), row('4', 'Dayo', 'gb2', 'suspended')]
  assert.equal(filterUsers(rows, 'ada', 'all').length, 1)
  assert.equal(filterUsers(rows, '', 'none').map((r) => r.full_name).join(), 'Chi')
  assert.equal(filterUsers(rows, '', 'gb5').length, 1)
  assert.equal(filterUsers(rows, 'ops', 'all').length, 4)
  // suspended people do not count towards the commitment
  assert.equal(commitmentFor(rows), 6 * GB)
  assert.equal(commitmentFor(rows, { 3: 'gb3', 2: null }), 4 * GB)
  assert.equal(csvEscape('a,b'), '"a,b"')
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""')
  assert.match(usageCsv(rows), /^Name,Email,Department,Plan,Status,Allowance today,Used today,Remaining today\nAda,ada@x\.test,Ops,1 GB,active/)
})

// ---- the Edge Function core -------------------------------------------------------------------

const fr = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { type: 'string', value: [v] }]))
const SECRET = 's3cret-value'

function harness(rpcImpl) {
  const calls = []
  const rpc = async (name, args) => { calls.push([name, args]); return rpcImpl(name, args) }
  const call = (path, body, extra = {}) =>
    handleRadius({ method: 'POST', path: `/functions/v1/data-radius/${path}`, secretHeader: SECRET, body, ...extra }, { rpc, secret: SECRET, log: () => {} })
  return { calls, call, rpc }
}

test('readAttributes understands the FreeRADIUS JSON shape and plain JSON', () => {
  assert.deepEqual(readAttributes({ 'User-Name': { type: 'string', value: ['ada@x.test'] }, 'NAS-Port': { type: 'integer', value: [0] } }),
    { 'user-name': 'ada@x.test', 'nas-port': '0' })
  assert.deepEqual(readAttributes({ 'User-Name': 'ada' }), { 'user-name': 'ada' })
  assert.deepEqual(readAttributes(null), {})
  assert.deepEqual(readAttributes([1, 2]), {})
})

test('the shared secret is mandatory, compared safely, and fails closed when unset', async () => {
  const { call } = harness(async () => ({ data: {}, error: null }))
  assert.equal((await call('health', null, { method: 'GET', secretHeader: null })).status, 401)
  assert.equal((await call('health', null, { method: 'GET', secretHeader: 'wrong' })).status, 401)
  assert.equal((await call('health', null, { method: 'GET' })).status, 200)
  const none = await handleRadius({ method: 'GET', path: '/health', secretHeader: 'anything', body: null }, { rpc: async () => ({ data: null, error: null }), secret: undefined, log: () => {} })
  assert.equal(none.status, 503)
  assert.equal(constantTimeEqual('abc', 'abc'), true)
  assert.equal(constantTimeEqual('abc', 'abd'), false)
  assert.equal(constantTimeEqual('abc', 'abcd'), false)
})

test('authenticate: accept carries the limits, reject carries a clear message, database trouble fails closed', async () => {
  const ok = harness(async () => ({ data: { ok: true, remaining_bytes: 5 * GB + 123, session_timeout: 5000 }, error: null }))
  const accepted = await ok.call('authenticate', fr({ 'User-Name': 'Ada@x.test', 'User-Password': 'pw' }), { query: { vendor: 'mikrotik', interim: '60' } })
  assert.equal(accepted.status, 200)
  assert.deepEqual(accepted.body['reply:Session-Timeout'], { value: [5000], op: ':=' })
  assert.deepEqual(accepted.body['reply:Mikrotik-Total-Limit'].value, [(5 * GB + 123) % 4294967296])
  assert.deepEqual(accepted.body['reply:Mikrotik-Total-Limit-Gigawords'].value, [Math.floor((5 * GB + 123) / 4294967296)])
  assert.deepEqual(ok.calls[0], ['radius_verify', { p_username: 'Ada@x.test', p_password: 'pw' }])

  const generic = await ok.call('authenticate', fr({ 'User-Name': 'a', 'User-Password': 'b' }))
  assert.equal(generic.body['reply:Mikrotik-Total-Limit'], undefined)

  const quota = harness(async () => ({ data: { ok: false, reason: 'quota_exhausted' }, error: null }))
  const refused = await quota.call('authenticate', fr({ 'User-Name': 'a', 'User-Password': 'b' }))
  assert.equal(refused.status, 401)
  assert.match(refused.body['reply:Reply-Message'], /resets at midnight/)

  const wrong = harness(async () => ({ data: { ok: false, reason: 'bad_password' }, error: null }))
  assert.equal((await wrong.call('authenticate', fr({ 'User-Name': 'a', 'User-Password': 'b' }))).body['reply:Reply-Message'], 'Access denied')

  const down = harness(async () => ({ data: null, error: { message: 'connection refused' } }))
  assert.equal((await down.call('authenticate', fr({ 'User-Name': 'a', 'User-Password': 'b' }))).status, 503)

  const empty = harness(async () => ({ data: {}, error: null }))
  assert.equal((await empty.call('authenticate', fr({ 'User-Name': 'a' }))).status, 401)
  assert.equal(empty.calls.length, 0, 'no database call without a password')
})

test('authReply splits big limits into the 32 bit field plus Gigawords', () => {
  const r = authReply({ remaining_bytes: 3 * 4294967296 + 7, session_timeout: 10 }, 'mikrotik', 60)
  assert.equal(r['reply:Mikrotik-Total-Limit'].value[0], 7)
  assert.equal(r['reply:Mikrotik-Total-Limit-Gigawords'].value[0], 3)
  assert.equal(r['reply:Session-Timeout'].value[0], 60, 'never below 60 seconds')
})

test('accounting: status names and numbers, gigawords, junk, and retry on database failure', async () => {
  const h = harness(async () => ({ data: { ok: true }, error: null }))
  const res = await h.call('accounting', {
    'User-Name': { type: 'string', value: ['ada@x.test'] }, 'Acct-Status-Type': { type: 'integer', value: ['Interim-Update'] },
    'Acct-Session-Id': { type: 'string', value: ['abc'] }, 'NAS-IP-Address': { type: 'ipaddr', value: ['10.0.0.1'] },
    'Acct-Input-Octets': { type: 'integer', value: [4000000000] }, 'Acct-Input-Gigawords': { type: 'integer', value: [1] },
    'Acct-Output-Octets': { type: 'integer', value: [10] },
  })
  assert.equal(res.status, 204)
  assert.equal(h.calls[0][1].p_input_octets, 4294967296 + 4000000000)
  assert.equal(h.calls[0][1].p_output_octets, 10)
  assert.equal(h.calls[0][1].p_status, 'Interim-Update')

  const byNumber = harness(async () => ({ data: { ok: true }, error: null }))
  await byNumber.call('accounting', fr({ 'User-Name': 'a', 'Acct-Status-Type': '2', 'Acct-Session-Id': 's' }))
  assert.equal(byNumber.calls[0][1].p_status, 'Stop')

  const junk = harness(async () => ({ data: {}, error: null }))
  assert.equal((await junk.call('accounting', fr({ 'Acct-Status-Type': 'Accounting-Failed' }))).status, 204)
  assert.equal((await junk.call('accounting', fr({ 'User-Name': 'a', 'Acct-Status-Type': 'Start', 'Acct-Input-Octets': '-5' }))).status, 204)
  assert.equal((await junk.call('accounting', fr({ 'User-Name': 'a', 'Acct-Status-Type': 'Start', 'Acct-Input-Octets': '99999999999' }))).status, 204)
  assert.equal(junk.calls.length, 0, 'bad counters are acknowledged but never charged')

  const down = harness(async () => ({ data: null, error: { message: 'boom' } }))
  const failed = await down.call('accounting', fr({ 'User-Name': 'a', 'Acct-Status-Type': 'Interim-Update', 'Acct-Session-Id': 's' }))
  assert.equal(failed.status, 503, '5xx makes the gateway resend instead of losing usage')
})

test('over-quota list and routing', async () => {
  const h = harness(async (name) => name === 'radius_over_quota' ? { data: [{ session_id: 's1' }], error: null } : { data: 0, error: null })
  const res = await h.call('over-quota', null, { method: 'GET' })
  assert.deepEqual(res.body, { sessions: [{ session_id: 's1' }] })
  assert.equal(h.calls[0][0], 'radius_close_stale_sessions')
  assert.equal((await h.call('nothing', {})).status, 404)
  assert.equal((await h.call('authenticate', null, { method: 'DELETE' })).status, 405)
})

// ---- static contracts --------------------------------------------------------------------------------

test('migration: RLS on every table, credentials unreadable, RADIUS functions service_role only', () => {
  const sql = read('../supabase/migrations/20261018000000_data_allocation.sql')
  const tables = [...sql.matchAll(/create table if not exists public\.(data_\w+)/g)].map((m) => m[1])
  assert.equal(tables.length, 9)
  for (const t of tables) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), t)
  assert.doesNotMatch(sql, /create policy[^;]*on public\.data_credentials/, 'no policy on credentials')
  for (const fn of ['radius_verify', 'radius_account', 'radius_over_quota', 'radius_close_stale_sessions']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`), fn)
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`), fn)
  }
  for (const fn of sql.match(/create or replace function public\.\w+/g)) {
    // every definition pins its search_path
    const body = sql.slice(sql.indexOf(fn), sql.indexOf(fn) + 1200)
    assert.match(body, /set search_path/, fn)
  }
  assert.match(sql, /crypt\(v_password, gen_salt\('bf', 10\)\)/)
})

test('function is public (no JWT) and protected by the shared secret', () => {
  assert.match(read('../supabase/config.toml'), /\[functions\.data-radius\]\s+enabled = true\s+verify_jwt = false/)
  assert.match(read('../supabase/functions/data-radius/index.ts'), /DATA_RADIUS_SECRET/)
  assert.doesNotMatch(read('../supabase/functions/data-radius/index.ts'), /Access-Control-Allow-Origin/)
})

test('FreeRADIUS files: control-list header, updated mapped to ok, no secrets committed', () => {
  const site = read('../ops/freeradius/sites-available/ra-data')
  assert.match(site, /update control \{[^}]*REST-HTTP-Header/s)
  assert.doesNotMatch(site, /update request \{[^}]*REST-HTTP-Header/s)
  assert.match(site, /if \(updated\) \{\s*ok\s*\}/)
  const example = read('../ops/freeradius/ra-data.secret.conf.example')
  assert.match(example, /PASTE_THE_SAME_VALUE/)
  assert.doesNotMatch(read('../ops/freeradius/ra-data-enforcer.sh'), /radclient[^\n]*\$SECRET/, 'admin secret never on a command line')
  assert.match(read('../ops/freeradius/install.sh'), /rm -f "\$FR_DIR\/mods-enabled\/eap"/)
})

test('Administration wiring: tab, card, dashboard card, stylesheet', () => {
  const admin = read('../src/modules/AdministrationControlPlane.tsx')
  assert.match(admin, /\| 'data'/)
  assert.match(admin, /\['data','Data Allocation',Wifi\]/)
  assert.match(admin, /tab==='data'&&<AdminDataAllocation\/>/)
  assert.match(admin, /onOpenTab\('data'\)/)
  assert.match(read('../src/modules/PersonalDashboard.tsx'), /<MyDataCard\/>/)
  assert.ok(existsSync(new URL('../src/data-allocation.css', import.meta.url)))
  const css = read('../src/data-allocation.css')
  assert.match(css, /var\(--ra-text/)
  assert.doesNotMatch(css, /#fff\b[^;]*;[^}]*color:#fff/, 'no hard coded white on white')
})

test('PArAsYtE crest: assets, splash and base bar mounted for every screen', () => {
  for (const f of ['parasyte-crest.png', 'parasyte-mark.png']) assert.ok(existsSync(new URL(`../public/${f}`, import.meta.url)), f)
  const app = read('../src/InternalApp.tsx')
  assert.match(app, /<ParasyteCrestBar\/><ParasyteSplash\/>/)
  assert.match(app, /parasyte-crest\.css/)
  const comp = read('../src/components/ParasyteCrest.tsx')
  assert.match(comp, /Major controller and engineering/)
  assert.match(comp, /href=\{PARASYTE_URL\}/)
  assert.match(comp, /PARASYTE_URL = 'https:\/\/www\.parasyte\.cloud'/)
  assert.match(comp, /rel="noopener noreferrer"/)
  assert.doesNotMatch(comp, /parasyteCrestCredit/)
  const css = read('../src/parasyte-crest.css')
  assert.match(css, /pointer-events:none/)
  assert.match(css, /\.parasyteSignature\{[^}]*pointer-events:auto/)
  assert.match(css, /@keyframes psSwell/)
  assert.match(css, /prefers-reduced-motion/)
})

test('PArAsYtE crest also on ROOM 7, public forms and the navbars', () => {
  assert.match(read('../src/room7-public/ExternalRoom7App.tsx'), /<ParasyteCrestBar\/>/)
  assert.match(read('../src/forms-public/FormsApp.tsx'), /<ParasyteCrestBar \/>/)
  assert.match(read('../src/App.tsx'), /<div className="brand"><BrandLogo className="sidebarLogo"\/>/, 'sidebar keeps the RideArrivo logo')
  assert.match(read('../src/room7-public/Room7TopIsland.tsx'), /src="\/parasyte-mark\.png" alt="PArAsYtE"/, 'ROOM 7 shows only the P mark')
})

test('no em dash anywhere in what was added', () => {
  const files = [
    '../docs/data-allocation.md', '../src/modules/AdminDataAllocation.tsx', '../src/components/MyDataCard.tsx',
    '../src/components/ParasyteCrest.tsx', '../src/lib/dataAllocation.ts', '../src/lib/dataAllocationModel.ts',
    '../src/data-allocation.css', '../src/parasyte-crest.css', '../supabase/migrations/20261018000000_data_allocation.sql',
    '../supabase/checks/data-allocation.sql', '../supabase/functions/data-radius/index.ts', '../supabase/functions/_shared/dataRadiusCore.ts',
    ...readdirSync(new URL('../ops/freeradius/', import.meta.url), { recursive: true }).filter((f) => !f.endsWith('/') && !/^(mods-available|sites-available)$/.test(f)).map((f) => `../ops/freeradius/${f}`),
  ]
  for (const f of files) {
    let text
    try { text = read(f) } catch { continue }
    assert.ok(!text.includes('—'), `${f} contains an em dash`)
  }
})
