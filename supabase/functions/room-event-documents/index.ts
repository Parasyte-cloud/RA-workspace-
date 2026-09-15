import {
  createClient,
} from "https://esm.sh/@supabase/supabase-js@2.57.4"

type JsonObject =
  Record<string, unknown>

type EmployeeProfile = {
  id: string
  role: string
  active: boolean
}

type ResolvedRoom = {
  room: Record<string, any>
  external: Record<string, any>
}

type InvitationAccess = {
  invitation: Record<string, any>
  guestParticipantId: string | null
}

class HttpError extends Error {
  status: number

  constructor(
    status: number,
    message: string,
  ) {
    super(message)
    this.status = status
  }
}

const BUCKET =
  "room7-event-documents"

const MAX_BODY_BYTES =
  16 * 1024

const MAX_FILE_BYTES =
  25 * 1024 * 1024

const SIGNED_PREVIEW_SECONDS =
  5 * 60

const ROOM7_PUBLIC_ORIGIN =
  "https://room7.ridearrivo.com"

const INTRANET_ORIGIN =
  "https://intranet.ridearrivo.com"

const documentCategories =
  new Set([
    "general",
    "programme",
    "company",
    "investor",
    "brochure",
    "legal",
  ])

const documentStatuses =
  new Set([
    "draft",
    "published",
    "archived",
  ])

const allowedMimeTypes =
  new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ])

const privilegedRoles =
  new Set([
    "admin",
    "administrator",
    "manager",
  ])

const extensionByMime:
  Record<string, string> = {
    "application/pdf":
      "pdf",

    "image/jpeg":
      "jpg",

    "image/png":
      "png",

    "image/webp":
      "webp",
  }

function cleanText(
  value: unknown,
  maxLength: number,
) {
  if (
    typeof value !== "string"
  ) {
    return ""
  }

  return value
    .trim()
    .slice(
      0,
      maxLength,
    )
}

function cleanNullableText(
  value: unknown,
  maxLength: number,
) {
  const result =
    cleanText(
      value,
      maxLength,
    )

  return result ||
    null
}

function isUuid(
  value: string,
) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)
}

function localOriginAllowed(
  origin: string,
) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i
    .test(origin)
}

function responseOrigin(
  req: Request,
) {
  const origin =
    req.headers.get(
      "Origin",
    ) || ""

  if (
    origin ===
      ROOM7_PUBLIC_ORIGIN ||
    origin ===
      INTRANET_ORIGIN ||
    localOriginAllowed(origin)
  ) {
    return origin
  }

  return ROOM7_PUBLIC_ORIGIN
}

function corsHeaders(
  req: Request,
) {
  return {
    "Access-Control-Allow-Origin":
      responseOrigin(req),

    "Access-Control-Allow-Headers":
      [
        "authorization",
        "apikey",
        "content-type",
        "x-client-info",
      ].join(", "),

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Access-Control-Max-Age":
      "86400",

    "Vary":
      "Origin",
  }
}

function json(
  req: Request,
  body: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        ...corsHeaders(req),

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store, max-age=0",

        "Pragma":
          "no-cache",

        "X-Content-Type-Options":
          "nosniff",

        "Referrer-Policy":
          "no-referrer",

        "Cross-Origin-Resource-Policy":
          "same-site",
      },
    },
  )
}

async function readBody(
  req: Request,
) {
  const declaredLength =
    Number(
      req.headers.get(
        "Content-Length",
      ) || 0,
    )

  if (
    Number.isFinite(
      declaredLength,
    ) &&
    declaredLength >
      MAX_BODY_BYTES
  ) {
    throw new HttpError(
      413,
      "ROOM 7 document request is too large.",
    )
  }

  const raw =
    await req.text()

  if (
    new TextEncoder()
      .encode(raw)
      .byteLength >
    MAX_BODY_BYTES
  ) {
    throw new HttpError(
      413,
      "ROOM 7 document request is too large.",
    )
  }

  if (!raw.trim()) {
    return {} as JsonObject
  }

  try {
    const value =
      JSON.parse(raw)

    if (
      !value ||
      typeof value !==
        "object" ||
      Array.isArray(value)
    ) {
      throw new Error(
        "not-object",
      )
    }

    return value as JsonObject
  } catch {
    throw new HttpError(
      400,
      "Invalid ROOM 7 document request.",
    )
  }
}

