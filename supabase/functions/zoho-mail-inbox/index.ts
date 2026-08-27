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
      connection.mail_api_base ||
      "https://mail.zoho.com/api"

    const foldersResponse = await fetch(
      `${apiBase}/accounts/${connection.zoho_account_id}/folders`,
      {
        headers: {
          Authorization:
            `Zoho-oauthtoken ${accessToken}`,
        },
      }
    )

    const foldersData =
      await foldersResponse.json()

    if (!foldersResponse.ok) {
      console.error(foldersData)
      throw new Error(
        "Unable to load Zoho mail folders."
      )
    }

    const folders =
      foldersData?.data || []

    const inbox =
      folders.find((folder: any) =>
        String(
          folder.folderName ||
          folder.folderDisplayName ||
          ""
        ).toLowerCase() === "inbox"
      )

    if (!inbox?.folderId) {
      throw new Error(
        "Zoho Inbox folder could not be found."
      )
    }

    const messagesResponse = await fetch(
      `${apiBase}/accounts/${connection.zoho_account_id}/messages/view?folderId=${encodeURIComponent(inbox.folderId)}&limit=50`,
      {
        headers: {
          Authorization:
            `Zoho-oauthtoken ${accessToken}`,
        },
      }
    )

    const messagesData =
      await messagesResponse.json()

    if (!messagesResponse.ok) {
      console.error(messagesData)
      throw new Error(
        "Unable to load Zoho inbox."
      )
    }

    return jsonResponse({
      email: connection.email,
      folderId: inbox.folderId,
      messages: messagesData?.data || [],
    })
  } catch (error) {
    console.error(error)

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load inbox.",
      },
      500
    )
  }
})
