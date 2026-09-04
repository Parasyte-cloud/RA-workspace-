import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

import {
  corsHeaders,
  getAuthenticatedUser,
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

    const {
      data: accessRows,
      error: accessError,
    } = await admin
      .from("zoho_mailbox_access")
      .select(
        [
          "mailbox_id",
          "can_read",
          "can_send",
          "can_manage",
          "can_send_as",
          "can_send_on_behalf",
          "default_identity_id",
          "is_default",
          "is_favorite",
        ].join(",")
      )
      .eq("employee_id", user.id)
      .eq("active", true)
      .eq("can_read", true)
      .order("is_default", {
        ascending: false,
      })
      .order("is_favorite", {
        ascending: false,
      })

    if (accessError) {
      throw new Error(
        "Unable to load Zoho mailbox entitlements."
      )
    }

    const entitled =
      Array.isArray(accessRows)
        ? accessRows
        : []

    const mailboxIds =
      entitled
        .map((row: any) =>
          String(row?.mailbox_id || "").trim()
        )
        .filter(Boolean)

    if (mailboxIds.length === 0) {
      return jsonResponse({
        connected: false,
        mailboxId: null,
        email: null,
        mailboxes: [],
      })
    }

    const {
      data: mailboxRows,
      error: mailboxError,
    } = await admin
      .from("zoho_mailboxes")
      .select(
        [
          "id",
          "primary_address",
          "display_name",
          "mailbox_type",
        ].join(",")
      )
      .in("id", mailboxIds)
      .eq("active", true)

    if (mailboxError) {
      throw new Error(
        "Unable to load Zoho mailbox metadata."
      )
    }

    const mailboxById =
      new Map(
        (Array.isArray(mailboxRows)
          ? mailboxRows
          : []
        ).map((mailbox: any) => [
          String(mailbox.id),
          mailbox,
        ])
      )

    const mailboxes =
      entitled
        .map((access: any) => {
          const mailbox =
            mailboxById.get(
              String(access.mailbox_id)
            )

          if (!mailbox) {
            return null
          }

          return {
            mailboxId:
              String(mailbox.id),

            email:
              mailbox.primary_address ||
              null,

            displayName:
              mailbox.display_name ||
              mailbox.primary_address ||
              null,

            mailboxType:
              mailbox.mailbox_type,

            defaultIdentityId:
              access.default_identity_id ||
              null,

            isDefault:
              Boolean(access.is_default),

            isFavorite:
              Boolean(access.is_favorite),

            permissions: {
              read:
                Boolean(access.can_read),

              send:
                Boolean(access.can_send),

              manage:
                Boolean(access.can_manage),

              sendAs:
                Boolean(access.can_send_as),

              sendOnBehalf:
                Boolean(
                  access.can_send_on_behalf
                ),
            },
          }
        })
        .filter(Boolean)

    const selected =
      mailboxes[0] || null

    return jsonResponse({
      connected:
        mailboxes.length > 0,

      mailboxId:
        selected?.mailboxId || null,

      email:
        selected?.email || null,

      mailboxes,
    })
  } catch (error) {
    console.error(
      "zoho-mail-status failure",
      error
    )

    return jsonResponse(
      {
        connected: false,
        mailboxId: null,
        email: null,
        mailboxes: [],
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Zoho mailbox status.",
      },
      500
    )
  }
})
