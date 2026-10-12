import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const load = async path => {
  const js = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const L = await load('src/lib/callLog.ts')
const T = await load('src/lib/ringtone.ts')
const read = p => readFileSync(p, 'utf8')

const ME = 'me'
const THEM = 'them'
const call = (over = {}) => ({
  id: 'c1', conversation_id: 'k1', caller_id: THEM, callee_id: ME, room_code: 'ABCDEFGH',
  kind: 'voice', status: 'missed', created_at: '2026-10-12T10:00:00Z', answered_at: null, ended_at: null, ...over,
})

test('durations read like a phone: m:ss and h:mm:ss', () => {
  assert.equal(L.formatCallDuration(0), '0:00')
  assert.equal(L.formatCallDuration(4 * 60000 + 32000), '4:32')
  assert.equal(L.formatCallDuration(3600000 + 5 * 60000 + 9000), '1:05:09')
  assert.equal(L.formatCallDuration(-5), '0:00')
})

test('a call you missed is labelled as missed and offers a call back', () => {
  const label = L.describeCall(call(), ME)
  assert.equal(label.title, 'Missed voice call')
  assert.equal(label.tone, 'missed')
  assert.equal(label.canCallBack, true)
  assert.equal(L.describeCall(call({ kind: 'video' }), ME).title, 'Missed video call')
})

test('the caller sees No answer, Declined and Cancelled in their own words', () => {
  assert.equal(L.describeCall(call({ caller_id: ME, callee_id: THEM, status: 'missed' }), ME).detail, 'No answer')
  assert.equal(L.describeCall(call({ caller_id: ME, callee_id: THEM, status: 'declined' }), ME).detail, 'Declined')
  assert.equal(L.describeCall(call({ caller_id: ME, callee_id: THEM, status: 'cancelled' }), ME).detail, 'Cancelled')
  assert.equal(L.describeCall(call({ status: 'declined' }), ME).detail, 'You declined')
})

test('a hang-up before you answered counts as missed for the person called', () => {
  const label = L.describeCall(call({ status: 'cancelled' }), ME)
  assert.equal(label.title, 'Missed voice call')
  assert.ok(L.isMissedForMe(call({ status: 'cancelled' }), ME))
  assert.ok(!L.isMissedForMe(call({ status: 'declined' }), ME))
  assert.ok(!L.isMissedForMe(call({ caller_id: ME, callee_id: THEM }), ME))
})

test('an answered call shows its length', () => {
  const done = call({ status: 'ended', answered_at: '2026-10-12T10:00:05Z', ended_at: '2026-10-12T10:04:37Z' })
  assert.equal(L.describeCall(done, ME).detail, '4:32')
  assert.equal(L.describeCall(done, ME).tone, 'ok')
  assert.equal(L.describeCall(call({ status: 'ended' }), ME).detail, 'Ended')
  assert.equal(L.callPreview(done, ME), 'Voice call, 4:32')
  assert.equal(L.callPreview(call(), ME), 'Missed voice call')
})

test('only new missed calls in that chat count as unseen', () => {
  const calls = [
    call({ id: 'a', created_at: '2026-10-12T09:00:00Z' }),
    call({ id: 'b', created_at: '2026-10-12T11:00:00Z' }),
    call({ id: 'c', conversation_id: 'other', created_at: '2026-10-12T11:00:00Z' }),
    call({ id: 'd', status: 'ended', created_at: '2026-10-12T11:30:00Z' }),
  ]
  assert.equal(L.unseenMissed(calls, ME, 'k1', '2026-10-12T08:00:00Z'), 2)
  assert.equal(L.unseenMissed(calls, ME, 'k1', '2026-10-12T10:00:00Z'), 1)
  assert.equal(L.unseenMissed(calls, ME, 'k1', '2026-10-12T12:00:00Z'), 0)
  assert.equal(L.unseenMissed(calls, ME, 'k1', null), 2)
})

test('calls sit among the messages in time order, and ringing calls wait', () => {
  const messages = [
    { id: 'm1', created_at: '2026-10-12T09:00:00Z' },
    { id: 'm2', created_at: '2026-10-12T11:00:00Z' },
  ]
  const calls = [
    call({ id: 'x', created_at: '2026-10-12T10:00:00Z' }),
    call({ id: 'y', status: 'ringing', created_at: '2026-10-12T10:30:00Z' }),
    call({ id: 'z', conversation_id: 'elsewhere', created_at: '2026-10-12T10:10:00Z' }),
  ]
  const order = L.mergeTimeline(messages, calls, 'k1').map(i => (i.type === 'message' ? i.message.id : i.call.id))
  assert.deepEqual(order, ['m1', 'x', 'm2'])
})

test('realtime updates replace a call, keep newest first, and stay capped', () => {
  let list = []
  list = L.upsertCall(list, call({ id: 'a', status: 'ringing', created_at: '2026-10-12T10:00:00Z' }))
  list = L.upsertCall(list, call({ id: 'b', created_at: '2026-10-12T11:00:00Z' }))
  list = L.upsertCall(list, call({ id: 'a', status: 'missed', created_at: '2026-10-12T10:00:00Z' }))
  assert.deepEqual(list.map(c => c.id), ['b', 'a'])
  assert.equal(list[1].status, 'missed')
  assert.equal(L.upsertCall(list, call({ id: 'c', created_at: '2026-10-12T12:00:00Z' }), 2).length, 2)
})

test('ring patterns fit inside their cycle and use audible tones', () => {
  for (const pattern of [T.INCOMING, T.RINGBACK]) {
    assert.ok(pattern.cycle > 0 && pattern.tones.length > 0)
    let previousEnd = 0
    for (const tone of [...pattern.tones].sort((a, b) => a.at - b.at)) {
      assert.ok(tone.at >= previousEnd - 1e-9, 'tones never overlap')
      assert.ok(tone.at + tone.dur < pattern.cycle, 'every tone ends before the cycle repeats')
      assert.ok(tone.gain > 0 && tone.gain <= 0.3, 'quiet enough not to startle')
      for (const f of tone.freqs) assert.ok(f >= 300 && f <= 1200)
      previousEnd = tone.at + tone.dur
    }
  }
  assert.ok(T.INCOMING.cycle > 2 && T.RINGBACK.cycle >= 3)
})

const sql = read('supabase/migrations/20261012250000_chat_call_history.sql')
const chat = read('src/modules/ChatModule.tsx')
const ringer = read('src/modules/CallRinger.tsx')
const roomModule = read('src/modules/RoomModule.tsx')

test('the migration lets the database close unanswered calls and records when calls end', () => {
  assert.match(sql, /add column if not exists ended_at timestamptz/)
  assert.match(sql, /create or replace function public\.expire_chat_calls\(\)/)
  assert.match(sql, /interval '45 seconds'/)
  assert.match(sql, /\(caller_id = me or callee_id = me\)/, 'a person only closes their own calls')
  assert.match(sql, /grant execute on function public\.expire_chat_calls\(\) to authenticated/)
  assert.match(sql, /revoke all on function public\.expire_chat_calls\(\) from public, anon/)
  assert.match(sql, /if call_row\.status <> 'accepted' then\s+return call_row\.status/, 'only answered calls can end')
  assert.ok(!sql.includes('—'))
})

test('chat shows calls in the thread, the list, and a Calls tab, and keeps the call in place', () => {
  assert.match(chat, /useChatCalls\(userId\)/)
  assert.match(chat, /mergeTimeline\(messages,calls,selectedId\)/)
  assert.match(chat, /cmCallLine/)
  assert.match(chat, /Call back/)
  assert.match(chat, /filter==='calls'/)
  assert.match(chat, /callPreview\(lastCall,userId\)/)
  assert.match(chat, /inPlace:true/)
  assert.match(chat, /callId:typeof callId==='string'\?callId:undefined/)
})

test('the ringer rings, plays ringback, and closes calls that rang out', () => {
  assert.match(ringer, /startTone\('incoming'/)
  assert.match(ringer, /startTone\('ringback'\)/)
  assert.match(ringer, /wireAudioUnlock\(\)/)
  assert.match(ringer, /expire_chat_calls/)
  assert.match(ringer, /announceCallFinished/)
  assert.match(ringer, /inPlace: true/)
  assert.match(ringer, /showDesktopAlert\(\{[\s\S]{0,300}urgent: true/)
})

test('hanging up on either side ends the chat call and closes the other window', () => {
  assert.match(roomModule, /callIdRef/)
  assert.match(roomModule, /respond_chat_call',\{p_call:callId,p_status:'ended'/)
  assert.match(roomModule, /CALL_FINISHED_EVENT/)
  assert.match(roomModule, /if\(!detail\.inPlace\)onOpenRef\.current\?\.\(\)/)
})

test('no em dash in the new call files', () => {
  for (const f of ['src/lib/callLog.ts', 'src/lib/ringtone.ts', 'src/modules/useChatCalls.ts']) assert.ok(!read(f).includes('—'))
})
