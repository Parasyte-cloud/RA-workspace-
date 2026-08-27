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
    if (req.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed." },
        405
      )
    }

    const payload =
      await req.json().catch(() => ({}))

    const toAddress =
      String(payload?.toAddress || "").trim()

    const subject =
      String(payload?.subject || "").trim()

    const content =
      String(payload?.content || "").trim()

    if (!toAddress || !subject || !content) {
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
      String(
        connection.mail_api_base ||
        "https://mail.zoho.com/api"
      ).replace(/\/$/, "")

    const url =
      `${apiBase}/accounts/` +
      `${encodeURIComponent(
        connection.zoho_account_id
      )}/messages`

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization:
            `Zoho-oauthtoken ${accessToken}`,
          Accept: "application/json",
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          fromAddress:connection.email,
          toAddress,
          subject,
          content,
          mailFormat:"html",
        }),
      })

    const raw = await response.text()

    let data:any={}

    try {
      data = raw ? JSON.parse(raw) : {}
    } catch {
      console.error(
        "Zoho send returned non-JSON",
        {
          status:response.status,
          preview:raw.slice(0,300),
        }
      )

      return jsonResponse(
        {
          error:
            "Zoho returned an invalid response while sending.",
        },
        502
      )
    }

    const zohoCode =
      data?.status?.code

    const zohoDescription =
      data?.status?.description

    const zohoError =
      data?.data?.errorCode ||
      data?.errorCode

    if (
      !response.ok ||
      (zohoCode &&
       Number(zohoCode) >= 400)
    ) {
      console.error(
        "Zoho Mail send failed",
        {
          userId:user.id,
          mailbox:connection.email,
          status:response.status,
          zohoCode,
          zohoDescription,
          zohoError,
        }
      )

      return jsonResponse(
        {
          error:
            zohoError ||
            zohoDescription ||
            "Zoho rejected the email.",
        },
        response.status >= 400
          ? response.status
          : 502
      )
    }

    return jsonResponse({
      success:true,
      message:"Email sent successfully.",
      data:data?.data || data,
    })
  } catch (error) {
    console.error(
      "zoho-mail-send failure",
      error
    )

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
