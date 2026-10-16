import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { cleanLobbyBody, shapeLobby } from "../_shared/lobbyChat.ts"
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { HttpError, publicRoom7Origin, roomKinds, accessModes, guestRoles, eventStates, normalTransitions, cors, json, cleanText, normalizeCode, uuid, normalizeSlug, hasOwn, parseDateField, validTimezone, hmacSha256Hex, cleanEmail, sha256Hex, randomInviteToken } from "./lib.ts"
import type { RoomAction, EventState, EmployeeProfile } from "./lib.ts"
import { room7ControlUuid, room7OptionalContentText, room7StoryPoints, room7ProgrammeItems } from "./content.ts"

async function authenticateEmployee(
  req: Request,
  admin: ReturnType<
    typeof createClient
  >,
): Promise<EmployeeProfile> {
  const authorization =
    req.headers.get("Authorization") || ""

  const match =
    /^Bearer\s+(.+)$/i.exec(
      authorization,
    )

  if (!match?.[1]) {
    throw new HttpError(
      401,
      "Missing RideArrivo session.",
    )
  }

  const token =
    match[1].trim()

  const {
    data: authData,
    error: authError,
  } = await admin.auth.getUser(
    token,
  )

  if (
    authError ||
    !authData.user
  ) {
    throw new HttpError(
      401,
      "Invalid or expired RideArrivo session.",
    )
  }

  const {
    data: profile,
    error: profileError,
  } = await admin
    .from("employee_profiles")
    .select("id,role,active")
    .eq(
      "id",
      authData.user.id,
    )
    .maybeSingle()

  if (profileError) {
    console.error(
      "ROOM 7 employee profile lookup failed:",
      profileError,
    )

    throw new HttpError(
      500,
      "Unable to verify ROOM 7 authority.",
    )
  }

  if (
    !profile ||
    profile.active !== true
  ) {
    throw new HttpError(
      403,
      "An active RideArrivo employee account is required.",
    )
  }

  return {
    id: profile.id,
    role:
      cleanText(
        profile.role,
        40,
      ).toLowerCase(),
    active: true,
  }
}

async function resolveRoom(
  admin: ReturnType<
    typeof createClient
  >,
  body: any,
) {
  const rawRoomId =
    cleanText(
      body?.room_id ||
      body?.roomId,
      64,
    )

  const roomId =
    uuid(rawRoomId)

  const roomCode =
    normalizeCode(
      body?.room_code ||
      body?.roomCode ||
      body?.code,
    )

  if (
    rawRoomId &&
    !roomId
  ) {
    throw new HttpError(
      400,
      "ROOM 7 ID is invalid.",
    )
  }

  if (
    !roomId &&
    roomCode.length !== 8
  ) {
    throw new HttpError(
      400,
      "ROOM 7 ID or 8-character code is required.",
    )
  }

  let query = admin
    .from("workspace_rooms")
    .select(
      "id,room_code,title,status,created_by,started_at,ended_at",
    )

  query = roomId
    ? query.eq(
        "id",
        roomId,
      )
    : query.eq(
        "room_code",
        roomCode,
      )

  const {
    data: room,
    error,
  } = await query.maybeSingle()

  if (error) {
    throw error
  }

  if (!room) {
    throw new HttpError(
      404,
      "ROOM 7 not found.",
    )
  }

  return room
}

