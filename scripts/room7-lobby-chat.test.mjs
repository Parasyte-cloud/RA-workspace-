import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cleanLobbyBody, shapeLobby, LOBBY_MAX_LENGTH } from '../supabase/functions/_shared/lobbyChat.ts'

assert.equal(cleanLobbyBody('  hello  '), 'hello')
assert.equal(cleanLobbyBody('   '), null)
assert.equal(cleanLobbyBody(42), null)
assert.equal(cleanLobbyBody('a\u0000b\u0007c'), 'abc')
assert.equal(cleanLobbyBody('x'.repeat(900)).length, LOBBY_MAX_LENGTH)
assert.equal(cleanLobbyBody('a\n\n\n\n\nb'), 'a\n\nb')

const rows = [
  { id: '2', author_kind: 'host', author_name: 'Biola', request_id: null, body: 'Welcome', created_at: '2026-10-16T10:00:02Z' },
  { id: '1', author_kind: 'guest', author_name: 'Ada', request_id: 'r1', body: 'Hi', created_at: '2026-10-16T10:00:01Z' },
  { id: '3', author_kind: 'guest', author_name: 'Tolu', request_id: 'r2', body: 'Hello', created_at: '2026-10-16T10:00:03Z' },
]
const shaped = shapeLobby(rows, 'r1')
assert.deepEqual(shaped.map(m => m.id), ['1', '2', '3'], 'oldest first')
assert.equal(shaped[0].mine, true)
assert.equal(shaped[2].mine, false)
assert.equal(shaped[1].name, 'Host', 'host staff names are never exposed to guests')
assert.ok(!('request_id' in shaped[0]), 'request ids stay on the server')
assert.equal(shapeLobby(rows, null).some(m => m.mine), false)

const guestFn = readFileSync('supabase/functions/room-guest-session/index.ts', 'utf8')
assert.match(guestFn, /lobby_chat_send/)
assert.match(guestFn, /status === "denied"/, 'denied guests cannot chat')
assert.match(guestFn, /guestSettings\.admission !== "host"/)
assert.match(guestFn, /enforceLimit\(admin, `lc:/)
const sql = readFileSync('supabase/migrations/20261016200000_room7_lobby_chat.sql', 'utf8')
assert.match(sql, /enable row level security/)
assert.match(sql, /revoke all on public\.room7_lobby_messages from public, anon, authenticated/)
console.log('room7-lobby-chat ok')
