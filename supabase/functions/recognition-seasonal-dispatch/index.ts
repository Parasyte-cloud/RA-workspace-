import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." })
  const secret = Deno.env.get("CRON_DISPATCH_SECRET") || ""
  const supplied = req.headers.get("Authorization") || ""
  if (!secret || !constantTimeEqual(supplied, `Bearer ${secret}`)) return json(401, { error: "Unauthorized." })

  const url = Deno.env.get("SUPABASE_URL") || ""
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  if (!url || !key) return json(500, { error: "Server is not configured." })
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.rpc("materialize_due_recognition_seasonal_campaigns")
  if (error) {
    console.error("seasonal-dispatch failed", { code: error.code, message: error.message })
    return json(500, { error: "Seasonal dispatch failed." })
  }
  return json(200, { ok: true, campaigns: Array.isArray(data) ? data.length : 0 })
})
