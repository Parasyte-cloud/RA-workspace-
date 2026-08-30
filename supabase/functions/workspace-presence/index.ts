import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const allowedOrigin = "https://intranet.ridearrivo.com"
const CONSENT_VERSION = "2026-08-admin-location-v1"

function cors(req: Request) {
  const origin = req.headers.get("origin") || ""
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
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
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  })
}

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max)
}

function nullableText(value: unknown, max = 500) {
  const valueText = text(value, max)
  return valueText || null
}

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function coarse(value: number) {
  return Math.round(value * 100) / 100
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1]
    if (!payload) return {}
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return {}
  }
}


async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("")
}

function requestIp(req: Request) {
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for")?.split(",")[0],
  ]

  for (const candidate of candidates) {
    const value = text(candidate, 128)
    if (value) return value
  }

  return null
}

type ReverseGeocode = {
  address_full: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string | null
  country_code: string | null
  geocoding_provider: string | null
  geocoding_attribution: string | null
}

async function reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocode> {
  const apiKey = Deno.env.get("GEOAPIFY_API_KEY")

  if (!apiKey) {
    return {
      address_full: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      postcode: null,
      country: null,
      country_code: null,
      geocoding_provider: null,
      geocoding_attribution: null,
    }
  }

  const query = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: "json",
    limit: "1",
    lang: "en",
    apiKey,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(
      `https://api.geoapify.com/v1/geocode/reverse?${query.toString()}`,
      {
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      console.warn("workspace-presence reverse geocode", response.status)
      return {
        address_full: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postcode: null,
        country: null,
        country_code: null,
        geocoding_provider: "geoapify",
        geocoding_attribution: "Powered by Geoapify; © OpenStreetMap contributors",
      }
    }

    const payload = await response.json().catch(() => ({}))
    const row = Array.isArray(payload?.results) ? payload.results[0] : null

    if (!row) {
      return {
        address_full: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postcode: null,
        country: null,
        country_code: null,
        geocoding_provider: "geoapify",
        geocoding_attribution: "Powered by Geoapify; © OpenStreetMap contributors",
      }
    }

    return {
      address_full: nullableText(row.formatted, 1000),
      address_line1: nullableText(row.address_line1, 500),
      address_line2: nullableText(row.address_line2, 700),
      city: nullableText(row.city || row.locality, 200),
      state: nullableText(row.state, 200),
      postcode: nullableText(row.postcode, 80),
      country: nullableText(row.country, 200),
      country_code: nullableText(row.country_code, 16),
      geocoding_provider: "geoapify",
      geocoding_attribution: "Powered by Geoapify; © OpenStreetMap contributors",
    }
  } catch (error) {
    console.warn("workspace-presence reverse geocode failed", error)
    return {
      address_full: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      postcode: null,
      country: null,
      country_code: null,
      geocoding_provider: "geoapify",
      geocoding_attribution: "Powered by Geoapify; © OpenStreetMap contributors",
    }
  } finally {
    clearTimeout(timeout)
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors(req) })
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405)
  }

  const authorization = req.headers.get("Authorization") || ""
  if (!authorization) {
    return json(req, { error: "Missing RideArrivo session." }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Presence service is not configured." }, 500)
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
    .select("id,active")
    .eq("id", employeeId)
    .maybeSingle()

  if (profileError || !profile || profile.active !== true) {
    return json(req, { error: "Active employee access is required." }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const browserDeviceId = text(body?.browser_device_id, 160)

  if (!browserDeviceId) {
    return json(req, { error: "Browser device ID is required." }, 400)
  }

  const locationConsent = body?.location_consent === true
  const latitudeRaw = finiteNumber(body?.latitude)
  const longitudeRaw = finiteNumber(body?.longitude)
  const accuracyRaw = finiteNumber(body?.location_accuracy_m)

  const hasValidLocation = Boolean(
    locationConsent &&
    latitudeRaw !== null && latitudeRaw >= -90 && latitudeRaw <= 90 &&
    longitudeRaw !== null && longitudeRaw >= -180 && longitudeRaw <= 180
  )

  const latitude = hasValidLocation ? latitudeRaw as number : null
  const longitude = hasValidLocation ? longitudeRaw as number : null
  const accuracy = hasValidLocation && accuracyRaw !== null
    ? Math.max(0, Math.min(Math.round(accuracyRaw), 100000))
    : null

  const jwt = decodeJwtPayload(token)
  const rawAuthSessionId = text(jwt.session_id, 160)
  const fallbackSessionPart = text(jwt.iat || jwt.exp || "session", 40)
  const sessionMaterial = rawAuthSessionId || `${browserDeviceId}:${fallbackSessionPart}`
  const authSessionHash = await sha256Hex(sessionMaterial)
  const sessionKey = `sha256:${authSessionHash}`
  const sourceIp = requestIp(req)
  const now = new Date().toISOString()

  const browserName = nullableText(body?.browser_name, 100)
  const operatingSystem = nullableText(body?.operating_system, 100)
  const platform = nullableText(body?.platform, 120)
  const userAgent = nullableText(body?.user_agent, 1000)
  const timezone = nullableText(body?.timezone, 120)

  // Keep the Support-visible session record deliberately coarse.
  const { error: sessionError } = await admin
    .from("employee_device_sessions")
    .upsert({
      employee_id: employeeId,
      browser_device_id: browserDeviceId,
      browser_name: browserName,
      operating_system: operatingSystem,
      platform,
      user_agent: userAgent,
      screen_width: finiteNumber(body?.screen_width),
      screen_height: finiteNumber(body?.screen_height),
      hardware_concurrency: finiteNumber(body?.hardware_concurrency),
      device_memory_gb: finiteNumber(body?.device_memory_gb),
      timezone,
      latitude: latitude === null ? null : coarse(latitude),
      longitude: longitude === null ? null : coarse(longitude),
      location_accuracy_m: accuracy,
      location_shared_at: hasValidLocation ? now : null,
      last_seen_at: now,
    }, { onConflict: "employee_id,browser_device_id" })

  if (sessionError) {
    console.error("workspace-presence session upsert", sessionError)
    return json(req, { error: "Unable to update device presence." }, 500)
  }

  const { data: existingLocation } = await admin
    .from("employee_sign_in_locations")
    .select("id,address_full,latitude,longitude,location_consent,location_sharing_active")
    .eq("employee_id", employeeId)
    .eq("session_key", sessionKey)
    .maybeSingle()

  let geocode: ReverseGeocode = {
    address_full: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postcode: null,
    country: null,
    country_code: null,
    geocoding_provider: null,
    geocoding_attribution: null,
  }

  // Capture the sign-in location once for the auth session. This is intentionally
  // not a movement tracker. Later heartbeats update last_seen_at but do not rewrite
  // a previously captured sign-in address.
  const shouldCaptureLocation = hasValidLocation && !existingLocation?.location_consent
  if (shouldCaptureLocation && latitude !== null && longitude !== null) {
    geocode = await reverseGeocode(latitude, longitude)
  }

  const locationPayload: Record<string, unknown> = {
    employee_id: employeeId,
    session_key: sessionKey,
    auth_session_hash: authSessionHash,
    browser_device_id: browserDeviceId,
    browser_name: browserName,
    operating_system: operatingSystem,
    platform,
    user_agent: userAgent,
    source_ip: sourceIp,
    timezone,
    location_sharing_active: hasValidLocation,
    last_seen_at: now,
  }

  if (shouldCaptureLocation && latitude !== null && longitude !== null) {
    Object.assign(locationPayload, {
      latitude,
      longitude,
      location_accuracy_m: accuracy,
      location_consent: true,
      consent_version: CONSENT_VERSION,
      location_captured_at: now,
      ...geocode,
    })
  }

  const { error: locationError } = await admin
    .from("employee_sign_in_locations")
    .upsert(locationPayload, { onConflict: "employee_id,session_key" })

  if (locationError) {
    console.error("workspace-presence location upsert", locationError)
    return json(req, { error: "Unable to update sign-in telemetry." }, 500)
  }

  return json(req, {
    ok: true,
    consent_version: CONSENT_VERSION,
    location_captured: shouldCaptureLocation,
    address: shouldCaptureLocation ? geocode.address_full : existingLocation?.address_full || null,
    geocoding_configured: Boolean(Deno.env.get("GEOAPIFY_API_KEY")),
  })
})