async function loadExternalRoom(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
) {
  const {
    data,
    error,
  } = await admin
    .from("room7_external_rooms")
    .select(
      "room_id,slug,room_kind,access_mode,event_state," +
      "default_guest_role,public_enabled,public_summary," +
      "timezone,scheduled_start,scheduled_end,passcode_hash," +
      "created_at,updated_at",
    )
    .eq(
      "room_id",
      roomId,
    )
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

function isManagerOrAdmin(
  profile: EmployeeProfile,
) {
  return (
    profile.role === "manager" ||
    profile.role === "admin"
  )
}

function assertControlAuthority(
  room: any,
  profile: EmployeeProfile,
) {
  const isCreator =
    room.created_by === profile.id

  const privileged =
    isManagerOrAdmin(profile)

  if (
    !isCreator &&
    !privileged
  ) {
    throw new HttpError(
      403,
      "Only the ROOM 7 host, Manager or Administrator can control this external event.",
    )
  }

  return {
    isCreator,
    privileged,
  }
}

function externalForResponse(
  external: any,
) {
  if (!external) {
    return null
  }

  return {
    slug:
      external.slug || null,
    room_kind:
      external.room_kind,
    access_mode:
      external.access_mode,
    event_state:
      external.event_state,
    default_guest_role:
      external.default_guest_role,
    public_enabled:
      external.public_enabled === true,
    public_summary:
      external.public_summary || null,
    timezone:
      external.timezone,
    scheduled_start:
      external.scheduled_start || null,
    scheduled_end:
      external.scheduled_end || null,
    has_passcode:
      Boolean(
        external.passcode_hash,
      ),
    created_at:
      external.created_at,
    updated_at:
      external.updated_at,
  }
}

// Guest admission and auto-open live in their own columns, read apart from
// the main event so this function still works before the migration is run.
async function loadEventSettings(
  admin: ReturnType<typeof createClient>,
  roomId: string,
) {
  try {
    const { data, error } = await admin
      .from("room7_external_rooms")
      .select("admission,auto_open")
      .eq("room_id", roomId)
      .maybeSingle()

    if (error || !data) {
      return { admission: "auto", auto_open: true, settings_ready: false }
    }

    return {
      admission: data.admission === "host" ? "host" : "auto",
      auto_open: data.auto_open !== false,
      settings_ready: true,
    }
  } catch {
    return { admission: "auto", auto_open: true, settings_ready: false }
  }
}

async function withSettings(
  admin: ReturnType<typeof createClient>,
  roomId: string,
  response: any,
) {
  if (!response?.event) return response

  return {
    ...response,
    event: {
      ...response.event,
      ...(await loadEventSettings(admin, roomId)),
    },
  }
}

async function saveEventSettings(
  admin: ReturnType<typeof createClient>,
  roomId: string,
  body: any,
) {
  const update: Record<string, unknown> = {}

  if (hasOwn(body, "admission")) {
    const admission = cleanText(body.admission, 10).toLowerCase()

    if (admission !== "auto" && admission !== "host") {
      throw new HttpError(400, "Invalid ROOM 7 admission setting.")
    }

    update.admission = admission
  }

  if (hasOwn(body, "auto_open")) {
    update.auto_open = body.auto_open === true
  }

  if (!Object.keys(update).length) return

  const { error } = await admin
    .from("room7_external_rooms")
    .update(update)
    .eq("room_id", roomId)

  if (error) {
    throw new HttpError(
      503,
      "Guest approval is not ready yet. Run the ROOM 7 admission SQL migration, then try again.",
    )
  }
}

async function listJoinRequests(
  admin: ReturnType<typeof createClient>,
  roomId: string,
) {
  const { data, error } = await admin
    .from("room7_join_requests")
    .select("id,display_name,email,status,created_at")
    .eq("room_id", roomId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50)

  if (error) {
    console.warn("ROOM 7 join request list failed:", error.message)
    return []
  }

  return data || []
}

async function decideJoinRequests(
  admin: ReturnType<typeof createClient>,
  roomId: string,
  profile: EmployeeProfile,
  body: any,
) {
  const decision = cleanText(body?.decision, 10).toLowerCase()

  if (decision !== "admit" && decision !== "deny") {
    throw new HttpError(400, "Choose admit or deny.")
  }

  let query = admin
    .from("room7_join_requests")
    .update({
      status: decision === "admit" ? "approved" : "denied",
      decided_at: new Date().toISOString(),
      decided_by: profile.id,
    })
    .eq("room_id", roomId)
    .eq("status", "pending")

  if (body?.all === true) {
    // Everyone waiting right now.
  } else {
    const requestId = uuid(body?.request_id)

    if (!requestId) {
      throw new HttpError(400, "A valid request is required.")
    }

    query = query.eq("id", requestId)
  }

  const { error } = await query

  if (error) throw error
}

function eventResponse(
  room: any,
  external: any,
  authority: {
    isCreator: boolean
    privileged: boolean
  },
) {
  const slug =
    cleanText(
      external?.slug,
      80,
    )

  const publicUrl =
    slug
      ? `${publicRoom7Origin}/${encodeURIComponent(slug)}`
      : `${publicRoom7Origin}/r/${encodeURIComponent(room.room_code)}`

  return {
    room: {
      id:
        room.id,
      room_code:
        room.room_code,
      title:
        room.title,
      status:
        room.status,
      started_at:
        room.started_at || null,
      ended_at:
        room.ended_at || null,
    },
    event:
      externalForResponse(
        external,
      ),
    public_url:
      publicUrl,
    permissions: {
      is_room_creator:
        authority.isCreator,
      can_configure:
        true,
      can_force_state:
        authority.privileged,
    },
  }
}

async function configureExternalRoom(
  admin: ReturnType<
    typeof createClient
  >,
  room: any,
  current: any,
  body: any,
) {
  let roomKind =
    current?.room_kind ||
    "standard"

  if (
    hasOwn(
      body,
      "room_kind",
    )
  ) {
    roomKind =
      cleanText(
        body.room_kind,
        40,
      ).toLowerCase()

    if (
      !roomKinds.has(
        roomKind,
      )
    ) {
      throw new HttpError(
        400,
        "Invalid ROOM 7 event type.",
      )
    }
  }

  let accessMode =
    current?.access_mode ||
    "invitation"

  if (
    hasOwn(
      body,
      "access_mode",
    )
  ) {
    accessMode =
      cleanText(
        body.access_mode,
        40,
      ).toLowerCase()

    if (
      !accessModes.has(
        accessMode,
      )
    ) {
      throw new HttpError(
        400,
        "Invalid ROOM 7 access mode.",
      )
    }
  }

  let defaultGuestRole =
    current?.default_guest_role ||
    "attendee"

  if (
    hasOwn(
      body,
      "default_guest_role",
    )
  ) {
    defaultGuestRole =
      cleanText(
        body.default_guest_role,
        40,
      ).toLowerCase()

    if (
      !guestRoles.has(
        defaultGuestRole,
      )
    ) {
      throw new HttpError(
        400,
        "Default external role must be attendee or viewer.",
      )
    }
  }

  let slug =
    current?.slug || null

  if (
    hasOwn(
      body,
      "slug",
    )
  ) {
    const rawSlug =
      cleanText(
        body.slug,
        100,
      )

    if (!rawSlug) {
      slug = null
    } else {
      const normalized =
        normalizeSlug(
          rawSlug,
        )

      if (!normalized) {
        throw new HttpError(
          400,
          "ROOM 7 slug must use lowercase letters, numbers and single hyphens.",
        )
      }

      const reserved =
        new Set([
          "api",
          "admin",
          "assets",
          "login",
          "privacy",
          "terms",
        ])

      if (
        reserved.has(
          normalized,
        )
      ) {
        throw new HttpError(
          400,
          "That ROOM 7 slug is reserved.",
        )
      }

      slug = normalized
    }
  }

  let publicEnabled =
    current?.public_enabled === true

  if (
    hasOwn(
      body,
      "public_enabled",
    )
  ) {
    if (
      typeof body.public_enabled !==
      "boolean"
    ) {
      throw new HttpError(
        400,
        "public_enabled must be true or false.",
      )
    }

    publicEnabled =
      body.public_enabled
  }

  let publicSummary =
    current?.public_summary || null

  if (
    hasOwn(
      body,
      "public_summary",
    )
  ) {
    if (
      body.public_summary === null ||
      body.public_summary === ""
    ) {
      publicSummary = null
    } else if (
      typeof body.public_summary !==
      "string"
    ) {
      throw new HttpError(
        400,
        "public_summary must be text or null.",
      )
    } else {
      const summary =
        body.public_summary.trim()

      if (
        summary.length > 2000
      ) {
        throw new HttpError(
          400,
          "Public ROOM 7 summary cannot exceed 2,000 characters.",
        )
      }

      publicSummary =
        summary || null
    }
  }

  let timezone =
    current?.timezone ||
    "Africa/Lagos"

  if (
    hasOwn(
      body,
      "timezone",
    )
  ) {
    timezone =
      cleanText(
        body.timezone,
        80,
      )

    if (
      !timezone ||
      !validTimezone(
        timezone,
      )
    ) {
      throw new HttpError(
        400,
        "ROOM 7 timezone is invalid.",
      )
    }
  }

  const scheduledStart =
    parseDateField(
      body,
      "scheduled_start",
      current?.scheduled_start ||
        null,
    )

  const scheduledEnd =
    parseDateField(
      body,
      "scheduled_end",
      current?.scheduled_end ||
        null,
    )

  if (
    scheduledStart &&
    scheduledEnd &&
    new Date(
      scheduledEnd,
    ).getTime() <=
      new Date(
        scheduledStart,
      ).getTime()
  ) {
    throw new HttpError(
      400,
      "ROOM 7 scheduled end must be after its scheduled start.",
    )
  }

  let passcodeHash =
    current?.passcode_hash ||
    null

  if (
    accessMode === "passcode"
  ) {
    const passcodeProvided =
      hasOwn(
        body,
        "passcode",
      )

    const rawPasscode =
      typeof body.passcode ===
      "string"
        ? body.passcode.trim()
        : ""

    if (
      passcodeProvided &&
      (
        rawPasscode.length < 6 ||
        rawPasscode.length > 128
      )
    ) {
      throw new HttpError(
        400,
        "ROOM 7 passcode must contain between 6 and 128 characters.",
      )
    }

    if (rawPasscode) {
      const pepper =
        Deno.env.get(
          "ROOM7_ACCESS_PEPPER",
        )?.trim() || ""

      if (!pepper) {
        throw new HttpError(
          503,
          "ROOM 7 passcode protection is not configured.",
        )
      }

      passcodeHash =
        await hmacSha256Hex(
          rawPasscode,
          pepper,
        )
    } else if (
      !passcodeHash
    ) {
      throw new HttpError(
        400,
        "A passcode is required for passcode-protected ROOM 7 access.",
      )
    }
  } else {
    passcodeHash = null
  }

  if (
    accessMode === "open" &&
    publicEnabled === true &&
    Deno.env.get(
      "ROOM7_ALLOW_OPEN_ACCESS",
    )?.trim().toLowerCase() !==
      "true"
  ) {
    throw new HttpError(
      503,
      "Open ROOM 7 access has not been enabled for this environment.",
    )
  }

  const eventState =
    current?.event_state ||
    "draft"

  const payload = {
    room_id:
      room.id,
    slug,
    room_kind:
      roomKind,
    access_mode:
      accessMode,
    event_state:
      eventState,
    default_guest_role:
      defaultGuestRole,
    public_enabled:
      publicEnabled,
    public_summary:
      publicSummary,
    timezone,
    scheduled_start:
      scheduledStart,
    scheduled_end:
      scheduledEnd,
    passcode_hash:
      passcodeHash,
  }

  const {
    data,
    error,
  } = await admin
    .from("room7_external_rooms")
    .upsert(
      payload,
      {
        onConflict:
          "room_id",
      },
    )
    .select(
      "room_id,slug,room_kind,access_mode,event_state," +
      "default_guest_role,public_enabled,public_summary," +
      "timezone,scheduled_start,scheduled_end,passcode_hash," +
      "created_at,updated_at",
    )
    .single()

  if (error) {
    if (
      error.code === "23505"
    ) {
      throw new HttpError(
        409,
        "That ROOM 7 public slug is already in use.",
      )
    }

    if (
      error.code === "23514"
    ) {
      throw new HttpError(
        400,
        "ROOM 7 event configuration violates a database constraint.",
      )
    }

    throw error
  }

  return data
}

async function setExternalState(
  admin: ReturnType<
    typeof createClient
  >,
  current: any,
  room: any,
  profile: EmployeeProfile,
  body: any,
) {
  if (!current) {
    throw new HttpError(
      409,
      "Configure external ROOM 7 access before changing event state.",
    )
  }

  const requested =
    cleanText(
      body?.event_state ||
      body?.state,
      40,
    ).toLowerCase() as EventState

  if (
    !eventStates.has(
      requested,
    )
  ) {
    throw new HttpError(
      400,
      "Invalid ROOM 7 event state.",
    )
  }

  const currentState =
    current.event_state as EventState

  if (
    requested ===
    currentState
  ) {
    return {
      previousState:
        currentState,
      external:
        current,
    }
  }

  const force =
    body?.force === true

  if (
    force &&
    !isManagerOrAdmin(
      profile,
    )
  ) {
    throw new HttpError(
      403,
      "Only Manager or Administrator can force a ROOM 7 state override.",
    )
  }

  const normallyAllowed =
    normalTransitions[
      currentState
    ]?.includes(
      requested,
    ) === true

  if (
    !normallyAllowed &&
    !force
  ) {
    throw new HttpError(
      409,
      `ROOM 7 cannot move directly from ${currentState} to ${requested}.`,
    )
  }

  if (
    [
      "doors_open",
      "live",
      "intermission",
      "replay",
    ].includes(
      requested,
    ) &&
    current.public_enabled !==
      true
  ) {
    throw new HttpError(
      409,
      "Enable the external ROOM 7 page before opening this event to guests.",
    )
  }

  const {
    data,
    error,
  } = await admin
    .from("room7_external_rooms")
    .update({
      event_state:
        requested,
    })
    .eq(
      "room_id",
      room.id,
    )
    .eq(
      "event_state",
      currentState,
    )
    .select(
      "room_id,slug,room_kind,access_mode,event_state," +
      "default_guest_role,public_enabled,public_summary," +
      "timezone,scheduled_start,scheduled_end,passcode_hash," +
      "created_at,updated_at",
    )
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new HttpError(
      409,
      "ROOM 7 event state changed in another session. Refresh and retry.",
    )
  }

  return {
    previousState:
      currentState,
    external:
      data,
  }
}

