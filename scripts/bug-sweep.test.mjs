// Regression tests for the 2026-10-16 critical bug sweep.
// Source-level contracts plus the one piece of logic that runs outside a
// database (the shared ROOM 7 passcode limiter). The SQL behaviour is covered
// by supabase/checks/bug-sweep-behaviour.sql.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { execFileSync } from 'node:child_process'

const read = p => readFileSync(p, 'utf8')
const sql = read('supabase/migrations/20261016320000_bug_sweep_fixes.sql')

test('RA-002/003: ROOM 7 chat helper needs an active employee inside the room', () => {
  const helper = sql.slice(sql.indexOf('function public.can_use_room_chat'), sql.indexOf('create or replace function public.delete_room_message'))
  assert.match(helper, /me\.active = true/)
  assert.doesNotMatch(helper, /role = 'admin'/, 'admins must not read a room they are not in')
  assert.match(sql, /e\.role = 'admin' and e\.active = true/)
})

test('RA-004: every public passcode path uses the shared limiter', () => {
  const lim = read('supabase/functions/_shared/room7Limit.ts')
  assert.match(lim, /fl:\$\{ip\}:\$\{roomId\}/)
  for (const f of ['room-event-documents', 'room-event-engagement']) {
    const src = read(`supabase/functions/${f}/index.ts`)
    assert.match(src, /guardPasscodeAttempt/, f)
  }
  assert.equal((read('supabase/functions/room-event-engagement/index.ts').match(/guardPasscodeAttempt\(/g) || []).length, 2)
  assert.equal((read('supabase/functions/room-event-documents/index.ts').match(/guardPasscodeAttempt\(/g) || []).length, 2)
})

test('RA-004: the limiter blocks after 15 wrong guesses and counts only 401/403', async () => {
  const js = transformSync(read('supabase/functions/_shared/room7Limit.ts'), { loader: 'ts', format: 'esm' }).code
  const L = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
  const hits = new Map()
  const admin = {
    rpc: async (_n, a) => {
      const cur = hits.get(a.p_key) || 0
      if (a.p_increment) hits.set(a.p_key, cur + 1)
      return { data: a.p_increment ? cur + 1 : cur, error: null }
    },
  }
  const req = new Request('https://x', { headers: { 'cf-connecting-ip': '1.2.3.4' } })
  const wrong = () => Promise.reject(Object.assign(new Error('no'), { status: 403 }))
  const tooMany = () => Object.assign(new Error('429'), { status: 429 })
  for (let i = 0; i < 15; i++) {
    await assert.rejects(L.guardPasscodeAttempt(admin, req, 'room1', wrong, tooMany), /no/)
  }
  await assert.rejects(L.guardPasscodeAttempt(admin, req, 'room1', async () => 'ok', tooMany), /429/)
  // a different room and a different address are unaffected
  assert.equal(await L.guardPasscodeAttempt(admin, req, 'room2', async () => 'ok', tooMany), 'ok')
  const other = new Request('https://x', { headers: { 'cf-connecting-ip': '9.9.9.9' } })
  assert.equal(await L.guardPasscodeAttempt(admin, other, 'room1', async () => 'ok', tooMany), 'ok')
  // server errors are not guesses
  const before = [...hits.values()].reduce((a, b) => a + b, 0)
  await assert.rejects(L.guardPasscodeAttempt(admin, other, 'room9', () => Promise.reject(Object.assign(new Error('boom'), { status: 500 })), tooMany), /boom/)
  assert.equal([...hits.values()].reduce((a, b) => a + b, 0), before)
  // a limiter outage never locks guests out
  const down = { rpc: async () => ({ data: null, error: { message: 'down' } }) }
  assert.equal(await L.guardPasscodeAttempt(down, req, 'room1', async () => 'ok', tooMany), 'ok')
})

test('RA-005: investor endpoint has a size cap and network/global limits', () => {
  const src = read('supabase/functions/ridearrivo-public-forms/index.ts')
  assert.match(src, /MAX_BODY_BYTES/)
  assert.match(src, /413/)
  assert.match(src, /inv:\$\{ipKey\}/)
  assert.match(src, /"inv:all"/)
  assert.doesNotMatch(src, /await req\.json\(\)/)
})

test('RA-006: obsolete cron auth is rewritten only when still present', () => {
  assert.match(sql, /command like '%service_role_key%'/)
  assert.match(sql, /cron_dispatch_secret/)
  assert.match(sql, /notifications-email-dispatch/)
  assert.match(sql, /ridearrivo-bookings-poll/)
})

test('RA-007/008: chat views read the newest page, not the oldest', () => {
  const files = {
    'src/modules/DepartmentDiscussionPanel.tsx': 500,
    'src/modules/MarketingTeamWorkspace.tsx': 150,
    'src/modules/SharedWorkspacesHub.tsx': 300,
    'src/modules/SupportWhatsAppPanel.tsx': 500,
  }
  for (const [f, n] of Object.entries(files)) {
    const src = read(f).replace(/\s+/g, '')
    assert.ok(src.includes(`{ascending:false})`) || src.includes(`ascending:false}).limit(${n})`) || /ascending:false\}\)\.limit\(/.test(src), f)
    assert.ok(!new RegExp(`ascending:true\\}\\)\\.limit\\(${n}\\)`).test(src), `${f} still reads the oldest ${n}`)
    assert.match(read(f), /\.reverse\(\)/, f)
  }
  const wa = read('src/modules/SupportWhatsAppPanel.tsx')
  assert.match(wa, /order\('last_message_at',\{ascending:false,nullsFirst:false\}\)/)
})

test('RA-009: unread count and mark-all do not depend on the 30 loaded rows', () => {
  const src = read('src/context/NotificationsContext.tsx')
  assert.match(src, /count:'exact',head:true/)
  assert.match(src, /\.is\('read_at',null\)\s*\n?\s*$|\.update\(\{read_at:now\}\)\s*\n\s*\.is\('read_at',null\)/m)
  assert.doesNotMatch(src, /\.in\('id',unreadIds\)/)
})

test('RA-010: download approvals filter by status before the limit', () => {
  const src = read('src/modules/AdminDownloadAccessManager.tsx')
  assert.match(src, /query\.eq\('status',filter\)/)
})

test('RA-011: investor list is paged with a cursor', () => {
  const src = read('supabase/functions/ridearrivo-public-forms/index.ts')
  assert.match(src, /next_before/)
  assert.match(src, /\.lt\(\s*"last_submitted_at"/)
})

test('RA-012: busy callee gets NULL and a missed call', () => {
  assert.match(sql, /return null;/)
  assert.match(sql, /'You were on another call'/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(read('src/chat/ChatShell.tsx'), /is on another call/)
})

test('RA-013/014: ROOM 7 end is database first; preset is re-asserted on rejoin', () => {
  const src = read('supabase/functions/room-session/index.ts')
  const end = src.slice(src.indexOf('if (action === "end")'))
  assert.ok(end.indexOf('.update({ status: "ended"') < end.indexOf('deactivateMeeting('), 'DB update must precede provider close')
  assert.match(end, /provider_closed/)
  assert.doesNotMatch(src, /if \(profile\.role === "admin" && role !== "host"\) \{\s*await setParticipantPreset/)
})

test('RA-015: mail polling rotates through subscribers', () => {
  const src = read('supabase/functions/mail-notify-poll/index.ts')
  assert.match(src, /mail_poll_cursor/)
  assert.match(src, /\.sort\(\(a, b\) => \(lastPolled/)
  assert.match(sql, /create table if not exists public\.mail_poll_cursor/)
})

test('RA-016: forwarded files must match the original size and hash', () => {
  assert.match(sql, /The file does not match the original/)
  assert.match(sql, /'eTag'/)
})

test('RA-017: a failed shell start releases the active marker', () => {
  const src = read('gateway/src/container.ts')
  const open = src.slice(src.indexOf('async openShell('))
  assert.match(open, /try\{\s*execution=await container\.exec/)
  assert.ok((open.match(/activeShellUsers\.delete\(userId\)/g) || []).length >= 3)
})

test('RA-001/023: CI runs the Supabase suites', () => {
  const ci = read('.github/workflows/ci.yml')
  assert.match(ci, /npm run test:supabase/)
  assert.match(ci, /supabase start/)
  assert.doesNotMatch(read('scripts/run-tests.mjs'), /Two suites are skipped/)
})

test('RA-018/020/024: customer hosts get CSP, their own manifest, and the intranet gets noindex', () => {
  const h = read('public/_headers')
  for (const host of ['bookings', 'membership', 'move', 'easybook', 'boat', 'air']) {
    assert.match(h, new RegExp(`https://${host}\\.ridearrivo\\.com/\\*\\n  Content-Security-Policy: script-src`))
    assert.ok(existsSync(`public/service-${host}.webmanifest`))
    const m = JSON.parse(read(`public/service-${host}.webmanifest`))
    assert.ok(!m.shortcuts, 'no internal shortcuts on a customer manifest')
    assert.doesNotMatch(m.name, /Workspace/)
  }
  assert.match(h, /X-Robots-Tag: noindex/)
  assert.match(read('index.html'), /service-host\.js/)
})

test('RA-021: legal contracts and compliance are legal/admin only', () => {
  assert.match(sql, /on public\.legal_contracts\s+for select to authenticated\s+using \(public\.has_workspace_role\(array\['legal', 'admin'\]\)\)/)
  assert.match(sql, /on public\.compliance_items\s+for select to authenticated\s+using \(public\.has_workspace_role\(array\['legal', 'admin'\]\)\)/)
})

test('RA-025: the repository bundle is no longer tracked', () => {
  const tracked = execFileSync('git', ['ls-files', 'audit-fixes.bundle'], { encoding: 'utf8' }).trim()
  assert.equal(tracked, '')
})
