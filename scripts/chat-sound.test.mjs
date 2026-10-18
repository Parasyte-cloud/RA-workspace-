import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const load = async (path, replace = {}) => {
  let src = readFileSync(path, 'utf8')
  for (const [a, b] of Object.entries(replace)) src = src.replace(a, b)
  const js = transformSync(src, { loader: 'ts', format: 'esm' }).code
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const S = await load('src/lib/chatSound.ts', { "import { playPatternOnce } from './ringtone'": 'const playPatternOnce = () => true' })
const P = await load('supabase/functions/_shared/pushPayload.ts')
const read = p => readFileSync(p, 'utf8')

test('defaults: sound on, buzz on, Jazz keys at 70 percent', () => {
  const p = S.normalizeChatPrefs(undefined)
  assert.deepEqual(p, { enabled: true, sound: 'keys', volume: 0.7, vibrate: true })
})
test('bad stored values fall back safely, volume is clamped', () => {
  const p = S.normalizeChatPrefs({ enabled: false, sound: 'nope', volume: 9, vibrate: false })
  assert.equal(p.enabled, false)
  assert.equal(p.sound, 'keys')
  assert.equal(p.volume, 1)
  assert.equal(S.clampChatVolume('x'), 0.7)
  assert.equal(S.clampChatVolume(0), 0.2)
})
test('every message sound is short and has tones', () => {
  assert.equal(S.CHAT_SOUNDS.length, 9)
  for (const s of S.CHAT_SOUNDS) {
    assert.ok(s.pattern.tones.length > 0)
    assert.ok(s.pattern.cycle <= 1, s.id)
  }
})
test('no sound for the chat you are reading, sound for others or when hidden', () => {
  assert.equal(S.shouldChatSound('a', 'a', true), false)
  assert.equal(S.shouldChatSound('a', 'b', true), true)
  assert.equal(S.shouldChatSound('a', 'a', false), true)
  assert.equal(S.shouldChatSound(null, 'a', true), true)
})
test('chat pushes are one notification per chat, high priority, not a ring', () => {
  const a = P.buildPushMessage({ id: 'n1', type: 'chat_message', title: 'Ada', entity_type: 'social_conversation', entity_id: 'k9' })
  const b = P.buildPushMessage({ id: 'n2', type: 'chat_message', title: 'Ada (2 new messages)', entity_type: 'social_conversation', entity_id: 'k9' })
  assert.equal(a.tag, 'chat-k9')
  assert.equal(a.tag, b.tag)
  assert.equal(a.highPriority, true)
  assert.equal(a.urgent, false)
  assert.equal(P.buildPushMessage({ id: 'n3', type: 'task_assigned', title: 't' }).highPriority, false)
})
test('later messages also push, and the phone buzzes for chat', () => {
  const sql = read('supabase/migrations/20261016260000_chat_push_every_message.sql')
  assert.match(sql, /after update of created_at on public\.notifications/)
  assert.match(sql, /'chat_message', 'chat_mention'/)
  assert.match(sql, /execute function public\.push_on_notification/)
  assert.match(read('public/sw.js'), /\[180, 90, 180\]/)
  assert.match(read('supabase/functions/push-dispatch/index.ts'), /message\.highPriority/)
})
test('settings card and arrival hook are wired', () => {
  assert.match(read('src/modules/NotificationSettings.tsx'), /Chat messages/)
  assert.match(read('src/context/NotificationsContext.tsx'), /playChatArrival\(\)/)
  assert.match(read('src/chat/ChatShell.tsx'), /raOpenChat/)
})
