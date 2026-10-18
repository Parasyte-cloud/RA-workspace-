import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const stage = readFileSync(new URL('../src/modules/FaceTimeStage.tsx', import.meta.url), 'utf8')
const meeting = readFileSync(new URL('../src/modules/RoomMeeting.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/facetime-call.css', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/modules/NotificationSettings.tsx', import.meta.url), 'utf8')

test('chat calls use the FaceTime-style stage and keep ROOM 7 on its own screen', () => {
  assert.match(meeting, /faceTime/)
  assert.match(meeting, /<FaceTimeStage/)
  // One call screen for every chat call on every device: no per-device classic switch.
  assert.match(meeting, /const faceTime=chatCall\b/)
  assert.doesNotMatch(meeting, /classicCall/)
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

test('there is no classic call screen option left to pick the wrong screen', () => {
  assert.doesNotMatch(settings, /classic call screen/i)
  assert.doesNotMatch(settings, /setClassicCall/)
  assert.throws(() => readFileSync(new URL('../src/lib/callStyle.ts', import.meta.url)))
})

test('the speaker control only shows when it can act, and never uses phone wording on desktop', () => {
  assert.match(stage, /getSpeakerDevices/)
  assert.match(stage, /outputControl\(/)
  assert.match(stage, /control !== 'none'/)
  assert.match(stage, /Sound output/)
  assert.doesNotMatch(stage, /Control Center/)
  assert.doesNotMatch(stage, /Your phone picks where call sound plays/)
  assert.ok(css.includes('.ftSheet'))
})

test('controls stay on screen while ringing, reconnecting, in a voice call or with the sheet open', () => {
  assert.match(stage, /holdControls = calling \|\| reconnecting \|\| speakerOpen \|\| isVoice/)
  assert.match(stage, /if \(!holdRef\.current\) setShowControls\(false\)/)
})

test('the incoming call card always shows: drawn on body, polled as a backup, above chat', () => {
  const ringer = readFileSync(new URL('../src/modules/CallRinger.tsx', import.meta.url), 'utf8')
  const ringCss = readFileSync(new URL('../src/call-ringer.css', import.meta.url), 'utf8')
  assert.match(ringer, /createPortal\(/)
  assert.match(ringer, /setInterval\(\(\) => void poll\(\), 3000\)/)
  assert.match(ringCss, /html body > \.callRinger\.callRinger \{ z-index: 2147483600; \}/)
  const crest = readFileSync(new URL('../src/parasyte-crest.css', import.meta.url), 'utf8')
  assert.match(crest, /cmShell\.threadOpen\) \.parasyteCrestBar\{display:none\}/)
})
