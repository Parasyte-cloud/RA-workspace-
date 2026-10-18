import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const stage = readFileSync(new URL('../src/modules/FaceTimeStage.tsx', import.meta.url), 'utf8')
const meeting = readFileSync(new URL('../src/modules/RoomMeeting.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/facetime-call.css', import.meta.url), 'utf8')
const style = readFileSync(new URL('../src/lib/callStyle.ts', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/modules/NotificationSettings.tsx', import.meta.url), 'utf8')

test('chat calls use the FaceTime-style stage and keep ROOM 7 on its own screen', () => {
  assert.match(meeting, /faceTime/)
  assert.match(meeting, /<FaceTimeStage/)
  assert.match(meeting, /chatCall&&!classicCall\(\)/)
  // ROOM 7 meetings still use the stock meeting UI.
  assert.match(meeting, /<RtkMeeting/)
  assert.match(meeting, /roomMeetingFrame/)
})

test('the stage joins itself, plays remote audio, and has camera, flip, mute and end controls', () => {
  assert.match(stage, /meeting\.join\(\)/)
  assert.match(stage, /RtkParticipantsAudio/)
  for (const label of ['Turn camera off', 'Flip camera', 'Mute', 'End call', 'Minimize call']) assert.ok(stage.includes(label), label)
  assert.match(stage, /corner-\$\{corner\}/)
})

test('FaceTime styling: pill controls, draggable self window, mini card', () => {
  for (const sel of ['.ftControls', '.ftSelf', '.ftMini', '.ftEnd', '.callFT']) assert.ok(css.includes(sel), sel)
})

test('Settings can switch back to the classic call screen', () => {
  assert.match(style, /ra-call-classic/)
  assert.match(settings, /Use the classic call screen/)
  assert.match(settings, /setClassicCall/)
})
