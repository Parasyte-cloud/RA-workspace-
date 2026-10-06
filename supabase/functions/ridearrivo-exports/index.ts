// RideArrivo operations exports for the Workspace.
//
// The CSV exports live in the RideArrivo backend. The Workspace has its own
// sign-in, so it cannot call the backend directly. This function is the bridge:
//
//   1. It checks the person's Workspace session and that their profile is active.
//   2. It works out which export role they hold (admin, operations or support).
//   3. It asks the backend for the file using a shared secret and the person's
//      email and role, so the backend audit log names the real person.
//   4. It streams the CSV back unchanged.
//
// The shared secret (EXPORT_PROXY_SECRET) lives only here and in the backend.
// It is never sent to the browser. If this function is ever wrong about a
// role, the backend still refuses the money exports to anyone but admin.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const allowedOrigins = new Set([
  "https://intranet.ridearrivo.com",
])

// A large export can take a while to stream.
const UPSTREAM_TIMEOUT_MS = 120_000

type ExportRole = "admin" | "operations" | "support"

function cors(req: Request) {
  const origin = req.headers.get("origin") || ""
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://intranet.ridearrivo.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Disposition, X-Row-Count",
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

// Same lookup the Support function uses: the profile id is authoritative, and
// a verified @ridearrivo.com email can recover an older profile.
async function getProfile(
  admin: ReturnType<typeof createClient>,
  user: { id: string; email?: string | null },
) {
  const byId = await admin
    .from("employee_profiles")
    .select("id,email,full_name,role,department,active")
    .eq("id", user.id)
    .maybeSingle()
  if (byId.data) return byId.data

  const email = String(user.email || "").trim().toLowerCase()
  if (!email || !email.endsWith("@ridearrivo.com")) return null

  const byEmail = await admin
    .from("employee_profiles")
    .select("id,email,full_name,role,department,active")
    .ilike("email", email)
    .maybeSingle()
  return byEmail.data || null
}

async function resolveExportRole(
  admin: ReturnType<typeof createClient>,
  profile: { id: string; role: string | null },
): Promise<ExportRole | null> {
  const role = String(profile.role || "").trim().toLowerCase()
  if (role === "admin") return "admin"
  if (role === "operations") return "operations"
  if (role === "support") return "support"

  // Explicit workstation assignments are access grants elsewhere in the
  // Workspace, so honour them here too. Operations wins if someone has both.
  const assignments = await admin
    .from("workspace_workstation_assignments")
    .select("workstation")
    .eq("employee_id", profile.id)
    .eq("active", true)
    .in("workstation", ["operations", "support"])

  const stations = new Set(
    (assignments.data || []).map((a: { workstation: string }) => a.workstation),
  )
  if (stations.has("operations")) return "operations"
  if (stations.has("support")) return "support"
  return null
}

serve(async (req) => {
  const requestId = crypto.randomUUID()

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors(req) })
  }
  if (req.method !== "POST") {
    return json(req, { error: "Exports only accepts POST requests." }, 405, requestId)
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json(req, { error: "Workspace authentication required." }, 401, requestId)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const backendUrl = Deno.env.get("RIDEARRIVO_BACKEND_URL")?.replace(/\/$/, "")
    const secret = Deno.env.get("EXPORT_PROXY_SECRET") || ""

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Workspace service configuration is missing.")
    }
    if (!backendUrl || secret.length < 32) {
      console.error(requestId, "Exports are not configured (backend URL or secret missing)")
      return json(req, { error: "Exports are not set up yet. Ask an administrator." }, 503, requestId)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(authHeader.substring("Bearer ".length))

    if (userError || !user) {
      return json(req, { error: "Your RideArrivo Workspace session is not valid." }, 401, requestId)
    }

    const profile = await getProfile(admin, { id: user.id, email: user.email })
    if (!profile) {
      return json(req, { error: "Unable to verify your RideArrivo Workspace profile." }, 403, requestId)
    }
    if (profile.active !== true) {
      return json(req, { error: "Your RideArrivo Workspace account is not active." }, 403, requestId)
    }

    const exportRole = await resolveExportRole(admin, profile)
    if (!exportRole) {
      console.warn(requestId, "Export access rejected", { profileId: profile.id, role: profile.role })
      return json(
        req,
        { error: "Exports are available to Operations, Support and Admin only." },
        403,
        requestId,
      )
    }

    // The email the backend records. The Workspace profile email is the
    // company address; fall back to the sign-in email.
    const actorEmail = String(profile.email || user.email || "").trim().toLowerCase()

    let body: { action?: string; dataset?: string; from?: string; to?: string } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: "Invalid request." }, 400, requestId)
    }

    const action = String(body.action || "")
    let path = ""

    if (action === "list") {
      path = "/api/internal/exports"
    } else if (action === "history") {
      path = "/api/internal/exports/history"
    } else if (action === "download") {
      const dataset = String(body.dataset || "")
      if (!/^[a-z-]{1,60}$/.test(dataset) || dataset === "history") {
        return json(req, { error: "Unknown export." }, 404, requestId)
      }
      const qs = new URLSearchParams()
      for (const key of ["from", "to"] as const) {
        const value = String(body[key] || "")
        if (value) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return json(req, { error: "Dates must look like 2026-10-06." }, 400, requestId)
          }
          qs.set(key, value)
        }
      }
      path = `/api/internal/exports/${dataset}${qs.toString() ? `?${qs}` : ""}`
    } else {
      return json(req, { error: "Unknown action." }, 400, requestId)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

    let upstream: Response
    try {
      upstream = await fetch(`${backendUrl}${path}`, {
        method: "GET",
        headers: {
          "x-export-proxy-secret": secret,
          "x-actor-email": actorEmail,
          "x-actor-role": exportRole,
        },
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      console.error(requestId, "Backend unreachable", String(error))
      return json(req, { error: "The RideArrivo backend could not be reached. Try again shortly." }, 502, requestId)
    }

    if (!upstream.ok) {
      clearTimeout(timer)
      const detail = await upstream.json().catch(() => ({}))
      // 401 and 503 from the backend mean a setup problem (secret or config),
      // which the person cannot fix, so do not pass the detail along.
      if (upstream.status === 401 || upstream.status === 503) {
        console.error(requestId, "Backend refused the export bridge", upstream.status)
        return json(req, { error: "Exports are not set up correctly. Ask an administrator." }, 502, requestId)
      }
      return json(req, { error: detail?.error || "The export could not be created." }, upstream.status, requestId)
    }

    // JSON answers (list, history) are small; pass them straight through.
    const type = upstream.headers.get("content-type") || ""
    if (type.includes("application/json")) {
      clearTimeout(timer)
      return json(req, await upstream.json(), 200, requestId)
    }

    // The CSV is streamed, not buffered, so a big file does not sit in memory.
    const headers = new Headers({
      ...cors(req),
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-ID": requestId,
    })
    for (const name of ["content-disposition", "x-row-count"]) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response(upstream.body, { status: 200, headers })
  } catch (error) {
    console.error(requestId, "Exports function failed", String(error))
    return json(req, { error: "The export could not be created. Please try again." }, 500, requestId)
  }
})
