import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/room7Share.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const R = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const module_ = readFileSync('src/modules/RoomModule.tsx', 'utf8')
const guest = readFileSync('src/room7-public/ExternalRoom7App.tsx', 'utf8')

const room = { id: 'r1', code: 'UFCKV8V7', title: 'Board call' }

// A tiny stand-in for the server that enforces the same state order and rules.
function fakeServer(initial = null) {
  let event = initial
  const calls = []
  const next = { draft: ['pre_event'], pre_event: ['doors_open'], doors_open: ['pre_event', 'live'], live: ['intermission', 'ended'] }
  const invoke = async body => {
    calls.push(body)
    if (body.action === 'get') return { event }
    if (body.action === 'configure') {
      event = { event_state: 'draft', ...event, public_enabled: body.public_enabled, access_mode: body.access_mode, has_passcode: !!body.passcode || !!event?.has_passcode, scheduled_end: 'scheduled_end' in body ? body.scheduled_end : event?.scheduled_end ?? null }
      return { event }
    }
    if (body.action === 'set_state') {
      const state = event.event_state
      if (!next[state]?.includes(body.event_state)) throw new Error(`ROOM 7 cannot move directly from ${state} to ${body.event_state}.`)
      if (!event.public_enabled) throw new Error('Enable the external ROOM 7 page before opening this event to guests.')
      event = { ...event, event_state: body.event_state }
      return { event }
    }
    throw new Error('unexpected ' + body.action)
  }
  return { invoke, calls, get event() { return event } }
}

test('a brand new room is configured, walked to Live, and the event code alone is the key', async () => {
  const server = fakeServer(null)
  const ready = await R.makeGuestReady(server.invoke, room)
  assert.equal(server.event.event_state, 'live')
  assert.equal(server.event.access_mode, 'passcode')
  assert.equal(server.event.public_enabled, true)
  assert.equal(ready.link, 'https://room7.ridearrivo.com/r/UFCKV8V7')
  assert.equal(ready.code, 'UFCKV8V7')
  assert.equal(ready.passcode, null)
  assert.equal(ready.codeOnly, true)
  assert.equal(server.calls.find(c => c.action === 'configure').passcode, 'UFCKV8V7')
  assert.deepEqual(server.calls.filter(c => c.action === 'set_state').map(c => c.event_state), ['pre_event', 'doors_open', 'live'])
})

test('a room already open to guests keeps its passcode instead of replacing it', async () => {
  const server = fakeServer({ event_state: 'live', public_enabled: true, access_mode: 'passcode', has_passcode: true, scheduled_end: null })
  const ready = await R.makeGuestReady(server.invoke, room)
  assert.equal(ready.alreadyOpen, true)
  assert.equal(ready.passcode, null)
  assert.deepEqual(server.calls.map(c => c.action), ['get'])
})

test('asking for a new passcode replaces it and keeps the room open', async () => {
  const server = fakeServer({ event_state: 'live', public_enabled: true, access_mode: 'passcode', has_passcode: true, scheduled_end: null })
  const ready = await R.makeGuestReady(server.invoke, room, { newPasscode: true })
  assert.equal(ready.alreadyOpen, false)
  assert.equal(ready.codeOnly, false)
  assert.match(ready.passcode, /^[A-HJ-NP-Z2-9]{8}$/)
  assert.notEqual(ready.passcode, room.code)
  assert.equal(server.event.event_state, 'live')
})

test('choosing the event code only replaces an older passcode and keeps the room open', async () => {
  const server = fakeServer({ event_state: 'live', public_enabled: true, access_mode: 'passcode', has_passcode: true, scheduled_end: null })
  const ready = await R.makeGuestReady(server.invoke, room, { codeOnly: true })
  assert.equal(ready.codeOnly, true)
  assert.equal(ready.passcode, null)
  assert.equal(server.calls.find(c => c.action === 'configure').passcode, 'UFCKV8V7')
  assert.equal(server.event.event_state, 'live')
})

test('the event code is long enough for the server passcode rule (6 to 128)', () => {
  assert.ok(room.code.length >= 6 && room.code.length <= 128)
})

test('an invitation for a code-only event has no passcode step, one with a separate passcode does', () => {
  const plain = R.invitationText({ title: 'T', code: 'UFCKV8V7' })
  assert.ok(!/passcode/i.test(plain))
  const kept = R.invitationText({ title: 'T', code: 'UFCKV8V7', passcodeSeparate: true })
  assert.match(kept, /and the passcode/)
})

