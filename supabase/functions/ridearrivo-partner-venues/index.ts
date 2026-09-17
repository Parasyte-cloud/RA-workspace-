import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ── RideArrivo Partner Venue Publishing ──────────────────────────────────
//
// Lets the Partnerships workspace set (or fix) the exact display name for
// a partner's reserved-pickup venue -- shown in the RideArrivo apps as
// "<venue name> x RideArrivo" -- without anyone needing the separate
// Arrivo admin dashboard. This mirrors ridearrivo-support's pattern
// exactly: log in to the Arrivo backend as a dedicated service account,
// then call the same already-audited admin API the Arrivo dashboard uses
// (POST/PATCH /api/admin/partner-venues), never a bespoke write path.
//
// The one rule this function exists to enforce, server-side, not just in
// the UI: a partner's venue can only be published or updated once that
// partner has a SIGNED or ACTIVE agreement on file. The client is never
// trusted to assert that on its own -- this function re-checks
// partner_agreements itself, with the service-role client, every time.

const allowedOrigins = new Set([
  "https://intranet.ridearrivo.com",
])

// Only Partnerships and Admin may publish or update a venue -- this
// mirrors this database's own RLS write policy on the partner_* tables
// exactly ("partnership write": partnerships, admin), so this function
// never grants more than the tables themselves already would.
const allowedRoles = new Set([
  "partnerships",
  "admin",
])

const allowedCategories = new Set([
  "club",
  "restaurant",
  "other",
])

let cachedBackendToken = ""
let cachedBackendTokenUntil = 0
let backendLoginPromise: Promise<string> | null = null

const UPSTREAM_TIMEOUT_MS = 15_000

function cors(req: Request) {
  const origin = req.headers.get("origin") || ""

  return {
    "Access-Control-Allow-Origin":
      allowedOrigins.has(origin) ? origin : "https://intranet.ridearrivo.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  }
}

function json(req: Request, body: unknown, status = 200, requestId?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(requestId ? { "X-Request-ID": requestId } : {}),
    },
  })
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`RideArrivo backend timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function invalidateBackendToken() {
  cachedBackendToken = ""
  cachedBackendTokenUntil = 0
}

async function loginToBackend(requestId: string) {
  const backendUrl = Deno.env.get("RIDEARRIVO_BACKEND_URL")?.replace(/\/$/, "")
  const email = Deno.env.get("RIDEARRIVO_PARTNERSHIPS_EMAIL")
  const password = Deno.env.get("RIDEARRIVO_PARTNERSHIPS_PASSWORD")

  if (!backendUrl || !email || !password) {
    console.error(requestId, "RideArrivo Partner Venues integration secrets missing")
    throw new Error("RideArrivo Partner Venues integration is not configured.")
  }

  const response = await fetchWithTimeout(`${backendUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ email, password }),
  })

  const text = await response.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }

  if (!response.ok) {
    console.error(requestId, "RideArrivo backend login failed", response.status)
    throw new Error(`RideArrivo backend authentication failed (${response.status}).`)
  }

  const token = data.token || data.accessToken || data.access_token
  if (typeof token !== "string" || !token) {
    console.error(requestId, "RideArrivo login response contained no access token")
    throw new Error("RideArrivo backend returned no access token.")
  }

  cachedBackendToken = token
  cachedBackendTokenUntil = Date.now() + 5 * 60 * 1000
  return token
}

async function getBackendToken(requestId: string) {
  if (cachedBackendToken && Date.now() < cachedBackendTokenUntil) {
    return cachedBackendToken
  }

  // Multiple publish actions could land at once. They must share one
  // service-account login rather than stampeding the upstream auth
  // endpoint -- same reasoning as ridearrivo-support.
  if (!backendLoginPromise) {
    backendLoginPromise = loginToBackend(requestId).finally(() => {
      backendLoginPromise = null
    })
  }

  return await backendLoginPromise
}

