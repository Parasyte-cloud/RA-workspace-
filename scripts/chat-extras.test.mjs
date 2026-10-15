import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const load = async path => {
  const js = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const X = await load('src/lib/chatExtras.ts')
const E = await load('src/chat/emojiData.ts')

test('emoji validation matches the database rule', () => {
  for (const ok of ['👍', '❤️', '🙏', '👨‍👩‍👧‍👦']) assert.equal(X.isValidEmoji(ok), true, ok)
  for (const bad of ['', 'a', '1', 'hi', '<b>', ' ', '👍👍👍👍👍👍👍👍👍', null, 42]) assert.equal(X.isValidEmoji(bad), false, String(bad))
})

test('reactions group by emoji, count people once, flag mine, sort by count', () => {
  const rows = [
    { message_id: 'm', user_id: 'a', emoji: '👍' },
    { message_id: 'm', user_id: 'b', emoji: '❤️' },
    { message_id: 'm', user_id: 'c', emoji: '❤️' },
    { message_id: 'm', user_id: 'c', emoji: '❤️' },
    { message_id: 'm', user_id: 'a', emoji: '❤️' },
  ]
  const g = X.groupReactions(rows, 'a')
  assert.deepEqual(g.map(x => [x.emoji, x.count, x.mine]), [['❤️', 3, true], ['👍', 1, true]])
  assert.equal(X.groupReactions(rows, 'zzz').every(x => !x.mine), true)
  assert.deepEqual(X.groupReactions([], 'a'), [])
})

test('realtime changes add and remove reactions without duplicates', () => {
  const r = { message_id: 'm', user_id: 'a', emoji: '👍' }
  let rows = X.applyReactionChange([], { type: 'add', row: r })
  rows = X.applyReactionChange(rows, { type: 'add', row: r })
  assert.equal(rows.length, 1)
  assert.equal(X.applyReactionChange(rows, { type: 'remove', row: r }).length, 0)
})

test('reaction tooltip names people and trims long lists', () => {
  const g = { emoji: '👍', count: 5, mine: true, userIds: ['me', 'a', 'b', 'c', 'd'] }
  assert.equal(X.reactionTitle(g, id => id.toUpperCase(), 'me'), 'You, A, B and 2 more')
})

test('status is active until it expires', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  assert.equal(X.statusActive(null, now), false)
  assert.equal(X.statusActive({ emoji: null, text: null, until: null }, now), false)
  assert.equal(X.statusActive({ emoji: '🏠', text: null, until: null }, now), true)
  assert.equal(X.statusActive({ emoji: '🏠', text: 'x', until: '2026-10-15T11:00:00Z' }, now), false)
  assert.equal(X.statusActive({ emoji: '🏠', text: 'x', until: '2026-10-15T13:00:00Z' }, now), true)
})

test('status durations resolve to the right end time', () => {
  const now = new Date(2026, 9, 15, 9, 30)
  assert.equal(X.statusUntil(null, now), null)
  assert.equal(new Date(X.statusUntil(4, now)).getTime() - now.getTime(), 4 * 3600_000)
  const today = new Date(X.statusUntil(-1, now))
  assert.equal(today.getDate(), 15)
  assert.equal(today.getHours(), 23)
  assert.ok(new Date(X.statusUntil(-7, now)).getTime() >= today.getTime())
})

test('search helpers escape wildcards and highlight matches', () => {
  assert.equal(X.escapeLike('50%_off\\'), '50\\%\\_off\\\\')
  assert.equal(X.cleanSearchQuery('  hello   world  '), 'hello world')
  assert.deepEqual(X.highlightParts('Send the Invoice now', 'invoice'), [
    { text: 'Send the ', hit: false }, { text: 'Invoice', hit: true }, { text: ' now', hit: false },
  ])
  assert.deepEqual(X.highlightParts('abc', ''), [{ text: 'abc', hit: false }])
})

test('avatar helpers crop a centred square and keep the path in the owner folder', () => {
  assert.deepEqual(X.centreSquare(400, 200), { sx: 100, sy: 0, size: 200 })
  assert.deepEqual(X.centreSquare(100, 300), { sx: 0, sy: 100, size: 100 })
  assert.equal(X.avatarPathFor('u1', 5), 'u1/5.webp')
})

test('emoji picker data is searchable and has no duplicates inside a group', () => {
  assert.ok(E.EMOJI_GROUPS.length >= 6)
  assert.ok(E.searchEmoji('plane').some(x => x.e === '✈️'))
  assert.deepEqual(E.searchEmoji(''), [])
  for (const group of E.EMOJI_GROUPS) {
    const seen = new Set(group.items.map(i => i.e))
    assert.equal(seen.size, group.items.length, group.id)
  }
  for (const q of X.QUICK_REACTIONS) assert.ok(X.isValidEmoji(q), q)
  for (const item of E.ALL_EMOJI) assert.ok(X.isValidEmoji(item.e), item.e)
})

test('migration protects reactions, pins and the chat photo', () => {
  const sql = readFileSync('supabase/migrations/20261015220000_chat_profiles_reactions_pins.sql', 'utf8')
  assert.match(sql, /create or replace function public\.toggle_chat_reaction/)
  assert.match(sql, /can_read_message\(msg\.conversation_id, msg\.created_at\)/)
  assert.match(sql, /can_write_to_conversation\(msg\.conversation_id\)/)
  assert.match(sql, /grant select on table public\.chat_message_reactions to authenticated/)
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*chat_message_reactions/)
  assert.match(sql, /bucket_id = 'chat-avatars'\s+and \(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/)
  assert.match(sql, /chat_profiles_avatar_own_folder/)
  assert.match(sql, /11\b|>= 10/)
})
