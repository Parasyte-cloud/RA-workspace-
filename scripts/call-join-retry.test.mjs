import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'

/*
 * "The call could not start [ERR0002]: {Client} Failed to join room" on an
 * iPhone (18 October 2026). The call screen made one join attempt and showed
 * the raw SDK text. These tests guard the fix.
 */

const read = p => readFileSync(p, 'utf8')
let instance = 0
const load = async path => {
  const code = buildSync({ entryPoints: [path], bundle: true, format: 'esm', write: false }).outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(`${code}\n// copy ${++instance}`).toString('base64')}`)
}

const SCREENSHOT = '[ERR0002]: {Client} Failed to join room. Check the network and try again.'

test('the exact text from the phone is read as a network failure worth retrying', async () => {
  const { joinFailureCode, isRetryableJoinFailure } = await load('src/lib/joinFailure.ts')
  assert.equal(joinFailureCode(SCREENSHOT), '0002')
  assert.equal(isRetryableJoinFailure(SCREENSHOT), true)
})

test('network, socket and pass errors retry; permission and browser errors do not', async () => {
  const { isRetryableJoinFailure } = await load('src/lib/joinFailure.ts')
  for (const code of ['0000', '0001', '0002', '0004', '0011', '0012', '0014', '0100']) {
    assert.equal(isRetryableJoinFailure(`[ERR${code}]: x`), true, code)
  }
  for (const code of ['0010', '0013', '0101']) {
    assert.equal(isRetryableJoinFailure(`[ERR${code}]: x`), false, code)
  }
  assert.equal(isRetryableJoinFailure('Unable to join the call.'), true)
})

test('the person sees plain words and a small code, never the SDK text', async () => {
  const { joinFailureMessage } = await load('src/lib/joinFailure.ts')
  const text = joinFailureMessage(SCREENSHOT)
  assert.doesNotMatch(text, /\{Client\}/)
  assert.match(text, /VPN|Private Relay|Low Data/)
  assert.match(text, /\(ERR0002\)$/)
  assert.match(joinFailureMessage('[ERR0101]: Permission denied'), /Microphone or camera/)
  assert.match(joinFailureMessage('[ERR0001]: Failed to initialize.'), /Check your internet/)
  assert.match(joinFailureMessage(''), /Check your internet/)
  // A message from our own server (for example a private call) is kept as is.
  assert.equal(joinFailureMessage('This call is private.'), 'This call is private.')
})

test('retries are bounded and back off', async () => {
  const { MAX_JOIN_RETRIES, joinRetryDelay } = await load('src/lib/joinFailure.ts')
  assert.equal(MAX_JOIN_RETRIES, 2)
  assert.ok(joinRetryDelay(2) > joinRetryDelay(1))
  assert.ok(joinRetryDelay(0) > 0)
})

test('the call screen retries the join with a fresh pass before showing an error', () => {
  const room = read('src/modules/RoomMeeting.tsx')
  assert.match(room, /onJoinError=\{handleJoinError\}/)
  assert.doesNotMatch(room, /onJoinError=\{setInitError\}/)
  const handler = room.slice(room.indexOf('const handleJoinError'), room.indexOf('const tryAgain'))
  assert.match(handler, /isRetryableJoinFailure\(message\)/)
  assert.match(handler, /MAX_JOIN_RETRIES/)
  assert.match(handler, /onRejoinRef\.current\(\)/)
  // Our own swap of the old connection must not read as being removed.
  assert.match(handler, /rejoinInFlightRef\.current=true/)
  assert.match(room, /giveUpJoin[\s\S]*setInitError\(joinFailureMessage\(message\)\)/)
})

test('Try again asks the server for a new pass instead of reusing the failed one', () => {
  const room = read('src/modules/RoomMeeting.tsx')
  assert.match(room, /onClick=\{\(\)=>void tryAgain\(\)\}>Try again/)
  const body = room.slice(room.indexOf('const tryAgain'), room.indexOf('// Meeting lifecycle'))
  assert.match(body, /onRejoinRef\.current\(\)/)
  assert.match(body, /joinRetryRef\.current=0/)
})

test('a client built from an old pass is never shown, so it cannot join as a second copy', () => {
  const room = read('src/modules/RoomMeeting.tsx')
  assert.match(room, /setReadyToken\(passToken\)/)
  assert.match(room, /readyToken===session\.auth_token/)
  // The hook gives back nothing while another start is running: wait, do not stop.
  assert.match(room, /if\(!created\)\{\s*if\(busyWaits\+\+<20\)/)
  // A refusal from the server still ends the attempt at once.
  assert.match(room, /leaveOnRefusal/)
})

test('a good connection resets the retry count', () => {
  const room = read('src/modules/RoomMeeting.tsx')
  const joined = room.slice(room.indexOf('const handleJoined'), room.indexOf('const handleRoomLeft'))
  assert.match(joined, /joinRetryRef\.current=0/)
})

test('nothing new uses an em dash', () => {
  for (const file of ['src/lib/joinFailure.ts', 'src/modules/RoomMeeting.tsx', 'scripts/call-join-retry.test.mjs']) {
    assert.doesNotMatch(read(file), new RegExp(String.fromCharCode(0x2014)), file)
  }
})
