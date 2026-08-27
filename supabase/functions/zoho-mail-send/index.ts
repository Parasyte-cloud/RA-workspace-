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
    const {
      toAddress,
      subject,
      content,
    } = await req.json()

    if (
      !toAddress ||
      !subject ||
      !content
    ) {
      return jsonResponse(
        {
          error:
            "Recipient, subject and message are required.",
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
      connection.mail_api_base ||
      "https://mail.zoho.com/api"

    const response = await fetch(
      `${apiBase}/accounts/${connection.zoho_account_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Zoho-oauthtoken ${accessToken}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          fromAddress: connection.email,
          toAddress,
          subject,
          content,
          mailFormat: "html",
        }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error(data)
      throw new Error(
        data?.data?.errorCode ||
        data?.message ||
        "Unable to send email."
      )
    }

    return jsonResponse({
      success: true,
      data: data?.data || data,
    })
  } catch (error) {
    console.error(error)

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to send email.",
      },
      500
    )
  }
})
