import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

type RoomAction = "resolve" | "join"

type MediaConfig = {
  accountId: string
  appId: string
  apiToken: string
  memberPreset: string
  viewerPreset: string
  presenterPreset: string
}

type GuestAccess = {
  displayName: string
  email: string | null
  role: "attendee" | "viewer" | "presenter"
  source: "invitation" | "open" | "passcode"
  invitation: any | null
}

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const room7Origin = "https://room7.ridearrivo.com"

function allowedOrigin(req: Request) {
  const origin = req.headers.get("Origin") || ""

  if (
    origin === room7Origin ||
    /^https:\/\/[a-z0-9-]+\.ra-workspace\.pages\.dev$/i.test(origin) ||
    /^http:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(origin)
  ) {
    return origin
  }

  return room7Origin
}

function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
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
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : ""
}

function normalizeCode(value: unknown) {
  return cleanText(value, 40)
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 8)
}

function normalizeSlug(value: unknown) {
  const valueText = cleanText(value, 80).toLowerCase()

  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(valueText)
    ? valueText
    : ""
}

function cleanEmail(value: unknown) {
  const email = cleanText(value, 320).toLowerCase()

  if (!email) return ""

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : ""
}

function cleanName(value: unknown) {
  const name = cleanText(value, 180)
  return name.length >= 2 ? name : ""
}

function getMediaConfig(): MediaConfig | null {
  const accountId =
    Deno.env.get("CLOUDFLARE_ACCOUNT_ID")?.trim() || ""

  const appId =
    Deno.env.get("CLOUDFLARE_REALTIMEKIT_APP_ID")?.trim() || ""

  const apiToken =
    Deno.env.get("CLOUDFLARE_REALTIMEKIT_API_TOKEN")?.trim() || ""

  const memberPreset =
    Deno.env.get("CLOUDFLARE_REALTIMEKIT_PARTICIPANT_PRESET")
      ?.trim() || ""

  const viewerPreset =
    Deno.env.get("CLOUDFLARE_REALTIMEKIT_VIEWER_PRESET")
      ?.trim() || ""

  const presenterPreset =
    Deno.env.get("CLOUDFLARE_REALTIMEKIT_PRESENTER_PRESET")
      ?.trim() || ""

  if (!accountId || !appId || !apiToken || !memberPreset) {
    return null
  }

  return {
    accountId,
    appId,
    apiToken,
    memberPreset,
    viewerPreset,
    presenterPreset,
  }
}

