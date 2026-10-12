import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const load = async path => {
  const js = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm', define: { 'import.meta.env.VITE_VAPID_PUBLIC_KEY': '""' } }).code
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}
const P = await load('supabase/functions/_shared/pushPayload.ts')
const C = await load('src/lib/pushClient.ts')
const read = p => readFileSync(p, 'utf8')

test('a ringing call is urgent, short lived and tagged by conversation', () => {
  const m = P.buildPushMessage({ id: 'n1', type: 'call', title: 'Ada is calling', body: 'Incoming voice call', entity_type: 'social_conversation', entity_id: 'k1' })
  assert.equal(m.urgent, true)
  assert.equal(m.ttl, 45)
  assert.equal(m.tag, 'call-k1')
  assert.equal(m.url, '/?section=chat')
})

test('the missed call replaces the ring on the phone (same tag)', () => {
  const ring = P.buildPushMessage({ id: 'n1', type: 'call', title: 't', entity_id: 'k1' })
  const missed = P.buildPushMessage({ id: 'n2', type: 'call_missed', title: 'Missed call', entity_id: 'k1' })
  assert.equal(ring.tag, missed.tag)
  assert.equal(missed.urgent, false)
})

test('ordinary notifications wait up to a day and never use the call tag', () => {
  const m = P.buildPushMessage({ id: 'n3', type: 'task_assigned', title: 'x'.repeat(500), body: 'y'.repeat(500) })
  assert.equal(m.urgent, false)
  assert.equal(m.ttl, 86400)
  assert.equal(m.tag, 'n-n3')
  assert.ok(m.title.length <= 120 && m.body.length <= 200)
})

test('gone subscriptions are recognised', () => {
  assert.equal(P.isGone(404), true)
  assert.equal(P.isGone(410), true)
  assert.equal(P.isGone(500), false)
})

test('public key converts to bytes and back', () => {
  const bytes = C.urlBase64ToUint8Array('AQIDBA')
  assert.deepEqual([...bytes], [1, 2, 3, 4])
  assert.equal(C.bufferToBase64Url(new Uint8Array([1, 2, 3, 4]).buffer), 'AQIDBA')
})

test('support: hidden until configured, iPhone needs install, blocked is reported', () => {
  const base = { hasWorker: true, hasPush: true, hasNotification: true, ios: false, standalone: false, permission: 'default', key: 'k' }
  assert.equal(C.pushSupport({ ...base, key: '' }), 'not-configured')
  assert.equal(C.pushSupport({ ...base, ios: true }), 'needs-install')
  assert.equal(C.pushSupport({ ...base, ios: true, standalone: true }), 'ready')
  assert.equal(C.pushSupport({ ...base, permission: 'denied' }), 'blocked')
  assert.equal(C.pushSupport({ ...base, hasPush: false }), 'unsupported')
  assert.equal(C.pushSupport(base), 'ready')
})

test('migration: trigger is exception safe and own-rows only', () => {
  const sql = read('supabase/migrations/20261012260000_web_push.sql')
  assert.match(sql, /exception when others then\s+return new/)
  assert.match(sql, /user_id = auth\.uid\(\)/)
  assert.doesNotMatch(sql, /grant (insert|update)[^;]*to authenticated/i)
  assert.match(sql, /vault\.decrypted_secrets/)
})

test('service worker shows pushes, skips them when the app is in front, and opens on tap', () => {
  const sw = read('public/sw.js')
  assert.match(sw, /addEventListener\('push'/)
  assert.match(sw, /visibilityState === 'visible'/)
  assert.match(sw, /addEventListener\('notificationclick'/)
  assert.match(sw, /requireInteraction: Boolean\(data\.urgent\)/)
})

test('function authenticates with a shared secret and the toggle is in the bell menu', () => {
  assert.match(read('supabase/functions/push-dispatch/index.ts'), /x-push-secret/)
  assert.match(read('supabase/config.toml'), /\[functions\.push-dispatch\][\s\S]*verify_jwt = false/)
  assert.match(read('src/components/NotificationCenter.tsx'), /<PhoneAlertsToggle\/>/)
})
