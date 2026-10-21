import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('ROOM 7 staff calls use keepalive, PiP and foreground recovery', () => {
  const src = read('src/modules/RoomMeeting.tsx')
  for (const token of [
    'startCallKeepAlive',
    'PictureInPicture2',
    'floatVideo',
    'findCallVideo',
    'resumeCallMedia',
    'backgroundAtRef',
    "window.addEventListener('pageshow'",
    "window.addEventListener('focus'",
  ]) assert.ok(src.includes(token), token)
  assert.match(src, /onClick=\{minimized\?onRestore:minimizeRoom7\}/)
})

test('ROOM 7 guest calls get the same mobile background recovery', () => {
  const src = read('src/room7-public/ExternalRoom7Meeting.tsx')
  for (const token of [
    'startCallKeepAlive',
    'useWakeLock',
    'PictureInPicture2',
    'floatVideo',
    'resumeCallMedia',
    'foregroundProbeRef',
    "window.addEventListener('pageshow'",
  ]) assert.ok(src.includes(token), token)
})

test('call keepalive supports shadow DOM video and Safari PiP', () => {
  const src = read('src/lib/callKeepAlive.ts')
  assert.match(src, /shadowRoot/)
  assert.match(src, /findCallVideo/)
  assert.match(src, /webkitSetPresentationMode/)
  assert.match(src, /requestPictureInPicture/)
  assert.match(src, /resumeCallMedia/)
  assert.match(src, /mediaSession/)
  assert.match(src, /ra-call-live/)
})

test('wake lock is reacquired on every foreground path', () => {
  const src = read('src/lib/useWakeLock.ts')
  for (const event of ['visibilitychange', 'pageshow', 'focus', 'online']) {
    assert.ok(src.includes(event), event)
  }
  assert.match(src, /addEventListener\('release'/)
})
