import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/*
 * Polls the Render RideArrivo backend for rides/bookings and notifies
 * Support (in-app + email, via public.notifications) about any ride
 * this function has not already recorded in the
 * public.ridearrivo_ride_notifications ledger.
 *
 * There is no webhook from the Render backend into Supabase, so this
 * is a poll + dedupe design rather than event-driven. It reuses the
 * exact same backend service-account auth already configured for the
 * ridearrivo-support function (RIDEARRIVO_BACKEND_URL /
 * RIDEARRIVO_SUPPORT_EMAIL / RIDEARRIVO_SUPPORT_PASSWORD) and the
 * same CRON_DISPATCH_SECRET already used to authorize the
 * notifications-email-dispatch cron call, so no new secrets are
 * required to run this.
 *
 * Two modes, both GET:
 *   - normal run (no query param): checks the most recent pages of
 *     rides and notifies Support about any not already in the ledger.
 *     This is what pg_cron calls on a schedule.
 *   - ?seed=1: pages through ALL rides currently on the backend and
 *     records them in the ledger WITHOUT notifying anyone. Run this
 *     once, by hand, before turning the cron job on, so Support isn't
 *     flooded with a backlog of every historical ride the first time
 *     this runs.
 */

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

let cachedBackendToken = ""
let cachedBackendTokenUntil = 0

async function loginToBackend() {
  const backendUrl = Deno.env.get("RIDEARRIVO_BACKEND_URL")?.replace(/\/$/, "")
  const email = Deno.env.get("RIDEARRIVO_SUPPORT_EMAIL")
  const password = Deno.env.get("RIDEARRIVO_SUPPORT_PASSWORD")

  if (!backendUrl || !email || !password) {
    throw new Error("RideArrivo backend integration secrets are missing.")
  }

  const response = await fetch(`${backendUrl}/api/auth/login`, {
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
    throw new Error(`Render backend login failed (${response.status}).`)
  }

  const token = data.token || data.accessToken || data.access_token
  if (typeof token !== "string" || !token) {
    throw new Error("Render backend login returned no access token.")
  }

  cachedBackendToken = token
  cachedBackendTokenUntil = Date.now() + 5 * 60 * 1000
  return token
}

async function getBackendToken() {
  if (cachedBackendToken && Date.now() < cachedBackendTokenUntil) {
    return cachedBackendToken
  }
  return await loginToBackend()
}

async function fetchRidesPage(page: number, limit: number) {
  const backendUrl = Deno.env.get("RIDEARRIVO_BACKEND_URL")?.replace(/\/$/, "")
  if (!backendUrl) throw new Error("RideArrivo backend URL is not configured.")

  const url = new URL(`${backendUrl}/api/admin/rides`)
  url.searchParams.set("page", String(page))
  url.searchParams.set("limit", String(limit))

  const doFetch = async (token: string) =>
    fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })

  let response = await doFetch(await getBackendToken())
  if (response.status === 401) {
    cachedBackendToken = ""
    response = await doFetch(await getBackendToken())
  }

  if (!response.ok) {
    throw new Error(`Render backend rides fetch failed (${response.status}).`)
  }

  const body = await response.json().catch(() => null)
  return asArray(body)
}

// Mirrors the frontend's own defensive unwrapping (SupportOperationsPanel's
// asArray) since the exact response shape isn't documented here.
function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[]
  const v = value as Record<string, unknown> | null
  const candidates = [v?.data, v?.rides, v?.results, v?.items]
  for (const item of candidates) {
    if (Array.isArray(item)) return item as Record<string, unknown>[]
  }
  return []
}

function firstValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== "") return value
  }
  return null
}

function rideId(row: Record<string, unknown>): string | null {
  const value = firstValue(row, ["id", "reference", "booking_reference", "ride_reference", "_id"])
  return value === null ? null : String(value)
}

function rideSummary(row: Record<string, unknown>): string {
  const ref = firstValue(row, ["booking_reference", "reference", "ride_reference", "id"])
  const rider = firstValue(row, ["rider_name", "customer_name", "name"])
  const pickup = firstValue(row, ["pickup_address", "pickup", "origin"])
  const dest = firstValue(row, ["dropoff_address", "destination", "dropoff"])
  const parts = [rider, pickup && dest ? `${pickup} → ${dest}` : pickup || dest].filter(Boolean)
  return parts.length ? String(parts.join(" — ")) : `Ride ${ref ?? ""}`.trim()
}

serve(async (req) => {
  const authorization = req.headers.get("Authorization") || ""
  const dispatchSecret = Deno.env.get("CRON_DISPATCH_SECRET") || ""

  if (!dispatchSecret || authorization !== `Bearer ${dispatchSecret}`) {
    return json(401, { error: "Not authorized to run the RideArrivo bookings poll." })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const url = new URL(req.url)
  const seed = url.searchParams.get("seed") === "1"
  const limit = 100

  try {
    let checked = 0
    const errors: string[] = []

    if (seed) {
      let page = 1
      const maxPages = 200
      while (page <= maxPages) {
        const rows = await fetchRidesPage(page, limit)
        if (rows.length === 0) break

        for (const row of rows) {
          const id = rideId(row)
          if (!id) continue
          checked++
          const { error } = await admin
            .from("ridearrivo_ride_notifications")
            .upsert({ ride_id: id }, { onConflict: "ride_id", ignoreDuplicates: true })
          if (error) errors.push(`${id}: ${error.message}`)
        }

        if (rows.length < limit) break
        page++
      }

      return json(200, { mode: "seed", checked, errors })
    }

    let newRides = 0
    let notified = 0
    const PAGES_TO_CHECK = 3
    for (let page = 1; page <= PAGES_TO_CHECK; page++) {
      const rows = await fetchRidesPage(page, limit)
      if (rows.length === 0) break

      for (const row of rows) {
        const id = rideId(row)
        if (!id) continue
        checked++

        const { data: isNew, error } = await admin.rpc("notify_ridearrivo_booking", {
          p_ride_id: id,
          p_title: "New RideArrivo booking",
          p_body: rideSummary(row),
        })

        if (error) {
          errors.push(`${id}: ${error.message}`)
          continue
        }

        if (isNew) {
          newRides++
          notified++
        }
      }

      if (rows.length < limit) break
    }

    return json(200, { mode: "poll", checked, newRides, notified, errors })
  } catch (error) {
    console.error("ridearrivo-bookings-poll failed", error)
    return json(500, { error: error instanceof Error ? error.message : "Unknown error" })
  }
})
