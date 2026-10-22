import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'

/*
 * Regression tests for the third chat and call audit (18 October 2026).
 * Each test names the failure it guards against.
 */

const read = p => readFileSync(p, 'utf8')
const sql = read('supabase/migrations/20261018190000_chat_call_audit_round3.sql')
let instance = 0
const load = async path => {
  const code = buildSync({ entryPoints: [path], bundle: true, format: 'esm', write: false }).outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(`${code}\n// copy ${++instance}`).toString('base64')}`)
}

test('the message insert policy again requires a file to sit in this chat and the sender folder', () => {
  const policy = sql.slice(sql.indexOf('create policy "social messages member send"'), sql.indexOf('-- 2.'))
  assert.match(policy, /split_part\(attachment_path, '\/', 1\) = conversation_id::text/)
  assert.match(policy, /split_part\(attachment_path, '\/', 2\) = auth\.uid\(\)::text/)
  assert.match(policy, /can_write_to_conversation\(conversation_id\)/)
  // The policy it replaced (20261013130300) had no path rule at all.
  const old = read('supabase/migrations/20261013130300_chat_message_authorization.sql')
  const oldPolicy = old.slice(old.indexOf('create policy "social messages member send"'), old.indexOf('create policy "social messages member send"') + 400)
  assert.doesNotMatch(oldPolicy, /attachment_path/)
})

test('notification previews exist for voice notes, photos and files', () => {
  assert.match(sql, /'Sent a voice note'/)
  assert.match(sql, /'Sent a photo'/)
  assert.match(sql, /'Sent a file: '/)
  // Still one row per chat, still mention aware.
  assert.match(sql, /'chat_mention'/)
  assert.match(sql, /m\.removed_at is null/)
})

test('a caller already on a live call cannot start another, and the guard tolerates a dead call', () => {
  assert.match(sql, /You are already on a call\. End it before starting another\./)
  assert.match(sql, /c\.heartbeat_at > now\(\) - interval '75 seconds'/)
  assert.match(sql, /c\.heartbeat_at is null and coalesce\(c\.answered_at, c\.created_at\) > now\(\) - interval '2 minutes'/)
})

test('abandoned calls end at the last heartbeat so history shows the real length', () => {
  assert.match(sql, /set status = 'ended', ended_at = coalesce\(heartbeat_at, now\(\)\)/)
})

test('marking a chat read writes only when something is newer', () => {
  const body = sql.slice(sql.indexOf('create or replace function public.mark_social_conversation_read'))
  assert.match(body, /sm\.created_at>coalesce\(m\.last_read_at/)
  assert.match(body, /Conversation membership not found/)
})

test('endStaleCalls leaves a call that was answered a moment ago (no first heartbeat yet)', async () => {
  const { endStaleCalls } = await load('src/lib/callCleanup.ts')
  const ago = ms => new Date(Date.now() - ms).toISOString()
  const rows = [
    { id: 'fresh', heartbeat_at: null, answered_at: ago(20_000) },
    { id: 'beating', heartbeat_at: ago(10_000), answered_at: ago(600_000) },
    { id: 'dead', heartbeat_at: ago(300_000), answered_at: ago(900_000) },
    { id: 'old-no-beat', heartbeat_at: null, answered_at: ago(600_000) },
  ]
  const ended = []
  const chain = { select: () => chain, eq: () => chain, or: () => Promise.resolve({ data: rows, error: null }) }
  const client = {
    from: () => chain,
    rpc: async (_fn, args) => { ended.push(args.p_call); return { error: null } },
  }
  const count = await endStaleCalls(client, 'me')
  assert.deepEqual(ended.sort(), ['dead', 'old-no-beat'])
  assert.equal(count, 2)
})

test('a kicked device closes its own screen but does not end the call for both people', () => {
  const src = read('src/modules/CallModule.tsx')
  assert.match(src, /const finish = useCallback\(\(message = '', hangUp = true\)/)
  assert.match(src, /if \(callId && hangUp\) serverHangUp/)
  assert.match(src, /reason !== 'kicked'/)
})

test('one call at a time: starting, answering and joining all refuse a second call', () => {
  const module = read('src/modules/CallModule.tsx')
  assert.match(module, /callIdRef\.current && callIdRef\.current !== detail\.callId/)
  const ringer = read('src/modules/CallRinger.tsx')
  assert.match(ringer, /status === 'accepted' && getActiveCallId\(\) && getActiveCallId\(\) !== call\.id/)
  const chat = read('src/chat/ChatShell.tsx')
  assert.match(chat, /if\(getActiveCallId\(\)\)\{\s*setCallNotice\('You are already on a call/)
})

test('the call clock starts when the other person is on the call, not when the screen opens', () => {
  const src = read('src/modules/RoomMeeting.tsx')
  assert.match(src, /answeredAtRef/)
  assert.match(src, /participantJoined',markAnswered/)
  assert.doesNotMatch(src, /const started=Date\.now\(\)/)
})

test('a third person in a call is shown, never an invisible listener', () => {
  const stage = read('src/modules/FaceTimeStage.tsx')
  assert.match(stage, /remotes\.length > 1/)
  assert.match(stage, /on this call/)
})

test('chat refresh from realtime is coalesced, not one reload per event', () => {
  const src = read('src/chat/ChatShell.tsx')
  assert.match(src, /const scheduleBase=\(\)=>\{\s*if\(baseTimerRef\.current\)return/)
  assert.match(src, /const scheduleReceipts=\(\)=>\{\s*if\(receiptTimer\)return/)
  assert.match(src, /table:'social_conversation_members'\},\s*scheduleBase\s*\)/)
  assert.match(src, /table:'chat_message_receipts'\s*\},\s*scheduleReceipts/)
  assert.doesNotMatch(src, /table:'social_conversation_members'\},\s*\(\)=>\{void loadBase\(\)\}/)
})

test('file and voice sends preserve client ids through governed sends and retries', () => {
  const shell = read('src/chat/ChatShell.tsx')
  const api = read('src/chat/api/chatApi.ts')

  assert.match(
    shell,
    /const clientMessageId=opts\.clientMessageId \|\| crypto\.randomUUID\(\)/,
  )
  assert.match(
    shell,
    /sendChatAttachmentMessage\(\{[\s\S]*?clientMessageId,[\s\S]*?\}\)/,
  )
  assert.match(
    shell,
    /savePendingFileRetry\(\{[\s\S]*?clientMessageId,[\s\S]*?file/,
  )
  assert.match(
    shell,
    /clientMessageId:message\.client_message_id\|\|undefined/,
  )
  assert.match(
    api,
    /p_client_message_id:\s*input\.clientMessageId/,
  )
})

test('deleted messages stay readable as a tombstone, and alerts that quote them are scrubbed', () => {
  const policy = sql.slice(sql.indexOf('create policy "social messages member read"'))
  const using = policy.slice(0, policy.indexOf(');') + 2)
  assert.match(using, /can_read_message\(/)
  assert.doesNotMatch(using, /deleted_at/)
  // The row it replaced hid deleted messages (20261013130300).
  const old = read('supabase/migrations/20261013130300_chat_message_authorization.sql')
  assert.match(old.slice(old.indexOf('create policy "social messages member read"')), /deleted_at is null/)
  assert.match(sql, /set body = 'This message was deleted'/)
  assert.match(sql, /read_at is null/)
  const chat = read('src/chat/ChatShell.tsx')
  assert.match(chat, /!message\.deleted_at &&/)
  assert.match(chat, /\.is\('deleted_at',null\)\s*\.gt\('created_at',membership\.last_read_at\)/)
  assert.match(chat, /if\(row\.deleted_at\)scheduleBase\(\)/)
})

test('a call room is private to the two people on it; admins get in and both people are told', () => {
  const fn = read('supabase/functions/room-session/index.ts')
  const join = fn.slice(fn.indexOf('if (action === "join")'), fn.indexOf('if (action === "end")'))
  assert.match(join, /from\("chat_calls"\)[\s\S]*\.eq\("room_code", code\)/)
  assert.match(join, /isCallRoom && !onTheCall && profile\.role !== "admin"/)
  assert.match(join, /This call is private\./)
  // Admin entry: notice goes to caller and callee for a call, and never when the admin is one of them.
  assert.match(join, /!existing && profile\.role === "admin" && role !== "host" && !onTheCall/)
  assert.match(join, /flatMap\(\(call\) => \[call\.caller_id, call\.callee_id\]\)/)
  assert.match(join, /An administrator joined your call/)
  assert.match(join, /An administrator joined your ROOM 7/)
  // The privacy check runs before any participant or provider work.
  assert.ok(join.indexOf('This call is private.') < join.indexOf('kickExistingPeers'))
})

test('no-show: the caller waits 30 seconds after Accept, no longer', async () => {
  const { NO_SHOW_MS, noShowDelay } = await load('src/lib/callTimers.ts')
  assert.equal(NO_SHOW_MS, 30_000)
  assert.equal(noShowDelay(1_000, 1_000), 30_000)
  assert.equal(noShowDelay(1_000, 11_000), 20_000)
  assert.equal(noShowDelay(1_000, 60_000), 0)
  assert.equal(noShowDelay(5_000, 1_000), 30_000, 'a clock that runs backwards never waits longer')
})

test('no-show wiring: announced once, caller only, never fires if anyone is on the call, reset between calls', () => {
  const ringer = read('src/modules/CallRinger.tsx')
  assert.match(ringer, /row\.caller_id === mine && row\.status === 'accepted' && !acceptedRef\.current\.has\(row\.id\)/)
  const module = read('src/modules/CallModule.tsx')
  assert.match(module, /detail\.callId === callIdRef\.current\) setAcceptedAt\(Date\.now\(\)\)/)
  assert.match(module, /if \(!session\) setAcceptedAt\(0\)/)
  assert.match(module, /callIdRef\.current = detail\.callId\s*setAcceptedAt\(0\)/)
  assert.match(module, /They could not connect\. Try calling again\./)
  const meeting = read('src/modules/RoomMeeting.tsx')
  assert.match(meeting, /session\.role!=='host'\)return/)
  assert.match(meeting, /noShowDelay\(acceptedAt\)/)
  assert.match(meeting, /!answeredAtRef\.current&&!someoneHere/)
})

test('no em dash in anything this round touched', () => {
  const dash = String.fromCharCode(0x2014)
  for (const f of [
    'supabase/migrations/20261018190000_chat_call_audit_round3.sql',
    'src/lib/callCleanup.ts', 'src/modules/CallModule.tsx', 'src/modules/CallRinger.tsx',
    'src/modules/RoomMeeting.tsx', 'src/modules/FaceTimeStage.tsx', 'src/facetime-call.css',
    'src/lib/callTimers.ts', 'src/lib/roomApi.ts', 'supabase/functions/room-session/index.ts',
  ]) assert.ok(!read(f).includes(dash), f)
})
