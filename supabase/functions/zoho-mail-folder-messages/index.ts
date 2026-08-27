import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

import {
  corsHeaders,
  getAuthenticatedUser,
  getZohoConnection,
  getZohoAccessToken,
  jsonResponse,
} from "../_shared/zoho.ts"

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    })
  }

  try {
    const payload =
      await req.json().catch(() => ({}))

    const folderId =
      String(payload?.folderId || '').trim()

    if (!folderId) {
      return jsonResponse(
        { error: "folderId is required." },
        400
      )
    }

    const { user, admin } =
      await getAuthenticatedUser(req)

    const connection =
      await getZohoConnection(
        admin,
        user.id
      )

    const token =
      await getZohoAccessToken(connection)

    const apiBase =
      String(
        connection.mail_api_base ||
        "https://mail.zoho.com/api"
      ).replace(/\/$/, "")

    const url =
      `${apiBase}/accounts/` +
      `${encodeURIComponent(
        connection.zoho_account_id
      )}/messages/view?folderId=` +
      `${encodeURIComponent(folderId)}` +
      `&limit=50`

    const response =
      await fetch(url, {
        headers: {
          Authorization:
            `Zoho-oauthtoken ${token}`,
          Accept: "application/json",
        },
      })

    const data =
      await response.json()

    if (!response.ok) {
      console.error(
        "Folder messages failed",
        data
      )

      return jsonResponse(
        {
          error:
            "Unable to load this mail folder.",
        },
        response.status
      )
    }

    return jsonResponse({
      success:true,
      folderId,
      messages:
        Array.isArray(data?.data)
          ? data.data
          : [],
    })
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load folder.",
      },
      500
    )
  }
})
