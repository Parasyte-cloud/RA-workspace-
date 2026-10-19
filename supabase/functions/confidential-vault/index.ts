// Confidential messages: the only door to the content.
//
// Browsers can see that a locked card exists and what state it is in. They can
// never read what is inside. This function seals content when it is sent, and
// hands it out only to a member of the chat who proves the one-time key, only
// once, and only for the view window the sender chose.
//
// Needs two secrets (see docs/confidential-messages.md):
//   VAULT_MASTER_KEY  base64 of 32 random bytes
//   VAULT_PEPPER      a random string of at least 32 characters
// Without them every call is refused. There is no weaker fallback.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import {
  MAX_FILE_BYTES,
  MAX_TEXT_LENGTH,
  cleanFileName,
  formatKey,
  generateKey,
  hashKey,
  isAllowedMime,
  isCompleteKey,
  normalizeKey,
  openFailureMessage,
  openText,
  parseSecrets,
  sealContext,
  sealText,
  sniffMime,
  type VaultSecrets,
} from "../_shared/vaultCore.ts"

const BUCKET = "confidential-vault"
const productionOrigin = "https://intranet.ridearrivo.com"
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function allowedOrigin(req: Request) {
  const origin = req.headers.get("Origin") || ""
  if (
    origin === productionOrigin ||
    /^https:\/\/[a-z0-9-]+\.ra-workspace\.pages\.dev$/i.test(origin) ||
    /^http:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(origin)
  ) return origin
  return productionOrigin
}

function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      // Content must never be cached by the browser, a proxy or the platform.
      "Cache-Control": "no-store, no-cache, max-age=0",
      "Pragma": "no-cache",
    },
  })
}

function fail(req: Request, status: number, code: string, error: string, extra: Record<string, unknown> = {}) {
  return json(req, { ok: false, code, error, ...extra }, status)
}

// Our own database functions raise readable messages with a known code.
function rpcFailure(req: Request, error: { code?: string; message?: string }) {
  const message = error?.message || "Something went wrong."
  switch (error?.code) {
    case "42501": return fail(req, 403, "forbidden", message)
    case "22023": return fail(req, 400, "invalid", message)
    case "P0002": return fail(req, 404, "not_found", message)
    default:
      console.error("confidential-vault database error:", error?.code, message)
      return fail(req, 500, "server", "Could not complete that. Try again.")
  }
}

function cleanUuid(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : ""
  return uuidPattern.test(raw) ? raw.toLowerCase() : ""
}

