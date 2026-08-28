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

async function getBackendToken(
  requestId: string,
) {
  if (
    cachedBackendToken &&
    Date.now() < cachedBackendTokenUntil
  ) {
    return cachedBackendToken
  }

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

  const response = await fetch(
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

  // Avoid logging into Render for every dashboard request.
  // Keep this deliberately short in case the upstream token
  // has a short expiry.
  cachedBackendTokenUntil =
    Date.now() + 5 * 60 * 1000

  return token
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
     * Support data remains department-controlled.
     *
     * Operations has its own workstation and should not
     * automatically inherit Support customer data.
     */
    const allowedRoles =
      new Set([
        "support",
        "manager",
        "admin",
      ])

    if (!allowedRoles.has(role)) {
      console.warn(
        requestId,
        "Support role rejected",
        {
          userId: user.id,
          role,
        },
      )

      return json(
        req,
        {
          error:
            "Your workspace role does not permit Support Operations access.",
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

    let response =
      await fetch(
        upstreamUrl.toString(),
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${backendToken}`,

            Accept:
              "application/json",
          },
        },
      )

    /*
     * A 401 can mean the cached upstream token expired.
     * Re-authenticate once, then retry the same GET.
     */
    if (response.status === 401) {
      cachedBackendToken = ""
      cachedBackendTokenUntil = 0

      const freshToken =
        await getBackendToken(
          requestId,
        )

      response =
        await fetch(
          upstreamUrl.toString(),
          {
            method: "GET",

            headers: {
              Authorization:
                `Bearer ${freshToken}`,

              Accept:
                "application/json",
            },
          },
        )
    }

    const responseText =
      await response.text()

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
    }

    return new Response(
      responseText,
      {
        status: response.status,

        headers: {
          ...cors(req),

          "Content-Type":
            response.headers
              .get("content-type") ||
            "application/json",

          "Cache-Control":
            "no-store",

          "X-Request-ID":
            requestId,
        },
      },
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
