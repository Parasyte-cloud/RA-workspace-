import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const allowedOrigins = new Set([
  "https://intranet.ridearrivo.com",
])

type SupportResource =
  | "tickets"
  | "rides"
  | "liveRides"
  | "riders"
  | "drivers"
  | "onTheGo"

const routes: Record<SupportResource, string> = {
  tickets: "/api/support/tickets",
  rides: "/api/admin/rides",
  liveRides: "/api/admin/rides/live",
  riders: "/api/admin/riders",
  drivers: "/api/admin/drivers",
  onTheGo: "/api/on-the-go",
}

const allowedParams = new Set([
  "status",
  "search",
  "page",
  "limit",
  "id",
])

let cachedBackendToken = ""
let cachedBackendTokenUntil = 0
let backendLoginPromise: Promise<string> | null = null

const UPSTREAM_TIMEOUT_MS = 15_000

function cors(req: Request) {
  const origin = req.headers.get("origin") || ""

  return {
    "Access-Control-Allow-Origin":
      allowedOrigins.has(origin)
        ? origin
        : "https://intranet.ridearrivo.com",

    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Vary": "Origin",
  }
}

function json(
  req: Request,
  body: unknown,
  status = 200,
  requestId?: string,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...cors(req),
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(requestId
          ? { "X-Request-ID": requestId }
          : {}),
      },
    },
  )
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
) {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs,
  )

  try {
    return await fetch(
      url,
      {
        ...init,
        signal: controller.signal,
      },
    )
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new Error(
        `RideArrivo backend timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      )
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

async function loginToBackend(
  requestId: string,
) {
  const backendUrl =
    Deno.env.get("RIDEARRIVO_BACKEND_URL")
      ?.replace(/\/$/, "")

  const email =
    Deno.env.get("RIDEARRIVO_SUPPORT_EMAIL")

  const password =
    Deno.env.get("RIDEARRIVO_SUPPORT_PASSWORD")

  if (
    !backendUrl ||
    !email ||
    !password
  ) {
    console.error(
      requestId,
      "Render support integration secrets missing",
    )

    throw new Error(
      "RideArrivo Support integration is not configured.",
    )
  }

  const response = await fetchWithTimeout(
    `${backendUrl}/api/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    },
  )

  const text = await response.text()

  let data: Record<string, unknown> = {}

  try {
    data = text
      ? JSON.parse(text)
      : {}
  } catch {
    data = {}
  }

  if (!response.ok) {
    console.error(
      requestId,
      "Render support login failed",
      response.status,
    )

    throw new Error(
      `Render Support authentication failed (${response.status}).`,
    )
  }

  const token =
    data.token ||
    data.accessToken ||
    data.access_token

  if (
    typeof token !== "string" ||
    !token
  ) {
    console.error(
      requestId,
      "Render login response contained no access token",
    )

    throw new Error(
      "RideArrivo backend returned no access token.",
    )
  }

  cachedBackendToken = token
  cachedBackendTokenUntil =
    Date.now() + 5 * 60 * 1000

  return token
}

async function getBackendToken(
  requestId: string,
) {
  if (
    cachedBackendToken &&
    Date.now() < cachedBackendTokenUntil
  ) {
    return cachedBackendToken
  }

  /*
   * Multiple Support cards can load at the same time. They must share one
   * service-account login rather than stampeding the upstream auth endpoint.
   */
  if (!backendLoginPromise) {
    backendLoginPromise = loginToBackend(requestId)
      .finally(() => {
        backendLoginPromise = null
      })
  }

  return await backendLoginPromise
}