async function sha256Hex(
  value: string,
) {
  const data =
    new TextEncoder()
      .encode(value)

  const digest =
    await crypto.subtle
      .digest(
        "SHA-256",
        data,
      )

  return Array.from(
    new Uint8Array(
      digest,
    ),
  )
    .map(byte =>
      byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("")
}

function booleanField(
  value: unknown,
  fallback: boolean,
) {
  return typeof value ===
    "boolean"
      ? value
      : fallback
}

function integerField(
  value: unknown,
  fallback: number,
) {
  if (
    typeof value !==
      "number" ||
    !Number.isInteger(
      value,
    )
  ) {
    return fallback
  }

  return value
}

function publicDocument(
  document: Record<string, any>,
) {
  return {
    id:
      document.id,

    title:
      document.title,

    description:
      document.description,

    category:
      document.category,

    mime_type:
      document.mime_type,

    file_size_bytes:
      document.file_size_bytes,

    sort_order:
      document.sort_order,

    allow_download:
      document.allow_download,

    created_at:
      document.created_at,

    updated_at:
      document.updated_at,
  }
}

function visibilityColumn(
  eventState: string,
) {
  if (
    eventState ===
      "pre_event"
  ) {
    return "available_before"
  }

  if (
    eventState ===
      "doors_open" ||
    eventState ===
      "live" ||
    eventState ===
      "intermission"
  ) {
    return "available_during"
  }

  if (
    eventState ===
      "ended" ||
    eventState ===
      "replay"
  ) {
    return "available_after"
  }

  return null
}

async function resolveRoom(
  admin: ReturnType<
    typeof createClient
  >,
  body: JsonObject,
): Promise<ResolvedRoom> {
  const slug =
    cleanText(
      body.slug,
      80,
    )
      .toLowerCase()

  const roomCode =
    cleanText(
      body.room_code,
      8,
    )
      .toUpperCase()

  if (
    !slug &&
    !roomCode
  ) {
    throw new HttpError(
      400,
      "ROOM 7 event locator is required.",
    )
  }

  let room:
    Record<string, any> |
    null = null

  let external:
    Record<string, any> |
    null = null

  if (slug) {
    const {
      data:
        externalData,

      error:
        externalError,
    } =
      await admin
        .from(
          "room7_external_rooms",
        )
        .select(
          [
            "room_id",
            "slug",
            "room_kind",
            "access_mode",
            "event_state",
            "public_enabled",
            "scheduled_start",
            "scheduled_end",
          ].join(","),
        )
        .eq(
          "slug",
          slug,
        )
        .maybeSingle()

    if (
      externalError
    ) {
      throw externalError
    }

    if (
      !externalData
    ) {
      throw new HttpError(
        404,
        "ROOM 7 event not found.",
      )
    }

    external =
      externalData

    const {
      data:
        roomData,

      error:
        roomError,
    } =
      await admin
        .from(
          "workspace_rooms",
        )
        .select(
          "id,room_code,title,status,created_by",
        )
        .eq(
          "id",
          external.room_id,
        )
        .maybeSingle()

    if (
      roomError
    ) {
      throw roomError
    }

    room =
      roomData
  } else {
    const {
      data:
        roomData,

      error:
        roomError,
    } =
      await admin
        .from(
          "workspace_rooms",
        )
        .select(
          "id,room_code,title,status,created_by",
        )
        .eq(
          "room_code",
          roomCode,
        )
        .maybeSingle()

    if (
      roomError
    ) {
      throw roomError
    }

    if (
      !roomData
    ) {
      throw new HttpError(
        404,
        "ROOM 7 event not found.",
      )
    }

    room =
      roomData

    const {
      data:
        externalData,

      error:
        externalError,
    } =
      await admin
        .from(
          "room7_external_rooms",
        )
        .select(
          [
            "room_id",
            "slug",
            "room_kind",
            "access_mode",
            "event_state",
            "public_enabled",
            "scheduled_start",
            "scheduled_end",
          ].join(","),
        )
        .eq(
          "room_id",
          room.id,
        )
        .maybeSingle()

    if (
      externalError
    ) {
      throw externalError
    }

    external =
      externalData
  }

  if (
    !room ||
    !external
  ) {
    throw new HttpError(
      404,
      "ROOM 7 event not found.",
    )
  }

  if (
    room.status !==
      "active" &&
    external.event_state !==
      "ended" &&
    external.event_state !==
      "replay"
  ) {
    throw new HttpError(
      409,
      "ROOM 7 event is not active.",
    )
  }

  return {
    room,
    external,
  }
}

function documentGuestEmail(
  value: unknown,
) {
  const email =
    cleanText(
      value,
      320,
    )
      .toLowerCase()

  if (!email) {
    return ""
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(email)
      ? email
      : ""
}

async function documentHmacSha256Hex(
  value: string,
  secret: string,
) {
  const encoder =
    new TextEncoder()

  const key =
    await crypto.subtle
      .importKey(
        "raw",
        encoder.encode(
          secret,
        ),
        {
          name:
            "HMAC",

          hash:
            "SHA-256",
        },
        false,
        [
          "sign",
        ],
      )

  const signature =
    await crypto.subtle
      .sign(
        "HMAC",
        key,
        encoder.encode(
          value,
        ),
      )

  return Array.from(
    new Uint8Array(
      signature,
    ),
  )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0"),
    )
    .join("")
}

function documentConstantTimeEqual(
  left: string,
  right: string,
) {
  if (
    left.length !==
    right.length
  ) {
    return false
  }

  let difference = 0

  for (
    let index = 0;
    index <
      left.length;
    index += 1
  ) {
    difference |=
      left.charCodeAt(
        index,
      ) ^
      right.charCodeAt(
        index,
      )
  }

  return difference === 0
}

async function documentGuestParticipantId(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  email: string,
  source:
    "passcode" |
    "open",
) {
  if (!email) {
    return null
  }

  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_guest_participants",
      )
      .select("id")
      .eq(
        "room_id",
        roomId,
      )
      .eq(
        "email",
        email,
      )
      .eq(
        "source",
        source,
      )
      .order(
        "created_at",
        {
          ascending: true,
        },
      )
      .limit(1)
      .maybeSingle()

  if (error) {
    throw error
  }

  return data?.id || null
}

