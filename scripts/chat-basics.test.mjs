import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/chatEdit.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const E = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const sql = readFileSync('supabase/migrations/20261012290000_chat_edit_delete.sql', 'utf8')
const ui = readFileSync('src/modules/ChatModule.tsx', 'utf8')
const now = Date.parse('2026-10-12T12:00:00Z')
const msg = (over = {}) => ({ sender_id: 'me', created_at: '2026-10-12T10:00:00Z', body: 'hi', ...over })

test('only your own fresh text can be edited', () => {
  assert.equal(E.canEdit(msg(), 'me', now), true)
  assert.equal(E.canEdit(msg(), 'other', now), false)
  assert.equal(E.canEdit(msg({ created_at: '2026-10-10T10:00:00Z' }), 'me', now), false)
  assert.equal(E.canEdit(msg({ pending: true }), 'me', now), false)
  assert.equal(E.canEdit(msg({ failed: true }), 'me', now), false)
  assert.equal(E.canEdit(msg({ deleted_at: 'x' }), 'me', now), false)
  assert.equal(E.canEdit(msg({ attachment_mime: 'audio/webm' }), 'me', now), false)
  assert.equal(E.canEdit(msg({ attachment_mime: 'image/png' }), 'me', now), true)
})

test('only your own sent message can be deleted, at any age', () => {
  assert.equal(E.canDelete(msg({ created_at: '2026-01-01T00:00:00Z' }), 'me'), true)
  assert.equal(E.canDelete(msg(), 'other'), false)
  assert.equal(E.canDelete(msg({ deleted_at: 'x' }), 'me'), false)
})

test('typing pings are throttled', () => {
  assert.equal(E.shouldSendTyping(0, E.TYPING_SEND_EVERY_MS), true)
  assert.equal(E.shouldSendTyping(1000, 1000 + E.TYPING_SEND_EVERY_MS - 1), false)
  assert.equal(E.typingLine('Ada'), 'Ada is typing...')
  assert.equal(E.typingLine(''), 'Someone is typing...')
})

test('older pages merge without duplicates and in order', () => {
  const cur = [{ id: 'b', created_at: '2026-10-02T00:00:00Z', v: 'new' }]
  const old = [{ id: 'b', created_at: '2026-10-02T00:00:00Z', v: 'stale' }, { id: 'a', created_at: '2026-10-01T00:00:00Z' }]
  const out = E.mergeOlder(cur, old)
  assert.deepEqual(out.map(m => m.id), ['a', 'b'])
  assert.equal(out[1].v, 'new')
})

test('refreshing the latest page keeps older loaded messages', () => {
  const cur = [
    { created_at: '2026-10-01T00:00:00Z' },
    { created_at: '2026-10-03T00:00:00Z' },
    { created_at: '2026-10-04T00:00:00Z', pending: true },
  ]
  assert.equal(E.keepOlderThan(cur, '2026-10-02T00:00:00Z').length, 1)
  assert.equal(E.keepOlderThan(cur, undefined).length, 0)
})

test('database: edit and delete are owner-only functions', () => {
  assert.match(sql, /edit_social_message/)
  assert.match(sql, /delete_social_message/)
  assert.match(sql, /sender_id <> me/)
  assert.match(sql, /24 hours/)
  assert.match(sql, /grant execute[\s\S]*authenticated/i)
})

test('screen is wired to edit, delete, typing and load earlier', () => {
  for (const s of ['edit_social_message', 'delete_social_message', "channel(`typing-", 'Load earlier messages', 'cmDeletedText', 'cmEditBox', 'cmTyping'])
    assert.ok(ui.includes(s), s)
})
