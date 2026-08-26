import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://intranet.ridearrivo.com",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  })
}

async function getBackendToken() {
  const backendUrl = Deno.env.get("RIDEARRIVO_BACKEND_URL")
  const email = Deno.env.get("RIDEARRIVO_SUPPORT_EMAIL")
  const password = Deno.env.get("RIDEARRIVO_SUPPORT_PASSWORD")

  if (!backendUrl || !email || !password) {
    throw new Error("RideArrivo support integration is not configured.")
  }

  const response = await fetch(
    `${backendUrl.replace(/\/$/, "")}/api/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    }
  )

  const data = await response.json()

  if (!response.ok) {
    console.error("RideArrivo login failed", response.status, data)
    throw new Error("Unable to authenticate support integration.")
  }

  const token =
    data.token ||
    data.accessToken ||
    data.access_token

  if (!token) {
    console.error("No recognised token in backend login response")
    throw new Error("RideArrivo backend did not return an access token.")
  }

  return token
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get("Authorization")

    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey
    )

    const token =
      authHeader.replace("Bearer ", "")

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token)

    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401)
    }

    const { data: profile, error: profileError } =
      await admin
        .from("employee_profiles")
        .select("role,email,full_name")
        .eq("id", user.id)
        .single()

    if (
      profileError ||
      !profile ||
      !["support", "manager", "admin"].includes(
        String(profile.role).toLowerCase()
      )
    ) {
      return json(
        {
          error:
            "Your workspace role does not permit Support Operations access.",
        },
        403
      )
    }

    const backendToken =
      await getBackendToken()

    const backendUrl =
      Deno.env
        .get("RIDEARRIVO_BACKEND_URL")!
        .replace(/\/$/, "")

    const url = new URL(req.url)

    let requestBody: any = {}
    if (req.method === "POST") {
      try {
        requestBody = await req.json()
      } catch {
        requestBody = {}
      }
    }

    const resource =
      requestBody.resource ||
      url.searchParams.get("resource") ||
      "tickets"

    const routes: Record<string, string> = {
      tickets: "/api/support/tickets",
      rides: "/api/admin/rides",
      liveRides: "/api/admin/rides/live",
      riders: "/api/admin/riders",
      drivers: "/api/admin/drivers",
      onTheGo: "/api/on-the-go",
    }

    const endpoint = routes[resource]

    if (!endpoint) {
      return json(
        { error: "Unsupported Support Operations resource." },
        400
      )
    }

    const upstreamUrl =
      new URL(`${backendUrl}${endpoint}`)

    const allowedParams = [
      "status",
      "search",
      "page",
      "limit",
      "id",
    ]

    for (const key of allowedParams) {
      const bodyValue = requestBody?.params?.[key]
      const queryValue = url.searchParams.get(key)

      const value =
        bodyValue !== undefined && bodyValue !== null
          ? String(bodyValue)
          : queryValue

      if (value !== null && value !== undefined) {
        upstreamUrl.searchParams.set(key, value)
      }
    }

    const response = await fetch(
      upstreamUrl.toString(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${backendToken}`,
          Accept: "application/json",
        },
      }
    )

    const body = await response.text()

    return new Response(body, {
      status: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          response.headers.get("content-type") ||
          "application/json",
      },
    })
  } catch (error) {
    console.error(error)

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Support integration failed.",
      },
      500
    )
  }
})
