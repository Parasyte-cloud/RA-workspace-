import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/keepSignedIn.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const K = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

const mem = () => {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k), m }
}

test('no flag means stay signed in, so existing installs do not change', () => {
  assert.equal(K.readKeepSignedIn(mem()), true)
})

test('ticked keeps the session in local storage, unticked in session storage', () => {
  const local = mem(), session = mem()
  const auth = K.createAuthStorage(local, session)
  K.writeKeepSignedIn(local, true)
  auth.setItem('s', 'one')
  assert.equal(local.getItem('s'), 'one')
  assert.equal(session.getItem('s'), null)
  K.writeKeepSignedIn(local, false)
  auth.setItem('s', 'two')
  assert.equal(session.getItem('s'), 'two')
  assert.equal(local.getItem('s'), null)
  assert.equal(auth.getItem('s'), 'two')
})

test('sign out clears both places', () => {
  const local = mem(), session = mem()
  local.setItem('s', 'a'); session.setItem('s', 'b')
  K.createAuthStorage(local, session).removeItem('s')
  assert.equal(local.getItem('s'), null)
  assert.equal(session.getItem('s'), null)
})

test('switching in Settings moves the live session without signing out', () => {
  const local = mem(), session = mem()
  local.setItem('s', 'tok')
  K.moveSession(local, session, 's', false)
  assert.equal(session.getItem('s'), 'tok')
  assert.equal(local.getItem('s'), null)
  assert.equal(K.readKeepSignedIn(local), false)
  K.moveSession(local, session, 's', true)
  assert.equal(local.getItem('s'), 'tok')
  assert.equal(session.getItem('s'), null)
})

test('phones default to ticked, desktop browsers to unticked', () => {
  assert.equal(K.defaultKeepForDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', true), true)
  assert.equal(K.defaultKeepForDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/120', false), false)
})

test('a broken storage never throws', () => {
  const bad = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') } }
  const auth = K.createAuthStorage(bad, bad)
  assert.equal(auth.getItem('s'), null)
  auth.setItem('s', 'v'); auth.removeItem('s')
})

test('the 30 minute idle sign-out respects "Keep me signed in"', () => {
  const idle = readFileSync('src/lib/useIdleSignOut.ts', 'utf8')
  assert.match(idle, /import \{ readKeepSignedIn \} from '\.\/keepSignedIn'/)
  const check = idle.slice(idle.indexOf('const checkIdle'), idle.indexOf('const activityEvents'))
  const keepAt = check.indexOf('readKeepSignedIn(window.localStorage)')
  assert.ok(keepAt > -1, 'checkIdle reads the flag live')
  assert.ok(keepAt < check.indexOf('signOutThisDevice(client'), 'flag is checked before signing out')
})

test('sidebar focus keeps only the thin glow, never the thick ring', () => {
  const css = readFileSync('src/nav-liquid.css', 'utf8')
  assert.match(css, /\.sidebar nav\.sidebarNav \.uiFocusRing:focus-within/)
  assert.match(css, /outline: 0 !important/)
})
