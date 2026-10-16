import assert from 'node:assert/strict'
import { addTyper, liveTypers, typingSentence, TYPING_TTL_MS } from '../src/chat/typingPeople.ts'
import { draftKey, loadDraft, saveDraft, listDrafts, draftPreview } from '../src/chat/drafts.ts'
import { isMuted, muteLabel, MUTE_CHOICES } from '../src/chat/mutes.ts'
import { broadcastSuggestions, detectBroadcast, highlightsBroadcast } from '../src/chat/broadcast.ts'
import { searchable, snippetAround } from '../src/chat/messageSearch.ts'
import { replyCounts, threadView, repliesLabel } from '../src/chat/threads.ts'

// typing
let list = []
list = addTyper(list, 'a', 'Ada Obi', 1000)
list = addTyper(list, 'b', 'Tolu Ade', 2000)
list = addTyper(list, 'a', 'Ada Obi', 3000)
assert.equal(list.length, 2, 'same person is not listed twice')
assert.equal(liveTypers(list, 3000 + TYPING_TTL_MS).length, 0, 'expires')
assert.equal(liveTypers(list, 4000).length, 2)
assert.equal(typingSentence([]), '')
assert.equal(typingSentence(['Ada Obi']), 'Ada is typing...')
assert.equal(typingSentence(['Ada Obi', 'Tolu Ade']), 'Ada and Tolu are typing...')
assert.equal(typingSentence(['A', 'B', 'C']), 'A, B and 1 other are typing...')
assert.equal(typingSentence(['A', 'B', 'C', 'D']), 'A, B and 2 others are typing...')

// drafts
const mem = new Map()
const store = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } }
saveDraft('u1', 'c1', 'hello wor', store)
saveDraft('u1', 'c2', '   ', store)
saveDraft('u2', 'c1', 'other person', store)
assert.equal(loadDraft('u1', 'c1', store), 'hello wor')
assert.equal(loadDraft('u1', 'c2', store), '')
assert.deepEqual(listDrafts('u1', store), { c1: 'hello wor' }, 'drafts are per person')
saveDraft('u1', 'c1', '', store)
assert.deepEqual(listDrafts('u1', store), {}, 'emptied draft is removed')
assert.equal(draftKey('u', 'c'), 'ridearrivo:chat:draft:u:c')
assert.equal(draftPreview('a   b\n c'), 'a b c')
assert.ok(draftPreview('x'.repeat(100)).length <= 48)
assert.equal(loadDraft('', 'c1', store), '')
assert.equal(loadDraft('u1', 'c1', null), '', 'works without storage')

// mute
const now = Date.parse('2026-10-16T10:00:00Z')
assert.equal(isMuted(null, now), false)
assert.equal(isMuted('infinity', now), true)
assert.equal(isMuted('2026-10-16T09:59:00Z', now), false)
assert.equal(isMuted('2026-10-16T11:00:00Z', now), true)
assert.equal(muteLabel('infinity', now), 'Muted')
assert.equal(muteLabel('2026-10-16T10:30:00Z', now), 'Muted for 30 min')
assert.equal(muteLabel('2026-10-16T18:00:00Z', now), 'Muted for 8 h')
assert.equal(muteLabel('2026-10-23T10:00:00Z', now), 'Muted for 7 days')
assert.equal(muteLabel(null, now), '')
assert.deepEqual(MUTE_CHOICES.map(c => c.id), ['1h', '8h', '1d', '1w', 'forever'])

// broadcast
assert.deepEqual(broadcastSuggestions('', true).map(s => s.kind), ['everyone', 'here'])
assert.deepEqual(broadcastSuggestions('he', true).map(s => s.kind), ['here'])
assert.deepEqual(broadcastSuggestions('', false), [], 'not in direct chats')
assert.equal(detectBroadcast('hi @everyone please read', true), 'everyone')
assert.equal(detectBroadcast('@here quick one', true), 'here')
assert.equal(detectBroadcast('mail me at a@here.com', true), null, 'part of an email is not a mention')
assert.equal(detectBroadcast('@everyone', false), null)
assert.equal(detectBroadcast('@everyones', true), null)
assert.equal(highlightsBroadcast('ping @here.'), true)

// search
assert.equal(searchable('ab'), false)
assert.equal(searchable(' abc '), true)
const sn = snippetAround('The quarterly report is attached for review by Friday afternoon, thanks', 'report')
assert.equal(sn.match, 'report')
assert.ok(sn.before.length > 0 && sn.after.length > 0)
assert.equal(snippetAround('nothing here', 'zzz').match, '')

// threads
const msgs = [
  { id: 'r', reply_to_id: null, created_at: '2026-10-16T10:00:00Z', sender_id: 'a' },
  { id: '1', reply_to_id: 'r', created_at: '2026-10-16T10:05:00Z', sender_id: 'b' },
  { id: '2', reply_to_id: 'r', created_at: '2026-10-16T10:09:00Z', sender_id: 'a' },
  { id: '3', reply_to_id: 'r', created_at: '2026-10-16T10:11:00Z', sender_id: 'c', deleted_at: 'x' },
]
const counts = replyCounts(msgs)
assert.equal(counts.get('r').count, 2, 'deleted replies are not counted')
assert.equal(counts.get('r').lastAt, '2026-10-16T10:09:00Z')
const view = threadView('r', msgs.slice(0, 2), [msgs[0], msgs[1], msgs[2]])
assert.equal(view.root.id, 'r')
assert.deepEqual(view.replies.map(m => m.id), ['1', '2'], 'fetched and loaded merge without duplicates')
assert.equal(repliesLabel(1), '1 reply')
assert.equal(repliesLabel(3), '3 replies')
console.log('chat-batch2-pure ok')