async function getWorkspaceProfile(
  admin: ReturnType<typeof createClient>,
  user: {
    id: string
    email?: string | null
  },
  requestId: string,
) {
  /*
   * UUID is authoritative.
   */
  const byId =
    await admin
      .from("employee_profiles")
      .select(
        "id,email,full_name,role,department,active",
      )
      .eq("id", user.id)
      .maybeSingle()

  if (byId.error) {
    console.error(
      requestId,
      "Profile UUID lookup failed",
      byId.error.message,
    )
  }

  if (byId.data) {
    return byId.data
  }

  /*
   * Legacy recovery:
   *
   * Some profiles were historically created before the
   * auth/profile UUID relationship was fully hardened.
   * A verified RideArrivo auth email may therefore recover
   * its employee profile.
   */
  const email =
    String(user.email || "")
      .trim()
      .toLowerCase()

  if (
    !email ||
    !email.endsWith("@ridearrivo.com")
  ) {
    return null
  }

  const byEmail =
    await admin
      .from("employee_profiles")
      .select(
        "id,email,full_name,role,department,active",
      )
      .ilike("email", email)
      .maybeSingle()

  if (byEmail.error) {
    console.error(
      requestId,
      "Profile email lookup failed",
      byEmail.error.message,
    )

    return null
  }

  if (
    byEmail.data &&
    byEmail.data.id !== user.id
  ) {
    console.warn(
      requestId,
      "Legacy auth/profile UUID mismatch",
      {
        authUserId: user.id,
        profileId: byEmail.data.id,
        email,
      },
    )
  }

  return byEmail.data || null
}

