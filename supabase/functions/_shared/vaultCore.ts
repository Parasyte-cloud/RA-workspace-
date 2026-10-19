// Pure helpers for confidential messages. No Deno or Supabase imports, so the
// same code is tested in Node and runs in the edge function.
//
// Three secrets are involved and they live only in the edge function's
// environment, never in the database:
//   VAULT_MASTER_KEY  32 random bytes, base64. Encrypts the text (AES-256-GCM).
//   VAULT_PEPPER      a long random string. Keys the hash of the one-time key.
// With the pepper, a copy of the database alone cannot be used to guess the
// one-time keys offline; with the master key, it cannot be read either.

// No I, L, O, 0 or 1, so a key read aloud or off a screen is not mistaken.
export const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const KEY_LENGTH = 12

export const VIEW_SECONDS_PRESETS = [15, 30, 60, 300, 900, 1800, 3600] as const
export const MAX_TEXT_LENGTH = 10000
export const MAX_FILE_BYTES = 15 * 1024 * 1024

export type VaultSecrets = { masterKey: Uint8Array; pepper: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function b64encode(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += String.fromCharCode(b)
  return btoa(out)
}

function b64decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Returns null when the secrets are missing or malformed. The function then
// refuses to run rather than falling back to something weaker.
export function parseSecrets(masterKeyB64: string | undefined, pepper: string | undefined): VaultSecrets | null {
  const mk = (masterKeyB64 || '').trim()
  const pp = (pepper || '').trim()
  if (!mk || pp.length < 32) return null
  try {
    const bytes = b64decode(mk)
    if (bytes.length !== 32) return null
    return { masterKey: bytes, pepper: pp }
  } catch {
    return null
  }
}

// Uniform pick from the alphabet: bytes above the largest multiple of the
// alphabet size are thrown away, so no character is more likely than another.
export function generateKey(): string {
  const limit = 256 - (256 % KEY_ALPHABET.length)
  let out = ''
  while (out.length < KEY_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(KEY_LENGTH * 2))
    for (const byte of bytes) {
      if (byte < limit && out.length < KEY_LENGTH) out += KEY_ALPHABET[byte % KEY_ALPHABET.length]
    }
  }
  return out
}

// What a person typed, made comparable: case and spacing and dashes ignored.
export function normalizeKey(input: unknown): string {
  if (typeof input !== 'string') return ''
  let out = ''
  for (const ch of input.toUpperCase()) if (KEY_ALPHABET.includes(ch)) out += ch
  return out
}

// ABCD-EFGH-JKMN for reading out loud.
export function formatKey(key: string): string {
  return key.match(/.{1,4}/g)?.join('-') || key
}

export function isCompleteKey(key: string): boolean {
  return key.length === KEY_LENGTH
}

// Keyed hash of the normalised key. This is all the database ever stores.
export async function hashKey(key: string, secrets: VaultSecrets): Promise<string> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secrets.pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(`vault-key:${key}`))
  return hex(new Uint8Array(mac))
}

async function aesKey(secrets: VaultSecrets): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', secrets.masterKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// "v1:" + base64(iv + ciphertext). The context ties the ciphertext to the chat
// and the sender it was written for, so a sealed text copied into another row
// does not open there.
export async function sealText(plain: string, secrets: VaultSecrets, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
      await aesKey(secrets),
      encoder.encode(plain),
    ),
  )
  const joined = new Uint8Array(iv.length + cipher.length)
  joined.set(iv, 0)
  joined.set(cipher, iv.length)
  return `v1:${b64encode(joined)}`
}

export async function openText(sealed: string, secrets: VaultSecrets, context: string): Promise<string> {
  if (!sealed.startsWith('v1:')) throw new Error('Unknown sealed format.')
  const joined = b64decode(sealed.slice(3))
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: joined.slice(0, 12), additionalData: encoder.encode(context) },
    await aesKey(secrets),
    joined.slice(12),
  )
  return decoder.decode(plain)
}

export function sealContext(conversationId: string, senderId: string): string {
  return `${conversationId}:${senderId}`
}

export function allowedViewSeconds(ceiling: number): number[] {
  return VIEW_SECONDS_PRESETS.filter((seconds) => seconds <= ceiling)
}

export function cleanFileName(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  const name = raw.replace(/[\\/\u0000-\u001f]/g, '_').trim().slice(0, 120)
  return name || 'document'
}

// The browser says what a file is; the first bytes say what it really is.
export function sniffMime(head: Uint8Array): string | null {
  const at = (i: number) => head[i] ?? -1
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) return 'application/pdf'
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif'
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) return 'image/webp'
  return null
}

export function isAllowedMime(mime: string): boolean {
  return mime === 'application/pdf' || ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)
}

// Words for each way a key attempt can end. Kept here so the screen and the
// server never disagree.
export function openFailureMessage(code: string, attemptsLeft?: number): string {
  switch (code) {
    case 'wrong_key':
      return typeof attemptsLeft === 'number'
        ? `That key is not right. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`
        : 'That key is not right.'
    case 'locked':
      return 'Too many wrong keys. This message is locked. Contact an administrator.'
    case 'spent':
      return 'This message was already viewed. Need to view again? Contact an administrator.'
    case 'destroyed':
      return 'This message was deleted.'
    case 'own':
      return 'You sent this message.'
    case 'pending':
      return 'This message is not ready yet.'
    case 'forbidden':
    case 'not_found':
      return 'This message is not available to you.'
    default:
      return 'This message could not be opened.'
  }
}
