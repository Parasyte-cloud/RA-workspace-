// RideArrivo Archive: opens a share link for someone outside the company.
//
//   GET /functions/v1/archive-share?t=<link code>
//
// If the link is valid (not revoked, not expired, file not deleted) the person
// is redirected to a signed download that lasts one minute, so the file itself
// is never public. Everything else gets the same plain answer, so nobody can
// tell a wrong code from an expired one.
//
// Deploy with --no-verify-jwt: people without an account open these links.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BUCKET = "archive"
const SIGNED_SECONDS = 60
const MAX_BAD_PER_MINUTE = 20

const baseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
}

function plain(status: number, message: string) {
  return new Response(message, { status, headers: { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" } })
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("")
}

function clientIp(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  )
}

const NOT_VALID = "This link is not valid or has expired."

Deno.serve(async req => {
  if (req.method !== "GET" && req.method !== "HEAD") return plain(405, "Method not allowed.")

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return plain(503, "This service is not available right now.")

  const code = new URL(req.url).searchParams.get("t") || ""
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(code)) return plain(404, NOT_VALID)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Slow down anyone trying many wrong codes. Fails open if the limiter is down.
  const key = `archshare:${clientIp(req)}`
  const rate = async (increment: boolean) => {
    try {
      const { data, error } = await admin.rpc("room7_rate_count", { p_key: key, p_window_seconds: 60, p_increment: increment })
      return error ? 0 : Number(data) || 0
    } catch {
      return 0
    }
  }
  if (await rate(false) >= MAX_BAD_PER_MINUTE) return plain(429, "Too many attempts. Wait a minute and try again.")

  const hash = await sha256Hex(code)
  const { data: share } = await admin
    .from("archive_shares")
    .select("id,file_id,expires_at,revoked_at,archive_files(name,storage_path,deleted_at)")
    .eq("token_hash", hash)
    .maybeSingle()

  const file = Array.isArray(share?.archive_files) ? share?.archive_files[0] : share?.archive_files
  const valid =
    !!share && !!file &&
    !share.revoked_at &&
    !file.deleted_at &&
    new Date(share.expires_at).getTime() > Date.now()

  if (!valid || !share || !file) {
    await rate(true)
    return plain(404, NOT_VALID)
  }

  const { data: signed, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, SIGNED_SECONDS, { download: file.name })

  if (error || !signed?.signedUrl) return plain(502, "The file could not be opened. Try again in a moment.")

  // Count it (best effort: never block the download on bookkeeping).
  const { data: current } = await admin.from("archive_shares").select("download_count").eq("id", share.id).maybeSingle()
  await admin
    .from("archive_shares")
    .update({ download_count: (current?.download_count ?? 0) + 1, last_accessed_at: new Date().toISOString() })
    .eq("id", share.id)

  return new Response(null, { status: 302, headers: { ...baseHeaders, Location: signed.signedUrl } })
})
