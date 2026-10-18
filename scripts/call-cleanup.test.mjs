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
