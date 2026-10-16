import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { explainWriteError, filterRooms, roomNeedsAttention, roomSummary, roleLabel, typeLabel } from '../src/modules/adminChatAccessModel.ts'

const room = (over = {}) => ({ conversation_id: 'a', title: 'Partnership', room_type: 'committee', department: null, description: null, status: 'active', problem: null, active_members: 3, blocked_members: 0, last_message_at: null, ...over })

assert.match(explainWriteError('Conversation write access required'), /not allowed to post/)
assert.match(explainWriteError('Conversation write access required'), /Administration, Chat/)
assert.equal(explainWriteError('something else'), 'something else')

assert.equal(roomNeedsAttention(room()), false)
assert.equal(roomNeedsAttention(room({ problem: 'This room is archived, so nobody can post in it.' })), true)
assert.equal(roomNeedsAttention(room({ blocked_members: 1 })), true)

const rooms = [room(), room({ conversation_id: 'b', title: 'General', status: 'archived', problem: 'x' }), room({ conversation_id: 'c', title: 'Ops', blocked_members: 2 })]
assert.deepEqual(roomSummary(rooms), { total: 3, archived: 1, broken: 1, withBlocked: 1 })
assert.deepEqual(filterRooms(rooms, '', true).map(r => r.title), ['General', 'Ops'])
assert.deepEqual(filterRooms(rooms, 'part', false).map(r => r.title), ['Partnership'])
assert.equal(roleLabel('admin'), 'Room admin')
assert.equal(typeLabel('restricted'), 'Restricted')

const sql = readFileSync('supabase/migrations/20261016210000_admin_chat_access.sql', 'utf8')
for (const fn of ['admin_chat_rooms()', 'admin_chat_room_members(uuid)', 'admin_restore_chat_room(uuid)']) {
  assert.ok(sql.includes(`function public.${fn.replace('()', '').replace('(uuid)', '')}`), fn)
  assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon`), `${fn} revoked from anon`)
}
assert.equal((sql.match(/is_workspace_chat_admin\(\)/g) || []).length >= 3, true, 'every admin function checks chat admin')
assert.ok(!/alter function public\.can_write_to_conversation|create or replace function public\.can_write_to_conversation/.test(sql), 'posting rules are untouched')

const cp = readFileSync('src/modules/AdministrationControlPlane.tsx', 'utf8')
assert.match(cp, /\['chat','Chat',MessagesSquare\]/)
assert.match(cp, /tab==='chat'&&<AdminChatAccess\/>/)
const access = readFileSync('src/modules/AdminAccessManager.tsx', 'utf8')
assert.ok(!access.includes('ChatAdminManager'), 'chat admins live only in the Chat tab now')
console.log('admin-chat-access ok')