serve(async req => {
  const requestId =
    crypto.randomUUID()

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
        error:
          "Support Operations only accepts POST requests.",
      },
      405,
      requestId,
    )
  }

  try {
    /*
     * --------------------------------------------------------
     * 1. Authenticate RideArrivo Workspace employee
     * --------------------------------------------------------
     */

    const authHeader =
      req.headers.get("Authorization")

    if (
      !authHeader ||
      !authHeader.startsWith("Bearer ")
    ) {
      return json(
        req,
        { error: "Workspace authentication required." },
        401,
        requestId,
      )
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      )

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      throw new Error(
        "Workspace service configuration is missing.",
      )
    }

    const admin =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        },
      )

    const jwt =
      authHeader.substring(
        "Bearer ".length,
      )

    const {
      data: { user },
      error: userError,
    } =
      await admin.auth.getUser(jwt)

    if (
      userError ||
      !user
    ) {
      console.warn(
        requestId,
        "Workspace JWT rejected",
        userError?.message,
      )

      return json(
        req,
        {
          error:
            "Your RideArrivo Workspace session is not valid.",
        },
        401,
        requestId,
      )
    }

    /*
     * --------------------------------------------------------
     * 2. Resolve active employee profile
     * --------------------------------------------------------
     */

    const profile =
      await getWorkspaceProfile(
        admin,
        {
          id: user.id,
          email: user.email,
        },
        requestId,
      )

    if (!profile) {
      return json(
        req,
        {
          error:
            "Unable to verify your RideArrivo Workspace profile.",
        },
        403,
        requestId,
      )
    }

    if (profile.active !== true) {
      return json(
        req,
        {
          error:
            "Your RideArrivo Workspace account is not active.",
        },
        403,
        requestId,
      )
    }

    const role =
      String(profile.role || "")
        .trim()
        .toLowerCase()

    /*
     * Support data remains department-controlled. Explicit Support workstation
     * assignments are first-class access grants in the rest of the workspace,
     * so the Edge Function must enforce the same model instead of role-only
     * authorization.
     *
     * Operations has its own workstation and does not automatically inherit
     * Support customer data.
     */
    const allowedRoles = new Set([
      "support",
      "manager",
      "admin",
    ])

    let hasSupportWorkstation = false

    if (!allowedRoles.has(role)) {
      const assignment = await admin
        .from("workspace_workstation_assignments")
        .select("id")
        .eq("employee_id", profile.id)
        .eq("workstation", "support")
        .eq("active", true)
        .limit(1)
        .maybeSingle()

      if (assignment.error) {
        console.error(
          requestId,
          "Support workstation authorization lookup failed",
          assignment.error.message,
        )
      } else {
        hasSupportWorkstation = Boolean(assignment.data)
      }
    }

    if (
      !allowedRoles.has(role) &&
      !hasSupportWorkstation
    ) {
      console.warn(
        requestId,
        "Support access rejected",
        {
          userId: user.id,
          profileId: profile.id,
          role,
        },
      )

      return json(
        req,
        {
          error:
            "Your workspace role or workstation assignment does not permit Support Operations access.",
        },
        403,
        requestId,
      )
    }

    /*
     * --------------------------------------------------------
     * 3. Parse requested READ-ONLY resource
     * --------------------------------------------------------
     */

    let body: {
      resource?: SupportResource
      params?: Record<
        string,
        string | number | undefined
      >
    } = {}

    try {
      body =
        await req.json()
    } catch {
      body = {}
    }

    const resource =
      body.resource || "tickets"

    const endpoint =
      routes[resource]

    if (!endpoint) {
      return json(
        req,
        {
          error:
            "Unsupported Support Operations resource.",
        },
        400,
        requestId,
      )
    }

    /*
     * --------------------------------------------------------
     * 4. Authenticate service account against Render
     * --------------------------------------------------------
     */

    const backendUrl =
      Deno.env
        .get("RIDEARRIVO_BACKEND_URL")
        ?.replace(/\/$/, "")

    if (!backendUrl) {
      throw new Error(
        "RideArrivo backend URL is not configured.",
      )
    }

    const backendToken =
      await getBackendToken(
        requestId,
      )

    /*
     * --------------------------------------------------------
     * 5. Build allow-listed upstream query
     * --------------------------------------------------------
     */

    const upstreamUrl =
      new URL(
        `${backendUrl}${endpoint}`,
      )

    for (
      const [key, rawValue]
      of Object.entries(
        body.params || {},
      )
    ) {
      if (
        !allowedParams.has(key) ||
        rawValue === undefined ||
        rawValue === null
      ) {
        continue
      }

      upstreamUrl.searchParams.set(
        key,
        String(rawValue),
      )
    }

    /*
     * --------------------------------------------------------
     * 6. READ ONLY
     *
     * No POST/PUT/PATCH/DELETE is ever sent to Render.
     * --------------------------------------------------------
     */

    const fetchResource = (token: string) =>
      fetchWithTimeout(
        upstreamUrl.toString(),
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
      )

    let response = await fetchResource(backendToken)

    /*
     * A 401 can mean the cached upstream token expired. Invalidate once,
     * share one fresh login across concurrent requests, and retry the same
     * read-only request once.
     */
    if (response.status === 401) {
      invalidateBackendToken()

      const freshToken = await getBackendToken(requestId)
      response = await fetchResource(freshToken)
    }

    const responseText = await response.text()
    let responseBody: unknown = null

    try {
      responseBody = responseText
        ? JSON.parse(responseText)
        : null
    } catch {
      console.error(
        requestId,
        "Render Support returned non-JSON content",
        {
          resource,
          status: response.status,
          path: endpoint,
        },
      )

      return json(
        req,
        {
          error:
            "RideArrivo Support backend returned an unexpected response.",
        },
        502,
        requestId,
      )
    }

    if (!response.ok) {
      console.error(
        requestId,
        "Render Support upstream error",
        {
          resource,
          status: response.status,
          path: endpoint,
        },
      )

      const upstream =
        responseBody &&
        typeof responseBody === "object"
          ? responseBody as Record<string, unknown>
          : {}

      const upstreamMessage =
        typeof upstream.error === "string"
          ? upstream.error
          : typeof upstream.message === "string"
            ? upstream.message
            : `RideArrivo Support backend error (${response.status}).`

      return json(
        req,
        {
          error: upstreamMessage,
          upstreamStatus: response.status,
        },
        response.status,
        requestId,
      )
    }

    return json(
      req,
      responseBody,
      200,
      requestId,
    )
  } catch (error) {
    console.error(
      requestId,
      "RideArrivo Support gateway failure",
      error,
    )

    return json(
      req,
      {
        error:
          error instanceof Error
            ? error.message
            : "Support integration failed.",

        requestId,
      },
      500,
      requestId,
    )
  }
})
