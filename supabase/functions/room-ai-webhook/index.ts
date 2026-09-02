import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const PUBLIC_KEY_URL =
  "https://api.realtime.cloudflare.com/.well-known/webhooks.json"

let cachedPublicKey: CryptoKey | null = null

function text(value: unknown, max = 1000) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : ""
}

function uuid(value: unknown) {
  const candidate = text(value, 64)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : ""
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

type MediaCleanupConfig = {
  accountId: string
  appId: string
  apiToken: string
}

function mediaCleanupConfig(): MediaCleanupConfig | null {
  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID")?.trim() || ""
  const appId = Deno.env.get("CLOUDFLARE_REALTIMEKIT_APP_ID")?.trim() || ""
  const apiToken = Deno.env.get("CLOUDFLARE_REALTIMEKIT_API_TOKEN")?.trim() || ""
  if (!accountId || !appId || !apiToken) return null
  return { accountId, appId, apiToken }
}

async function deactivateProviderMeeting(meetingId: string) {
  const config = mediaCleanupConfig()
  if (!config) throw new Error("ROOM 7 media provider cleanup is not configured.")
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/realtime/kit/${encodeURIComponent(config.appId)}/meetings/${encodeURIComponent(meetingId)}`
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "INACTIVE" }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || payload.success === false) {
    console.error("ROOM 7 provider deactivation failed", {
      status: response.status,
      errors: payload?.errors || null,
    })
    throw new Error("ROOM 7 media provider cleanup failed.")
  }
}

async function publicKey() {
  if (cachedPublicKey) return cachedPublicKey

  const response = await fetch(PUBLIC_KEY_URL, {
    headers: { "Accept": "application/json" },
  })

  if (!response.ok) {
    throw new Error("Unable to fetch the RealtimeKit webhook public key.")
  }

  const payload = await response.json()
  const pem = text(payload?.data?.publicKey, 12000)

  if (!pem) {
    throw new Error("RealtimeKit webhook public key is missing.")
  }

  const clean = pem
    .replace(/\\n/g, "")
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "")

  const bytes = Uint8Array.from(atob(clean), char => char.charCodeAt(0))

  cachedPublicKey = await crypto.subtle.importKey(
    "spki",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  )

  return cachedPublicKey
}

async function verifySignature(signature: string, body: ArrayBuffer) {
  const signatureBytes = Uint8Array.from(
    atob(signature),
    char => char.charCodeAt(0),
  )

  const verify = async (key: CryptoKey) =>
    crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signatureBytes,
      body,
    )

  try {
    const firstKey = await publicKey()
    if (await verify(firstKey)) return true

    // RealtimeKit can rotate its signing key. Refresh once before rejecting.
    cachedPublicKey = null
    const refreshedKey = await publicKey()
    return await verify(refreshedKey)
  } catch (error) {
    console.error("ROOM 7 webhook signature verification failed:", error)
    return false
  }
}

function iso(value: unknown) {
  const candidate = text(value, 80)
  if (!candidate) return null
  const date = new Date(candidate)
  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString()
}

function secondsBetween(start: string | null, end: string | null) {
  if (!start || !end) return null
  const difference = Math.floor(
    (new Date(end).getTime() - new Date(start).getTime()) / 1000,
  )
  return Number.isFinite(difference) && difference >= 0
    ? difference
    : null
}

async function downloadSummary(urlValue: unknown) {
  const raw = text(urlValue, 4096)

  if (!raw) {
    throw new Error("ROOM 7 summary download URL is missing.")
  }

  const url = new URL(raw)
  if (url.protocol !== "https:") {
    throw new Error("ROOM 7 summary URL must use HTTPS.")
  }

  const response = await fetch(url, {
    headers: {
      "Accept": "text/markdown,text/plain;q=0.9,*/*;q=0.1",
    },
    redirect: "follow",
  })

  if (!response.ok) {
    throw new Error(`ROOM 7 summary download failed (${response.status}).`)
  }

  const body = await response.arrayBuffer()

  if (body.byteLength > 256 * 1024) {
    throw new Error("ROOM 7 summary exceeds the accepted size.")
  }

  const summary = new TextDecoder().decode(body).trim()

  if (!summary) {
    throw new Error("ROOM 7 summary is empty.")
  }

  return summary
}

serve(async req => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405)
  }

  const signature = text(req.headers.get("rtk-signature"), 12000)
  const deliveryId = text(req.headers.get("rtk-uuid"), 200)
  const webhookId = text(req.headers.get("rtk-webhook-id"), 200)

  if (!signature || !deliveryId) {
    return json({ error: "Missing RealtimeKit webhook authentication." }, 400)
  }

  const rawBody = await req.arrayBuffer()

  if (!(await verifySignature(signature, rawBody))) {
    return json({ error: "Invalid RealtimeKit webhook signature." }, 401)
  }

  let event: Record<string, any>
  try {
    event = JSON.parse(new TextDecoder().decode(rawBody))
  } catch {
    return json({ error: "Invalid webhook JSON." }, 400)
  }

  const eventType = text(event?.event, 100)
  const meetingId = text(event?.meeting?.id, 200)
  const sessionId = text(event?.meeting?.sessionId, 200)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "ROOM 7 webhook persistence is not configured." }, 500)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: previous, error: previousError } = await admin
    .from("workspace_room_webhook_deliveries")
    .select("delivery_id,status,attempts")
    .eq("delivery_id", deliveryId)
    .maybeSingle()

  if (previousError) {
    console.error("ROOM 7 webhook dedupe lookup failed:", previousError)
    return json({ error: "Unable to accept webhook." }, 500)
  }

  if (previous?.status === "processed") {
    return json({ accepted: true, duplicate: true })
  }

  const attempt = Number(previous?.attempts || 0) + 1
  const deliveryPayload = {
    delivery_id: deliveryId,
    webhook_id: webhookId || null,
    event_type: eventType || "unknown",
    meeting_id: meetingId || null,
    session_id: sessionId || null,
    status: "processing",
    attempts: attempt,
    last_error: null,
    processed_at: null,
  }

  const deliveryWrite = previous
    ? await admin
        .from("workspace_room_webhook_deliveries")
        .update(deliveryPayload)
        .eq("delivery_id", deliveryId)
    : await admin
        .from("workspace_room_webhook_deliveries")
        .insert(deliveryPayload)

  if (deliveryWrite.error) {
    console.error("ROOM 7 webhook delivery tracking failed:", deliveryWrite.error)
    return json({ error: "Unable to accept webhook." }, 500)
  }

  const finish = async(
    status: "processed" | "failed",
    roomId: string | null,
    errorMessage: string | null,
  ) => {
    const { error } = await admin
      .from("workspace_room_webhook_deliveries")
      .update({
        status,
        room_id: roomId,
        last_error: errorMessage,
        processed_at: status === "processed"
          ? new Date().toISOString()
          : null,
      })
      .eq("delivery_id", deliveryId)

    if (error) {
      console.error("ROOM 7 webhook delivery finalisation failed:", error)
    }
  }

  try {
    const supported = new Set([
      "meeting.started",
      "meeting.ended",
      "meeting.participantJoined",
      "meeting.participantLeft",
      "meeting.transcript",
      "meeting.summary",
    ])

    if (!supported.has(eventType)) {
      await finish("processed", null, null)
      return json({ accepted: true, ignored: true })
    }

    if (!meetingId) {
      await finish("failed", null, "Missing meeting ID.")
      return json({ error: "Missing meeting ID." }, 400)
    }

    const { data: room, error: roomError } = await admin
      .from("workspace_rooms")
      .select("id,room_code,title,created_by,ai_notes_enabled")
      .eq("cloudflare_meeting_id", meetingId)
      .maybeSingle()

    if (roomError) throw roomError

    if (!room) {
      await finish("processed", null, "Meeting is not managed by ROOM 7.")
      return json({ accepted: true, ignored: true })
    }

    await admin
      .from("workspace_room_webhook_deliveries")
      .update({ room_id: room.id })
      .eq("delivery_id", deliveryId)

    if (!sessionId && eventType !== "meeting.participantJoined") {
      await finish("failed", room.id, "Missing meeting session ID.")
      return json({ error: "Missing meeting session ID." }, 400)
    }

    const startedAt = iso(event?.meeting?.startedAt)
    const endedAt = iso(event?.meeting?.endedAt)
    const endReason = text(event?.reason, 120) || null

    if (eventType === "meeting.ended") {
      const finalEndedAt = endedAt || new Date().toISOString()
      const { error: roomEndError } = await admin
        .from("workspace_rooms")
        .update({ status: "ended", ended_at: finalEndedAt })
        .eq("id", room.id)
        .eq("status", "active")
      if (roomEndError) throw roomEndError

      const { error: attendanceEndError } = await admin
        .from("workspace_room_attendance")
        .update({ left_at: finalEndedAt })
        .eq("room_id", room.id)
        .eq("session_id", sessionId)
        .is("left_at", null)
      if (attendanceEndError) throw attendanceEndError

    }

    if (
      room.ai_notes_enabled &&
      sessionId &&
      (eventType === "meeting.started" || eventType === "meeting.ended")
    ) {
      const minutePayload: Record<string, unknown> = {
        room_id: room.id,
        session_id: sessionId,
        status: "pending",
      }

      if (startedAt) minutePayload.started_at = startedAt
      if (endedAt) minutePayload.ended_at = endedAt
      if (endReason) minutePayload.end_reason = endReason

      const duration = secondsBetween(startedAt, endedAt)
      if (duration !== null) minutePayload.duration_seconds = duration

      const { error } = await admin
        .from("workspace_room_minutes")
        .upsert(minutePayload, { onConflict: "room_id,session_id" })

      if (error) throw error
    }

    if (eventType === "meeting.ended") {
      await deactivateProviderMeeting(meetingId)
    }

    if (
      eventType === "meeting.participantJoined" ||
      eventType === "meeting.participantLeft"
    ) {
      const participant = event?.participant || {}
      const userId = uuid(participant?.customParticipantId)

      if (userId && sessionId) {
        const joinedAt = iso(participant?.joinedAt)
        const leftAt = iso(participant?.leftAt)
        const payload: Record<string, unknown> = {
          room_id: room.id,
          session_id: sessionId,
          user_id: userId,
          display_name:
            text(participant?.userDisplayName, 180) || "RideArrivo Employee",
          peer_id: text(participant?.peerId, 200) || null,
        }

        if (joinedAt) payload.joined_at = joinedAt
        if (leftAt) payload.left_at = leftAt

        const { error } = await admin
          .from("workspace_room_attendance")
          .upsert(payload, { onConflict: "room_id,session_id,user_id" })

        if (error) throw error
      }
    }

    if (
      room.ai_notes_enabled &&
      eventType === "meeting.transcript" &&
      sessionId
    ) {
      const { error } = await admin
        .from("workspace_room_minutes")
        .upsert({
          room_id: room.id,
          session_id: sessionId,
          status: "pending",
          transcript_received_at: new Date().toISOString(),
          started_at: startedAt,
          ended_at: endedAt,
          duration_seconds: secondsBetween(startedAt, endedAt),
        }, { onConflict: "room_id,session_id" })

      if (error) throw error
    }

    if (
      room.ai_notes_enabled &&
      eventType === "meeting.summary" &&
      sessionId
    ) {
      const summary = await downloadSummary(event?.summaryDownloadUrl)

      const { count, error: countError } = await admin
        .from("workspace_room_attendance")
        .select("user_id", { count: "exact", head: true })
        .eq("room_id", room.id)
        .eq("session_id", sessionId)

      if (countError) throw countError

      const { error } = await admin
        .from("workspace_room_minutes")
        .upsert({
          room_id: room.id,
          session_id: sessionId,
          status: "ready",
          summary_markdown: summary,
          summary_received_at: new Date().toISOString(),
          participant_count: count || 0,
        }, { onConflict: "room_id,session_id" })

      if (error) throw error
    }

    await finish("processed", room.id, null)
    return json({ accepted: true })
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "ROOM 7 webhook processing failed."

    console.error("ROOM 7 webhook processing failed:", error)
    await finish("failed", null, message.slice(0, 1000))
    return json({ error: "ROOM 7 webhook processing failed." }, 500)
  }
})
