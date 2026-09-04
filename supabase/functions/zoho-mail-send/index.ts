import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import {
  corsHeaders,
  getAuthenticatedUser,
  getZohoConnection,
  getZohoAccessToken,
  jsonResponse,
} from "../_shared/zoho.ts"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

    const mailboxId =
      String(payload?.mailboxId || "").trim()

    const identityId =
      String(payload?.identityId || "").trim()

    const toAddress =
      String(payload?.toAddress || "").trim()

    const subject =
      String(payload?.subject || "").trim()

    const content =
      String(payload?.content || "").trim()

    if (!UUID_RE.test(mailboxId)) {
      return jsonResponse(
        { error: "A valid mailboxId is required." },
        400
      )
    }

    if (!UUID_RE.test(identityId)) {
      return jsonResponse(
        { error: "A valid identityId is required." },
        400
      )
    }

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
        user.id,
        mailboxId,
        "send"
      )

    const {
      data: identityData,
      error: identityError,
    } = await admin.rpc(
      "resolve_zoho_send_identity",
      {
        p_employee_id: user.id,
        p_mailbox_id: mailboxId,
        p_identity_id: identityId,
      }
    )

    const senderIdentity =
      Array.isArray(identityData)
        ? identityData[0]
        : identityData

    if (
      identityError ||
      !senderIdentity?.identity_id ||
      !senderIdentity?.email_address
    ) {
      return jsonResponse(
        {
          error:
            "Zoho sender identity is not authorised.",
        },
        403
      )
    }

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
          fromAddress: senderIdentity.email_address,
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
          mailboxId,
          identityId,
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
      mailboxId,
      identityId: senderIdentity.identity_id,
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