function publicRoomUrl(
  room: any,
  external: any,
) {
  const slug =
    cleanText(
      external?.slug,
      80,
    )

  return slug
    ? `${publicRoom7Origin}/${encodeURIComponent(slug)}`
    : `${publicRoom7Origin}/r/${encodeURIComponent(room.room_code)}`
}

function invitationForResponse(
  invitation: any,
) {
  return {
    id:
      invitation.id,
    email:
      invitation.email || null,
    display_name:
      invitation.display_name || null,
    role:
      invitation.role,
    status:
      invitation.status,
    expires_at:
      invitation.expires_at || null,
    first_used_at:
      invitation.first_used_at || null,
    last_used_at:
      invitation.last_used_at || null,
    use_count:
      Number(
        invitation.use_count || 0,
      ),
    created_at:
      invitation.created_at,
    updated_at:
      invitation.updated_at,
  }
}

async function listInvitations(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
) {
  const {
    data,
    error,
  } = await admin
    .from("room7_guest_invitations")
    .select(
      "id,email,display_name,role,status,expires_at," +
      "first_used_at,last_used_at,use_count,created_at,updated_at",
    )
    .eq(
      "room_id",
      roomId,
    )
    .order(
      "created_at",
      {
        ascending: false,
      },
    )
    .limit(250)

  if (error) {
    throw error
  }

  return (
    data || []
  ).map(
    invitationForResponse,
  )
}