async function requireInvitation(
  admin: ReturnType<
    typeof createClient
  >,
  resolved: ResolvedRoom,
  body: JsonObject,
): Promise<InvitationAccess> {
  if (
    resolved.external
      .public_enabled !==
    true
  ) {
    throw new HttpError(
      404,
      "ROOM 7 event is not publicly available.",
    )
  }

  const accessMode =
    cleanText(
      resolved.external
        .access_mode,
      32,
    )

  if (
    accessMode ===
      "invitation"
  ) {
    const token =
      cleanText(
        body.invite_token,
        512,
      )

    if (
      token.length <
      24
    ) {
      throw new HttpError(
        401,
        "A valid ROOM 7 invitation is required.",
      )
    }

    const tokenHash =
      await sha256Hex(
        token,
      )

    const {
      data:
        invitation,

      error:
        invitationError,
    } =
      await admin
        .from(
          "room7_guest_invitations",
        )
        .select(
          "id,room_id,status,expires_at,role,email",
        )
        .eq(
          "room_id",
          resolved.room.id,
        )
        .eq(
          "token_hash",
          tokenHash,
        )
        .maybeSingle()

    if (
      invitationError
    ) {
      throw invitationError
    }

    if (
      !invitation ||
      invitation.status !==
        "active"
    ) {
      throw new HttpError(
        401,
        "ROOM 7 invitation is invalid.",
      )
    }

    if (
      invitation.expires_at &&
      new Date(
        invitation.expires_at,
      ).getTime() <=
        Date.now()
    ) {
      throw new HttpError(
        401,
        "ROOM 7 invitation has expired.",
      )
    }

    const invitedEmail =
      documentGuestEmail(
        invitation.email,
      )

    if (invitedEmail) {
      const providedEmail =
        documentGuestEmail(
          body.email,
        )

      if (
        !providedEmail ||
        providedEmail !==
          invitedEmail
      ) {
        throw new HttpError(
          401,
          "ROOM 7 invitation email does not match.",
        )
      }
    }

    const {
      data:
        guest,

      error:
        guestError,
    } =
      await admin
        .from(
          "room7_guest_participants",
        )
        .select("id")
        .eq(
          "room_id",
          resolved.room.id,
        )
        .eq(
          "invitation_id",
          invitation.id,
        )
        .maybeSingle()

    if (guestError) {
      throw guestError
    }

    return {
      invitation,
      guestParticipantId:
        guest?.id || null,
    }
  }

  const providedEmail =
    documentGuestEmail(
      body.email,
    )

  if (!providedEmail) {
    throw new HttpError(
      400,
      "Enter a valid email address to access ROOM 7 documents.",
    )
  }

  if (
    accessMode ===
      "passcode"
  ) {
    const passcode =
      cleanText(
        body.passcode,
        256,
      )

    if (
      passcode.length <
      4
    ) {
      throw new HttpError(
        403,
        "The ROOM 7 passcode is incorrect.",
      )
    }

    const pepper =
      Deno.env.get(
        "ROOM7_ACCESS_PEPPER",
      )
        ?.trim() || ""

    if (!pepper) {
      throw new HttpError(
        503,
        "ROOM 7 passcode access is not configured.",
      )
    }

    const expectedHash =
      cleanText(
        resolved.external
          .passcode_hash,
        64,
      )

    const suppliedHash =
      await documentHmacSha256Hex(
        passcode,
        pepper,
      )

    if (
      !expectedHash ||
      !documentConstantTimeEqual(
        suppliedHash,
        expectedHash,
      )
    ) {
      throw new HttpError(
        403,
        "The ROOM 7 passcode is incorrect.",
      )
    }

    const guestParticipantId =
      await documentGuestParticipantId(
        admin,
        resolved.room.id,
        providedEmail,
        "passcode",
      )

    /*
     * Public document callers already consume
     * access.invitation.id for telemetry.
     * A null ID correctly represents non-invitation
     * authorization without creating a fake DB row.
     */
    return {
      invitation: {
        id: null,
      },
      guestParticipantId,
    }
  }

  if (
    accessMode ===
      "open"
  ) {
    if (
      Deno.env.get(
        "ROOM7_ALLOW_OPEN_ACCESS",
      )
        ?.trim()
        .toLowerCase() !==
      "true"
    ) {
      throw new HttpError(
        503,
        "Open ROOM 7 access has not been enabled.",
      )
    }

    const guestParticipantId =
      await documentGuestParticipantId(
        admin,
        resolved.room.id,
        providedEmail,
        "open",
      )

    return {
      invitation: {
        id: null,
      },
      guestParticipantId,
    }
  }

  throw new HttpError(
    403,
    "This ROOM 7 access mode is unavailable.",
  )
}

