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
  userId: string,
  mailboxId?: string | null,
  capability = "read"
) {
  const capabilityColumns: Record<string,string> = {
    read: "can_read",
    send: "can_send",
    manage: "can_manage",
    send_as: "can_send_as",
    send_on_behalf: "can_send_on_behalf",
  }

  const capabilityColumn =
    capabilityColumns[capability]

  if (!capabilityColumn) {
    throw new Error(
      "Unsupported Zoho mailbox capability."
    )
  }

  let selectedMailboxId =
    String(mailboxId || "").trim()

  if (!selectedMailboxId) {
    const { data, error } = await admin
      .from("zoho_mailbox_access")
      .select("mailbox_id,is_default,is_favorite")
      .eq("employee_id", userId)
      .eq("active", true)
      .eq(capabilityColumn, true)
      .order("is_default", { ascending: false })
      .order("is_favorite", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data?.mailbox_id) {
      throw new Error(
        "No authorised Zoho mailbox is available."
      )
    }

    selectedMailboxId =
      String(data.mailbox_id)
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(selectedMailboxId)
  ) {
    throw new Error(
      "Invalid Zoho mailbox identifier."
    )
  }

  const { data, error } = await admin.rpc(
    "resolve_zoho_mailbox_connection",
    {
      p_employee_id: userId,
      p_mailbox_id: selectedMailboxId,
      p_capability: capability,
    },
  )

  const connection =
    Array.isArray(data)
      ? data[0]
      : data

  if (error || !connection) {
    throw new Error(
      "Zoho mailbox access is not authorised."
    )
  }

  return connection
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
    console.error(
      "Zoho token refresh failed",
      {
        status: response.status,
        providerError:
          String(
            data?.error ||
            data?.error_description ||
            "unknown"
          ).slice(0,160),
      }
    )
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