async function createInvitation(
  admin: ReturnType<
    typeof createClient
  >,
  room: any,
  external: any,
  profile: EmployeeProfile,
  body: any,
) {
  if (!external) {
    throw new HttpError(
      409,
      "Configure external ROOM 7 access before creating invitations.",
    )
  }

  const rawEmail =
    cleanText(
      body?.email,
      320,
    )

  const email =
    rawEmail
      ? cleanEmail(
          rawEmail,
        )
      : ""

  if (
    rawEmail &&
    !email
  ) {
    throw new HttpError(
      400,
      "Invitation email address is invalid.",
    )
  }

  let displayName:
    string | null = null

  if (
    hasOwn(
      body,
      "display_name",
    )
  ) {
    if (
      body.display_name === null ||
      body.display_name === ""
    ) {
      displayName = null
    } else if (
      typeof body.display_name !==
      "string"
    ) {
      throw new HttpError(
        400,
        "Invitation display name must be text or null.",
      )
    } else {
      const candidate =
        body.display_name
          .trim()

      if (
        candidate.length > 180
      ) {
        throw new HttpError(
          400,
          "Invitation display name cannot exceed 180 characters.",
        )
      }

      displayName =
        candidate || null
    }
  }

  const requestedRole =
    cleanText(
      body?.role ||
      external.default_guest_role,
      40,
    ).toLowerCase()

  if (
    ![
      "attendee",
      "viewer",
      "presenter",
    ].includes(
      requestedRole,
    )
  ) {
    throw new HttpError(
      400,
      "Invitation role must be attendee, viewer or presenter.",
    )
  }

  if (
    requestedRole ===
      "presenter" &&
    !email
  ) {
    throw new HttpError(
      400,
      "Presenter invitations must be bound to an email address.",
    )
  }

  const now =
    Date.now()

  let expiresAtMs:
    number

  if (
    hasOwn(
      body,
      "expires_at",
    )
  ) {
    if (
      typeof body.expires_at !==
        "string" ||
      !body.expires_at.trim()
    ) {
      throw new HttpError(
        400,
        "Invitation expiry must be a valid date/time.",
      )
    }

    expiresAtMs =
      new Date(
        body.expires_at,
      ).getTime()

    if (
      Number.isNaN(
        expiresAtMs,
      )
    ) {
      throw new HttpError(
        400,
        "Invitation expiry is not a valid date/time.",
      )
    }
  } else if (
    external.scheduled_end
  ) {
    expiresAtMs =
      Math.max(
        new Date(
          external.scheduled_end,
        ).getTime() +
          24 * 60 * 60 * 1000,
        now +
          60 * 60 * 1000,
      )
  } else {
    expiresAtMs =
      now +
      7 * 24 * 60 * 60 * 1000
  }

  if (
    expiresAtMs <= now
  ) {
    throw new HttpError(
      400,
      "Invitation expiry must be in the future.",
    )
  }

  const maximumExpiry =
    now +
    90 * 24 * 60 * 60 * 1000

  if (
    expiresAtMs >
    maximumExpiry
  ) {
    throw new HttpError(
      400,
      "ROOM 7 invitations cannot remain valid for more than 90 days.",
    )
  }

  const expiresAt =
    new Date(
      expiresAtMs,
    ).toISOString()

  if (email) {
    const {
      data: existing,
      error: existingError,
    } = await admin
      .from("room7_guest_invitations")
      .select(
        "id,status,expires_at,role",
      )
      .eq(
        "room_id",
        room.id,
      )
      .eq(
        "email",
        email,
      )
      .eq(
        "role",
        requestedRole,
      )
      .eq(
        "status",
        "active",
      )
      .gt(
        "expires_at",
        new Date().toISOString(),
      )
      .limit(1)
      .maybeSingle()

    if (existingError) {
      throw existingError
    }

    if (existing) {
      throw new HttpError(
        409,
        "This email already has an active ROOM 7 invitation for that role.",
      )
    }
  }

  for (
    let attempt = 0;
    attempt < 3;
    attempt += 1
  ) {
    const token =
      randomInviteToken()

    const tokenHash =
      await sha256Hex(
        token,
      )

    const {
      data,
      error,
    } = await admin
      .from("room7_guest_invitations")
      .insert({
        room_id:
          room.id,
        email:
          email || null,
        display_name:
          displayName,
        role:
          requestedRole,
        token_hash:
          tokenHash,
        status:
          "active",
        expires_at:
          expiresAt,
        invited_by:
          profile.id,
      })
      .select(
        "id,email,display_name,role,status,expires_at," +
        "first_used_at,last_used_at,use_count,created_at,updated_at",
      )
      .single()

    if (!error) {
      const invitationUrl =
        new URL(
          publicRoomUrl(
            room,
            external,
          ),
        )

      invitationUrl.hash =
        new URLSearchParams({
          invite:
            token,
        }).toString()

      return {
        invitation:
          invitationForResponse(
            data,
          ),
        invite_token:
          token,
        invitation_url:
          invitationUrl.toString(),
      }
    }

    if (
      error.code !== "23505"
    ) {
      throw error
    }
  }

  throw new HttpError(
    500,
    "Unable to generate a unique ROOM 7 invitation.",
  )
}