function invalidCoordinate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null
  const num = Number(value)
  if (!Number.isFinite(num)) return `${label} must be a number.`
  if (label === "lat" && (num < -90 || num > 90)) return "lat must be between -90 and 90."
  if (label === "lng" && (num < -180 || num > 180)) return "lng must be between -180 and 180."
  return null
}

serve(async (req) => {
  const requestId = crypto.randomUUID()

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors(req) })
  }

  if (req.method !== "POST") {
    return json(req, { error: "Partner Venue Publishing only accepts POST requests." }, 405, requestId)
  }

  try {
    // ── 1. Authenticate the RideArrivo Workspace employee ──
    const authHeader = req.headers.get("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json(req, { error: "Workspace authentication required." }, 401, requestId)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Workspace service configuration is missing.")
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const jwt = authHeader.substring("Bearer ".length)
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !user) {
      console.warn(requestId, "Workspace JWT rejected", userError?.message)
      return json(req, { error: "Your RideArrivo Workspace session is not valid." }, 401, requestId)
    }

    // ── 2. Resolve active employee profile + role ──
    const profileResult = await admin
      .from("employee_profiles")
      .select("id,email,role,active")
      .eq("id", user.id)
      .maybeSingle()

    const profile = profileResult.data
    if (!profile) {
      return json(req, { error: "Unable to verify your RideArrivo Workspace profile." }, 403, requestId)
    }
    if (profile.active !== true) {
      return json(req, { error: "Your RideArrivo Workspace account is not active." }, 403, requestId)
    }

    const role = String(profile.role || "").trim().toLowerCase()
    if (!allowedRoles.has(role)) {
      console.warn(requestId, "Partner venue publish rejected", { userId: user.id, role })
      return json(
        req,
        { error: "Publishing a RideArrivo venue requires the Partnerships or Admin role." },
        403,
        requestId,
      )
    }

    // ── 3. Parse and validate the request ──
    let body: {
      action?: string
      partnerId?: string
      partnerName?: string
      arrivoVenueId?: number
      venue?: {
        name?: string
        category?: string
        address?: string
        lat?: string | number
        lng?: string | number
        perkDescription?: string
      }
    } = {}

    try {
      body = await req.json()
    } catch {
      body = {}
    }

    if (body.action !== "publishVenue") {
      return json(req, { error: "Unsupported Partner Venue Publishing action." }, 400, requestId)
    }

    const partnerId = String(body.partnerId || "").trim()
    const partnerName = String(body.partnerName || "").trim()
    const venue = body.venue || {}
    const venueName = String(venue.name || "").trim()
    const venueAddress = String(venue.address || "").trim()
    const venueCategory = String(venue.category || "other").trim()

    if (!partnerId || !partnerName) {
      return json(req, { error: "partnerId and partnerName are required." }, 400, requestId)
    }
    if (!venueName || !venueAddress) {
      return json(req, { error: "The venue needs a name and an address." }, 400, requestId)
    }
    if (!allowedCategories.has(venueCategory)) {
      return json(req, { error: `category must be one of: ${Array.from(allowedCategories).join(", ")}` }, 400, requestId)
    }
    const latError = invalidCoordinate(venue.lat, "lat")
    if (latError) return json(req, { error: latError }, 400, requestId)
    const lngError = invalidCoordinate(venue.lng, "lng")
    if (lngError) return json(req, { error: lngError }, 400, requestId)

    // ── 4. Confirm the partner record is real and the name matches ──
    // (never trust a caller-supplied partnerName against a partnerId it
    // doesn't actually belong to)
    const partnerResult = await admin
      .from("partners")
      .select("id,name")
      .eq("id", partnerId)
      .maybeSingle()

    if (!partnerResult.data || String(partnerResult.data.name || "").trim().toLowerCase() !== partnerName.toLowerCase()) {
      return json(req, { error: "That partner record could not be verified." }, 404, requestId)
    }

    // ── 5. The actual gate: a signed/active agreement on file ──
    // This is enforced here, authoritatively, regardless of what the UI
    // already checked -- the whole point of asking for this feature was
    // that a venue can only go live once the partner has agreed to terms.
    const agreementResult = await admin
      .from("partner_agreements")
      .select("id,status")
      .ilike("partner_name", partnerName)
      .in("status", ["signed", "active"])
      .limit(1)

    if (agreementResult.error) {
      console.error(requestId, "Agreement lookup failed", agreementResult.error.message)
      throw new Error("Could not verify this partner's agreement status.")
    }

    if (!agreementResult.data || agreementResult.data.length === 0) {
      return json(
        req,
        { error: `${partnerName} doesn't have a signed agreement on file yet -- publish once Legal/Partnerships marks one as signed or active.` },
        403,
        requestId,
      )
    }

    // ── 6. Publish (create or update) on the Arrivo side ──
    const backendUrl = Deno.env.get("RIDEARRIVO_BACKEND_URL")?.replace(/\/$/, "")
    if (!backendUrl) {
      throw new Error("RideArrivo backend URL is not configured.")
    }

    const venuePayload = {
      name: venueName,
      category: venueCategory,
      address: venueAddress,
      lat: venue.lat === "" || venue.lat === undefined ? null : venue.lat,
      lng: venue.lng === "" || venue.lng === undefined ? null : venue.lng,
      perkDescription: venue.perkDescription ? String(venue.perkDescription).trim() : null,
    }

    const arrivoVenueId = body.arrivoVenueId ? Number(body.arrivoVenueId) : null
    const upstreamPath = arrivoVenueId
      ? `/api/admin/partner-venues/${arrivoVenueId}`
      : `/api/admin/partner-venues`
    const upstreamMethod = arrivoVenueId ? "PATCH" : "POST"

    const performMutation = (token: string) =>
      fetchWithTimeout(`${backendUrl}${upstreamPath}`, {
        method: upstreamMethod,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(venuePayload),
      })

    let backendToken = await getBackendToken(requestId)
    let response = await performMutation(backendToken)

    if (response.status === 401) {
      invalidateBackendToken()
      backendToken = await getBackendToken(requestId)
      response = await performMutation(backendToken)
    }

    const responseText = await response.text()
    let responseBody: Record<string, unknown> | null = null
    try {
      responseBody = responseText ? JSON.parse(responseText) : null
    } catch {
      console.error(requestId, "RideArrivo partner-venues endpoint returned non-JSON content", {
        status: response.status,
        path: upstreamPath,
      })
    }

    if (!response.ok) {
      return json(
        req,
        { error: (responseBody as { error?: string } | null)?.error || `RideArrivo backend rejected this venue (${response.status}).` },
        response.status >= 400 && response.status < 500 ? response.status : 502,
        requestId,
      )
    }

    const venueRow = (responseBody as { venue?: Record<string, unknown> } | null)?.venue
    if (!venueRow || typeof venueRow.id !== "number") {
      throw new Error("RideArrivo backend accepted the venue but returned no venue id.")
    }

    // ── 7. Record the link back on the partner record ──
    const updateResult = await admin
      .from("partners")
      .update({
        arrivo_venue_id: venueRow.id,
        arrivo_venue_synced_at: new Date().toISOString(),
      })
      .eq("id", partnerId)

    if (updateResult.error) {
      // The Arrivo side is already correct at this point -- this is a
      // bookkeeping failure, not a publish failure, so it's logged, not
      // thrown, and the client still gets back a successful venue.
      console.error(requestId, "Failed to record arrivo_venue_id on partner", updateResult.error.message)
    }

    return json(req, { venue: venueRow }, 200, requestId)
  } catch (error) {
    console.error(requestId, "Partner Venue Publishing failed", error instanceof Error ? error.message : error)
    return json(
      req,
      { error: error instanceof Error ? error.message : "Could not publish this venue to RideArrivo." },
      500,
      requestId,
    )
  }
})
