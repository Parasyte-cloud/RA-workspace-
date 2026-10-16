import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261016180000_room7_action_item_to_task.sql', 'utf8')
const ui = readFileSync('src/room7-shared/RoomNotes.tsx', 'utf8')

assert.match(sql, /add column if not exists work_item_id uuid references public\.work_items/)
assert.match(sql, /security definer\s+set search_path = public, pg_temp/)
assert.match(sql, /can_use_room_chat\(item\.room_id\)/, 'must check room membership')
assert.match(sql, /public\.create_work_assignment\(/, 'must reuse the existing assignment rules')
assert.match(sql, /can_assign_work\(item\.owner_id\)/, 'only assign to others when allowed')
assert.match(sql, /for update/, 'lock the row so a double tap makes one task')
assert.match(sql, /revoke all on function public\.room_action_to_task\(uuid\) from public, anon/)
assert.match(sql, /grant execute on function public\.room_action_to_task\(uuid\) to authenticated/)
assert.match(ui, /rpc\('room_action_to_task'/)
assert.match(ui, /work_item_id/)
console.log('room7-action-to-task ok')