async function revokeInvitation(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  body: any,
) {
  const invitationId =
    uuid(
      body?.invitation_id ||
      body?.invitationId,
    )

  if (!invitationId) {
    throw new HttpError(
      400,
      "A valid ROOM 7 invitation ID is required.",
    )
  }

  const {
    data,
    error,
  } = await admin
    .from("room7_guest_invitations")
    .update({
      status:
        "revoked",
    })
    .eq(
      "id",
      invitationId,
    )
    .eq(
      "room_id",
      roomId,
    )
    .select(
      "id,email,display_name,role,status,expires_at," +
      "first_used_at,last_used_at,use_count,created_at,updated_at",
    )
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new HttpError(
      404,
      "ROOM 7 invitation not found.",
    )
  }

  return invitationForResponse(
    data,
  )
}


async function loadRoom7EngagementControl(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
) {
  const [
    contentResult,
    questionResult,
    interestResult,
  ] =
    await Promise.all([
      admin
        .from(
          "room7_event_content",
        )
        .select(
          [
            "story_headline",
            "story_body",
            "story_points",
            "programme_items",
            "invest_headline",
            "invest_body",
            "invest_cta_label",
            "qna_enabled",
            "investor_interest_enabled",
            "updated_at",
          ].join(","),
        )
        .eq(
          "room_id",
          roomId,
        )
        .maybeSingle(),

      admin
        .from(
          "room7_event_questions",
        )
        .select(
          [
            "id",
            "display_name",
            "email",
            "question",
            "status",
            "answer_text",
            "is_pinned",
            "submitted_at",
            "moderated_at",
            "answered_at",
            "updated_at",
          ].join(","),
        )
        .eq(
          "room_id",
          roomId,
        )
        .order(
          "is_pinned",
          {
            ascending:
              false,
          },
        )
        .order(
          "submitted_at",
          {
            ascending:
              false,
          },
        )
        .limit(250),

      admin
        .from(
          "room7_investor_interest",
        )
        .select(
          [
            "id",
            "display_name",
            "email",
            "company",
            "phone",
            "interest_type",
            "investment_range",
            "message",
            "contact_consent",
            "consent_version",
            "consent_at",
            "status",
            "internal_notes",
            "submitted_at",
            "last_submitted_at",
            "updated_at",
          ].join(","),
        )
        .eq(
          "room_id",
          roomId,
        )
        .order(
          "last_submitted_at",
          {
            ascending:
              false,
          },
        )
        .limit(250),
    ])

  if (contentResult.error) {
    throw contentResult.error
  }

  if (questionResult.error) {
    throw questionResult.error
  }

  if (interestResult.error) {
    throw interestResult.error
  }

  return {
    content:
      contentResult.data ||
      null,

    questions:
      questionResult.data ||
      [],

    investor_interest:
      interestResult.data ||
      [],
  }
}

