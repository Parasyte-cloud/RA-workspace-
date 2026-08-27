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
        )}/folders`,
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
            "Zoho returned an invalid folder response.",
        },
        502
      )
    }

    if (!response.ok) {
      console.error(
        "Zoho folders failed",
        {
          status: response.status,
          data,
        }
      )

      return jsonResponse(
        {
          error:
            data?.data?.errorCode ||
            data?.status?.description ||
            "Unable to load mailbox folders.",
        },
        response.status
      )
    }

    const folders =
      Array.isArray(data?.data)
        ? data.data.map((folder:any) => ({
            folderId:
              String(folder.folderId || ''),

            name:
              String(
                folder.folderDisplayName ||
                folder.folderName ||
                'Folder'
              ),

            type:
              String(
                folder.folderType ||
                folder.folderName ||
                ''
              ).toLowerCase(),

            unreadCount:
              Number(
                folder.unreadCount ??
                folder.unreadMessageCount ??
                0
              ),

            messageCount:
              Number(
                folder.messageCount ??
                folder.totalMessageCount ??
                0
              ),
          }))
        : []

    return jsonResponse({
      success: true,
      folders,
    })
  } catch (error) {
    console.error(
      "zoho-mail-folders failure",
      error
    )

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load mailbox folders.",
      },
      500
    )
  }
})
