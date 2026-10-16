// Encrypts long-lived mailbox tokens before they reach the database, so a
// database dump or a leaked read-only connection does not hand out working
// mailbox access.
//
// AES-256-GCM, key from the ZOHO_TOKEN_KEY secret (32 random bytes, base64).
// Stored form: "enc1:" + base64(iv + ciphertext). Values without the prefix are
// treated as legacy plain text and still work, so turning this on never locks
// anyone out; they are re-encrypted the next time the mailbox is connected.
// With no key configured, tokens are stored as before.

const PREFIX = "enc1:"

function b64decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

function b64encode(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += String.fromCharCode(b)
  return btoa(out)
}

async function loadKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("ZOHO_TOKEN_KEY") || ""
  if (!raw) return null
  const bytes = b64decode(raw.trim())
  if (bytes.length !== 32) {
    throw new Error("ZOHO_TOKEN_KEY must be 32 bytes, base64 encoded.")
  }
  return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"])
}

export async function sealToken(plain: string): Promise<string> {
  const key = await loadKey()
  if (!key) return plain
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  )
  const joined = new Uint8Array(iv.length + cipher.length)
  joined.set(iv, 0)
  joined.set(cipher, iv.length)
  return PREFIX + b64encode(joined)
}

export async function openToken(stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) return stored
  const key = await loadKey()
  if (!key) throw new Error("ZOHO_TOKEN_KEY is required to read this mailbox token.")
  const joined = b64decode(stored.slice(PREFIX.length))
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: joined.slice(0, 12) },
    key,
    joined.slice(12),
  )
  return new TextDecoder().decode(plain)
}
