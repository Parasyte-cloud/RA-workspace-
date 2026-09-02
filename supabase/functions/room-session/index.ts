import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

type RoomAction = "config" | "create" | "join" | "end"
type MediaConfig = {
  accountId: string
  appId: string
  apiToken: string
  hostPreset: string
  memberPreset: string
}

const productionOrigin = "https://intranet.ridearrivo.com"

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
      "Cache-Control": "no-store",
    },
  })
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function normalizeCode(value: unknown) {
  return cleanText(value, 40).toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8)
}

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(byte => alphabet[byte % alphabet.length]).join("")
}

function getMediaConfig(): MediaConfig | null {
  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID")?.trim() || ""
  const appId = Deno.env.get("CLOUDFLARE_REALTIMEKIT_APP_ID")?.trim() || ""
  const apiToken = Deno.env.get("CLOUDFLARE_REALTIMEKIT_API_TOKEN")?.trim() || ""
  const hostPreset = Deno.env.get("CLOUDFLARE_REALTIMEKIT_HOST_PRESET")?.trim() || ""
  const memberPreset = Deno.env.get("CLOUDFLARE_REALTIMEKIT_PARTICIPANT_PRESET")?.trim() || ""
  if (!accountId || !appId || !apiToken || !hostPreset || !memberPreset) return null
  return { accountId, appId, apiToken, hostPreset, memberPreset }
}

async function realtimeRequest(config: MediaConfig, path: string, init: RequestInit) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/realtime/kit/${encodeURIComponent(config.appId)}${path}`
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      "Authorization": `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || payload.success === false) {
    console.error("RealtimeKit request failed", {
      status: response.status,
      path,
      errors: payload?.errors || null,
    })
    throw new Error("ROOM 7 media provider request failed.")
  }
  return payload.data
}

async function createMeeting(config: MediaConfig, title: string, aiNotesEnabled: boolean) {
  const data = await realtimeRequest(config, "/meetings", {
    method: "POST",
    body: JSON.stringify({
      title,
      status: "ACTIVE",
      persist_chat: false,
      record_on_start: false,
      transcribe_on_end: aiNotesEnabled,
      summarize_on_end: aiNotesEnabled,
      ai_config: aiNotesEnabled
        ? {
            summarization: {
              word_limit: 700,
              text_format: "markdown",
              summary_type: "team_meeting",
            },
          }
        : undefined,
      session_keep_alive_time_in_secs: 600,
    }),
  })
  const id = cleanText(data?.id, 160)
  if (!id) throw new Error("ROOM 7 media provider did not return a meeting ID.")
  return id
}

