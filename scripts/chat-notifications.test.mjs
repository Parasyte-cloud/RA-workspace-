import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012110000_chat_announcement_notifications.sql', 'utf8')
const chat = readFileSync('src/modules/ChatModule.tsx', 'utf8')
const center = readFileSync('src/components/NotificationCenter.tsx', 'utf8')

test('chat messages, announcements and announcement posts all create notifications', () => {
  assert.match(sql, /after insert on public\.social_messages/)
  assert.match(sql, /after insert or update of published on public\.workspace_announcements/)
  assert.match(sql, /after insert on public\.social_posts/)
})

test('chat notifications do not email, and reading clears them', () => {
  assert.match(sql, /'skipped'/)
  assert.match(sql, /after update of last_read_at on public\.social_conversation_members/)
})

test('trigger functions are not callable by clients', () => {
  assert.equal((sql.match(/from public, anon, authenticated;/g) || []).length, 4)
})

test('chat keeps one realtime channel and never blanks the list on refresh', () => {
  assert.equal((chat.match(/\.channel\(/g) || []).length, 1)
  assert.doesNotMatch(chat, /setLoading\(true\)/)
})

test('calling buttons tell people to ask Admin', () => {
  assert.match(chat, /Reach out to Admin to give you access/)
})

test('bell opens chat and announcements', () => {
  assert.match(center, /social_conversation/)
  assert.match(center, /workspace_announcement/)
})
