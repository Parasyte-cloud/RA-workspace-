import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "https://intranet.ridearrivo.com",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

export async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization")

  if (!authHeader) {
    throw new Error("Unauthorized")
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  const admin = createClient(
    supabaseUrl,
    serviceRoleKey
  )

  const token = authHeader.replace("Bearer ", "")

  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token)

  if (error || !user) {
    throw new Error("Unauthorized")
  }

  return { user, admin }
}

export async function getZohoConnection(
  admin: any,
  userId: string
) {
  const { data, error } = await admin
    .from("zoho_mail_connections")
    .select(`
      user_id,
      email,
      zoho_account_id,
      refresh_token,
      accounts_domain,
      mail_api_base
    `)
    .eq("user_id", userId)
    .single()

  if (error || !data) {
    throw new Error("Zoho Mail is not connected.")
  }

  return data
}

export async function getZohoAccessToken(
  connection: any
) {
  const clientId = Deno.env.get("ZOHO_CLIENT_ID")
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET")

  if (!clientId || !clientSecret) {
    throw new Error("Zoho OAuth configuration is missing.")
  }

  const accountsDomain =
    connection.accounts_domain ||
    "https://accounts.zoho.com"

  const response = await fetch(
    `${accountsDomain}/oauth/v2/token`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        refresh_token: connection.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    }
  )

  const data = await response.json()

  if (!response.ok || !data.access_token) {
    console.error("Zoho token refresh failed", data)
    throw new Error("Unable to refresh Zoho access token.")
  }

  return data.access_token
}

export function jsonResponse(
  body: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  )
}
