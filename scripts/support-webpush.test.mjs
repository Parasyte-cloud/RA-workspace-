// PArAsYtE | RA-Workspace support module
// Web Push: the receiving side below is written from RFC 8291 section 3.4 independently of the sender.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, createDecipheriv, createHmac, createPublicKey, createVerify } from 'node:crypto'
import * as wp from '../supabase/functions/_shared/webPush.ts'

const b64u = (b) => Buffer.from(b).toString('base64url')
const hkdf = (salt, ikm, info, len) => {
  const prk = createHmac('sha256', salt).update(ikm).digest()
  let t = Buffer.alloc(0), out = Buffer.alloc(0)
  for (let i = 1; out.length < len; i++) { t = createHmac('sha256', prk).update(Buffer.concat([t, info, Buffer.from([i])])).digest(); out = Buffer.concat([out, t]) }
  return out.subarray(0, len)
}

function receive(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20]
  const asPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen)
  assert.equal(rs, 4096)
  const shared = uaEcdh.computeSecret(asPublic)
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]), 32)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  const d = createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(cipher.subarray(cipher.length - 16))
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()])
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter')
  return plain.subarray(0, plain.length - 1)
}

test('payload encrypts so that a standards-based receiver can read it', async () => {
  const ua = createECDH('prime256v1'); ua.generateKeys()
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16)))
  const msg = JSON.stringify({ title: 'SOS SOS-2026-000001', body: 'Open the Support workspace now. Café ☎', n: 7 })
  const body = await wp.encryptPushPayload({ plaintext: new TextEncoder().encode(msg), p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) })
  assert.equal(receive(Buffer.from(body), ua, auth).toString('utf8'), msg)
})

test('a wrong auth secret cannot decrypt, and every message uses fresh keys and salt', async () => {
  const ua = createECDH('prime256v1'); ua.generateKeys()
  const auth = Buffer.alloc(16, 7), other = Buffer.alloc(16, 9)
  const a = Buffer.from(await wp.encryptPushPayload({ plaintext: new Uint8Array([1, 2, 3]), p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) }))
  const b = Buffer.from(await wp.encryptPushPayload({ plaintext: new Uint8Array([1, 2, 3]), p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) }))
  assert.notDeepEqual(a, b)
  assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16))
  assert.throws(() => receive(a, ua, other))
})

test('payload limits and bad keys are refused', async () => {
  const ua = createECDH('prime256v1'); ua.generateKeys()
  const k = { p256dh: b64u(ua.getPublicKey()), auth: b64u(Buffer.alloc(16)) }
  await wp.encryptPushPayload({ plaintext: new Uint8Array(wp.MAX_PUSH_PLAINTEXT), ...k })
  await assert.rejects(wp.encryptPushPayload({ plaintext: new Uint8Array(wp.MAX_PUSH_PLAINTEXT + 1), ...k }), /too large/)
  await assert.rejects(wp.encryptPushPayload({ plaintext: new Uint8Array(1), p256dh: 'AAAA', auth: k.auth }), /bad p256dh/)
  await assert.rejects(wp.encryptPushPayload({ plaintext: new Uint8Array(1), p256dh: k.p256dh, auth: 'AA' }), /bad auth/)
})

test('VAPID header is a valid ES256 JWT bound to the push service origin', async () => {
  const keys = await wp.generateVapidKeys()
  assert.equal(wp.b64uDecode(keys.publicKey).length, 65)
  assert.equal(wp.b64uDecode(keys.privateKey).length, 32)
  const header = await wp.vapidAuthorization({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', subject: 'mailto:support@example.com', publicKey: keys.publicKey, privateKey: keys.privateKey, nowSeconds: 1_800_000_000 })
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header)
  assert.ok(m && m[2] === keys.publicKey)
  const [h, c, s] = m[1].split('.')
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' })
  const claims = JSON.parse(Buffer.from(c, 'base64url'))
  assert.equal(claims.aud, 'https://fcm.googleapis.com')
  assert.equal(claims.sub, 'mailto:support@example.com')
  assert.equal(claims.exp, 1_800_000_000 + 12 * 3600)
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(wp.b64uDecode(keys.publicKey).slice(1, 33)), y: b64u(wp.b64uDecode(keys.publicKey).slice(33)) }, format: 'jwk' })
  const v = createVerify('SHA256').update(`${h}.${c}`)
  assert.ok(v.verify({ key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')))
  assert.ok(!createVerify('SHA256').update(`${h}.${c}x`).verify({ key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')))
})

test('sendWebPush classifies push service answers and refuses insecure endpoints', async () => {
  const ua = createECDH('prime256v1'); ua.generateKeys()
  const keys = await wp.generateVapidKeys()
  const base = { p256dh: b64u(ua.getPublicKey()), auth: b64u(Buffer.alloc(16, 3)), payload: { t: 1 }, vapid: { subject: 'mailto:a@b.co', ...keys } }
  const real = globalThis.fetch
  try {
    let seen
    const answer = (status) => { globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response(null, { status }) } }
    answer(201)
    assert.deepEqual((await wp.sendWebPush({ ...base, endpoint: 'https://push.example.com/x', topic: 'abc' })).ok, true)
    assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm')
    assert.equal(seen.init.headers.Urgency, 'high')
    assert.equal(seen.init.headers.Topic, 'abc')
    assert.match(seen.init.headers.Authorization, /^vapid t=.+, k=.+$/)
    answer(410); assert.deepEqual(await wp.sendWebPush({ ...base, endpoint: 'https://push.example.com/x' }), { ok: false, status: 410, gone: true, retry: false, detail: 'subscription expired' })
    answer(429); assert.equal((await wp.sendWebPush({ ...base, endpoint: 'https://push.example.com/x' })).retry, true)
    answer(503); assert.equal((await wp.sendWebPush({ ...base, endpoint: 'https://push.example.com/x' })).retry, true)
    answer(403); assert.equal((await wp.sendWebPush({ ...base, endpoint: 'https://push.example.com/x' })).retry, false)
    globalThis.fetch = async () => { throw new Error('boom') }
    assert.equal((await wp.sendWebPush({ ...base, endpoint: 'https://push.example.com/x' })).retry, true)
    const insecure = await wp.sendWebPush({ ...base, endpoint: 'http://push.example.com/x' })
    assert.equal(insecure.ok, false); assert.equal(insecure.retry, false)
    answer(201)
    assert.equal((await wp.sendWebPush({ ...base, endpoint: 'https://push.example.com/x', topic: 'bad topic!' })).ok, true)
    assert.equal(seen.init.headers.Topic, undefined)
  } finally { globalThis.fetch = real }
})
