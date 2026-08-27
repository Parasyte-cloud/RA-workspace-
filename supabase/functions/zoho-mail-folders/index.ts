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

    const response =
      await fetch(
        `${apiBase}/accounts/${encodeURIComponent(
          connection.zoho_account_id
        )}/folders`,
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

    let payload:any = {}

    try {
      payload =
        raw
          ? JSON.parse(raw)
          : {}
    } catch {
      console.error(
        "Zoho folders non-JSON response",
        {
          status: response.status,
          preview: raw.slice(0,300),
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
        "Zoho folders request failed",
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
        : Array.isArray(payload?.folders)
          ? payload.folders
          : Array.isArray(payload)
            ? payload
            : []

    console.log(
      "Zoho raw folders",
      rawFolders
    )

    const folders =
      rawFolders
        .map((folder:any) => {
          const folderId =
            folder?.folderId ??
            folder?.folderID ??
            folder?.id ??
            ''

          const name =
            folder?.folderDisplayName ??
            folder?.folderName ??
            folder?.displayName ??
            folder?.name ??
            folder?.path ??
            ''

          const type =
            folder?.folderType ??
            folder?.type ??
            folder?.folderName ??
            name

          const unreadCount =
            Number(
              folder?.unreadCount ??
              folder?.unreadMessageCount ??
              folder?.unread ??
              0
            ) || 0

          const messageCount =
            Number(
              folder?.messageCount ??
              folder?.totalMessageCount ??
              folder?.total ??
              0
            ) || 0

          return {
            folderId:String(folderId),
            name:String(name),
            type:String(type),
            unreadCount,
            messageCount,
          }
        })
        .filter((folder:any) =>
          folder.folderId &&
          folder.name
        )

    return jsonResponse({
      success:true,
      folders,
      count:folders.length,
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
