import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const load = async path => {
  const js = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const A = await load('src/lib/room7Admission.ts')
const read = p => readFileSync(p, 'utf8')

const sql = read('supabase/migrations/20261012240000_room7_admission_and_limits.sql')
const guestFn = read('supabase/functions/room-guest-session/index.ts')
const controlFn = read('supabase/functions/room-event-control/index.ts')
const sessionFn = read('supabase/functions/room-session/index.ts')
const guestApp = read('src/room7-public/ExternalRoom7App.tsx')
const panel = read('src/modules/GuestAdmissionPanel.tsx')
const roomModule = read('src/modules/RoomModule.tsx')

test('request keys are 32 hex characters and different each time', () => {
  const a = A.makeRequestKey()
  const b = A.makeRequestKey()
  assert.match(a, /^[0-9a-f]{32}$/)
  assert.notEqual(a, b)
  assert.equal(A.makeRequestKey(() => new Uint8Array(16)), '0'.repeat(32))
})

test('the guest page enters only on approval and stops on refusal', () => {
  assert.equal(A.admissionAction('approved'), 'enter')
  assert.equal(A.admissionAction('denied'), 'refused')
  assert.equal(A.admissionAction('pending'), 'keep_waiting')
  assert.equal(A.admissionAction('none'), 'keep_waiting')
  assert.equal(A.admissionAction(undefined), 'keep_waiting')
})

test('the migration is additive, locked down, and safe to run twice', () => {
  assert.match(sql, /add column if not exists admission text not null default 'auto'/)
  assert.match(sql, /add column if not exists auto_open boolean not null default true/)
  assert.match(sql, /create table if not exists public\.room7_join_requests/)
  assert.match(sql, /unique \(room_id, key_hash\)/)
  assert.match(sql, /create table if not exists public\.room7_rate_limits/)
  for (const table of ['room7_join_requests', 'room7_rate_limits']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`))
  }
  assert.match(sql, /grant execute on function public\.room7_rate_count\(text, integer, boolean\) to service_role/)
  assert.match(sql, /revoke all on function public\.room7_rate_count\(text, integer, boolean\) from public, anon, authenticated/)
  assert.ok(!/drop table|truncate|delete from public\.room7_(external|guest)/i.test(sql))
  assert.ok(!sql.includes('—'))
})

test('guest function limits attempts, counts only wrong passcodes, and fails open', () => {
  assert.match(guestFn, /room7_rate_count/)
  assert.match(guestFn, /status: 429|HttpError\(\s*429/)
  assert.match(guestFn, /rateCount\(admin, failKey, 600, true\)/)
  assert.match(guestFn, /rateCount\(admin, failKey, 600, false\)\) >= 15/)
  // limiter outage returns 0 hits instead of blocking guests
  assert.match(guestFn, /rate limiter unavailable[\s\S]{0,80}return 0/)
})

test('guest function never lets a guest in before approval when the host asked for it', () => {
  const approval = guestFn.indexOf('admissionDecision(\n          admin,\n          resolved.room.id,\n          body,\n          {')
  const media = guestFn.indexOf('const media =\n      getMediaConfig()')
  assert.ok(approval > 0 && media > approval, 'approval check runs before any media token is issued')
  assert.match(guestFn, /waiting: true/)
  assert.match(guestFn, /decision === "denied"/)
  // invited guests were chosen by the host already
  assert.match(guestFn, /access\.source !== "invitation"/)
  // approval is tied to the browser key, and expires
  assert.match(guestFn, /sha256Hex\(key\)/)
  assert.match(guestFn, /ADMISSION_VALID_MS = 12 \* 60 \* 60 \* 1000/)
  // the new column is read apart, so events work before the migration runs
  assert.match(guestFn, /loadGuestSettings[\s\S]{0,400}admission: "auto"/)
})

test('event control can list and decide requests, with the same authority as the rest', () => {
  assert.match(controlFn, /action === "join_requests"/)
  assert.match(controlFn, /action === "decide_request"/)
  const authority = controlFn.indexOf('assertControlAuthority(\n        room,\n        profile,\n      )')
  const list = controlFn.indexOf('action === "join_requests"')
  assert.ok(authority > 0 && list > authority, 'authority is asserted before requests are listed or decided')
  assert.match(controlFn, /decision !== "admit" && decision !== "deny"/)
  assert.match(controlFn, /Invalid ROOM 7 admission setting/)
  assert.match(controlFn, /Run the ROOM 7 admission SQL migration/)
})

test('auto-open only opens an already public event for its own host and never reopens an ended one', () => {
  const fn = sessionFn.slice(sessionFn.indexOf('async function openDoorsForHost'), sessionFn.indexOf('serve(async req'))
  assert.match(fn, /public_enabled !== true\) return/)
  assert.match(fn, /auto_open === false\) return/)
  assert.match(fn, /\["draft", "pre_event", "doors_open"\]\.includes/)
  assert.ok(!/ended|replay/.test(fn.replace(/scheduled_end/g, '')), 'ended and replay are never touched')
  assert.match(fn, /Date\.now\(\) >= endMs\) return/)
  assert.match(sessionFn, /role === "host" \|\| profile\.role === "admin" \|\| profile\.role === "manager"[\s\S]{0,80}openDoorsForHost/)
})

test('guest page shows a waiting screen, polls status, and sends its request key', () => {
  assert.match(guestApp, /request_key:\s*requestKey/)
  assert.match(guestApp, /action: 'status'/)
  assert.match(guestApp, /Waiting for the host to let you in/)
  assert.match(guestApp, /response\.waiting/)
  assert.match(guestApp, /POLL_WAITING_MS/)
})

test('host sees waiting guests above the call and can admit, deny, or admit all', () => {
  assert.match(panel, /createPortal/)
  assert.match(panel, /action: 'join_requests'/)
  assert.match(panel, /action: 'decide_request'/)
  assert.match(panel, /Admit all/)
  assert.match(roomModule, /<GuestAdmissionPanel/)
  assert.match(roomModule, /Approve each guest before they enter/)
})

test('no em dash in anything added for this feature', () => {
  for (const file of [sql, panel, read('src/lib/room7Admission.ts')]) assert.ok(!file.includes('—'))
})
