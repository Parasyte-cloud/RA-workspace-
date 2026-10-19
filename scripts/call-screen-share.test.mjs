import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const read = p => readFileSync(p, 'utf8')
const js = transformSync(read('src/lib/screenShare.ts'), { loader: 'ts', format: 'esm' }).code
const S = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

test('only browsers with getDisplayMedia can share a screen', () => {
  assert.equal(S.canCaptureScreen({ mediaDevices: { getDisplayMedia() {} } }), true)
  assert.equal(S.canCaptureScreen({ mediaDevices: {} }), false) // iPhone and Android phone browsers
  assert.equal(S.canCaptureScreen({}), false)
  assert.equal(S.canCaptureScreen(undefined), false)
})

test('a shared screen is used only when it is on and its video has arrived', () => {
  const video = { kind: 'video' }
  assert.equal(S.sharedScreenTrack({ screenShareEnabled: true, screenShareTracks: { video } }), video)
  assert.equal(S.sharedScreenTrack({ screenShareEnabled: false, screenShareTracks: { video } }), undefined)
  assert.equal(S.sharedScreenTrack({ screenShareEnabled: true, screenShareTracks: {} }), undefined)
  assert.equal(S.sharedScreenTrack(undefined), undefined)
})

test('the help text says phones can still watch and contains no em dash', () => {
  const h = S.screenShareHelp()
  assert.match(h.body, /still see/i)
  assert.ok(!/—/.test(h.title + h.body))
})

test('the FaceTime call has a share button and shows a shared screen uncropped', () => {
  const stage = read('src/modules/FaceTimeStage.tsx')
  assert.match(stage, /enableScreenShare\(\)/)
  assert.match(stage, /disableScreenShare\(\)/)
  assert.match(stage, /remote\.on\('screenShareUpdate'/)
  assert.match(stage, /Share your screen/)
  assert.match(read('src/facetime-call.css'), /\.ftVideo\.ftScreen \{ object-fit: contain/)
})
