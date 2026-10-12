// RideArrivo Workspace: send one notification to the person's phones and browsers.
// Called by the database trigger on public.notifications (see
// 20261012260000_web_push.sql), authenticated by a shared secret kept in
// Vault. Not meant to be called by any client app.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"
import { buildPushMessage, isGone } from "../_shared/pushPayload.ts"

const SECRET = Deno.env.get("PUSH_DISPATCH_SECRET") || ""
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || ""
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || ""
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@ridearrivo.com"
const MAX_FAILURES = 5

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405)
  if (!SECRET || !sameSecret(request.headers.get("x-push-secret") || "", SECRET)) return json({ error: "Forbidden" }, 403)
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "Push keys are not configured" }, 503)

  let id = ""
  try {
    id = String((await request.json())?.notification_id || "")
  } catch {
    return json({ error: "Bad request" }, 400)
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Bad request" }, 400)

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  })

  const { data: row } = await admin
    .from("notifications")
    .select("id,user_id,type,title,body,entity_type,entity_id")
    .eq("id", id)
    .maybeSingle()
  if (!row) return json({ sent: 0 })

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,failure_count")
    .eq("user_id", row.user_id)
  if (!subs?.length) return json({ sent: 0 })

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  const message = buildPushMessage(row)
  const payload = JSON.stringify(message)
  const topic = message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined

  let sent = 0
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: message.ttl, urgency: message.urgent ? "high" : "normal", topic },
      )
      sent++
      await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", sub.id)
    } catch (error) {
      const status = Number((error as { statusCode?: number })?.statusCode || 0)
      if (isGone(status) || sub.failure_count + 1 >= MAX_FAILURES) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id)
      } else {
        await admin.from("push_subscriptions").update({ failure_count: sub.failure_count + 1 }).eq("id", sub.id)
      }
    }
  }))

  return json({ sent })
})
