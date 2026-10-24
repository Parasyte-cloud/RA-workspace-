export type JsonObject =
  Record<string, unknown>

export type EmployeeProfile = {
  id: string
  role: string
  active: boolean
}

export type ResolvedRoom = {
  room: Record<string, any>
  external: Record<string, any>
}

export type InvitationAccess = {
  invitation: Record<string, any>
  guestParticipantId: string | null
}

export class HttpError extends Error {
  status: number

  constructor(
    status: number,
    message: string,
  ) {
    super(message)
    this.status = status
  }
}

export const BUCKET =
  "room7-event-documents"

export const MAX_BODY_BYTES =
  16 * 1024

export const MAX_FILE_BYTES =
  25 * 1024 * 1024

export const SIGNED_PREVIEW_SECONDS =
  5 * 60

export const ROOM7_PUBLIC_ORIGIN =
  "https://room7.ridearrivo.com"

export const INTRANET_ORIGIN =
  "https://intranet.ridearrivo.com"

export const documentCategories =
  new Set([
    "general",
    "programme",
    "company",
    "investor",
    "brochure",
    "legal",
  ])

export const documentStatuses =
  new Set([
    "draft",
    "published",
    "archived",
  ])

// Keep equal to src/lib/room7DocumentTypes.ts, the room7_event_documents_mime_check
// constraint and the storage bucket (scripts/room7-documents-audit.test.mjs
// compares them). Legacy .doc/.xls/.ppt and macro-enabled formats are left out
// on purpose.
export const allowedMimeTypes =
  new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
  ])

// Only these can be shown inside the ROOM 7 reader. Every other allowed type is
// download only, so it is always published with downloading on.
export const previewableMimeTypes =
  new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ])

export function isPreviewableMime(
  mime: unknown,
) {
  return typeof mime === "string" &&
    previewableMimeTypes.has(
      mime.toLowerCase(),
    )
}

export const privilegedRoles =
  new Set([
    "admin",
    "administrator",
    "manager",
  ])

export const extensionByMime:
  Record<string, string> = {
    "application/pdf":
      "pdf",

    "image/jpeg":
      "jpg",

    "image/png":
      "png",

    "image/webp":
      "webp",

    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",

    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "xlsx",

    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "pptx",

    "text/plain":
      "txt",

    "text/csv":
      "csv",
  }

export function cleanText(
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

export function cleanNullableText(
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

export function isUuid(
  value: string,
) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)
}

export function localOriginAllowed(
  origin: string,
) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i
    .test(origin)
}

export function responseOrigin(
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

export function corsHeaders(
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

export function json(
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

export async function readBody(
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

export async function sha256Hex(
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

export function booleanField(
  value: unknown,
  fallback: boolean,
) {
  return typeof value ===
    "boolean"
      ? value
      : fallback
}

export function integerField(
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

export function publicDocument(
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

export function visibilityColumn(
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
