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

    const response =
      await fetch(
        `${apiBase}/accounts/${accountId}/folders`,
        {
          method: "GET",
          headers: {
            Authorization:
              `Zoho-oauthtoken ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      )

    const raw =
      await response.text()

    let payload:any

    try {
      payload =
        raw
          ? JSON.parse(raw)
          : {}
    } catch {
      console.error(
        "Zoho folders invalid JSON",
        {
          status: response.status,
          body: raw.slice(0, 500),
        }
      )

      return jsonResponse(
        {
          error:
            "Zoho returned an invalid folders response.",
        },
        502
      )
    }

    if (!response.ok) {
      console.error(
        "Zoho folder request failed",
        {
          status: response.status,
          payload,
        }
      )

      return jsonResponse(
        {
          error:
            payload?.status?.description ||
            payload?.data?.errorCode ||
            payload?.errorCode ||
            "Unable to load Zoho folders.",
        },
        response.status
      )
    }

    const rawFolders =
      Array.isArray(payload?.data)
        ? payload.data
        : []

    console.log(
      "Zoho folders received",
      rawFolders.map((folder:any) => ({
        folderId: folder?.folderId,
        folderName: folder?.folderName,
        folderType: folder?.folderType,
        path: folder?.path,
        isArchived: folder?.isArchived,
      }))
    )

    const folders =
      rawFolders
        .map((folder:any) => ({
          folderId:
            String(folder?.folderId || ''),

          name:
            String(
              folder?.folderName ||
              folder?.folderDisplayName ||
              folder?.path ||
              'Folder'
            ).replace(/^\//, ''),

          type:
            String(
              folder?.folderType ||
              folder?.folderName ||
              ''
            ),

          path:
            String(folder?.path || ''),

          isArchived:
            Number(folder?.isArchived || 0),

          unreadCount:
            Number(
              folder?.unreadCount ??
              folder?.unreadMessageCount ??
              0
            ) || 0,

          messageCount:
            Number(
              folder?.messageCount ??
              folder?.totalMessageCount ??
              0
            ) || 0,
        }))
        .filter((folder:any) =>
          Boolean(folder.folderId)
        )

    return jsonResponse({
      success: true,
      count: folders.length,
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
            : "Unable to load Zoho folders.",
      },
      500
    )
  }
})
