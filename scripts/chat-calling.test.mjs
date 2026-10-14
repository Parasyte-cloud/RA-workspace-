import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012120000_chat_calling.sql', 'utf8')
const chat = readFileSync('src/chat/ChatShell.tsx', 'utf8')
const ringer = readFileSync('src/modules/CallRinger.tsx', 'utf8')
const room = readFileSync('src/modules/RoomModule.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')

test('only an admin writes calling access, and clients cannot write calls directly', () => {
  assert.match(sql, /"calling access admin write"[\s\S]*current_workspace_role\(\) = 'admin'/)
  assert.match(sql, /revoke insert, update, delete on public\.chat_calls from authenticated/)
})

test('starting a call needs access, a direct chat and a room the caller created', () => {
  assert.match(sql, /not public\.has_calling_access\(\)/)
  assert.match(sql, /Calls can only be started inside your own direct chats/)
  assert.match(sql, /r\.created_by = me and r\.status = 'active'/)
})

test('only the callee answers and only the caller cancels', () => {
  assert.match(sql, /Only the person being called can do that/)
  assert.match(sql, /Only the caller can do that/)
  assert.match(sql, /interval '90 seconds'/)
})

test('functions are not callable by anon', () => {
  for (const f of ['has_calling_access()', 'start_chat_call(uuid, text, text)', 'respond_chat_call(uuid, text)']) {
    assert.ok(sql.includes(`revoke all on function public.${f} from public, anon`), f)
  }
})

test('chat falls back to the ask-Admin message without access', () => {
  assert.match(chat, /Reach out to Admin to give you access/)
  assert.match(chat, /has_calling_access/)
})

test('ringer, room listener and audio-only wiring exist', () => {
  assert.match(ringer, /respond_chat_call/)
  assert.match(room, /JOIN_ROOM_EVENT/)
  assert.match(room, /audioOnly=\{audioOnly\}/)
  assert.match(app, /<CallRinger\/>/)
})
