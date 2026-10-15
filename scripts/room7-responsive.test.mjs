import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const room = read('src/modules/RoomModule.tsx')
const meeting = read('src/modules/RoomMeeting.tsx')
const ringer = read('src/modules/CallRinger.tsx')
const roomCss = read('src/room.css')
const ringerCss = read('src/call-ringer.css')
const main = read('src/main.tsx')
const publicApp = read('src/room7-public/ExternalRoom7App.tsx')
const publicCss = read('src/room7-public/room7-public.css')
const install = read('src/room7-public/Room7Install.tsx')

test('internal Room7 opts into shared responsive surfaces without changing call entry points', () => {
  assert.match(room, /roomPage responsiveModule/)
  assert.match(meeting, /roomCallPage roomCallPortal responsiveModule/)
  assert.match(meeting, /roomCallActions responsiveActionBar/)
  assert.match(ringer, /callRinger responsiveModule/)
  assert.match(meeting, /endRoom\(\)/)
  assert.match(meeting, /End call/)
  assert.match(meeting, /End ROOM 7/)
})

test('meeting and compact call frames use dynamic viewport and safe areas', () => {
  assert.match(roomCss, /100dvh/)
  assert.match(roomCss, /safe-area-inset-bottom/)
  assert.match(roomCss, /safe-area-inset-left/)
  assert.match(roomCss, /safe-area-inset-right/)
  assert.match(roomCss, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*1023px\)/)
  assert.match(roomCss, /\.roomCallActions/)
})

test('ringer stays touch safe and clear of phone notches', () => {
  assert.match(ringer, /aria-label="Decline call"/)
  assert.match(ringer, /aria-label="Accept call"/)
  assert.match(ringer, /aria-label="Cancel call"/)
  assert.match(ringerCss, /safe-area-inset-top/)
  assert.match(ringerCss, /\.callBtn\s*\{[^}]*width:\s*56px[^}]*height:\s*56px/s)
  assert.match(ringerCss, /prefers-reduced-motion:\s*reduce/)
})

test('public Room7 retains its separate lazy entry boundary', () => {
  assert.match(main, /const ExternalRoom7App = lazy/)
  assert.match(main, /room7\.ridearrivo\.com/)
  assert.match(publicApp, /const ExternalRoom7Meeting = lazy/)
  assert.match(publicApp, /<Suspense/)
  assert.match(publicApp, /<ExternalRoom7Meeting/)
})

test('public guest and install surfaces expose compact responsive markers', () => {
  assert.match(publicApp, /room7Public[^"']*responsiveModule/)
  assert.match(publicApp, /room7PublicJoinCard[^"']*responsiveFormSurface/)
  assert.match(publicCss, /100dvh/)
  assert.match(publicCss, /safe-area-inset-left/)
  assert.match(publicCss, /safe-area-inset-right/)
  assert.match(publicCss, /@media\s*\(max-width:\s*599px\)/)
  assert.match(install, /room7InstallBar[^"']*responsiveActionBar/)
})
