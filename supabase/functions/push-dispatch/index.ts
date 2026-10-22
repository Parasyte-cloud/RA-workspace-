// RideArrivo Workspace: send one notification to the person's phones and browsers.
// Called by the database trigger on public.notifications (see
// 20261012260000_web_push.sql), authenticated by a shared secret kept in
// Vault. Not meant to be called by any client app.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"
import {
  applyPreviewSetting,
  buildPushMessage,
  decidePush,
  DEFAULT_PREFS,
  isGone,
  RING_GAP_MS,
  RING_REPEATS,
} from "../_shared/pushPayload.ts"

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

  // What this person asked to be pushed, and when. Anything skipped here is
  // still in the bell inside the workspace.
  const { data: savedPrefs } = await admin
    .from("notification_preferences")
    .select("push_chat,push_calls,push_mail,push_room,push_other,show_previews,quiet_enabled,quiet_start,quiet_end,quiet_allow_calls,timezone")
    .eq("user_id", row.user_id)
    .maybeSingle()
  const prefs = { ...DEFAULT_PREFS, ...(savedPrefs || {}) }

  const log = async (outcome: string, subscriptionId: string | null, httpStatus: number | null) => {
    try {
      await admin.from("push_delivery_log").insert({
        notification_id: row.id,
        user_id: row.user_id,
        subscription_id: subscriptionId,
        outcome,
        http_status: httpStatus,
      })
    } catch (_) { /* logging never blocks delivery */ }
  }

  const decision = decidePush(row, prefs)
  if (!decision.send) {
    await log(decision.reason === "quiet_hours" ? "skipped_quiet_hours" : "skipped_preference", null, null)
    return json({ sent: 0, skipped: decision.reason })
  }

  // The number shown on the app icon: everything still unread.
  let unread = 0
  try {
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", row.user_id)
      .is("read_at", null)
    unread = Math.min(count || 0, 99)
  } catch (_) { /* the icon falls back to a plain dot */ }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  const message = { ...applyPreviewSetting(buildPushMessage(row), prefs), badge: unread || undefined }
  const payload = JSON.stringify(message)
  const topic = message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined

  const sendAll = async (body: string, isRepeat = false) => {
    let delivered = 0
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: message.ttl, urgency: message.urgent || message.highPriority ? "high" : "normal", topic, timeout: 8000 },
        )
        delivered++
        await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", sub.id)
        if (!isRepeat) await log("sent", sub.id, 201)
      } catch (error) {
        const status = Number((error as { statusCode?: number })?.statusCode || 0)
        if (!isRepeat) await log(isGone(status) ? "gone" : "failed", sub.id, status || null)
        if (isGone(status) || sub.failure_count + 1 >= MAX_FAILURES) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id)
        } else {
          await admin.from("push_subscriptions").update({ failure_count: sub.failure_count + 1 }).eq("id", sub.id)
        }
      }
    }))
    return delivered
  }

  const sent = await sendAll(payload)

  // Keep the log to two weeks. Cheap, and only now and then.
  if (Math.random() < 0.02) {
    await admin.from("push_delivery_log").delete().lt("created_at", new Date(Date.now() - 14 * 86400_000).toISOString())
  }

  // Keep ringing: while the call is still unanswered, send it again every few
  // seconds. Runs after the response so the database trigger is not held up.
  if (message.urgent && sent > 0 && row.type === "call") {
    const repeat = async () => {
      for (let n = 1; n <= RING_REPEATS; n++) {
        await new Promise((resolve) => setTimeout(resolve, RING_GAP_MS))
        const { data: ringing } = await admin
          .from("chat_calls")
          .select("id")
          .eq("callee_id", row.user_id)
          .eq("conversation_id", row.entity_id)
          .eq("status", "ringing")
          .gte("created_at", new Date(Date.now() - 60_000).toISOString())
          .limit(1)
        if (!ringing?.length) return
        await sendAll(JSON.stringify({ ...message, repeat: n }), true)
      }
    }
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
    if (runtime?.waitUntil) runtime.waitUntil(repeat().catch(() => {}))
    else void repeat().catch(() => {})
  }

  return json({ sent })
})
