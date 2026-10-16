import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const shell = readFileSync('src/chat/ChatShell.tsx', 'utf8')
const sql = readFileSync('supabase/migrations/20261016230000_chat_mute_broadcast_search_threads.sql', 'utf8')
test('chat shell uses each new feature', () => {
  for (const needle of ["'set_chat_mute'", "'search_chat_messages'", "'get_chat_thread'", "'register_chat_broadcast_mention'", 'loadDraft(', 'saveDraft(', 'typingSentence(', '<ThreadPanel', '<MessageSearchResults'])
    assert.ok(shell.includes(needle), needle)
})
test('broadcast placeholders never count as real mentions', () => {
  assert.match(shell, /!item\.userId\.startsWith\('\*'\)/)
})
test('the database defines every function the chat calls', () => {
  for (const fn of ['set_chat_mute', 'search_chat_messages', 'get_chat_thread', 'register_chat_broadcast_mention'])
    assert.ok(sql.includes(fn), fn)
})
