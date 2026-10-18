import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'

/*
 * Regression tests for the chat / call audio and notification audit.
 * Each block names the failure it guards against.
 */

const read = p => readFileSync(p, 'utf8')
let instance = 0
// Fresh copy of a module (its own module-level state) every time it is loaded.
const load = async path => {
  const code = buildSync({ entryPoints: [path], bundle: true, format: 'esm', write: false }).outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(`${code}\n// copy ${++instance}`).toString('base64')}`)
}

function fakeStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: k => { delete data[k] },
  }
}

// A minimal browser: listeners are recorded so tests can fire and count them.
function installBrowser({ audioSession = true, storage = {} } = {}) {
  const listeners = new Map()
  const removed = []
  const win = {
    localStorage: fakeStorage(storage),
    addEventListener: (name, fn) => { listeners.set(name, [...(listeners.get(name) || []), fn]) },
    removeEventListener: (name, fn) => { removed.push(name); listeners.set(name, (listeners.get(name) || []).filter(f => f !== fn)) },
    setTimeout, clearTimeout, setInterval, clearInterval,
  }
  const docListeners = new Map()
  globalThis.window = win
  globalThis.localStorage = win.localStorage // browsers expose it bare as well
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => { docListeners.set(name, [...(docListeners.get(name) || []), fn]) },
    removeEventListener: (name, fn) => { docListeners.set(name, (docListeners.get(name) || []).filter(f => f !== fn)) },
  }
  const session = audioSession ? { type: 'auto', state: 'active', addEventListener: (n, f) => { session._l[n] = f }, removeEventListener: n => { delete session._l[n] }, _l: {} } : null
  Object.defineProperty(globalThis, 'navigator', { value: session ? { audioSession: session, userAgent: 'test' } : { userAgent: 'test' }, configurable: true, writable: true })
  return {
    win, session, removed,
    fire: (name, target = win) => { for (const fn of (target === win ? listeners : docListeners).get(name) || []) fn({}) },
    count: name => (listeners.get(name) || []).length,
    doc: globalThis.document,
  }
}

// ---------------------------------------------------------------- banners ----
test('banner: a later message in the same chat (same row, newer created_at) raises a banner again', async () => {
  const { pickFreshToast, rememberAll } = await load('src/lib/toastPick.ts')
  const known = new Map()
  const first = { id: 'n1', created_at: '2026-10-18T10:00:00Z', read_at: null }
  rememberAll([], known)
  assert.equal(pickFreshToast([first], known)?.id, 'n1', 'a brand new notification banners')
  assert.equal(pickFreshToast([first], known), null, 'the same row is not shown twice')
  const bumped = { ...first, created_at: '2026-10-18T10:05:00Z' }
  assert.equal(pickFreshToast([bumped], known)?.id, 'n1', 'message 2 in the same chat banners (this was the bug)')
  assert.equal(pickFreshToast([bumped], known), null)
})

test('banner: history on first load, read rows, and unrelated list changes stay silent', async () => {
  const { pickFreshToast, rememberAll } = await load('src/lib/toastPick.ts')
  const known = new Map()
  const a = { id: 'a', created_at: '2026-10-18T09:00:00Z', read_at: null }
  rememberAll([a], known)
  assert.equal(pickFreshToast([a], known), null, 'the first snapshot is history')
  const read = { id: 'b', created_at: '2026-10-18T09:30:00Z', read_at: '2026-10-18T09:31:00Z' }
  assert.equal(pickFreshToast([read, a], known), null, 'an already read row never banners')
  assert.equal(pickFreshToast([a], known), null, 'a row leaving the list does not banner another')
})

test('banner: the newest of several fresh rows wins', async () => {
  const { pickFreshToast } = await load('src/lib/toastPick.ts')
  const known = new Map()
  const newer = { id: 'x', created_at: '2026-10-18T11:00:00Z', read_at: null }
  const older = { id: 'y', created_at: '2026-10-18T10:00:00Z', read_at: null }
  assert.equal(pickFreshToast([newer, older], known)?.id, 'x')
})

test('banner: the center uses the shared picker and skips the chat being read', () => {
  const center = read('src/components/NotificationCenter.tsx')
  assert.match(center, /pickFreshToast\(items,knownToastIdsRef\.current\)/)
  assert.match(center, /shouldChatSound\(/)
  assert.doesNotMatch(center, /knownToastIdsRef\.current\.has\(/, 'the id-only check is gone')
})

// ------------------------------------------------------- system alerts -------
test('alerts: "Later" is a three day snooze, and the old permanent marker is not honoured', async () => {
  installBrowser()
  const A = await load('src/lib/desktopAlerts.ts')
  const now = Date.UTC(2026, 9, 18, 12)
  assert.equal(A.alertsPromptDismissed(now), false, 'never dismissed')
  window.localStorage.setItem('ra.alerts.dismissed', '1')
  assert.equal(A.alertsPromptDismissed(now), false, 'the old "1" marker no longer hides the prompt for good')
  A.dismissAlertsPrompt(now)
  assert.equal(A.alertsPromptDismissed(now + 60_000), true, 'hidden right after Later')
  assert.equal(A.alertsPromptDismissed(now + A.ALERT_SNOOZE_MS - 1), true)
  assert.equal(A.alertsPromptDismissed(now + A.ALERT_SNOOZE_MS + 1), false, 'asks again after three days')
})

test('alerts: the tap target opens the right chat; junk ids are dropped', async () => {
  installBrowser()
  const A = await load('src/lib/desktopAlerts.ts')
  const id = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(A.alertUrl('chat', id), `/?section=chat&conversation=${id}`)
  assert.equal(A.alertUrl('chat', 'not-a-uuid'), '/?section=chat')
  assert.equal(A.alertUrl(null, id), '/')
})

test('alerts: shown through the service worker first (Android and the iPhone app refuse new Notification)', () => {
  const src = read('src/lib/desktopAlerts.ts')
  assert.match(src, /registration\.showNotification\(/)
  assert.match(src, /if \(!shown\) showViaConstructor\(options\)/)
  assert.match(src, /Notification\.permission !== 'granted' \|\| !tabIsBackground\(\)/)
})

// ------------------------------------------------------------ audio route ----
test('route: only re-applied when the phone has drifted from it', async () => {
  const b = installBrowser()
  const R = await load('src/lib/audioRoute.ts')
  R.applyRoute('phone')
  assert.equal(b.session.type, 'play-and-record')
  assert.equal(R.reassertRoute('phone'), false, 'already right: nothing to do')
  b.session.type = 'playback' // iOS puts it back after the microphone restarts
  assert.equal(R.reassertRoute('phone'), true)
  assert.equal(b.session.type, 'play-and-record')
  R.applyRoute('speaker')
  assert.equal(b.session.type, 'playback')
})

test('route: no Audio Session means nothing to do, and nothing breaks', async () => {
  installBrowser({ audioSession: false })
  const R = await load('src/lib/audioRoute.ts')
  assert.equal(R.reassertRoute('phone'), false)
  assert.equal(typeof R.watchRoute(() => 'phone'), 'function')
  const release = R.holdPlayback()
  assert.doesNotThrow(release)
})

test('route: the watcher re-applies on a session change and on coming back to the front, and stops cleanly', async () => {
  const b = installBrowser()
  const R = await load('src/lib/audioRoute.ts')
  R.applyRoute('phone')
  const stop = R.watchRoute(() => 'phone', 60_000)
  b.session.type = 'playback'
  b.session._l.statechange()
  assert.equal(b.session.type, 'play-and-record', 'statechange re-applies the route')
  b.session.type = 'auto'
  b.fire('visibilitychange', b.doc)
  assert.equal(b.session.type, 'play-and-record', 'returning to the app re-applies the route')
  stop()
  assert.equal(b.session._l.statechange, undefined, 'the session listener is removed')
})

test('silent switch: playback is held while a sound plays, counted, and released to auto', async () => {
  const b = installBrowser()
  const R = await load('src/lib/audioRoute.ts')
  const one = R.holdPlayback()
  const two = R.holdPlayback()
  assert.equal(b.session.type, 'playback')
  one()
  assert.equal(b.session.type, 'playback', 'still held by the second sound')
  one() // releasing twice must not over-release
  assert.equal(b.session.type, 'playback')
  two()
  assert.equal(b.session.type, 'auto')
})

test('silent switch: never touches the route during a call, and respects the setting', async () => {
  const b = installBrowser()
  const R = await load('src/lib/audioRoute.ts')
  const calls = await load('src/lib/activeCall.ts')
  void calls // a separate copy; the audioRoute bundle has its own, so test the setting here
  R.setPlayOnSilent(false)
  assert.equal(R.playOnSilentAllowed(), false)
  const release = R.holdPlayback()
  assert.equal(b.session.type, 'auto', 'turned off in Settings: left alone')
  release()
  R.setPlayOnSilent(true)
  assert.equal(R.playOnSilentAllowed(), true)
})

test('silent switch: the call route is left alone when a call is active', () => {
  const src = read('src/lib/audioRoute.ts')
  assert.match(src, /!playOnSilentAllowed\(\) \|\| getActiveCallId\(\)\) return \(\) => \{\}/)
  assert.match(src, /A call that started meanwhile has chosen its own route: leave it/)
})

// ----------------------------------------------------------------- ringtone ----
function fakeAudioContext(initial) {
  class Ctx {
    constructor() { this.state = initial; this.currentTime = 0; this.destination = {}; this.resumed = 0; Ctx.last = this }
    resume() { this.resumed += 1; this.state = 'running'; return Promise.resolve() }
    createBuffer() { return {} }
    createBufferSource() { return { connect() {}, start() {}, buffer: null } }
    createOscillator() { return { type: '', frequency: {}, connect() {}, start() {}, stop() {} } }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } }
  }
  return Ctx
}

test('sound: an iOS "interrupted" context counts as blocked and is resumed (it used to stay silent)', async () => {
  const b = installBrowser()
  b.win.AudioContext = fakeAudioContext('interrupted')
  const T = await load('src/lib/ringtone.ts')
  assert.equal(T.audioBlocked(), true, 'interrupted is not running')
  assert.equal(await T.ensureAudioRunning(), true)
  assert.equal(T.audioBlocked(), false)
  assert.equal(T.soundStatus().running, true)
})

test('sound: unlock listeners stay for the life of the page and re-unlock after the app was backgrounded', async () => {
  const b = installBrowser()
  const Ctx = fakeAudioContext('suspended')
  b.win.AudioContext = Ctx
  const T = await load('src/lib/ringtone.ts')
  T.audioBlocked() // creates the context
  T.wireAudioUnlock()
  for (const name of ['click', 'touchend', 'pointerup']) assert.ok(b.count(name) > 0, `${name} unlocks sound on iPhone`)

  b.fire('touchend')
  assert.equal(Ctx.last.state, 'running', 'the first tap unlocks')
  const resumedOnce = Ctx.last.resumed
  assert.equal(b.removed.length, 0, 'listeners are NOT removed after the first success (this was the bug)')

  // The phone locks or the app is backgrounded: iOS interrupts the context.
  Ctx.last.state = 'interrupted'
  assert.equal(T.audioBlocked(), true)
  b.fire('click')
  assert.equal(Ctx.last.state, 'running', 'the next tap brings sound back without a reload')
  assert.ok(Ctx.last.resumed > resumedOnce)

  // And coming back to the app tries to resume by itself, before any tap.
  Ctx.last.state = 'interrupted'
  b.fire('visibilitychange', b.doc)
  assert.equal(Ctx.last.state, 'running')
})

test('sound: a message sound that cannot play reports false so the app can ask for a tap', async () => {
  const b = installBrowser()
  class Stuck extends fakeAudioContext('suspended') { resume() { return new Promise(() => {}) } }
  b.win.AudioContext = Stuck
  const T = await load('src/lib/ringtone.ts')
  assert.equal(T.playPatternOnce(T.RINGTONES[0].pattern, 0.7), false)
  assert.equal(T.SOUND_BLOCKED_EVENT, 'ra:sound-blocked')
})

test('sound: the context announces a blocked message sound, and the prompt returns at most daily', () => {
  assert.match(read('src/context/NotificationsContext.tsx'), /playChatArrival\(\)===false\) window\.dispatchEvent\(new Event\(SOUND_BLOCKED_EVENT\)\)/)
  assert.match(read('src/context/NotificationsContext.tsx'), /wireAudioUnlock\(\)/)
  const prompt = read('src/components/SoundOnPrompt.tsx')
  assert.match(prompt, /REASK_MS = 24 \* 60 \* 60 \* 1000/)
  assert.match(prompt, /primeAudio\(\)/)
})

// ------------------------------------------------------------- call screen ----
test('calls: poor connection shows below 5 and only clears at 7 or better', async () => {
  const Q = await load('src/lib/callQuality.ts')
  let q = 'good'
  q = Q.nextQuality(q, 8); assert.equal(q, 'good')
  q = Q.nextQuality(q, 4); assert.equal(q, 'poor')
  q = Q.nextQuality(q, 6); assert.equal(q, 'poor', 'no flicker between 5 and 6')
  q = Q.nextQuality(q, 7); assert.equal(q, 'good')
  assert.equal(Q.nextQuality('good', NaN), 'good')
  assert.equal(Q.weakest({ me: 9, them: 3 }), 3, 'the weaker direction decides')
  assert.equal(Q.weakest({}), 10)
})

test('calls: the screen re-applies the route on microphone changes and shows the quality label', () => {
  const stage = read('src/modules/FaceTimeStage.tsx')
  assert.match(stage, /watchRoute\(\(\) => routeRef\.current\)/)
  for (const event of ['audioUpdate', 'videoUpdate', 'deviceUpdate', 'roomJoined']) assert.ok(stage.includes(`'${event}'`), event)
  assert.match(stage, /reassertRoute\(routeRef\.current\)/)
  assert.match(stage, /mediaScoreUpdate/)
  assert.match(stage, /Poor connection/)
  assert.match(read('src/facetime-call.css'), /\.ftQuality/)
})

test('calls: the self-check lists sound and silent-switch problems with a fix', () => {
  const check = read('src/components/CallRingCheck.tsx')
  assert.match(check, /Sound is switched on in the app/)
  assert.match(check, /Rings and message sounds play even on silent/)
  assert.match(read('src/modules/NotificationSettings.tsx'), /Play sounds even when the phone is on silent/)
})

test('house style: no em dash in anything this change added', () => {
  for (const f of ['src/lib/toastPick.ts', 'src/lib/callQuality.ts', 'src/lib/audioRoute.ts', 'src/lib/desktopAlerts.ts', 'src/components/CallRingCheck.tsx', 'src/components/SoundOnPrompt.tsx']) {
    assert.ok(!read(f).includes(String.fromCharCode(0x2014)), f)
  }
})
