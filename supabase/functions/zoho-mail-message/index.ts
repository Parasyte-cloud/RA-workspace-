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
    const body = await req.json().catch(() => ({}))

    const messageId = String(body?.messageId || "").trim()
    const folderId = String(body?.folderId || "").trim()

    if (!messageId) {
      return jsonResponse(
        { error: "messageId is required." },
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

    const url = new URL(
      `${apiBase}/accounts/${encodeURIComponent(
        connection.zoho_account_id
      )}/messages/${encodeURIComponent(messageId)}/content`
    )

    /*
     * Some Zoho mailbox/message contexts need the folder
     * associated with the message. Preserve it whenever the
     * inbox endpoint supplied it.
     */
    if (folderId) {
      url.searchParams.set("folderId", folderId)
    }

    const response = await fetch(
      url.toString(),
      {
        method: "GET",
        headers: {
          Authorization:
            `Zoho-oauthtoken ${accessToken}`,
          Accept: "application/json",
        },
      }
    )

    const raw = await response.text()

    let data: any = null

    try {
      data = raw ? JSON.parse(raw) : null
    } catch {
      data = {
        raw,
      }
    }

    if (!response.ok) {
      console.error(
        "Zoho message content request failed",
        {
          status: response.status,
          messageId,
          folderId: folderId || null,
          zohoStatus: data?.status || null,
        }
      )

      const description =
        data?.status?.description ||
        data?.data?.errorCode ||
        data?.error?.message ||
        null

      return jsonResponse(
        {
          error:
            description
              ? `Unable to load email content: ${description}`
              : "Unable to load email content.",
        },
        response.status >= 400 &&
        response.status < 600
          ? response.status
          : 500
      )
    }

    return jsonResponse({
      message:
        data?.data ||
        data ||
        {},
    })
  } catch (error) {
    console.error(
      "zoho-mail-message failure",
      error
    )

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to open email.",
      },
      500
    )
  }
})