async function requireEmployee(
  admin: ReturnType<
    typeof createClient
  >,
  req: Request,
): Promise<EmployeeProfile> {
  const authorization =
    req.headers.get(
      "Authorization",
    ) || ""

  if (
    !/^Bearer\s+/i.test(
      authorization,
    )
  ) {
    throw new HttpError(
      401,
      "Missing RideArrivo session.",
    )
  }

  const token =
    authorization
      .replace(
        /^Bearer\s+/i,
        "",
      )
      .trim()

  if (!token) {
    throw new HttpError(
      401,
      "Missing RideArrivo session.",
    )
  }

  const {
    data:
      userData,

    error:
      userError,
  } =
    await admin.auth
      .getUser(token)

  if (
    userError ||
    !userData?.user
  ) {
    throw new HttpError(
      401,
      "Your RideArrivo session is invalid.",
    )
  }

  const {
    data:
      profile,

    error:
      profileError,
  } =
    await admin
      .from(
        "employee_profiles",
      )
      .select(
        "id,role,active",
      )
      .eq(
        "id",
        userData.user.id,
      )
      .maybeSingle()

  if (
    profileError ||
    !profile ||
    profile.active !== true
  ) {
    throw new HttpError(
      403,
      "Active employee access is required.",
    )
  }

  return profile as
    EmployeeProfile
}

async function requireRoomAuthority(
  admin: ReturnType<
    typeof createClient
  >,
  profile: EmployeeProfile,
  roomId: string,
) {
  if (
    !isUuid(roomId)
  ) {
    throw new HttpError(
      400,
      "A valid ROOM 7 room ID is required.",
    )
  }

  const {
    data:
      room,

    error:
      roomError,
  } =
    await admin
      .from(
        "workspace_rooms",
      )
      .select(
        "id,room_code,title,status,created_by",
      )
      .eq(
        "id",
        roomId,
      )
      .maybeSingle()

  if (
    roomError
  ) {
    throw roomError
  }

  if (!room) {
    throw new HttpError(
      404,
      "ROOM 7 meeting not found.",
    )
  }

  const role =
    cleanText(
      profile.role,
      80,
    )
      .toLowerCase()

  const isCreator =
    room.created_by ===
      profile.id

  const privileged =
    privilegedRoles.has(
      role,
    )

  if (
    !isCreator &&
    !privileged
  ) {
    throw new HttpError(
      403,
      "ROOM 7 document management requires the room creator, Manager or Administrator.",
    )
  }

  return room
}

function validateDocumentInput(
  body: JsonObject,
) {
  const title =
    cleanText(
      body.title,
      180,
    )

  if (
    title.length < 1
  ) {
    throw new HttpError(
      400,
      "Document title is required.",
    )
  }

  const description =
    cleanNullableText(
      body.description,
      2000,
    )

  const category =
    cleanText(
      body.category,
      40,
    )
      .toLowerCase() ||
    "general"

  if (
    !documentCategories.has(
      category,
    )
  ) {
    throw new HttpError(
      400,
      "Invalid ROOM 7 document category.",
    )
  }

  const originalFileName =
    cleanText(
      body.original_file_name,
      255,
    )

  if (
    !originalFileName ||
    originalFileName.includes(
      "/",
    ) ||
    originalFileName.includes(
      "\\",
    )
  ) {
    throw new HttpError(
      400,
      "Invalid document file name.",
    )
  }

  const mimeType =
    cleanText(
      body.mime_type,
      120,
    )
      .toLowerCase()

  if (
    !allowedMimeTypes.has(
      mimeType,
    )
  ) {
    throw new HttpError(
      415,
      "ROOM 7 supports PDF, JPEG, PNG and WebP documents.",
    )
  }

  const fileSize =
    integerField(
      body.file_size_bytes,
      0,
    )

  if (
    fileSize < 1 ||
    fileSize >
      MAX_FILE_BYTES
  ) {
    throw new HttpError(
      400,
      "ROOM 7 documents must be between 1 byte and 25 MB.",
    )
  }

  const sortOrder =
    integerField(
      body.sort_order,
      0,
    )

  if (
    sortOrder < 0 ||
    sortOrder > 999
  ) {
    throw new HttpError(
      400,
      "Invalid document sort order.",
    )
  }

  const availableBefore =
    booleanField(
      body.available_before,
      true,
    )

  const availableDuring =
    booleanField(
      body.available_during,
      true,
    )

  const availableAfter =
    booleanField(
      body.available_after,
      true,
    )

  if (
    !availableBefore &&
    !availableDuring &&
    !availableAfter
  ) {
    throw new HttpError(
      400,
      "Published ROOM 7 documents need at least one visibility phase.",
    )
  }

  return {
    title,
    description,
    category,
    originalFileName,
    mimeType,
    fileSize,
    sortOrder,
    availableBefore,
    availableDuring,
    availableAfter,

    allowDownload:
      booleanField(
        body.allow_download,
        false,
      ),
  }
}

async function adminList(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
) {
  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .select(
        [
          "id",
          "room_id",
          "title",
          "description",
          "category",
          "storage_path",
          "original_file_name",
          "mime_type",
          "file_size_bytes",
          "sha256_hex",
          "sort_order",
          "status",
          "available_before",
          "available_during",
          "available_after",
          "allow_download",
          "created_at",
          "updated_at",
        ].join(","),
      )
      .eq(
        "room_id",
        roomId,
      )
      .order(
        "sort_order",
        {
          ascending: true,
        },
      )
      .order(
        "created_at",
        {
          ascending: true,
        },
      )

  if (error) {
    throw error
  }

  return data || []
}