async function deactivateMeeting(config: MediaConfig, meetingId: string) {
  return realtimeRequest(config, `/meetings/${encodeURIComponent(meetingId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "INACTIVE" }),
  })
}

async function kickEveryone(config: MediaConfig, meetingId: string) {
  return realtimeRequest(
    config,
    `/meetings/${encodeURIComponent(meetingId)}/active-session/kick-all`,
    { method: "POST" },
  )
}

async function addParticipant(
  config: MediaConfig,
  meetingId: string,
  input: { userId: string; name: string; preset: string },
) {
  const data = await realtimeRequest(
    config,
    `/meetings/${encodeURIComponent(meetingId)}/participants`,
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        preset_name: input.preset,
        custom_participant_id: input.userId,
      }),
    },
  )
  const participantId = cleanText(data?.id, 160)
  const token = cleanText(data?.token, 10000)
  if (!participantId || !token) {
    throw new Error("ROOM 7 media provider did not return a participant session.")
  }
  return { participantId, token }
}

async function refreshParticipant(
  config: MediaConfig,
  meetingId: string,
  participantId: string,
) {
  const data = await realtimeRequest(
    config,
    `/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}/token`,
    { method: "POST" },
  )
  const token = cleanText(data?.token, 10000)
  if (!token) throw new Error("ROOM 7 media provider did not refresh the participant session.")
  return token
}

serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) })
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405)

  const authorization = req.headers.get("Authorization") || ""
  if (!authorization) return json(req, { error: "Missing RideArrivo session." }, 401)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "ROOM 7 service is not configured." }, 500)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = authorization.replace(/^Bearer\s+/i, "")
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData?.user) {
    return json(req, { error: "Your RideArrivo session is invalid." }, 401)
  }

  const employeeId = userData.user.id
  const { data: profile, error: profileError } = await admin
    .from("employee_profiles")
    .select("id,full_name,active")
    .eq("id", employeeId)
    .maybeSingle()

  if (profileError || !profile || profile.active !== true) {
    return json(req, { error: "Active employee access is required." }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const action = cleanText(body?.action, 30) as RoomAction
  const config = getMediaConfig()

  if (action === "config") return json(req, { configured: Boolean(config) })

  if (!config) {
    return json(req, { error: "ROOM 7 media is not configured yet. Add the RealtimeKit server credentials." }, 503)
  }

  if (action === "create") {
    const title = cleanText(body?.title, 120)
    if (title.length < 2) {
      return json(req, { error: "ROOM 7 title must be at least 2 characters." }, 400)
    }

    const aiNotesEnabled = body?.ai_notes_enabled !== false
    let meetingId = ""
    let createdRoomId = ""
    try {
      meetingId = await createMeeting(config, title, aiNotesEnabled)
      let room: Record<string, any> | null = null
      let lastError: any = null

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const result = await admin
          .from("workspace_rooms")
          .insert({
            room_code: randomRoomCode(),
            title,
            status: "active",
            created_by: employeeId,
            cloudflare_meeting_id: meetingId,
            ai_notes_enabled: aiNotesEnabled,
          })
          .select("id,room_code,title,status,ai_notes_enabled,created_by,started_at,ended_at,created_at,updated_at")
          .single()

        if (!result.error) {
          room = result.data
          createdRoomId = cleanText(result.data?.id, 160)
          lastError = null
          break
        }
        lastError = result.error
        if (result.error.code !== "23505") break
      }

      if (!room || lastError) {
        await deactivateMeeting(config, meetingId).catch(error => console.error("ROOM 7 cleanup failed:", error))
        console.error("ROOM 7 row creation failed:", lastError)
        return json(req, { error: "Unable to create the ROOM 7 record." }, 500)
      }

      const participant = await addParticipant(config, meetingId, {
        userId: employeeId,
        name: cleanText(profile.full_name, 160) || "RideArrivo Employee",
        preset: config.hostPreset,
      })

      const now = new Date().toISOString()
      const { error: memberError } = await admin
        .from("workspace_room_participants")
        .upsert({
          room_id: room.id,
          user_id: employeeId,
          role: "host",
          cloudflare_participant_id: participant.participantId,
          first_joined_at: now,
          last_joined_at: now,
        }, { onConflict: "room_id,user_id" })

      if (memberError) {
        console.error("ROOM 7 host membership failed:", memberError)
        await deactivateMeeting(config, meetingId).catch(() => {})
        await admin.from("workspace_rooms").update({ status: "ended", ended_at: now }).eq("id", room.id)
        return json(req, { error: "Unable to establish ROOM 7 membership." }, 500)
      }

      const audit = await admin.from("workspace_room_events").insert({
        room_id: room.id,
        actor_id: employeeId,
        event_type: "created",
      })
      if (audit.error) console.warn("ROOM 7 audit create:", audit.error.message)

      return json(req, {
        room,
        auth_token: participant.token,
        participant_id: participant.participantId,
        role: "host",
      })
    } catch (error) {
      console.error("ROOM 7 create failed:", error)
      if (meetingId) await deactivateMeeting(config, meetingId).catch(() => {})
      if (createdRoomId) {
        const cleanupAt = new Date().toISOString()
        const cleanup = await admin
          .from("workspace_rooms")
          .update({ status: "ended", ended_at: cleanupAt })
          .eq("id", createdRoomId)
          .eq("status", "active")
        if (cleanup.error) {
          console.error("ROOM 7 failed-create cleanup could not finalise the room:", cleanup.error)
        }
      }
      return json(req, { error: "Unable to create ROOM 7." }, 502)
    }
  }

  if (action === "join") {
    const code = normalizeCode(body?.room_code)
    if (code.length !== 8) {
      return json(req, { error: "Enter a valid 8-character Room code." }, 400)
    }

    const { data: room, error: roomError } = await admin
      .from("workspace_rooms")
      .select("id,room_code,title,status,ai_notes_enabled,created_by,cloudflare_meeting_id,started_at,ended_at,created_at,updated_at")
      .eq("room_code", code)
      .maybeSingle()

    if (roomError || !room) return json(req, { error: "ROOM 7 not found." }, 404)
    if (room.status !== "active") return json(req, { error: "This ROOM 7 meeting has ended." }, 409)

    const role = room.created_by === employeeId ? "host" : "member"
    const { data: existing, error: existingError } = await admin
      .from("workspace_room_participants")
      .select("room_id,user_id,role,cloudflare_participant_id,first_joined_at")
      .eq("room_id", room.id)
      .eq("user_id", employeeId)
      .maybeSingle()

    if (existingError) {
      console.error("ROOM 7 membership lookup failed:", existingError)
      return json(req, { error: "Unable to verify ROOM 7 membership." }, 500)
    }

    try {
      let participantId = cleanText(existing?.cloudflare_participant_id, 160)
      let participantToken = ""

      if (participantId) {
        participantToken = await refreshParticipant(config, room.cloudflare_meeting_id, participantId)
      } else {
        const participant = await addParticipant(config, room.cloudflare_meeting_id, {
          userId: employeeId,
          name: cleanText(profile.full_name, 160) || "RideArrivo Employee",
          preset: role === "host" ? config.hostPreset : config.memberPreset,
        })
        participantId = participant.participantId
        participantToken = participant.token
      }

      const now = new Date().toISOString()
      const { error: memberError } = await admin
        .from("workspace_room_participants")
        .upsert({
          room_id: room.id,
          user_id: employeeId,
          role,
          cloudflare_participant_id: participantId,
          first_joined_at: existing?.first_joined_at || now,
          last_joined_at: now,
        }, { onConflict: "room_id,user_id" })

      if (memberError) {
        console.error("ROOM 7 join membership failed:", memberError)
        return json(req, { error: "Unable to save ROOM 7 membership." }, 500)
      }

      const audit = await admin.from("workspace_room_events").insert({
        room_id: room.id,
        actor_id: employeeId,
        event_type: "joined",
      })
      if (audit.error) console.warn("ROOM 7 audit join:", audit.error.message)

      return json(req, {
        room: {
          id: room.id,
          room_code: room.room_code,
          title: room.title,
          status: room.status,
          ai_notes_enabled: room.ai_notes_enabled,
          created_by: room.created_by,
          started_at: room.started_at,
          ended_at: room.ended_at,
          created_at: room.created_at,
          updated_at: room.updated_at,
        },
        auth_token: participantToken,
        participant_id: participantId,
        role,
      })
    } catch (error) {
      console.error("ROOM 7 participant session failed:", error)
      return json(req, { error: "Unable to create your ROOM 7 session." }, 502)
    }
  }

  if (action === "end") {
    const roomId = cleanText(body?.room_id, 160)
    if (!roomId) return json(req, { error: "ROOM 7 ID is required." }, 400)

    const { data: room, error: roomError } = await admin
      .from("workspace_rooms")
      .select("id,status,created_by,cloudflare_meeting_id")
      .eq("id", roomId)
      .maybeSingle()

    if (roomError || !room) return json(req, { error: "ROOM 7 not found." }, 404)
    if (room.created_by !== employeeId) {
      return json(req, { error: "Only the ROOM 7 host can end this meeting." }, 403)
    }
    if (room.status === "ended") return json(req, { ended: true })

    try {
      await kickEveryone(config, room.cloudflare_meeting_id).catch(error => console.warn("ROOM 7 kick-all skipped:", error))
      await deactivateMeeting(config, room.cloudflare_meeting_id)

      const now = new Date().toISOString()
      const { error: updateError } = await admin
        .from("workspace_rooms")
        .update({ status: "ended", ended_at: now })
        .eq("id", room.id)

      if (updateError) {
        console.error("ROOM 7 end persistence failed:", updateError)
        return json(req, { error: "ROOM 7 ended at the media provider but could not be finalised in the workspace." }, 500)
      }

      const audit = await admin.from("workspace_room_events").insert({
        room_id: room.id,
        actor_id: employeeId,
        event_type: "ended",
      })
      if (audit.error) console.warn("ROOM 7 audit end:", audit.error.message)

      return json(req, { ended: true })
    } catch (error) {
      console.error("ROOM 7 end failed:", error)
      return json(req, { error: "Unable to end ROOM 7." }, 502)
    }
  }

  return json(req, { error: "Unsupported ROOM 7 action." }, 400)
})
