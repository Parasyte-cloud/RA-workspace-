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
      String(
        payload?.folderId || ''
      ).trim()

    if (!folderId) {
      return jsonResponse(
        {
          error:
            "folderId is required.",
        },
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

    const accessToken =
      await getZohoAccessToken(connection)

    const apiBase =
      String(
        connection.mail_api_base ||
        "https://mail.zoho.com/api"
      ).replace(/\/$/, "")

    const response =
      await fetch(
        `${apiBase}/accounts/${encodeURIComponent(
          connection.zoho_account_id
        )}/messages/view?folderId=${encodeURIComponent(
          folderId
        )}&limit=50`,
        {
          headers: {
            Authorization:
              `Zoho-oauthtoken ${accessToken}`,
            Accept: "application/json",
          },
        }
      )

    const raw =
      await response.text()

    let data:any = {}

    try {
      data = raw
        ? JSON.parse(raw)
        : {}
    } catch {
      return jsonResponse(
        {
          error:
            "Zoho returned an invalid message-list response.",
        },
        502
      )
    }

    if (!response.ok) {
      console.error(
        "Zoho folder messages failed",
        {
          status: response.status,
          folderId,
          data,
        }
      )

      return jsonResponse(
        {
          error:
            data?.data?.errorCode ||
            data?.status?.description ||
            "Unable to load this mail folder.",
        },
        response.status
      )
    }

    return jsonResponse({
      success: true,
      folderId,
      messages:
        Array.isArray(data?.data)
          ? data.data
          : [],
    })
  } catch (error) {
    console.error(
      "zoho-mail-folder-messages failure",
      error
    )

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load mail folder.",
      },
      500
    )
  }
})