async function prepareUpload(
  admin: ReturnType<
    typeof createClient
  >,
  profile: EmployeeProfile,
  roomId: string,
  body: JsonObject,
) {
  const input =
    validateDocumentInput(
      body,
    )

  const documentId =
    crypto.randomUUID()

  const extension =
    extensionByMime[
      input.mimeType
    ]

  const storagePath =
    [
      roomId,
      documentId,
      `${documentId}.${extension}`,
    ].join("/")

  const {
    data:
      inserted,

    error:
      insertError,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .insert({
        id:
          documentId,

        room_id:
          roomId,

        title:
          input.title,

        description:
          input.description,

        category:
          input.category,

        storage_path:
          storagePath,

        original_file_name:
          input.originalFileName,

        mime_type:
          input.mimeType,

        file_size_bytes:
          input.fileSize,

        sort_order:
          input.sortOrder,

        status:
          "draft",

        available_before:
          input.availableBefore,

        available_during:
          input.availableDuring,

        available_after:
          input.availableAfter,

        allow_download:
          input.allowDownload,

        uploaded_by:
          profile.id,
      })
      .select(
        "id,room_id,title,status,storage_path",
      )
      .single()

  if (
    insertError ||
    !inserted
  ) {
    const message =
      insertError?.message ||
      "Unable to reserve ROOM 7 document."

    if (
      message.includes(
        "maximum of 10 active event documents",
      )
    ) {
      throw new HttpError(
        409,
        "ROOM 7 already has 10 active event documents.",
      )
    }

    throw insertError ||
      new Error(
        message,
      )
  }

  const {
    data:
      signed,

    error:
      signError,
  } =
    await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(
        storagePath,
      )

  if (
    signError ||
    !signed?.token
  ) {
    await admin
      .from(
        "room7_event_documents",
      )
      .delete()
      .eq(
        "id",
        documentId,
      )
      .eq(
        "room_id",
        roomId,
      )

    throw signError ||
      new Error(
        "Unable to prepare secure document upload.",
      )
  }

  return {
    document: {
      id:
        inserted.id,

      room_id:
        inserted.room_id,

      title:
        input.title,

      description:
        input.description,

      category:
        input.category,

      original_file_name:
        input.originalFileName,

      mime_type:
        input.mimeType,

      file_size_bytes:
        input.fileSize,

      sort_order:
        input.sortOrder,

      status:
        "draft",

      available_before:
        input.availableBefore,

      available_during:
        input.availableDuring,

      available_after:
        input.availableAfter,

      allow_download:
        input.allowDownload,
    },

    upload: {
      path:
        signed.path ||
        storagePath,

      token:
        signed.token,
    },
  }
}

async function findStoredObject(
  admin: ReturnType<
    typeof createClient
  >,
  storagePath: string,
) {
  const segments =
    storagePath.split("/")

  const fileName =
    segments.pop()

  const folder =
    segments.join("/")

  if (
    !fileName ||
    !folder
  ) {
    throw new Error(
      "Invalid ROOM 7 storage path.",
    )
  }

  const {
    data,
    error,
  } =
    await admin.storage
      .from(BUCKET)
      .list(
        folder,
        {
          limit: 20,

          search:
            fileName,
        },
      )

  if (error) {
    throw error
  }

  return (
    data || []
  ).find(
    object =>
      object.name ===
      fileName,
  ) || null
}

async function finalizeUpload(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  body: JsonObject,
) {
  const documentId =
    cleanText(
      body.document_id,
      60,
    )

  if (
    !isUuid(
      documentId,
    )
  ) {
    throw new HttpError(
      400,
      "A valid document ID is required.",
    )
  }

  const {
    data:
      document,

    error:
      documentError,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .select(
        [
          "id",
          "room_id",
          "storage_path",
          "status",
          "mime_type",
          "file_size_bytes",
        ].join(","),
      )
      .eq(
        "id",
        documentId,
      )
      .eq(
        "room_id",
        roomId,
      )
      .maybeSingle()

  if (
    documentError
  ) {
    throw documentError
  }

  if (!document) {
    throw new HttpError(
      404,
      "ROOM 7 document reservation not found.",
    )
  }

  if (
    document.status ===
      "archived"
  ) {
    throw new HttpError(
      409,
      "Archived ROOM 7 documents cannot be finalized.",
    )
  }

  const object =
    await findStoredObject(
      admin,
      document.storage_path,
    )

  if (!object) {
    throw new HttpError(
      409,
      "The document file has not finished uploading.",
    )
  }

  const metadata =
    (
      object as
        Record<string, any>
    ).metadata ||
    {}

  const actualSize =
    Number(
      metadata.size ||
      metadata.contentLength ||
      0,
    )

  const actualMimeType =
    cleanText(
      metadata.mimetype ||
      metadata.contentType ||
      metadata.content_type,
      120,
    )
      .toLowerCase()

  if (
    !Number.isFinite(
      actualSize,
    ) ||
    actualSize < 1
  ) {
    throw new HttpError(
      409,
      "Uploaded ROOM 7 document is empty or has invalid metadata.",
    )
  }

  if (
    actualMimeType &&
    actualMimeType !==
      document.mime_type
  ) {
    throw new HttpError(
      415,
      "Uploaded document type does not match the reserved ROOM 7 document type.",
    )
  }

  if (
    actualSize >
      MAX_FILE_BYTES
  ) {
    throw new HttpError(
      400,
      "Uploaded ROOM 7 document exceeds 25 MB.",
    )
  }

  const requestedStatus =
    cleanText(
      body.status,
      20,
    )
      .toLowerCase() ||
    "published"

  if (
    requestedStatus !==
      "draft" &&
    requestedStatus !==
      "published"
  ) {
    throw new HttpError(
      400,
      "Document can only be finalized as draft or published.",
    )
  }

  let sha256HexValue:
    string | null = null

  const requestedHash =
    cleanText(
      body.sha256_hex,
      64,
    )
      .toLowerCase()

  if (requestedHash) {
    if (
      !/^[0-9a-f]{64}$/
        .test(
          requestedHash,
        )
    ) {
      throw new HttpError(
        400,
        "Invalid document SHA-256 value.",
      )
    }

    sha256HexValue =
      requestedHash
  }

  const update:
    Record<string, unknown> = {
      status:
        requestedStatus,
  }

  if (
    sha256HexValue
  ) {
    update.sha256_hex =
      sha256HexValue
  }

  if (
    Number.isFinite(
      actualSize,
    ) &&
    actualSize > 0
  ) {
    update.file_size_bytes =
      actualSize
  }

  const {
    data:
      updated,

    error:
      updateError,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .update(update)
      .eq(
        "id",
        documentId,
      )
      .eq(
        "room_id",
        roomId,
      )
      .select(
        [
          "id",
          "room_id",
          "title",
          "description",
          "category",
          "original_file_name",
          "mime_type",
          "file_size_bytes",
          "sha256_hex",
          "sort_order",
          "status",
          "available_before",
          "available_during",
          "available_after",
          "allow_download",
          "created_at",
          "updated_at",
        ].join(","),
      )
      .single()

  if (
    updateError ||
    !updated
  ) {
    throw updateError ||
      new Error(
        "Unable to finalize ROOM 7 document.",
      )
  }

  return updated
}

async function updateDocument(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  body: JsonObject,
) {
  const documentId =
    cleanText(
      body.document_id,
      60,
    )

  if (
    !isUuid(
      documentId,
    )
  ) {
    throw new HttpError(
      400,
      "A valid document ID is required.",
    )
  }

  const update:
    Record<string, unknown> = {}

  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "title",
    )
  ) {
    const title =
      cleanText(
        body.title,
        180,
      )

    if (!title) {
      throw new HttpError(
        400,
        "Document title cannot be empty.",
      )
    }

    update.title =
      title
  }

  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "description",
    )
  ) {
    update.description =
      cleanNullableText(
        body.description,
        2000,
      )
  }

  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "category",
    )
  ) {
    const category =
      cleanText(
        body.category,
        40,
      )
        .toLowerCase()

    if (
      !documentCategories.has(
        category,
      )
    ) {
      throw new HttpError(
        400,
        "Invalid document category.",
      )
    }

    update.category =
      category
  }

  for (
    const field of
      [
        "available_before",
        "available_during",
        "available_after",
        "allow_download",
      ]
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        body,
        field,
      )
    ) {
      if (
        typeof body[field] !==
          "boolean"
      ) {
        throw new HttpError(
          400,
          `Invalid ${field} value.`,
        )
      }

      update[field] =
        body[field]
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "sort_order",
    )
  ) {
    const sortOrder =
      integerField(
        body.sort_order,
        -1,
      )

    if (
      sortOrder < 0 ||
      sortOrder > 999
    ) {
      throw new HttpError(
        400,
        "Invalid document sort order.",
      )
    }

    update.sort_order =
      sortOrder
  }

  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "status",
    )
  ) {
    const status =
      cleanText(
        body.status,
        20,
      )
        .toLowerCase()

    if (
      !documentStatuses.has(
        status,
      )
    ) {
      throw new HttpError(
        400,
        "Invalid ROOM 7 document status.",
      )
    }

    update.status =
      status
  }

  if (
    Object.keys(update)
      .length === 0
  ) {
    throw new HttpError(
      400,
      "No ROOM 7 document changes were provided.",
    )
  }

  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .update(update)
      .eq(
        "id",
        documentId,
      )
      .eq(
        "room_id",
        roomId,
      )
      .select(
        [
          "id",
          "room_id",
          "title",
          "description",
          "category",
          "original_file_name",
          "mime_type",
          "file_size_bytes",
          "sha256_hex",
          "sort_order",
          "status",
          "available_before",
          "available_during",
          "available_after",
          "allow_download",
          "created_at",
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
      "ROOM 7 document not found.",
    )
  }

  return data
}

