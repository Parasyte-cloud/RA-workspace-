import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mergeRoomMessages} from '../src/room7-shared/roomChatMerge.ts'

const m=(id,sender,at,extra={})=>({id,room_id:'r',sender_id:sender,body:id,reply_to_id:null,client_message_id:null,created_at:at,edited_at:null,deleted_at:null,...extra})
// ordering, tie break, de-duplication
const a=mergeRoomMessages([m('b','u','2026-10-16T10:00:02Z')],[m('a','u','2026-10-16T10:00:01Z'),m('b','u','2026-10-16T10:00:02Z',{body:'edited'})])
assert.deepEqual(a.map(x=>x.id),['a','b']); assert.equal(a[1].body,'edited')
// the saved copy replaces the optimistic one with the same client id
const pending=m('tmp-c1','u','2026-10-16T10:00:05Z',{client_message_id:'c1',pending:true})
const b=mergeRoomMessages([pending],[m('real','u','2026-10-16T10:00:06Z',{client_message_id:'c1'})])
assert.deepEqual(b.map(x=>x.id),['real'])
// a failed copy is kept so it can be retried
const failed=m('tmp-c2','u','2026-10-16T10:00:07Z',{client_message_id:'c2',failed:true})
assert.equal(mergeRoomMessages([failed],[]).length,1)
// bad dates never throw
assert.doesNotThrow(()=>mergeRoomMessages([m('x','u','nonsense')],[m('y','u','also bad')]))

// database contract
const sql=readFileSync(new URL('../supabase/migrations/20261016100000_room7_team_chat_and_notes.sql',import.meta.url),'utf8')
for(const needle of [
  'alter table public.workspace_room_messages enable row level security',
  'create or replace function public.send_room_message',
  'can_use_room_chat(p_room)',
  "read only",
  'client_message_id',
  'revoke all on public.workspace_room_messages from public, anon, authenticated',
  'my_room_minutes',
  'set_room_action_done']) assert.ok(sql.includes(needle),`migration is missing: ${needle}`)
// no direct write grants on the chat table
assert.ok(!/grant (insert|update|delete)[^;]*workspace_room_messages/.test(sql),'clients must not write the chat table directly')
assert.ok(!sql.includes('—'),'no em dash')
// every security definer function pins its search_path
const defs=sql.match(/security definer[\s\S]*?\$\$/g)||[]
for(const d of defs) assert.ok(/set search_path = public, pg_temp/.test(d),'search_path must be pinned')

// the in-meeting wiring
const meeting=readFileSync(new URL('../src/modules/RoomMeeting.tsx',import.meta.url),'utf8')
assert.ok(/useRoomChat\(chatCall/.test(meeting),'one to one calls must not load the team chat')
assert.ok(/useWakeLock\(Boolean\(meeting\)\)/.test(meeting))
assert.ok(/event\.persisted/.test(meeting),'pagehide must not leave a paused page')
console.log('room7 team chat ok')