async function saveRoom7EngagementContent(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  profile: EmployeeProfile,
  body: any,
) {
  if (
    typeof body?.qna_enabled !==
      "boolean"
  ) {
    throw new HttpError(
      400,
      "qna_enabled must be true or false.",
    )
  }

  if (
    typeof body
      ?.investor_interest_enabled !==
      "boolean"
  ) {
    throw new HttpError(
      400,
      "investor_interest_enabled must be true or false.",
    )
  }

  const payload = {
    room_id:
      roomId,

    story_headline:
      room7OptionalContentText(
        body?.story_headline,
        180,
        "Story headline",
      ),

    story_body:
      room7OptionalContentText(
        body?.story_body,
        5000,
        "Story body",
      ),

    story_points:
      room7StoryPoints(
        body?.story_points ??
          [],
      ),

    programme_items:
      room7ProgrammeItems(
        body?.programme_items ??
          [],
      ),

    invest_headline:
      room7OptionalContentText(
        body?.invest_headline,
        180,
        "Investment headline",
      ),

    invest_body:
      room7OptionalContentText(
        body?.invest_body,
        5000,
        "Investment body",
      ),

    invest_cta_label:
      room7OptionalContentText(
        body?.invest_cta_label,
        80,
        "Investment call to action",
      ),

    qna_enabled:
      body.qna_enabled,

    investor_interest_enabled:
      body
        .investor_interest_enabled,

    updated_by:
      profile.id,
  }

  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_event_content",
      )
      .upsert(
        payload,
        {
          onConflict:
            "room_id",
        },
      )
      .select(
        [
          "story_headline",
          "story_body",
          "story_points",
          "programme_items",
          "invest_headline",
          "invest_body",
          "invest_cta_label",
          "qna_enabled",
          "investor_interest_enabled",
          "updated_at",
        ].join(","),
      )
      .single()

  if (error) {
    throw error
  }

  return data
}

async function moderateRoom7Question(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  profile: EmployeeProfile,
  body: any,
) {
  const questionId =
    room7ControlUuid(
      body?.question_id,
      "ROOM 7 question",
    )

  const status =
    cleanText(
      body?.status,
      40,
    )
      .toLowerCase()

  if (
    ![
      "pending",
      "approved",
      "answered",
      "dismissed",
    ].includes(
      status,
    )
  ) {
    throw new HttpError(
      400,
      "Invalid ROOM 7 question status.",
    )
  }

  const answer =
    room7OptionalContentText(
      body?.answer_text,
      2000,
      "Question answer",
    )

  if (
    status ===
      "answered" &&
    !answer
  ) {
    throw new HttpError(
      400,
      "Answered ROOM 7 questions require an answer.",
    )
  }

  const pinned =
    (
      status ===
        "approved" ||
      status ===
        "answered"
    ) &&
    body?.is_pinned ===
      true

  const now =
    new Date()
      .toISOString()

  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_event_questions",
      )
      .update({
        status,

        answer_text:
          status ===
            "answered"
            ? answer
            : null,

        is_pinned:
          pinned,

        moderated_by:
          profile.id,

        moderated_at:
          now,

        answered_at:
          status ===
            "answered"
            ? now
            : null,
      })
      .eq(
        "room_id",
        roomId,
      )
      .eq(
        "id",
        questionId,
      )
      .select(
        [
          "id",
          "display_name",
          "email",
          "question",
          "status",
          "answer_text",
          "is_pinned",
          "submitted_at",
          "moderated_at",
          "answered_at",
          "updated_at",
        ].join(","),
      )
      .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new HttpError(
      404,
      "ROOM 7 question not found.",
    )
  }

  return data
}