// Slows down someone hammering the vault. Fails open on purpose: the
// per-message lock-out in the database is the real brake.
async function rateCount(admin: any, key: string, windowSeconds: number) {
  try {
    const { data, error } = await admin.rpc("room7_rate_count", {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_increment: true,
    })
    if (error) return 0
    return Number(data) || 0
  } catch {
    return 0
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) })
  if (req.method !== "POST") return fail(req, 405, "method", "Method not allowed.")

  const authorization = req.headers.get("Authorization") || ""
  if (!authorization) return fail(req, 401, "auth", "Sign in required.")

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return fail(req, 500, "server", "Confidential messages are not configured.")

  const secrets: VaultSecrets | null = parseSecrets(
    Deno.env.get("VAULT_MASTER_KEY"),
    Deno.env.get("VAULT_PEPPER"),
  )
  if (!secrets) {
    return fail(req, 503, "not_configured", "Confidential messages are not set up yet. An administrator must add the vault secrets.")
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = authorization.replace(/^Bearer\s+/i, "")
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData?.user) return fail(req, 401, "auth", "Your session has expired. Sign in again.")
  const uid = userData.user.id

  const { data: profile } = await admin
    .from("employee_profiles")
    .select("id,full_name,role,active")
    .eq("id", uid)
    .maybeSingle()
  if (!profile || profile.active !== true) return fail(req, 403, "forbidden", "Your workspace profile is not active.")

  let body: any = null
  try {
    body = await req.json()
  } catch {
    return fail(req, 400, "invalid", "Invalid request.")
  }
  const action = typeof body?.action === "string" ? body.action : ""

  // Finish a send: make the key, store only its hash, post the locked card.
  async function seal(itemId: string) {
    const key = generateKey()
    const hash = await hashKey(key, secrets!)
    const { data: messageId, error } = await admin.rpc("vault_finish", {
      p_item: itemId,
      p_user: uid,
      p_key_hash: hash,
    })
    if (error) return { error }
    return { messageId: messageId as string, key: formatKey(key) }
  }

  // Hand over what a valid, open window entitles this person to see.
  async function deliver(itemId: string, grant: { expires_at: string }) {
    try {
      const { data: item } = await admin
        .from("confidential_items")
        .select("conversation_id,sender_id,kind,mime")
        .eq("id", itemId)
        .maybeSingle()
      const { data: secret } = await admin
        .from("confidential_secrets")
        .select("ciphertext,file_path,file_name_sealed")
        .eq("item_id", itemId)
        .maybeSingle()
      if (!item || !secret) return fail(req, 404, "not_found", "This message is not available.")

      const context = sealContext(item.conversation_id, item.sender_id)
      const expiresMs = Date.parse(grant.expires_at)
      const secondsLeft = Math.max(1, Math.floor((expiresMs - Date.now()) / 1000))
      const viewer = { name: profile!.full_name || "" }

      if (item.kind === "text") {
        if (!secret.ciphertext) return fail(req, 410, "destroyed", openFailureMessage("destroyed"))
        const text = await openText(secret.ciphertext, secrets!, context)
        return json(req, { ok: true, kind: "text", text, expires_at: grant.expires_at, seconds_left: secondsLeft, viewer })
      }

      if (!secret.file_path) return fail(req, 410, "destroyed", openFailureMessage("destroyed"))
      const name = secret.file_name_sealed
        ? await openText(secret.file_name_sealed, secrets!, context)
        : "document"
      const signed = await admin.storage.from(BUCKET).createSignedUrl(secret.file_path, Math.max(secondsLeft, 5))
      if (signed.error || !signed.data?.signedUrl) {
        console.error("confidential-vault signed url failed:", signed.error?.message)
        return fail(req, 502, "deliver_failed", "Could not open this document. Try again in a moment.")
      }
      return json(req, {
        ok: true,
        kind: "file",
        mime: item.mime,
        name,
        url: signed.data.signedUrl,
        expires_at: grant.expires_at,
        seconds_left: secondsLeft,
        viewer,
      })
    } catch (error) {
      console.error("confidential-vault deliver failed:", (error as Error)?.message)
      // The window is still open on the server, so "resume" will work.
      return fail(req, 500, "deliver_failed", "Could not open this message. Try again in a moment.")
    }
  }

  // ---- send a text ----
  if (action === "create_text") {
    const conversationId = cleanUuid(body.conversation_id)
    const text = typeof body.text === "string" ? body.text.trim() : ""
    const viewSeconds = Math.floor(Number(body.view_seconds))
    if (!conversationId) return fail(req, 400, "invalid", "Choose a chat first.")
    if (!text) return fail(req, 400, "invalid", "Write the message first.")
    if (text.length > MAX_TEXT_LENGTH) return fail(req, 400, "invalid", "That message is too long.")
    if (await rateCount(admin, `vaultcreate:${uid}`, 3600) > 60) {
      return fail(req, 429, "rate", "Too many confidential messages in a short time. Try again later.")
    }

    const sealed = await sealText(text, secrets, sealContext(conversationId, uid))
    const begun = await admin.rpc("vault_begin", {
      p_user: uid,
      p_conversation: conversationId,
      p_kind: "text",
      p_view_seconds: viewSeconds,
      p_mime: null,
      p_file_size: null,
      p_file_path: null,
      p_file_name_sealed: null,
      p_ciphertext: sealed,
    })
    if (begun.error) return rpcFailure(req, begun.error)
    const itemId = begun.data as string

    const done = await seal(itemId)
    if (done.error) {
      await admin.from("confidential_items").delete().eq("id", itemId)
      return rpcFailure(req, done.error)
    }
    return json(req, { ok: true, item_id: itemId, message_id: done.messageId, key: done.key, view_seconds: viewSeconds })
  }

  // ---- send a file: step 1, get a one-time upload address ----
  if (action === "prepare_file") {
    const conversationId = cleanUuid(body.conversation_id)
    const name = cleanFileName(body.file_name)
    const mime = typeof body.mime === "string" ? body.mime.trim().toLowerCase() : ""
    const size = Math.floor(Number(body.size))
    const viewSeconds = Math.floor(Number(body.view_seconds))
    if (!conversationId) return fail(req, 400, "invalid", "Choose a chat first.")
    if (!isAllowedMime(mime)) return fail(req, 400, "invalid", "Only PDF files and images can be sent as confidential.")
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
      return fail(req, 400, "invalid", "A confidential file can be at most 15 MB.")
    }
    if (await rateCount(admin, `vaultcreate:${uid}`, 3600) > 60) {
      return fail(req, 429, "rate", "Too many confidential messages in a short time. Try again later.")
    }

    const objectPath = `${conversationId}/${crypto.randomUUID()}`
    const sealedName = await sealText(name, secrets, sealContext(conversationId, uid))
    const begun = await admin.rpc("vault_begin", {
      p_user: uid,
      p_conversation: conversationId,
      p_kind: "file",
      p_view_seconds: viewSeconds,
      p_mime: mime,
      p_file_size: size,
      p_file_path: objectPath,
      p_file_name_sealed: sealedName,
      p_ciphertext: null,
    })
    if (begun.error) return rpcFailure(req, begun.error)

    const upload = await admin.storage.from(BUCKET).createSignedUploadUrl(objectPath)
    if (upload.error || !upload.data?.token) {
      await admin.from("confidential_items").delete().eq("id", begun.data as string)
      console.error("confidential-vault upload url failed:", upload.error?.message)
      return fail(req, 502, "server", "Could not start the upload. Try again.")
    }
    return json(req, { ok: true, item_id: begun.data, path: objectPath, token: upload.data.token })
  }

  // ---- send a file: step 2, check what arrived and post the locked card ----
  if (action === "finish_file") {
    const itemId = cleanUuid(body.item_id)
    if (!itemId) return fail(req, 400, "invalid", "Missing item.")
    const { data: item } = await admin
      .from("confidential_items")
      .select("id,sender_id,status,mime,file_size,kind")
      .eq("id", itemId)
      .maybeSingle()
    if (!item || item.sender_id !== uid || item.kind !== "file") return fail(req, 404, "not_found", "Confidential item not found.")
    if (item.status !== "pending") return fail(req, 400, "invalid", "This message was already sent.")
    const { data: secret } = await admin.from("confidential_secrets").select("file_path").eq("item_id", itemId).maybeSingle()
    const path = secret?.file_path as string | undefined
    if (!path) return fail(req, 404, "not_found", "Confidential item not found.")

    const discard = async () => {
      await admin.storage.from(BUCKET).remove([path])
      await admin.from("confidential_items").delete().eq("id", itemId)
    }

    // Look at the first bytes: the browser's word for what a file is can lie.
    const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 30)
    if (signed.error || !signed.data?.signedUrl) {
      await discard()
      return fail(req, 400, "invalid", "The upload did not arrive. Try again.")
    }
    const head = await fetch(signed.data.signedUrl, { headers: { Range: "bytes=0-15" } })
    if (!head.ok) {
      await discard()
      return fail(req, 400, "invalid", "The upload did not arrive. Try again.")
    }
    const bytes = new Uint8Array(await head.arrayBuffer()).slice(0, 16)
    const total = Number((head.headers.get("content-range") || "").split("/")[1]) || bytes.length
    if (sniffMime(bytes) !== item.mime || total > MAX_FILE_BYTES) {
      await discard()
      return fail(req, 400, "invalid", "That file is not a valid PDF or image.")
    }

    const done = await seal(itemId)
    if (done.error) {
      await discard()
      return rpcFailure(req, done.error)
    }
    return json(req, { ok: true, item_id: itemId, message_id: done.messageId, key: done.key })
  }

  // ---- open with the one-time key ----
  if (action === "reveal") {
    const itemId = cleanUuid(body.item_id)
    if (!itemId) return fail(req, 400, "invalid", "Missing item.")
    const key = normalizeKey(body.key)
    // A half-typed key is a typo, not an attempt: it is not counted.
    if (!isCompleteKey(key)) return fail(req, 400, "incomplete", "Enter all 12 characters of the key.")
    if (await rateCount(admin, `vaultopen:${uid}`, 600) > 30) {
      return fail(req, 429, "rate", "Too many tries. Wait a few minutes.")
    }

    const hash = await hashKey(key, secrets)
    const opened = await admin.rpc("vault_open", { p_item: itemId, p_user: uid, p_key_hash: hash })
    if (opened.error) return rpcFailure(req, opened.error)
    const result = opened.data as { ok: boolean; code?: string; attempts_left?: number; expires_at?: string }
    if (!result?.ok) {
      const code = result?.code || "failed"
      return fail(req, code === "forbidden" || code === "not_found" ? 403 : 200, code,
        openFailureMessage(code, result?.attempts_left),
        { attempts_left: result?.attempts_left ?? null })
    }
    return await deliver(itemId, { expires_at: result.expires_at as string })
  }

  // ---- still inside the window (page reloaded, app came back) ----
  if (action === "resume") {
    const itemId = cleanUuid(body.item_id)
    if (!itemId) return fail(req, 400, "invalid", "Missing item.")
    const resumed = await admin.rpc("vault_resume", { p_item: itemId, p_user: uid })
    if (resumed.error) return rpcFailure(req, resumed.error)
    const result = resumed.data as { ok: boolean; code?: string; expires_at?: string }
    if (!result?.ok) return fail(req, 200, result?.code || "closed", "The view time has ended.")
    return await deliver(itemId, { expires_at: result.expires_at as string })
  }

  // ---- sender or administrator deletes it for good ----
  if (action === "destroy") {
    const itemId = cleanUuid(body.item_id)
    if (!itemId) return fail(req, 400, "invalid", "Missing item.")
    const destroyed = await admin.rpc("vault_destroy", { p_item: itemId, p_user: uid })
    if (destroyed.error) return rpcFailure(req, destroyed.error)
    const path = (destroyed.data as { file_path?: string | null })?.file_path
    if (path) {
      const removed = await admin.storage.from(BUCKET).remove([path])
      if (removed.error) console.error("confidential-vault file removal failed:", removed.error.message)
    }
    return json(req, { ok: true })
  }

  // ---- administrator issues a new one-time key ----
  if (action === "unblock") {
    const itemId = cleanUuid(body.item_id)
    if (!itemId) return fail(req, 400, "invalid", "Missing item.")
    const key = generateKey()
    const hash = await hashKey(key, secrets)
    const unblocked = await admin.rpc("vault_unblock", { p_item: itemId, p_admin: uid, p_key_hash: hash })
    if (unblocked.error) return rpcFailure(req, unblocked.error)
    return json(req, { ok: true, key: formatKey(key) })
  }

  return fail(req, 400, "invalid", "Unknown action.")
})
