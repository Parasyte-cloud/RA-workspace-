import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'

/*
 * Regression tests for the call screen consistency pass: one FaceTime screen
 * everywhere, a speaker control that can act, and a hang up that really ends
 * a call that is still ringing.
 */

const read = p => readFileSync(p, 'utf8')
let instance = 0
const load = async path => {
  const code = buildSync({ entryPoints: [path], bundle: true, format: 'esm', write: false }).outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(`${code}\n// copy ${++instance}`).toString('base64')}`)
}

const dev = (deviceId, label, groupId = deviceId) => ({ deviceId, label, groupId, kind: 'audiooutput' })

test('desktop with two outputs lists both by real name and marks the one in use (the "cannot access speakers" bug)', async () => {
  const { outputChoices, outputControl } = await load('src/lib/outputSheet.ts')
  const all = [
    dev('default', 'Default - MacBook Pro Speakers', 'g1'),
    dev('a', 'MacBook Pro Speakers', 'g1'),
    dev('b', 'DELL U2720Q', 'g2')
  ]
  // The browser reports the "default" entry as current: the real speakers are the ones in use.
  const choices = outputChoices(all, all[0])
  assert.deepEqual(choices.map(c => [c.name, c.on]), [['MacBook Pro Speakers', true], ['DELL U2720Q', false]])
  assert.equal(outputControl(false, choices), 'list')
  // Picking the monitor moves the tick.
  assert.deepEqual(outputChoices(all, all[2]).map(c => c.on), [false, true])
})

test('a single real output still gets a list, and no outputs means no dead button', async () => {
  const { outputChoices, outputControl } = await load('src/lib/outputSheet.ts')
  const one = [dev('default', 'Default - Speakers', 'g'), dev('a', 'Speakers', 'g')]
  const choices = outputChoices(one, one[0])
  assert.equal(choices.length, 1)
  assert.equal(choices[0].on, true)
  assert.equal(outputControl(false, choices), 'list')
  assert.equal(outputControl(false, outputChoices([], undefined)), 'none')
  assert.equal(outputControl(false, outputChoices([dev('default', '', 'g')], undefined)), 'none')
})

test('iPhone toggles Phone and Speaker in one tap, whatever the list says', async () => {
  const { outputControl } = await load('src/lib/outputSheet.ts')
  assert.equal(outputControl(true, []), 'toggle')
})

test('output names: Android earpiece and speakerphone use FaceTime words, headsets keep their name', async () => {
  const { outputKind, outputName } = await load('src/lib/outputSheet.ts')
  assert.equal(outputName('Earpiece', outputKind('Earpiece')), 'Phone')
  assert.equal(outputName('Speakerphone', outputKind('Speakerphone')), 'Speaker')
  assert.equal(outputName('AirPods Pro', outputKind('AirPods Pro')), 'AirPods Pro')
  assert.equal(outputKind('Bluetooth Headset'), 'headset')
})

test('caller hang up cancels a ringing call; the callee never sends a refused cancel', async () => {
  const { hangUpStatuses, hangUpCall } = await load('src/lib/callHangup.ts')
  assert.deepEqual(hangUpStatuses('host'), ['cancelled', 'ended'])
  assert.deepEqual(hangUpStatuses('member'), ['ended'])
  assert.deepEqual(hangUpStatuses('unknown'), ['cancelled', 'ended'])
  const sent = []
  await hangUpCall(async (fn, args) => { sent.push([fn, args.p_call, args.p_status]) }, 'c1', 'host')
  assert.deepEqual(sent, [['respond_chat_call', 'c1', 'cancelled'], ['respond_chat_call', 'c1', 'ended']])
  // One failing request does not stop the other.
  const got = []
  await hangUpCall(async (_fn, args) => { got.push(args.p_status); throw new Error('offline') }, 'c2', 'host')
  assert.deepEqual(got, ['cancelled', 'ended'])
})

test('the active call id can be watched, so the Calling card steps aside', async () => {
  const mod = await load('src/lib/activeCall.ts')
  const seen = []
  const stop = mod.subscribeActiveCall(id => seen.push(id))
  mod.setActiveCallId('x')
  mod.setActiveCallId('x')
  mod.setActiveCallId('')
  stop()
  mod.setActiveCallId('y')
  assert.deepEqual(seen, ['x', ''])
  assert.equal(mod.getActiveCallId(), 'y')
})

test('CallModule hangs up through the role-aware helper, clears the id on a failed join, and cancels on pagehide', () => {
  const src = read('src/modules/CallModule.tsx')
  assert.match(src, /serverHangUp\(callId, sessionRef\.current\?\.role \?\? 'unknown'\)/)
  assert.doesNotMatch(src, /p_status: 'ended' \}\)\n?\s*setSession/)
  assert.match(src, /setActiveCallId\(''\)\n\s*if \(failed\) serverHangUp\(failed, 'unknown'\)/)
  assert.match(src, /for \(const status of hangUpStatuses\(sessionRef\.current\.role\)\)/)
})

test('CallRinger hides its Calling card while the call screen shows the same call', () => {
  const src = read('src/modules/CallRinger.tsx')
  assert.match(src, /subscribeActiveCall\(setStageCallId\)/)
  assert.match(src, /outgoing\.id !== stageCallId/)
})

test('one call screen: no per-device classic switch, desktop window is one fixed shape', () => {
  assert.match(read('src/modules/RoomMeeting.tsx'), /const faceTime=chatCall\b/)
  const css = read('src/facetime-call.css')
  assert.match(css, /\.callScreen\.callFT\.callFull \{[^}]*width: min\(960px/)
})

test('no em dash in the files this pass touched', () => {
  const dash = String.fromCharCode(0x2014)
  for (const f of ['src/lib/outputSheet.ts', 'src/lib/callHangup.ts', 'src/lib/activeCall.ts', 'src/modules/FaceTimeStage.tsx', 'src/modules/CallModule.tsx', 'src/modules/CallRinger.tsx', 'src/facetime-call.css']) {
    assert.ok(!read(f).includes(dash), f)
  }
})
