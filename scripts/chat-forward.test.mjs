import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildForwardTargets, filterTargets, toggleTarget, cleanNote, canForward, forwardedLabel, forwardSummary, MAX_FORWARD_TARGETS } from '../src/chat/forward.ts'
import { copyableText } from '../src/chat/copy.ts'

const rooms = [{ id: 'r1', title: 'Partnership' }, { id: 'r2', title: null }]
const directs = [{ conversationId: 'd1', personId: 'p1', name: 'Ann Bello', subtitle: 'HR' }]
const people = [{ id: 'me', name: 'Me', subtitle: '' }, { id: 'p1', name: 'Ann Bello', subtitle: 'HR' }, { id: 'p2', name: 'Tom Ade', subtitle: 'Ops' }]

test('targets: chats first, then people who have no chat yet, never yourself', () => {
  const list = buildForwardTargets(rooms, directs, people, 'me')
  assert.deepEqual(list.map(item => item.key), ['c:d1', 'c:r1', 'c:r2', 'p:p2'])
  assert.equal(list[2].title, 'Room')
  assert.equal(list[3].kind, 'person')
})
test('search matches title or subtitle, ignoring case', () => {
  const list = buildForwardTargets(rooms, directs, people, 'me')
  assert.deepEqual(filterTargets(list, 'ann').map(item => item.key), ['c:d1'])
  assert.deepEqual(filterTargets(list, 'OPS').map(item => item.key), ['p:p2'])
  assert.equal(filterTargets(list, '').length, list.length)
})
test('selection toggles and stops at five', () => {
  let picked = []
  for (let i = 0; i < 8; i++) picked = toggleTarget(picked, `k${i}`)
  assert.equal(picked.length, MAX_FORWARD_TARGETS)
  assert.deepEqual(toggleTarget(['a', 'b'], 'a'), ['b'])
})
test('note is trimmed and capped', () => {
  assert.equal(cleanNote('  hi  '), 'hi')
  assert.equal(cleanNote('x'.repeat(5000)).length, 2000)
})
test('only sent, live messages can be forwarded', () => {
  assert.equal(canForward({ id: 'abc' }), true)
  assert.equal(canForward({ id: 'temp-1' }), false)
  assert.equal(canForward({ id: 'abc', pending: true }), false)
  assert.equal(canForward({ id: 'abc', failed: true }), false)
  assert.equal(canForward({ id: 'abc', deleted_at: '2026-01-01' }), false)
})
test('labels and summaries read in plain words', () => {
  assert.equal(forwardedLabel('Ann'), 'Forwarded from Ann')
  assert.equal(forwardedLabel(''), 'Forwarded')
  assert.equal(forwardSummary([{ title: 'Ann', ok: true }, { title: 'Tom', ok: true }, { title: 'Ops', ok: true }]), 'Forwarded to Ann, Tom and Ops.')
  assert.equal(forwardSummary([{ title: 'Ann', ok: true }, { title: 'Partnership', ok: false, error: 'archived' }]), 'Forwarded to Ann. Could not forward to Partnership: archived')
})
test('copy takes the text, or the file name for a file-only message, and nothing for deleted ones', () => {
  assert.equal(copyableText({ body: '  hello ' }), 'hello')
  assert.equal(copyableText({ body: '', attachment_name: 'plan.pdf' }), 'plan.pdf')
  assert.equal(copyableText({ body: 'x', deleted_at: '2026-01-01' }), '')
})

const sql = readFileSync('supabase/migrations/20261016240000_chat_forward_messages.sql', 'utf8')
test('the database function checks both ends and the file location', () => {
  for (const needle of ['can_read_message(v_src.conversation_id', 'can_write_to_conversation(p_target_conversation_id)', "o.bucket_id = 'chat-attachments'", 'coalesce(v_src.forwarded_from_user_id, v_src.sender_id)', 'security definer', 'set search_path = public, pg_temp', 'revoke all on function public.forward_chat_message', 'grant execute on function public.forward_chat_message'])
    assert.ok(sql.includes(needle), needle)
})
const shell = readFileSync('src/chat/ChatShell.tsx', 'utf8')
test('the chat uses forward and copy, and forwarded messages cannot be edited', () => {
  for (const needle of ["'forward_chat_message'", '<ForwardDialog', 'copyToClipboard(', 'forwarded_from_user_id,attachment_path', '!message.forwarded_from_user_id'])
    assert.ok(shell.includes(needle), needle)
})
const css = readFileSync('src/chat/chat-bottom.css', 'utf8')
test('the newest message is kept above the typing line and message box', () => {
  assert.match(css, /padding-bottom:var\(--cm-overlay/)
  assert.match(shell, /--cm-overlay/)
})
