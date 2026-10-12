import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012190000_chat_reply_archive_delete.sql', 'utf8')
const ui = readFileSync('src/modules/ChatModule.tsx', 'utf8')
const security = readFileSync('supabase/migrations/20260901230000_native_chat_security.sql', 'utf8')

test('deleting a chat is admin-only in the database, not just hidden in the UI', () => {
  const fn = sql.slice(sql.indexOf('function public.delete_social_conversation'))
  assert.match(fn, /if not public\.is_workspace_admin\(\)/)
  assert.match(fn, /raise exception 'Only an administrator can delete a chat'/)
  assert.match(sql, /revoke all on function public\.delete_social_conversation\(uuid\) from public/)
})

test('employees still have no direct DELETE on any chat table', () => {
  assert.match(security, /revoke update, delete\s+on table public\.social_messages\s+from authenticated/)
  assert.match(security, /revoke insert, update, delete\s+on table public\.social_conversations\s+from authenticated/)
  assert.ok(!/grant[^;]*\bdelete\b[^;]*on table[^;]*social_/i.test(sql))
  assert.ok(!/create policy[^;]*for delete/i.test(sql))
})

test('a reply can only point at a message in the same chat', () => {
  assert.match(sql, /reply_to_id uuid\s+references public\.social_messages\(id\) on delete set null/)
  assert.match(sql, /r\.conversation_id=new\.conversation_id/)
  assert.match(sql, /before insert on public\.social_messages/)
})

test('archiving is per person and a new incoming message restores the chat', () => {
  assert.match(sql, /user_id=auth\.uid\(\)/)
  assert.match(sql, /user_id<>new\.sender_id/)
  assert.match(sql, /can_access_social_conversation\(p_conversation_id\)/)
})

test('the app shows Delete only to admins and sends replies and archive through the database', () => {
  assert.match(ui, /is_workspace_admin/)
  assert.match(ui, /\{isAdmin&&\(/)
  assert.match(ui, /rpc\('delete_social_conversation'/)
  assert.match(ui, /rpc\('set_social_conversation_archived'/)
  assert.match(ui, /reply_to_id/)
  assert.match(ui, /filter==='archived'/)
})

test('archived chats are kept out of the main list and the unread total', () => {
  assert.match(ui, /!row\.membership\.archived_at/)
  assert.match(ui, /row\.membership\.archived_at\?sum:sum\+row\.unread/)
})
