export type RoomAction =
  | "get"
  | "configure"
  | "set_state"
  | "list_invitations"
  | "create_invitation"
  | "revoke_invitation"

export type EventState =
  | "draft"
  | "pre_event"
  | "doors_open"
  | "live"
  | "intermission"
  | "ended"
  | "replay"

export type EmployeeProfile = {
  id: string
  role: string
  active: boolean
}

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const productionOrigin =
  "https://intranet.ridearrivo.com"

export const publicRoom7Origin =
  "https://room7.ridearrivo.com"

export const roomKinds = new Set([
  "standard",
  "executive",
  "investor",
  "webinar",
  "launch",
  "town_hall",
])

export const accessModes = new Set([
  "invitation",
  "passcode",
  "open",
])

export const guestRoles = new Set([
  "attendee",
  "viewer",
])

export const eventStates = new Set<EventState>([
  "draft",
  "pre_event",
  "doors_open",
  "live",
  "intermission",
  "ended",
  "replay",
])

export const normalTransitions:
  Record<EventState, EventState[]> = {
    draft: [
      "pre_event",
    ],
    pre_event: [
      "doors_open",
    ],
    doors_open: [
      "pre_event",
      "live",
    ],
    live: [
      "intermission",
      "ended",
    ],
    intermission: [
      "live",
      "ended",
    ],
    ended: [
      "replay",
    ],
    replay: [
      "ended",
    ],
  }

export function allowedOrigin(req: Request) {
  const origin =
    req.headers.get("Origin") || ""

  if (
    origin === productionOrigin ||
    /^https:\/\/[a-z0-9-]+\.ra-workspace\.pages\.dev$/i.test(
      origin,
    ) ||
    /^http:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(
      origin,
    )
  ) {
    return origin
  }

  return productionOrigin
}

export function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin":
      allowedOrigin(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
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
        ...cors(req),
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store",
        "Referrer-Policy":
          "no-referrer",
        "X-Content-Type-Options":
          "nosniff",
      },
    },
  )
}

export function cleanText(
  value: unknown,
  maxLength: number,
) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : ""
}

export function normalizeCode(value: unknown) {
  return cleanText(value, 40)
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 8)
}

export function uuid(value: unknown) {
  const candidate =
    cleanText(value, 64)

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate,
  )
    ? candidate
    : ""
}

export function normalizeSlug(value: unknown) {
  const candidate =
    cleanText(value, 100)
      .toLowerCase()

  if (
    candidate.length < 3 ||
    candidate.length > 80
  ) {
    return ""
  }

  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
    candidate,
  )
    ? candidate
    : ""
}

export function hasOwn(
  value: unknown,
  key: string,
) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(
      value,
      key,
    ),
  )
}

export function parseDateField(
  body: any,
  key: string,
  currentValue: string | null,
) {
  if (!hasOwn(body, key)) {
    return currentValue
  }

  const raw = body?.[key]

  if (
    raw === null ||
    raw === ""
  ) {
    return null
  }

  if (typeof raw !== "string") {
    throw new HttpError(
      400,
      `${key} must be an ISO date/time or null.`,
    )
  }

  const parsed = new Date(raw)

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    throw new HttpError(
      400,
      `${key} is not a valid date/time.`,
    )
  }

  return parsed.toISOString()
}

export function validTimezone(
  timezone: string,
) {
  try {
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: timezone,
      },
    ).format()

    return true
  } catch {
    return false
  }
}

export async function hmacSha256Hex(
  value: string,
  secret: string,
) {
  const encoder =
    new TextEncoder()

  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"],
    )

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(value),
    )

  return Array.from(
    new Uint8Array(signature),
  )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0"),
    )
    .join("")
}

export function cleanEmail(value: unknown) {
  const email =
    cleanText(value, 320)
      .toLowerCase()

  if (!email) {
    return ""
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email,
  )
    ? email
    : ""
}

export async function sha256Hex(
  value: string,
) {
  const bytes =
    new TextEncoder()
      .encode(value)

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      bytes,
    )

  return Array.from(
    new Uint8Array(digest),
  )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0"),
    )
    .join("")
}

export function randomInviteToken() {
  const bytes =
    new Uint8Array(32)

  crypto.getRandomValues(bytes)

  let binary = ""

  for (
    const byte of bytes
  ) {
    binary +=
      String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}