test('a room configured earlier but still in Draft is opened, not left closed', async () => {
  const server = fakeServer({ event_state: 'draft', public_enabled: false, access_mode: 'invitation', has_passcode: false })
  const ready = await R.makeGuestReady(server.invoke, room)
  assert.equal(server.event.event_state, 'live')
  assert.equal(server.event.public_enabled, true)
  assert.equal(ready.alreadyOpen, false)
})

test('a scheduled end in the past is cleared so guests are not shut out on arrival', async () => {
  const server = fakeServer({ event_state: 'live', public_enabled: true, access_mode: 'passcode', has_passcode: true, scheduled_end: '2026-01-01T00:00:00Z' })
  await R.makeGuestReady(server.invoke, room, { now: () => Date.parse('2026-10-12T12:00:00Z') })
  assert.equal(server.event.scheduled_end, null)
})

test('an ended event is not silently reopened', async () => {
  const server = fakeServer({ event_state: 'ended', public_enabled: true, access_mode: 'passcode', has_passcode: true })
  await assert.rejects(() => R.makeGuestReady(server.invoke, room), /has ended/)
})

test('server problems are explained in words a host can act on', () => {
  assert.match(R.friendlyEventError('ROOM 7 passcode protection is not configured.'), /ROOM7_ACCESS_PEPPER/)
  assert.match(R.friendlyEventError('Only the ROOM 7 host, Manager or Administrator can control this external event.'), /created this ROOM 7/)
  assert.equal(R.friendlyEventError('something else'), 'something else')
})

test('generated passcodes are unbiased, readable, and different each time', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(R.generatePasscode())
  assert.ok(seen.size > 195)
  for (const code of seen) assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/)
  // 32 symbols divide 256 evenly, so every byte maps cleanly: 255 -> last symbol, 254 -> second last, 0 -> A, 1 -> B
  assert.equal(R.generatePasscode(4, () => new Uint8Array([255, 254, 0, 1, 2, 3, 4, 5])), '98AB')
})

test('the invitation message carries link, code, passcode and plain steps', () => {
  const text = R.invitationText({ title: 'Board call', code: 'UFCKV8V7', passcode: 'K7M2QX9P' })
  assert.match(text, /Join link: https:\/\/room7\.ridearrivo\.com\/r\/UFCKV8V7/)
  assert.match(text, /Event code: UFCKV8V7/)
  assert.match(text, /Passcode: K7M2QX9P/)
  assert.match(text, /type the event code/)
  assert.ok(!text.includes('—'))
  assert.match(R.whatsappLink('a b'), /^https:\/\/wa\.me\/\?text=a%20b$/)
})

test('the screen offers the guest link on the new-meeting banner and on every room card', () => {
  assert.match(module_, /Guest link and code/)
  assert.match(module_, /'Guest link'/)
  assert.match(module_, /makeGuestReady\(invokeEvent/)
  assert.match(module_, /Copy invitation message/)
  assert.match(module_, /Share on WhatsApp/)
  assert.ok(!/copyGuestLink/.test(module_), 'the old link that was handed out before setup is gone')
})

test('a guest who types the passcode in lowercase is retried once in capitals', () => {
  assert.match(guest, /passcode is incorrect/)
  assert.match(guest, /typed\.toUpperCase\(\)/)
  assert.match(guest, /autoCapitalize="characters"/)
  assert.ok(!/type="password"[\s\S]{0,120}Event passcode/.test(guest))
})

test('the guest page tries the event code first, then asks for a passcode only if needed', () => {
  assert.match(guest, /locator\?\.room_code/)
  assert.match(guest, /Have a separate passcode\?/)
  assert.match(guest, /This event also needs a passcode/)
})

test('an early guest waits in the lobby and is let in by themselves', () => {
  assert.match(guest, /setInterval\(\(\) => void check\(\), 5000\)/)
  assert.match(guest, /visibilitychange/)
  assert.match(guest, /ended'[\s\S]{0,40}replay/)
})

test('returning guests keep their name and email on this device', () => {
  assert.match(guest, /ridearrivo:room7:guest/)
  assert.match(guest, /writeGuestMemory\(name\.trim\(\), email\.trim\(\)\)/)
})
