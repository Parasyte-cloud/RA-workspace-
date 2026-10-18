import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const read = p => readFileSync(p, 'utf8')
const load = async p => {
  const js = transformSync(read(p), { loader: 'ts', format: 'esm' }).code
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const O = await load('src/lib/outbox.ts')
const D = await load('src/lib/declineReplies.ts')

const memory = () => {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const item = (n, extra = {}) => ({ tempId: `t${n}`, conversationId: 'c', body: `m${n}`, replyToId: null, clientMessageId: `id${n}`, mentionedUserIds: [], queuedAt: Date.now(), ...extra })

test('outbox keeps order, ignores duplicates and drops day-old items', () => {
  const s = memory()
  O.enqueue('u', item(1), s); O.enqueue('u', item(2), s); O.enqueue('u', item(1), s)
  assert.deepEqual(O.loadOutbox('u', s).map(i => i.body), ['m2', 'm1'])
  O.saveOutbox('u', [item(3, { queuedAt: Date.now() - O.OUTBOX_MAX_AGE_MS - 5 }), item(4)], s)
  assert.deepEqual(O.loadOutbox('u', s).map(i => i.body), ['m4'])
  assert.deepEqual(O.loadOutbox('other', s), [])
  s.setItem(O.outboxKey('u'), 'not json')
  assert.deepEqual(O.loadOutbox('u', s), [])
})
test('network errors are told apart from server refusals', () => {
  assert.equal(O.isNetworkError(new Error('Failed to fetch'), true), true)
  assert.equal(O.isNetworkError(new Error('Load failed'), true), true)
  assert.equal(O.isNetworkError(new Error('anything'), false), true)
  assert.equal(O.isNetworkError(new Error('Conversation write access required'), true), false)
})
test('flush sends in order, stops on a network error, drops refused messages', async () => {
  const s = memory()
  for (const n of [1, 2, 3]) O.enqueue('u', item(n), s)
  const sent = []
  const first = await O.flushOutbox('u', {
    send: async i => { if (i.body === 'm2') throw new Error('Failed to fetch'); return { id: i.body } },
    onSent: i => sent.push(i.body), onFailed: () => assert.fail('no refusal expected'),
  }, s)
  assert.equal(first, 1)
  assert.deepEqual(sent, ['m1'])
  assert.deepEqual(O.loadOutbox('u', s).map(i => i.body), ['m2', 'm3'])
  const failed = []
  const second = await O.flushOutbox('u', {
    send: async i => { if (i.body === 'm2') throw new Error('Conversation write access required'); return { id: i.body } },
    onSent: i => sent.push(i.body), onFailed: i => failed.push(i.body),
  }, s)
  assert.equal(second, 1)
  assert.deepEqual(failed, ['m2'])
  assert.deepEqual(sent, ['m1', 'm3'])
  assert.deepEqual(O.loadOutbox('u', s), [])
})
test('chat queues offline text sends and the flusher is mounted app wide', () => {
  const chat = read('src/chat/ChatShell.tsx')
  assert.match(chat, /isNetworkError\(error\)/)
  assert.match(chat, /enqueue\(userId,/)
  assert.match(chat, /OUTBOX_SENT/)
  assert.match(read('src/App.tsx'), /<OutboxFlusher\/>/)
  assert.match(read('src/components/OutboxFlusher.tsx'), /addEventListener\('online'/)
})
test('muted badge shows when the other person is muted', () => {
  const src = read('src/modules/FaceTimeStage.tsx')
  assert.match(src, /!remote\.audioEnabled/)
  assert.match(src, /is muted/)
  assert.match(src, /remote\.on\('audioUpdate'/)
})
test('decline with a message: quick replies, same chat, queued when offline', () => {
  assert.equal(D.DECLINE_REPLIES.length, 4)
  assert.equal(D.isDeclineReply(D.DECLINE_REPLIES[1]), true)
  assert.equal(D.isDeclineReply('<script>'), false)
  const src = read('src/modules/CallRinger.tsx')
  assert.match(src, /respond\(call, 'declined'\)/)
  assert.match(src, /conversationId: call\.conversation_id/)
  assert.match(src, /enqueue\(meRef\.current/)
  assert.ok(!D.DECLINE_REPLIES.join('').includes('—'))
})
