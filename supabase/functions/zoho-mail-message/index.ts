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

    const mailboxId =
      String(body?.mailboxId || "").trim() ||
      null

    const messageId =
      String(body?.messageId || "").trim()

    const folderId =
      String(body?.folderId || "").trim()

    if (!messageId) {
      return jsonResponse(
        { error: "messageId is required." },
        400
      )
    }

    if (!folderId) {
      return jsonResponse(
        { error: "folderId is required to open this email." },
        400
      )
    }

    const { user, admin } =
      await getAuthenticatedUser(req)

    const connection =
      await getZohoConnection(
        admin,
        user.id,
        mailboxId,
        "read"
      )

    const accessToken =
      await getZohoAccessToken(connection)

    const apiBase =
      String(
        connection.mail_api_base ||
        "https://mail.zoho.com/api"
      ).replace(/\/$/, "")

    const url =
      `${apiBase}` +
      `/accounts/${encodeURIComponent(connection.zoho_account_id)}` +
      `/folders/${encodeURIComponent(folderId)}` +
      `/messages/${encodeURIComponent(messageId)}` +
      `/content`

    console.log("Loading Zoho message content", {
      userId: user.id,
      folderId,
      messageId,
    })

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization:
          `Zoho-oauthtoken ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    })

    const raw = await response.text()

    let data: any = null

    try {
      data = raw ? JSON.parse(raw) : {}
    } catch {
      console.error(
        "Zoho returned non-JSON response",
        {
          status: response.status,
          preview: raw.slice(0, 300),
        }
      )

      return jsonResponse(
        {
          error:
            "Zoho returned an invalid response while opening this email.",
        },
        502
      )
    }

    if (!response.ok) {
      console.error(
        "Zoho message request failed",
        {
          status: response.status,
          zohoStatus: data?.status,
          zohoErrorCode:
            data?.data?.errorCode ||
            data?.errorCode ||
            null,
        }
      )

      const description =
        data?.status?.description ||
        data?.data?.errorCode ||
        data?.error ||
        "Unable to load email content."

      return jsonResponse(
        {
          error: `Unable to load email content: ${description}`,
        },
        response.status >= 400 &&
        response.status < 600
          ? response.status
          : 502
      )
    }

    return jsonResponse({
      message:
        data?.data ||
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
