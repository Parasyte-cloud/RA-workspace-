import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('the migration ends calls nobody is on, and clears them before a new call is judged busy', () => {
  const sql = read('supabase/migrations/20261018120000_call_heartbeat.sql')
  assert.match(sql, /add column if not exists heartbeat_at/)
  assert.match(sql, /function public\.chat_call_heartbeat/)
  assert.match(sql, /function public\.end_stale_calls_for/)
  assert.match(sql, /heartbeat_at < now\(\) - interval '60 seconds'/)
  // Older apps never send a heartbeat, so they keep the 4 hour rule.
  assert.match(sql, /heartbeat_at is null and coalesce\(answered_at, created_at\) < now\(\) - interval '4 hours'/)
  assert.match(sql, /perform public\.end_stale_calls_for\(other\)/)
  assert.match(sql, /perform public\.end_stale_calls_for\(me\)/)
  assert.match(sql, /revoke all on function public\.end_stale_calls_for\(uuid\) from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.chat_call_heartbeat\(uuid\) to authenticated/)
})

test('the app heartbeats, hangs up on close, and ends when the other person disappears', () => {
  const mod = read('src/modules/CallModule.tsx')
  assert.match(mod, /chat_call_heartbeat/)
  assert.match(mod, /15_000/)
  assert.match(mod, /pagehide/)
  assert.match(mod, /keepalive: true/)
  const stage = read('src/modules/FaceTimeStage.tsx')
  assert.match(stage, /onRemoteGone/)
  assert.match(stage, /hadRemote/)
  assert.match(read('src/modules/RoomMeeting.tsx'), /onRemoteGone=\{hangUp\}/)
})

test('a call left behind is ended by the app itself, with or without the SQL', () => {
  const lib = read('src/lib/callCleanup.ts')
  assert.match(lib, /status', 'accepted'/)
  assert.match(lib, /respond_chat_call/)
  assert.match(lib, /getActiveCallId/)
  const ringer = read('src/modules/CallRinger.tsx')
  assert.match(ringer, /endStaleCalls\(client, id\)/)
  assert.match(ringer, /visibilitychange', onShow/)
  const mod = read('src/modules/CallModule.tsx')
  assert.match(mod, /setActiveCallId\(detail\.callId\)/)
  const chat = read('src/chat/ChatShell.tsx')
  assert.match(chat, /End call/)
  assert.match(chat, /endStaleCalls\(client,userId\)/)
})

test('endStaleCalls ends only calls nothing is carrying (behaviour)', async () => {
  const { buildSync } = await import('esbuild')
  const out = buildSync({ entryPoints: ['src/lib/callCleanup.ts'], bundle: true, format: 'esm', write: false, platform: 'node' })
  const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
  const act = await import('data:text/javascript;base64,' + Buffer.from(buildSync({ entryPoints: ['src/lib/activeCall.ts'], bundle: true, format: 'esm', write: false }).outputFiles[0].text).toString('base64'))
  const ended = []
  const make = (rows, failWide) => ({
    from: () => {
      const q = { select: cols => { q.cols = cols; return q }, eq: () => q, or: () => q,
        then: res => res(failWide && q.cols.includes('heartbeat_at') ? { data: null, error: { message: 'no column' } } : { data: rows, error: null }) }
      return q
    },
    rpc: async (name, args) => { ended.push(args.p_call); return { error: null } }
  })
  const fresh = new Date(Date.now() - 5000).toISOString()
  const old = new Date(Date.now() - 600000).toISOString()
  const n = await mod.endStaleCalls(make([{ id: 'a', heartbeat_at: old }, { id: 'b', heartbeat_at: fresh }, { id: 'c' }]), 'me')
  assert.equal(n, 2)
  assert.deepEqual(ended.splice(0), ['a', 'c'])
  // Before the SQL is run the heartbeat column does not exist: still works.
  assert.equal(await mod.endStaleCalls(make([{ id: 'x' }], true), 'me'), 1)
  assert.deepEqual(ended.splice(0), ['x'])
})
