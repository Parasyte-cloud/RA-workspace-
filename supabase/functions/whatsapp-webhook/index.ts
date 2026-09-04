import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)

const VERIFY_TOKEN =
  Deno.env.get("WHATSAPP_VERIFY_TOKEN")!

const APP_SECRET =
  Deno.env.get("WHATSAPP_APP_SECRET")!

const encoder =
  new TextEncoder()

function bytesToHex(
  bytes: Uint8Array,
) {
  return Array
    .from(bytes)
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0"),
    )
    .join("")
}

function constantTimeEqual(
  left: string,
  right: string,
) {
  if (
    left.length
    !== right.length
  ) {
    return false
  }

  let difference = 0

  for (
    let index = 0;
    index < left.length;
    index++
  ) {
    difference |=
      left.charCodeAt(index)
      ^ right.charCodeAt(index)
  }

  return difference === 0
}

async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
) {
  if (
    !signatureHeader
    || !signatureHeader.startsWith(
      "sha256=",
    )
  ) {
    return false
  }

  if (!APP_SECRET) {
    return false
  }

  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(APP_SECRET),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"],
    )

  const signed =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody),
    )

  const expected =
    `sha256=${bytesToHex(
      new Uint8Array(signed),
    )}`

  return constantTimeEqual(
    expected,
    signatureHeader,
  )
}

serve(async (req) => {
  const url =
    new URL(req.url)

  if (req.method === "GET") {
    const mode =
      url.searchParams.get(
        "hub.mode",
      )

    const token =
      url.searchParams.get(
        "hub.verify_token",
      )

    const challenge =
      url.searchParams.get(
        "hub.challenge",
      )

    if (
      mode === "subscribe"
      && token === VERIFY_TOKEN
    ) {
      return new Response(
        challenge ?? "",
        { status: 200 },
      )
    }

    return new Response(
      "Forbidden",
      { status: 403 },
    )
  }

  if (req.method !== "POST") {
    return new Response(
      "Method not allowed",
      { status: 405 },
    )
  }

  const rawBody =
    await req.text()

  const signatureValid =
    await verifyMetaSignature(
      rawBody,
      req.headers.get(
        "x-hub-signature-256",
      ),
    )

  if (!signatureValid) {
    return new Response(
      "Invalid webhook signature",
      { status: 401 },
    )
  }

  let payload: any

  try {
    payload =
      JSON.parse(rawBody)
  } catch {
    return new Response(
      "Invalid webhook JSON",
      { status: 400 },
    )
  }

  try {
    for (
      const entry
      of payload?.entry ?? []
    ) {
      for (
        const change
        of entry?.changes ?? []
      ) {
        const value =
          change?.value

        const messages =
          value?.messages ?? []

        const contacts =
          value?.contacts ?? []

        for (
          const message
          of messages
        ) {
          const waId =
            String(
              message?.from || "",
            ).trim()

          const messageId =
            String(
              message?.id || "",
            ).trim()

          if (
            !waId
            || !messageId
          ) {
            continue
          }

          const contact =
            contacts.find(
              (candidate: any) =>
                String(
                  candidate?.wa_id
                  || "",
                ) === waId,
            )

          const customerName =
            String(
              contact
                ?.profile?.name
              || "WhatsApp Customer",
            ).trim()

          const now =
            new Date()
              .toISOString()

          const {
            data: conversation,
            error:
              conversationError,
          } =
            await admin
              .from(
                "support_whatsapp_conversations",
              )
              .upsert(
                {
                  wa_id: waId,
                  phone: waId,
                  customer_name:
                    customerName,
                  last_message_at:
                    now,
                  updated_at: now,
                },
                {
                  onConflict:
                    "wa_id",
                },
              )
              .select("id")
              .single()

          if (
            conversationError
            || !conversation
          ) {
            throw (
              conversationError
              || new Error(
                "Conversation persistence failed.",
              )
            )
          }

          let body = ""

          if (
            message.type === "text"
          ) {
            body =
              String(
                message
                  ?.text?.body
                || "",
              )
          } else {
            body =
              `[${String(
                message.type
                || "unknown",
              )} message]`
          }

          const {
            error: messageError,
          } =
            await admin
              .from(
                "support_whatsapp_messages",
              )
              .upsert(
                {
                  conversation_id:
                    conversation.id,
                  whatsapp_message_id:
                    messageId,
                  direction:
                    "inbound",
                  message_type:
                    String(
                      message.type
                      || "unknown",
                    ),
                  body,
                },
                {
                  onConflict:
                    "whatsapp_message_id",
                  ignoreDuplicates:
                    true,
                },
              )

          if (messageError) {
            throw messageError
          }
        }
      }
    }

    return new Response(
      "OK",
      { status: 200 },
    )
  } catch (error) {
    console.error(
      "WhatsApp webhook processing failed",
      error,
    )

    return new Response(
      "Webhook processing failed",
      { status: 500 },
    )
  }
})
