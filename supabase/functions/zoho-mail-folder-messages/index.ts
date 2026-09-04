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

    const mailboxId =
      String(payload?.mailboxId || "").trim() ||
      null

    const folderId =
      String(
        payload?.folderId || ''
      ).trim()

    const view =
      String(
        payload?.view || ''
      )
        .trim()
        .toLowerCase()

    const { user, admin } =
      await getAuthenticatedUser(req)

    const connection =
      await getZohoConnection(
        admin,
        user.id,
        mailboxId,
        "read"
      )

    const token =
      await getZohoAccessToken(connection)

    const apiBase =
      String(
        connection.mail_api_base ||
        "https://mail.zoho.com/api"
      ).replace(/\/$/, "")

    const accountId =
      encodeURIComponent(
        String(connection.zoho_account_id)
      )

    const params =
      new URLSearchParams()

    params.set("limit", "50")

    if (folderId) {
      params.set("folderId", folderId)
    }

    if (view === "starred") {
      params.set(
        "flaggedMails",
        "true"
      )
    }

    if (view === "archive") {
      params.set(
        "includearchive",
        "true"
      )
    }

    if (!folderId &&
        view !== "starred" &&
        view !== "archive") {
      return jsonResponse(
        {
          error:
            "folderId or supported view is required.",
        },
        400
      )
    }

    const response =
      await fetch(
        `${apiBase}/accounts/${accountId}/messages/view?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Authorization:
              `Zoho-oauthtoken ${token}`,
            Accept: "application/json",
          },
        }
      )

    const raw =
      await response.text()

    let data:any

    try {
      data =
        raw
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
        "Zoho folder/view messages failed",
        {
          status: response.status,
          folderId,
          view,
          data,
        }
      )

      return jsonResponse(
        {
          error:
            data?.status?.description ||
            data?.data?.errorCode ||
            "Unable to load this mailbox view.",
        },
        response.status
      )
    }

    return jsonResponse({
      success: true,
      folderId:
        folderId || null,
      view:
        view || null,
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
            : "Unable to load mailbox view.",
      },
      500
    )
  }
})