async function updateRoom7InvestorInterest(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  body: any,
) {
  const interestId =
    room7ControlUuid(
      body?.interest_id,
      "ROOM 7 investor record",
    )

  const status =
    cleanText(
      body?.status,
      40,
    )
      .toLowerCase()

  if (
    ![
      "new",
      "contacted",
      "qualified",
      "closed",
    ].includes(
      status,
    )
  ) {
    throw new HttpError(
      400,
      "Invalid ROOM 7 investor follow-up status.",
    )
  }

  const internalNotes =
    room7OptionalContentText(
      body?.internal_notes,
      5000,
      "Investor internal notes",
    )

  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_investor_interest",
      )
      .update({
        status,

        internal_notes:
          internalNotes,
      })
      .eq(
        "room_id",
        roomId,
      )
      .eq(
        "id",
        interestId,
      )
      .select(
        [
          "id",
          "display_name",
          "email",
          "company",
          "phone",
          "interest_type",
          "investment_range",
          "message",
          "contact_consent",
          "consent_version",
          "consent_at",
          "status",
          "internal_notes",
          "submitted_at",
          "last_submitted_at",
          "updated_at",
        ].join(","),
      )
      .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new HttpError(
      404,
      "ROOM 7 investor record not found.",
    )
  }

  return data
}