async function realtimeRequest(
  config: MediaConfig,
  path: string,
  init: RequestInit,
) {
  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${encodeURIComponent(config.accountId)}/realtime/kit/` +
    `${encodeURIComponent(config.appId)}${path}`

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
    console.error("ROOM 7 guest RealtimeKit request failed", {
      status: response.status,
      path,
      errors: payload?.errors || null,
    })

    throw new Error("ROOM 7 media provider request failed.")
  }

  return payload.data
}

async function addParticipant(
  config: MediaConfig,
  meetingId: string,
  input: {
    guestId: string
    name: string
    preset: string
  },
) {
  const data = await realtimeRequest(
    config,
    `/meetings/${encodeURIComponent(meetingId)}/participants`,
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        preset_name: input.preset,
        custom_participant_id: `guest:${input.guestId}`,
      }),
    },
  )

  const participantId = cleanText(data?.id, 160)
  const token = cleanText(data?.token, 10000)

  if (!participantId || !token) {
    throw new Error(
      "ROOM 7 media provider did not return a guest participant session.",
    )
  }

  return {
    participantId,
    token,
  }
}

async function refreshParticipant(
  config: MediaConfig,
  meetingId: string,
  participantId: string,
) {
  const data = await realtimeRequest(
    config,
    `/meetings/${encodeURIComponent(meetingId)}` +
      `/participants/${encodeURIComponent(participantId)}/token`,
    {
      method: "POST",
    },
  )

  const token = cleanText(data?.token, 10000)

  if (!token) {
    throw new Error(
      "ROOM 7 media provider did not refresh the guest session.",
    )
  }

  return token
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)

  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes,
  )

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function hmacSha256Hex(
  value: string,
  secret: string,
) {
  const encoder = new TextEncoder()

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  )

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  )

  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false

  let difference = 0

  for (let index = 0; index < left.length; index += 1) {
    difference |=
      left.charCodeAt(index) ^
      right.charCodeAt(index)
  }

  return difference === 0
}

async function resolveManagedRoom(
  admin: ReturnType<typeof createClient>,
  body: any,
) {
  const slug = normalizeSlug(body?.slug)

  const code = normalizeCode(
    body?.room_code ||
    body?.roomCode ||
    body?.code,
  )

  let external: any = null
  let room: any = null

  if (slug) {
    const {
      data,
      error,
    } = await admin
      .from("room7_external_rooms")
      .select(
        "room_id,slug,room_kind,access_mode,event_state," +
        "default_guest_role,public_enabled,public_summary," +
        "timezone,scheduled_start,scheduled_end,passcode_hash",
      )
      .eq("slug", slug)
      .maybeSingle()

    if (error) throw error

    external = data

    if (!external || external.public_enabled !== true) {
      return null
    }

    const {
      data: roomData,
      error: roomError,
    } = await admin
      .from("workspace_rooms")
      .select(
        "id,room_code,title,status,cloudflare_meeting_id",
      )
      .eq("id", external.room_id)
      .maybeSingle()

    if (roomError) throw roomError

    room = roomData
  } else if (code.length === 8) {
    const {
      data: roomData,
      error: roomError,
    } = await admin
      .from("workspace_rooms")
      .select(
        "id,room_code,title,status,cloudflare_meeting_id",
      )
      .eq("room_code", code)
      .maybeSingle()

    if (roomError) throw roomError

    room = roomData

    if (!room) return null

    const {
      data,
      error,
    } = await admin
      .from("room7_external_rooms")
      .select(
        "room_id,slug,room_kind,access_mode,event_state," +
        "default_guest_role,public_enabled,public_summary," +
        "timezone,scheduled_start,scheduled_end,passcode_hash",
      )
      .eq("room_id", room.id)
      .maybeSingle()

    if (error) throw error

    external = data

    if (!external || external.public_enabled !== true) {
      return null
    }
  } else {
    throw new HttpError(
      400,
      "A valid ROOM 7 link or code is required.",
    )
  }

  if (!room) return null

  return {
    room,
    external,
  }
}

function publicRoomMetadata(
  room: any,
  external: any,
) {
  const joinStates = new Set([
    "doors_open",
    "live",
    "intermission",
  ])

  const joinAvailable =
    room.status === "active" &&
    joinStates.has(external.event_state)

  return {
    title: cleanText(room.title, 180),
    slug: cleanText(external.slug, 80) || null,
    room_kind: external.room_kind,
    access_mode: external.access_mode,
    event_state: external.event_state,
    public_summary:
      cleanText(external.public_summary, 2000) || null,
    timezone:
      cleanText(external.timezone, 80) ||
      "Africa/Lagos",
    scheduled_start:
      external.scheduled_start || null,
    scheduled_end:
      external.scheduled_end || null,
    join_available: joinAvailable,
    requires_invitation:
      external.access_mode === "invitation",
    requires_passcode:
      external.access_mode === "passcode",
    requires_email:
      external.access_mode !== "invitation",
  }
}

async function authorizeGuest(
  admin: ReturnType<typeof createClient>,
  resolved: any,
  body: any,
): Promise<GuestAccess> {
  const { room, external } = resolved

  const inputName = cleanName(
    body?.display_name ||
    body?.displayName ||
    body?.name,
  )

  const inputEmail = cleanEmail(body?.email)

  if (external.access_mode === "invitation") {
    const rawToken = cleanText(
      body?.invite_token ||
      body?.inviteToken,
      512,
    )

    if (rawToken.length < 24) {
      throw new HttpError(
        403,
        "This ROOM 7 invitation is invalid or unavailable.",
      )
    }

    const tokenHash = await sha256Hex(rawToken)

    const {
      data: invitation,
      error,
    } = await admin
      .from("room7_guest_invitations")
      .select(
        "id,email,display_name,role,status,expires_at," +
        "first_used_at,last_used_at,use_count",
      )
      .eq("room_id", room.id)
      .eq("token_hash", tokenHash)
      .maybeSingle()

    if (error) throw error

    if (
      !invitation ||
      invitation.status !== "active"
    ) {
      throw new HttpError(
        403,
        "This ROOM 7 invitation is invalid or unavailable.",
      )
    }

    if (
      invitation.expires_at &&
      new Date(invitation.expires_at).getTime() <= Date.now()
    ) {
      throw new HttpError(
        403,
        "This ROOM 7 invitation has expired.",
      )
    }

    const invitedEmail = cleanEmail(
      invitation.email,
    )

    if (
      invitedEmail &&
      inputEmail !== invitedEmail
    ) {
      throw new HttpError(
        403,
        "Enter the email address associated with this invitation.",
      )
    }

    const displayName =
      cleanName(invitation.display_name) ||
      inputName

    if (!displayName) {
      throw new HttpError(
        400,
        "Enter your name to join ROOM 7.",
      )
    }

    return {
      displayName,
      email: invitedEmail || inputEmail || null,
      role: invitation.role,
      source: "invitation",
      invitation,
    }
  }

  if (!inputName) {
    throw new HttpError(
      400,
      "Enter your name to join ROOM 7.",
    )
  }

  if (!inputEmail) {
    throw new HttpError(
      400,
      "Enter a valid email address to join ROOM 7.",
    )
  }

  if (external.access_mode === "passcode") {
    const passcode = cleanText(
      body?.passcode,
      256,
    )

    if (passcode.length < 4) {
      throw new HttpError(
        403,
        "The ROOM 7 passcode is incorrect.",
      )
    }

    const pepper =
      Deno.env.get("ROOM7_ACCESS_PEPPER")
        ?.trim() || ""

    if (!pepper) {
      throw new HttpError(
        503,
        "ROOM 7 passcode access is not configured.",
      )
    }

    const expectedHash =
      cleanText(external.passcode_hash, 64)

    const suppliedHash =
      await hmacSha256Hex(
        passcode,
        pepper,
      )

    if (
      !expectedHash ||
      !constantTimeEqual(
        suppliedHash,
        expectedHash,
      )
    ) {
      throw new HttpError(
        403,
        "The ROOM 7 passcode is incorrect.",
      )
    }

    return {
      displayName: inputName,
      email: inputEmail,
      role: external.default_guest_role,
      source: "passcode",
      invitation: null,
    }
  }

  if (external.access_mode === "open") {
    if (
      Deno.env.get("ROOM7_ALLOW_OPEN_ACCESS")
        ?.trim()
        .toLowerCase() !== "true"
    ) {
      throw new HttpError(
        503,
        "Open ROOM 7 access has not been enabled.",
      )
    }

    return {
      displayName: inputName,
      email: inputEmail,
      role: external.default_guest_role,
      source: "open",
      invitation: null,
    }
  }

  throw new HttpError(
    403,
    "This ROOM 7 access mode is unavailable.",
  )
}

async function getOrCreateGuest(
  admin: ReturnType<typeof createClient>,
  roomId: string,
  access: GuestAccess,
) {
  let existing: any = null

  if (access.invitation) {
    const {
      data,
      error,
    } = await admin
      .from("room7_guest_participants")
      .select(
        "id,display_name,email,role,source," +
        "cloudflare_participant_id",
      )
      .eq(
        "room_id",
        roomId,
      )
      .eq(
        "invitation_id",
        access.invitation.id,
      )
      .maybeSingle()

    if (error) throw error

    existing = data
  } else if (access.email) {
    const {
      data,
      error,
    } = await admin
      .from("room7_guest_participants")
      .select(
        "id,display_name,email,role,source," +
        "cloudflare_participant_id",
      )
      .eq("room_id", roomId)
      .eq("email", access.email)
      .eq("source", access.source)
      .eq("role", access.role)
      .order("created_at", {
        ascending: true,
      })
      .limit(1)
      .maybeSingle()

    if (error) throw error

    existing = data
  }

  if (existing) {
    if (
      access.invitation &&
      existing.role !== access.role &&
      existing.cloudflare_participant_id
    ) {
      throw new HttpError(
        409,
        "This invitation role changed after it was used. Ask the ROOM 7 host to issue a new invitation.",
      )
    }

    const {
      data,
      error,
    } = await admin
      .from("room7_guest_participants")
      .update({
        display_name: access.displayName,
        email: access.email,
        role: access.role,
        source: access.source,
      })
      .eq("id", existing.id)
      .eq("room_id", roomId)
      .select(
        "id,display_name,email,role,source," +
        "cloudflare_participant_id",
      )
      .single()

    if (error) throw error

    return data
  }

  const {
    data,
    error,
  } = await admin
    .from("room7_guest_participants")
    .insert({
      room_id: roomId,
      invitation_id:
        access.invitation?.id || null,
      display_name:
        access.displayName,
      email:
        access.email,
      role:
        access.role,
      source:
        access.source,
    })
    .select(
      "id,display_name,email,role,source," +
      "cloudflare_participant_id",
    )
    .single()

  if (!error) return data

  if (
    error.code === "23505" &&
    access.invitation
  ) {
    const {
      data: raced,
      error: racedError,
    } = await admin
      .from("room7_guest_participants")
      .select(
        "id,display_name,email,role,source," +
        "cloudflare_participant_id",
      )
      .eq("room_id", roomId)
      .eq(
        "invitation_id",
        access.invitation.id,
      )
      .single()

    if (racedError) throw racedError

    return raced
  }

  throw error
}

function presetForRole(
  config: MediaConfig,
  role: string,
) {
  if (role === "viewer") {
    if (!config.viewerPreset) {
      throw new HttpError(
        503,
        "ROOM 7 viewer access is not configured.",
      )
    }

    return config.viewerPreset
  }

  if (role === "presenter") {
    if (!config.presenterPreset) {
      throw new HttpError(
        503,
        "ROOM 7 presenter access is not configured.",
      )
    }

    return config.presenterPreset
  }

  return config.memberPreset
}

serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response(
      "ok",
      {
        headers: cors(req),
      },
    )
  }

  if (req.method !== "POST") {
    return json(
      req,
      {
        error: "Method not allowed.",
      },
      405,
    )
  }

  const rawBody = await req.text()

  if (rawBody.length > 16_384) {
    return json(
      req,
      {
        error: "Request is too large.",
      },
      413,
    )
  }

  let body: any = null

  try {
    body = JSON.parse(rawBody || "{}")
  } catch {
    return json(
      req,
      {
        error: "Invalid request.",
      },
      400,
    )
  }

  const action =
    cleanText(body?.action, 20) as RoomAction

  if (
    action !== "resolve" &&
    action !== "join"
  ) {
    return json(
      req,
      {
        error: "Unsupported ROOM 7 guest action.",
      },
      400,
    )
  }

  const supabaseUrl =
    Deno.env.get("SUPABASE_URL")

  const serviceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    return json(
      req,
      {
        error: "ROOM 7 guest service is not configured.",
      },
      500,
    )
  }

  const admin = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )

  try {
    const resolved =
      await resolveManagedRoom(
        admin,
        body,
      )

    if (!resolved) {
      return json(
        req,
        {
          error: "ROOM 7 not found.",
        },
        404,
      )
    }

    const metadata =
      publicRoomMetadata(
        resolved.room,
        resolved.external,
      )

    if (action === "resolve") {
      return json(
        req,
        {
          room: metadata,
        },
      )
    }

    if (
      resolved.room.status !== "active" ||
      metadata.join_available !== true
    ) {
      throw new HttpError(
        409,
        "ROOM 7 is not open for joining right now.",
      )
    }

    const access =
      await authorizeGuest(
        admin,
        resolved,
        body,
      )

    const media =
      getMediaConfig()

    if (!media) {
      throw new HttpError(
        503,
        "ROOM 7 media is not configured.",
      )
    }

    const preset =
      presetForRole(
        media,
        access.role,
      )

    const guest =
      await getOrCreateGuest(
        admin,
        resolved.room.id,
        access,
      )

    let participantId =
      cleanText(
        guest.cloudflare_participant_id,
        160,
      )

    let participantToken = ""

    if (participantId) {
      participantToken =
        await refreshParticipant(
          media,
          resolved.room.cloudflare_meeting_id,
          participantId,
        )
    } else {
      const participant =
        await addParticipant(
          media,
          resolved.room.cloudflare_meeting_id,
          {
            guestId: guest.id,
            name: access.displayName,
            preset,
          },
        )

      participantId =
        participant.participantId

      participantToken =
        participant.token

      const {
        error: participantSaveError,
      } = await admin
        .from("room7_guest_participants")
        .update({
          cloudflare_participant_id:
            participantId,
        })
        .eq("id", guest.id)
        .eq(
          "room_id",
          resolved.room.id,
        )

      if (participantSaveError) {
        throw participantSaveError
      }
    }

    if (access.invitation) {
      const now =
        new Date().toISOString()

      const {
        error: invitationUsageError,
      } = await admin
        .from("room7_guest_invitations")
        .update({
          first_used_at:
            access.invitation.first_used_at ||
            now,
          last_used_at:
            now,
          use_count:
            Number(
              access.invitation.use_count ||
              0,
            ) + 1,
        })
        .eq(
          "id",
          access.invitation.id,
        )
        .eq(
          "room_id",
          resolved.room.id,
        )

      if (invitationUsageError) {
        console.warn(
          "ROOM 7 invitation usage update failed:",
          invitationUsageError.message,
        )
      }
    }

    return json(
      req,
      {
        room: metadata,
        guest: {
          display_name:
            access.displayName,
          role:
            access.role,
        },
        auth_token:
          participantToken,
      },
    )
  } catch (error) {
    if (error instanceof HttpError) {
      return json(
        req,
        {
          error: error.message,
        },
        error.status,
      )
    }

    console.error(
      "ROOM 7 guest session failed:",
      error,
    )

    return json(
      req,
      {
        error:
          "Unable to prepare your ROOM 7 guest session.",
      },
      500,
    )
  }
})
