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

const ID = '11111111-1111-4111-8111-111111111111'

test('a tap opens the exact chat, room or inbox, and ignores malformed ids', () => {
  const url = row => P.buildPushMessage({ id: 'n', title: 't', ...row }).url
  assert.equal(url({ type: 'chat_message', entity_type: 'social_conversation', entity_id: ID }), `/?section=chat&conversation=${ID}`)
  assert.equal(url({ type: 'call', entity_id: ID }), `/?section=chat&conversation=${ID}`)
  assert.equal(url({ type: 'chat_message', entity_type: 'social_conversation', entity_id: '../../x' }), '/?section=chat')
  assert.equal(url({ type: 'room_join_request', entity_id: ID }), `/?section=room&room=${ID}`)
  assert.equal(url({ type: 'mail_message' }), '/?section=mail')
})

test('preferences decide what is pushed, and calls can ring through quiet hours', () => {
  const prefs = { ...P.DEFAULT_PREFS, quiet_enabled: true, quiet_start: '22:00', quiet_end: '07:00', timezone: 'UTC' }
  const night = new Date('2026-10-16T23:30:00Z')
  const noon = new Date('2026-10-16T12:00:00Z')
  assert.equal(P.inQuietHours(night, prefs), true)
  assert.equal(P.inQuietHours(new Date('2026-10-16T03:00:00Z'), prefs), true)
  assert.equal(P.inQuietHours(noon, prefs), false)
  assert.deepEqual(P.decidePush({ type: 'chat_message' }, prefs, night), { send: false, reason: 'quiet_hours' })
  assert.deepEqual(P.decidePush({ type: 'call' }, prefs, night), { send: true })
  assert.deepEqual(P.decidePush({ type: 'call' }, { ...prefs, quiet_allow_calls: false }, night), { send: false, reason: 'quiet_hours' })
  assert.deepEqual(P.decidePush({ type: 'mail_message' }, { ...prefs, push_mail: false }, noon), { send: false, reason: 'preference' })
  assert.deepEqual(P.decidePush({ type: 'push_test' }, { ...prefs, push_chat: false }, night), { send: true })
})

test('previews off hides content but keeps the caller on a ring', () => {
  const off = { show_previews: false }
  const chat = P.applyPreviewSetting(P.buildPushMessage({ id: 'n', type: 'chat_message', title: 'Ada', body: 'secret' }), off)
  assert.equal(chat.body, 'You have a new message')
  assert.equal(chat.title, 'RideArrivo')
  const call = P.applyPreviewSetting(P.buildPushMessage({ id: 'n', type: 'call', title: 'Ada is calling', body: 'Voice' }), off)
  assert.equal(call.title, 'Ada is calling')
})

test('new mail, waiting guests and the Settings screen are wired up', () => {
  assert.match(read('supabase/functions/mail-notify-poll/index.ts'), /email_status: "skipped"/)
  assert.match(read('supabase/migrations/20261016270000_push_everywhere.sql'), /room7_join_request_notify/)
  assert.match(read('src/modules/NotificationSettings.tsx'), /<AlertPreferences \/>/)
  assert.match(read('src/chat/ChatShell.tsx'), /get\('conversation'\)/)
})

test('notification tap asks the open app to navigate instead of reloading it, and messages are counted', async () => {
  const sw = read('public/sw.js')
  assert.match(sw, /type: 'ra-open'/)
  assert.match(sw, /MessageChannel/)
  assert.match(sw, /getNotifications\(\{ tag: data\.tag \}\)/)
  assert.match(sw, /new messages/)
  const bridge = read('src/lib/pushBridge.ts')
  assert.match(bridge, /ra-open/)
  assert.match(bridge, /clearTray/)
  assert.match(read('src/InternalApp.tsx'), /startPushBridge/)
})

test('parseOpenUrl routes chat links in the app and leaves room links to a normal navigation', async () => {
  const js = transformSync(read('src/lib/pushBridge.ts'), { loader: 'ts', format: 'esm' }).code
    .replace(/import .*desktopAlerts.*\n/, '')
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
  const o = 'https://app.test'
  const id = '123e4567-e89b-12d3-a456-426614174000'
  assert.deepEqual(mod.parseOpenUrl(`/?section=chat&conversation=${id}`, o), { section: 'chat', conversationId: id })
  assert.deepEqual(mod.parseOpenUrl('/?section=mail', o), { section: 'mail', conversationId: null })
  assert.equal(mod.parseOpenUrl(`/?section=room&room=${id}`, o), null)
  assert.equal(mod.parseOpenUrl('https://evil.test/?section=chat', o), null)
  assert.deepEqual(mod.parseOpenUrl('/', o), { section: 'overview' })
  assert.equal(mod.parseOpenUrl('/?section=chat&conversation=not-a-uuid', o).conversationId, null)
})