serve(async req => {
  if (
    req.method === "OPTIONS"
  ) {
    return new Response(
      "ok",
      {
        headers:
          cors(req),
      },
    )
  }

  if (
    req.method !== "POST"
  ) {
    return json(
      req,
      {
        error:
          "Method not allowed.",
      },
      405,
    )
  }

  const rawBody =
    await req.text()

  if (
    rawBody.length > 16_384
  ) {
    return json(
      req,
      {
        error:
          "Request is too large.",
      },
      413,
    )
  }

  let body: any

  try {
    body =
      JSON.parse(
        rawBody || "{}",
      )
  } catch {
    return json(
      req,
      {
        error:
          "Invalid request.",
      },
      400,
    )
  }

  const action =
    cleanText(
      body?.action,
      30,
    ) as
      | RoomAction
      | "engagement_get"
      | "engagement_save_content"
      | "engagement_moderate_question"
      | "engagement_update_interest"
      | "join_requests"
      | "decide_request"
      | "lobby_chat_list"
      | "lobby_chat_send"


  if (
    action !== "get" &&
    action !== "configure" &&
    action !== "set_state" &&
    action !== "list_invitations" &&
    action !== "create_invitation" &&
    action !== "revoke_invitation" &&
    action !== "engagement_get" &&
    action !== "engagement_save_content" &&
    action !== "engagement_moderate_question" &&
    action !== "engagement_update_interest" &&
    action !== "join_requests" &&
    action !== "decide_request" &&
    action !== "lobby_chat_list" &&
    action !== "lobby_chat_send"
  ) {
    return json(
      req,
      {
        error:
          "Unsupported ROOM 7 event action.",
      },
      400,
    )
  }

  const supabaseUrl =
    Deno.env.get(
      "SUPABASE_URL",
    )

  const serviceRoleKey =
    Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    )

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    return json(
      req,
      {
        error:
          "ROOM 7 event control is not configured.",
      },
      500,
    )
  }

  const admin =
    createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession:
            false,
          autoRefreshToken:
            false,
        },
      },
    )

  try {
    const profile =
      await authenticateEmployee(
        req,
        admin,
      )

    const room =
      await resolveRoom(
        admin,
        body,
      )

    const authority =
      assertControlAuthority(
        room,
        profile,
      )

    let external =
      await loadExternalRoom(
        admin,
        room.id,
      )

    if (
      action === "get"
    ) {
      return json(
        req,
        await withSettings(
          admin,
          room.id,
          eventResponse(
            room,
            external,
            authority,
          ),
        ),
      )
    }

    if (action === "join_requests") {
      const settings =
        await loadEventSettings(admin, room.id)

      return json(
        req,
        {
          requests:
            settings.admission === "host"
              ? await listJoinRequests(admin, room.id)
              : [],
          admission: settings.admission,
        },
      )
    }

    if (action === "lobby_chat_list" || action === "lobby_chat_send") {
      if (action === "lobby_chat_send") {
        const text = cleanLobbyBody(body?.body)

        if (!text) throw new HttpError(400, "Type a message first.")

        const { error: insertError } = await admin
          .from("room7_lobby_messages")
          .insert({
            room_id: room.id,
            author_kind: "host",
            author_name: "Host",
            body: text,
          })

        if (insertError) {
          throw new HttpError(503, "Waiting room chat is not ready yet. Run the ROOM 7 lobby chat migration.")
        }
      }

      const { data: rows } = await admin
        .from("room7_lobby_messages")
        .select("id,author_kind,author_name,request_id,body,created_at")
        .eq("room_id", room.id)
        .order("created_at", { ascending: false })
        .limit(100)

      return json(req, { messages: shapeLobby(rows || [], null) })
    }

    if (action === "decide_request") {
      await decideJoinRequests(
        admin,
        room.id,
        profile,
        body,
      )

      return json(
        req,
        {
          requests:
            await listJoinRequests(admin, room.id),
        },
      )
    }

    if (
      action === "configure"
    ) {
      external =
        await configureExternalRoom(
          admin,
          room,
          external,
          body,
        )

      await saveEventSettings(
        admin,
        room.id,
        body,
      )

      console.info(
        "ROOM 7 external event configured",
        {
          roomId:
            room.id,
          actorId:
            profile.id,
          actorRole:
            profile.role,
          eventState:
            external.event_state,
          roomKind:
            external.room_kind,
          accessMode:
            external.access_mode,
          publicEnabled:
            external.public_enabled,
        },
      )

      return json(
        req,
        await withSettings(
          admin,
          room.id,
          eventResponse(
            room,
            external,
            authority,
          ),
        ),
      )
    }

    if (
      action === "list_invitations"
    ) {
      if (!external) {
        throw new HttpError(
          409,
          "Configure external ROOM 7 access before managing invitations.",
        )
      }

      const invitations =
        await listInvitations(
          admin,
          room.id,
        )

      return json(
        req,
        {
          ...eventResponse(
            room,
            external,
            authority,
          ),
          invitations,
        },
      )
    }

    if (
      action === "create_invitation"
    ) {
      const result =
        await createInvitation(
          admin,
          room,
          external,
          profile,
          body,
        )

      console.info(
        "ROOM 7 external invitation created",
        {
          roomId:
            room.id,
          actorId:
            profile.id,
          actorRole:
            profile.role,
          invitationId:
            result.invitation.id,
          guestRole:
            result.invitation.role,
          expiresAt:
            result.invitation.expires_at,
        },
      )

      return json(
        req,
        {
          ...eventResponse(
            room,
            external,
            authority,
          ),
          ...result,
        },
        201,
      )
    }

    if (
      action === "revoke_invitation"
    ) {
      if (!external) {
        throw new HttpError(
          409,
          "Configure external ROOM 7 access before managing invitations.",
        )
      }

      const invitation =
        await revokeInvitation(
          admin,
          room.id,
          body,
        )

      console.info(
        "ROOM 7 external invitation revoked",
        {
          roomId:
            room.id,
          actorId:
            profile.id,
          actorRole:
            profile.role,
          invitationId:
            invitation.id,
        },
      )

      return json(
        req,
        {
          ...eventResponse(
            room,
            external,
            authority,
          ),
          invitation,
        },
      )
    }

    if (
      action ===
        "engagement_get"
    ) {
      if (!external) {
        throw new HttpError(
          409,
          "Configure external ROOM 7 access before managing event engagement.",
        )
      }

      const engagement =
        await loadRoom7EngagementControl(
          admin,
          room.id,
        )

      return json(
        req,
        {
          ...eventResponse(
            room,
            external,
            authority,
          ),

          engagement,
        },
      )
    }

    if (
      action ===
        "engagement_save_content"
    ) {
      if (!external) {
        throw new HttpError(
          409,
          "Configure external ROOM 7 access before managing event content.",
        )
      }

      const content =
        await saveRoom7EngagementContent(
          admin,
          room.id,
          profile,
          body,
        )

      console.info(
        "ROOM 7 event content updated",
        {
          roomId:
            room.id,

          actorId:
            profile.id,

          actorRole:
            profile.role,
        },
      )

      return json(
        req,
        {
          ...eventResponse(
            room,
            external,
            authority,
          ),

          content,
        },
      )
    }

    if (
      action ===
        "engagement_moderate_question"
    ) {
      if (!external) {
        throw new HttpError(
          409,
          "Configure external ROOM 7 access before moderating questions.",
        )
      }

      const question =
        await moderateRoom7Question(
          admin,
          room.id,
          profile,
          body,
        )

      console.info(
        "ROOM 7 question moderated",
        {
          roomId:
            room.id,

          actorId:
            profile.id,

          actorRole:
            profile.role,

          questionId:
            question.id,

          status:
            question.status,
        },
      )

      return json(
        req,
        {
          ...eventResponse(
            room,
            external,
            authority,
          ),

          question,
        },
      )
    }

    if (
      action ===
        "engagement_update_interest"
    ) {
      if (!external) {
        throw new HttpError(
          409,
          "Configure external ROOM 7 access before managing investor follow-up.",
        )
      }

      const interest =
        await updateRoom7InvestorInterest(
          admin,
          room.id,
          body,
        )

      console.info(
        "ROOM 7 investor follow-up updated",
        {
          roomId:
            room.id,

          actorId:
            profile.id,

          actorRole:
            profile.role,

          interestId:
            interest.id,

          status:
            interest.status,
        },
      )

      return json(
        req,
        {
          ...eventResponse(
            room,
            external,
            authority,
          ),

          interest,
        },
      )
    }

    const stateResult =
      await setExternalState(
        admin,
        external,
        room,
        profile,
        body,
      )

    external =
      stateResult.external

    console.info(
      "ROOM 7 external state changed",
      {
        roomId:
          room.id,
        actorId:
          profile.id,
        actorRole:
          profile.role,
        previousState:
          stateResult.previousState,
        nextState:
          external.event_state,
        forced:
          body?.force === true,
      },
    )

    return json(
      req,
      {
        ...eventResponse(
          room,
          external,
          authority,
        ),
        previous_state:
          stateResult.previousState,
      },
    )
  } catch (error) {
    if (
      error instanceof
      HttpError
    ) {
      return json(
        req,
        {
          error:
            error.message,
        },
        error.status,
      )
    }

    console.error(
      "ROOM 7 event control failed:",
      error,
    )

    return json(
      req,
      {
        error:
          "Unable to control this ROOM 7 event.",
      },
      500,
    )
  }
})