function signedStoragePath(
  value: string,
) {
  let parsed: URL

  try {
    parsed =
      new URL(
        value,
        "https://room7.invalid",
      )
  } catch {
    throw new Error(
      "Storage returned an invalid signed document reference.",
    )
  }

  if (
    !parsed.pathname
      .startsWith(
        "/storage/v1/object/",
      )
  ) {
    throw new Error(
      "Storage returned an unexpected signed document path.",
    )
  }

  return (
    parsed.pathname +
    parsed.search
  )
}

async function createDocumentUrl(
  admin: ReturnType<
    typeof createClient
  >,
  document: Record<string, any>,
  download: boolean,
) {
  const storage =
    admin.storage
      .from(BUCKET)

  const result =
    download
      ? await storage
          .createSignedUrl(
            document.storage_path,
            SIGNED_PREVIEW_SECONDS,
            {
              download:
                document.original_file_name,
            },
          )
      : await storage
          .createSignedUrl(
            document.storage_path,
            SIGNED_PREVIEW_SECONDS,
          )

  if (
    result.error ||
    !result.data?.signedUrl
  ) {
    throw result.error ||
      new Error(
        "Unable to prepare document preview.",
      )
  }

  return signedStoragePath(
    result.data.signedUrl,
  )
}

async function publicDocuments(
  admin: ReturnType<
    typeof createClient
  >,
  resolved: ResolvedRoom,
) {
  const visibility =
    visibilityColumn(
      cleanText(
        resolved.external
          .event_state,
        30,
      ),
    )

  if (!visibility) {
    return []
  }

  const {
    data,
    error,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .select(
        [
          "id",
          "title",
          "description",
          "category",
          "mime_type",
          "file_size_bytes",
          "sort_order",
          "allow_download",
          "created_at",
          "updated_at",
        ].join(","),
      )
      .eq(
        "room_id",
        resolved.room.id,
      )
      .eq(
        "status",
        "published",
      )
      .eq(
        visibility,
        true,
      )
      .order(
        "sort_order",
        {
          ascending: true,
        },
      )
      .order(
        "created_at",
        {
          ascending: true,
        },
      )

  if (error) {
    throw error
  }

  return (
    data || []
  ).map(
    publicDocument,
  )
}

async function publicDocumentPreview(
  admin: ReturnType<
    typeof createClient
  >,
  resolved: ResolvedRoom,
  access: InvitationAccess,
  body: JsonObject,
) {
  const documentId =
    cleanText(
      body.document_id,
      60,
    )

  if (
    !isUuid(
      documentId,
    )
  ) {
    throw new HttpError(
      400,
      "A valid document ID is required.",
    )
  }

  const visibility =
    visibilityColumn(
      cleanText(
        resolved.external
          .event_state,
        30,
      ),
    )

  if (!visibility) {
    throw new HttpError(
      403,
      "ROOM 7 documents are not available in the current event phase.",
    )
  }

  const {
    data:
      document,

    error:
      documentError,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .select(
        [
          "id",
          "room_id",
          "title",
          "description",
          "category",
          "storage_path",
          "original_file_name",
          "mime_type",
          "file_size_bytes",
          "sort_order",
          "allow_download",
          "created_at",
          "updated_at",
        ].join(","),
      )
      .eq(
        "id",
        documentId,
      )
      .eq(
        "room_id",
        resolved.room.id,
      )
      .eq(
        "status",
        "published",
      )
      .eq(
        visibility,
        true,
      )
      .maybeSingle()

  if (
    documentError
  ) {
    throw documentError
  }

  if (!document) {
    throw new HttpError(
      404,
      "ROOM 7 document is not available.",
    )
  }

  const wantsDownload =
    body.download ===
      true

  if (
    wantsDownload &&
    document.allow_download !==
      true
  ) {
    throw new HttpError(
      403,
      "Downloading this ROOM 7 document is disabled.",
    )
  }

  const signedUrl =
    await createDocumentUrl(
      admin,
      document,
      wantsDownload,
    )

  const {
    error:
      accessError,
  } =
    await admin
      .from(
        "room7_event_document_access",
      )
      .insert({
        room_id:
          resolved.room.id,

        document_id:
          document.id,

        invitation_id:
          access.invitation.id,

        guest_participant_id:
          access.guestParticipantId,

        access_kind:
          wantsDownload
            ? "download"
            : "preview",
      })

  if (
    accessError
  ) {
    throw accessError
  }

  return {
    document:
      publicDocument(
        document,
      ),

    signed_path:
      signedUrl,

    expires_in_seconds:
      SIGNED_PREVIEW_SECONDS,

    disposition:
      wantsDownload
        ? "download"
        : "preview",
  }
}

async function deleteDocument(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  body: JsonObject,
) {
  const documentId =
    cleanText(
      body.document_id,
      60,
    )

  if (
    !isUuid(
      documentId,
    )
  ) {
    throw new HttpError(
      400,
      "A valid document ID is required.",
    )
  }

  const {
    data:
      document,

    error:
      documentError,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .select(
        "id,room_id,storage_path,title",
      )
      .eq(
        "id",
        documentId,
      )
      .eq(
        "room_id",
        roomId,
      )
      .maybeSingle()

  if (
    documentError
  ) {
    throw documentError
  }

  if (!document) {
    throw new HttpError(
      404,
      "ROOM 7 document not found.",
    )
  }

  /*
   * Remove the private object first.
   *
   * Security takes priority over bookkeeping:
   * after object deletion, an already-issued short-lived
   * preview can no longer retrieve the file.
   */
  const {
    error:
      storageError,
  } =
    await admin.storage
      .from(BUCKET)
      .remove([
        document.storage_path,
      ])

  if (
    storageError
  ) {
    throw new HttpError(
      502,
      "ROOM 7 could not securely remove the document file.",
    )
  }

  const {
    data:
      deleted,

    error:
      deleteError,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .delete()
      .eq(
        "id",
        documentId,
      )
      .eq(
        "room_id",
        roomId,
      )
      .select("id")
      .maybeSingle()

  if (
    deleteError
  ) {
    throw deleteError
  }

  if (!deleted) {
    throw new Error(
      "ROOM 7 document metadata changed during deletion.",
    )
  }

  return {
    deleted: true,
    document_id:
      documentId,
  }
}

async function adminPreview(
  admin: ReturnType<
    typeof createClient
  >,
  roomId: string,
  body: JsonObject,
) {
  const documentId =
    cleanText(
      body.document_id,
      60,
    )

  if (
    !isUuid(
      documentId,
    )
  ) {
    throw new HttpError(
      400,
      "A valid document ID is required.",
    )
  }

  const {
    data:
      document,

    error,
  } =
    await admin
      .from(
        "room7_event_documents",
      )
      .select(
        [
          "id",
          "room_id",
          "title",
          "storage_path",
          "original_file_name",
          "mime_type",
          "allow_download",
        ].join(","),
      )
      .eq(
        "id",
        documentId,
      )
      .eq(
        "room_id",
        roomId,
      )
      .maybeSingle()

  if (error) {
    throw error
  }

  if (!document) {
    throw new HttpError(
      404,
      "ROOM 7 document not found.",
    )
  }

  const download =
    body.download ===
      true

  const signedUrl =
    await createDocumentUrl(
      admin,
      document,
      download,
    )

  return {
    document: {
      id:
        document.id,

      title:
        document.title,

      mime_type:
        document.mime_type,
    },

    signed_path:
      signedUrl,

    expires_in_seconds:
      SIGNED_PREVIEW_SECONDS,

    disposition:
      download
        ? "download"
        : "preview",
  }
}

Deno.serve(
  async (
    req: Request,
  ) => {
    if (
      req.method ===
        "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers:
            corsHeaders(req),
        },
      )
    }

    if (
      req.method !==
        "POST"
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

    try {
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
              "ROOM 7 document service is not configured.",
          },
          503,
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

      const body =
        await readBody(req)

      const action =
        cleanText(
          body.action,
          40,
        )

      if (
        action ===
          "public_list"
      ) {
        const resolved =
          await resolveRoom(
            admin,
            body,
          )

        await requireInvitation(
          admin,
          resolved,
          body,
        )

        const documents =
          await publicDocuments(
            admin,
            resolved,
          )

        return json(
          req,
          {
            room: {
              title:
                resolved.room
                  .title,

              slug:
                resolved.external
                  .slug,

              event_state:
                resolved.external
                  .event_state,
            },

            documents,
          },
        )
      }

      if (
        action ===
          "public_preview"
      ) {
        const resolved =
          await resolveRoom(
            admin,
            body,
          )

        const access =
          await requireInvitation(
            admin,
            resolved,
            body,
          )

        const result =
          await publicDocumentPreview(
            admin,
            resolved,
            access,
            body,
          )

        return json(
          req,
          result,
        )
      }

      const profile =
        await requireEmployee(
          admin,
          req,
        )

      const roomId =
        cleanText(
          body.room_id,
          60,
        )

      await requireRoomAuthority(
        admin,
        profile,
        roomId,
      )

      if (
        action ===
          "admin_list"
      ) {
        const documents =
          await adminList(
            admin,
            roomId,
          )

        return json(
          req,
          {
            documents,
          },
        )
      }

      if (
        action ===
          "prepare_upload"
      ) {
        const result =
          await prepareUpload(
            admin,
            profile,
            roomId,
            body,
          )

        return json(
          req,
          result,
          201,
        )
      }

      if (
        action ===
          "finalize_upload"
      ) {
        const document =
          await finalizeUpload(
            admin,
            roomId,
            body,
          )

        return json(
          req,
          {
            document,
          },
        )
      }

      if (
        action ===
          "update_document"
      ) {
        const document =
          await updateDocument(
            admin,
            roomId,
            body,
          )

        return json(
          req,
          {
            document,
          },
        )
      }

      if (
        action ===
          "delete_document"
      ) {
        const result =
          await deleteDocument(
            admin,
            roomId,
            body,
          )

        return json(
          req,
          result,
        )
      }

      if (
        action ===
          "admin_preview"
      ) {
        const result =
          await adminPreview(
            admin,
            roomId,
            body,
          )

        return json(
          req,
          result,
        )
      }

      return json(
        req,
        {
          error:
            "Unsupported ROOM 7 document action.",
        },
        400,
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
        "ROOM 7 document service failed:",
        error,
      )

      return json(
        req,
        {
          error:
            "Unable to process ROOM 7 documents.",
        },
        500,
      )
    }
  },
)
