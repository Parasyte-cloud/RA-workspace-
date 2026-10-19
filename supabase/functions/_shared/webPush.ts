// Web Push without a library: VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291 / RFC 8188),
// using only WebCrypto so it runs unchanged in Deno (Edge Functions) and Node (tests).
//
// PArAsYtE | RA-Workspace support module

const enc = new TextEncoder()

export function b64uEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uDecode(text: string): Uint8Array {
  const clean = text.trim().replace(/-/g, '+').replace(/_/g, '/')
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// ----------------------------------------------------------------------------- VAPID

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { publicKey: b64uEncode(raw), privateKey: String(jwk.d) }
}

async function importVapidPrivate(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = b64uDecode(publicKey)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be an uncompressed P-256 point')
  const jwk = { kty: 'EC', crv: 'P-256', d: privateKey, x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

export async function vapidAuthorization(opts: {
  endpoint: string; subject: string; publicKey: string; privateKey: string; nowSeconds?: number; ttlSeconds?: number
}): Promise<string> {
  const aud = new URL(opts.endpoint).origin
  const exp = (opts.nowSeconds ?? Math.floor(Date.now() / 1000)) + (opts.ttlSeconds ?? 12 * 3600)   // the spec caps this at 24 hours
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud, exp, sub: opts.subject })))
  const input = `${header}.${claims}`
  const key = await importVapidPrivate(opts.publicKey, opts.privateKey)
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input)))   // raw r||s, as JWS wants
  return `vapid t=${input}.${b64uEncode(sig)}, k=${opts.publicKey}`
}

// ----------------------------------------------------------------------------- payload encryption

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

export const MAX_PUSH_PLAINTEXT = 3993   // 4096 byte record minus header, delimiter and tag

export async function encryptPushPayload(opts: {
  plaintext: Uint8Array; p256dh: string; auth: string
  // Test hooks: fixed ephemeral key and salt. Never set in production.
  ephemeral?: CryptoKeyPair; salt?: Uint8Array
}): Promise<Uint8Array> {
  if (opts.plaintext.length > MAX_PUSH_PLAINTEXT) throw new Error('push payload too large')
  const uaPublic = b64uDecode(opts.p256dh)
  const authSecret = b64uDecode(opts.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad p256dh key')
  if (authSecret.length < 16) throw new Error('bad auth secret')

  const eph = opts.ephemeral ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256))
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, shared, keyInfo, 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const record = concat(opts.plaintext, new Uint8Array([2]))          // 0x02 marks the last record
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, record))

  const rs = new Uint8Array([0, 0, 16, 0])                            // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

// ----------------------------------------------------------------------------- sending

export type PushOutcome = { ok: boolean; status: number; gone: boolean; retry: boolean; detail: string }

export async function sendWebPush(opts: {
  endpoint: string; p256dh: string; auth: string; payload: unknown
  vapid: { subject: string; publicKey: string; privateKey: string }
  urgency?: 'very-low' | 'low' | 'normal' | 'high'; ttlSeconds?: number; topic?: string
}): Promise<PushOutcome> {
  try {
    const url = new URL(opts.endpoint)
    if (url.protocol !== 'https:') return { ok: false, status: 0, gone: true, retry: false, detail: 'endpoint is not https' }
    const body = await encryptPushPayload({ plaintext: enc.encode(JSON.stringify(opts.payload)), p256dh: opts.p256dh, auth: opts.auth })
    const headers: Record<string, string> = {
      Authorization: await vapidAuthorization({ endpoint: opts.endpoint, ...opts.vapid }),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttlSeconds ?? 3600),
      Urgency: opts.urgency ?? 'high',
    }
    if (opts.topic && /^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) headers.Topic = opts.topic
    const res = await fetch(opts.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) })
    const status = res.status
    await res.body?.cancel().catch(() => undefined)
    if (status >= 200 && status < 300) return { ok: true, status, gone: false, retry: false, detail: 'sent' }
    if (status === 404 || status === 410) return { ok: false, status, gone: true, retry: false, detail: 'subscription expired' }
    if (status === 400 || status === 401 || status === 403 || status === 413) return { ok: false, status, gone: false, retry: false, detail: `push service refused it (${status})` }
    return { ok: false, status, gone: false, retry: true, detail: `push service answered ${status}` }
  } catch (e) {
    return { ok: false, status: 0, gone: false, retry: true, detail: e instanceof Error ? e.message.slice(0, 120) : 'network error' }
  }
}
