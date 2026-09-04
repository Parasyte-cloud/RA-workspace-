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

const whatsappToken =
  Deno.env.get("WHATSAPP_ACCESS_TOKEN")!

const phoneNumberId =
  Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!

const allowedOrigin =
  "https://intranet.ridearrivo.com"

function cors(req: Request) {
  const origin = req.headers.get("Origin") || ""
  return {
    "Access-Control-Allow-Origin":
      origin === allowedOrigin ? origin : allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":
      "POST, OPTIONS",
    "Vary": "Origin",
  }
}

function json(
  req: Request,
  payload: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(payload),
    {
      status,
      headers: {
        ...cors(req),
        "Content-Type": "application/json",
      },
    },
  )
}

async function authorisedSupportActor(
  req: Request,
) {
  const header =
    req.headers.get("Authorization")

  if (
    !header
    || !header.startsWith("Bearer ")
  ) {
    return null
  }

  const jwt =
    header.slice(7).trim()

  if (!jwt) return null

  const {
    data: { user },
    error: userError,
  } =
    await admin.auth.getUser(jwt)

  if (userError || !user) {
    return null
  }

  const {
    data: profile,
    error: profileError,
  } =
    await admin
      .from("employee_profiles")
      .select("id,role,active")
      .eq("id", user.id)
      .eq("active", true)
      .maybeSingle()

  if (
    profileError
    || !profile
  ) {
    return null
  }

  const allowedRoles =
    new Set([
      "support",
      "manager",
      "admin",
    ])

  if (
    allowedRoles.has(
      String(profile.role || "")
        .toLowerCase(),
    )
  ) {
    return {
      id: profile.id as string,
    }
  }

  const {
    data: assignment,
    error: assignmentError,
  } =
    await admin
      .from(
        "workspace_workstation_assignments",
      )
      .select("id")
      .eq("employee_id", profile.id)
      .eq("workstation", "support")
      .eq("active", true)
      .limit(1)
      .maybeSingle()

  if (
    assignmentError
    || !assignment
  ) {
    return null
  }

  return {
    id: profile.id as string,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(
      null,
      {
        status: 204,
        headers: cors(req),
      },
    )
  }

  if (req.method !== "POST") {
    return json(
      req,
      { error: "Method not allowed." },
      405,
    )
  }

  const actor =
    await authorisedSupportActor(req)

  if (!actor) {
    return json(
      req,
      {
        error:
          "Authorised Support access is required.",
      },
      403,
    )
  }

  let payload: {
    conversationId?: unknown
    body?: unknown
  }

  try {
    payload = await req.json()
  } catch {
    return json(
      req,
      { error: "Invalid JSON body." },
      400,
    )
  }

  const conversationId =
    String(
      payload.conversationId || "",
    ).trim()

  const body =
    String(
      payload.body || "",
    ).trim()

  if (!conversationId) {
    return json(
      req,
      {
        error:
          "conversationId is required.",
      },
      400,
    )
  }

  if (
    !body
    || body.length > 4096
  ) {
    return json(
      req,
      {
        error:
          "Message body must contain 1 to 4096 characters.",
      },
      400,
    )
  }

  const {
    data: conversation,
    error: conversationError,
  } =
    await admin
      .from(
        "support_whatsapp_conversations",
      )
      .select("id,wa_id,phone")
      .eq("id", conversationId)
      .maybeSingle()

  if (
    conversationError
    || !conversation
  ) {
    return json(
      req,
      {
        error:
          "WhatsApp conversation was not found.",
      },
      404,
    )
  }

  const destination =
    String(
      conversation.wa_id
      || conversation.phone
      || "",
    ).trim()

  if (!destination) {
    return json(
      req,
      {
        error:
          "Conversation has no WhatsApp destination.",
      },
      409,
    )
  }

  let providerResponse: Response

  try {
    providerResponse =
      await fetch(
        `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization":
              `Bearer ${whatsappToken}`,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            messaging_product:
              "whatsapp",
            to: destination,
            type: "text",
            text: {
              body,
            },
          }),
        },
      )
  } catch (error) {
    console.error(
      "WhatsApp provider request failed",
      error,
    )

    return json(
      req,
      {
        error:
          "Unable to reach WhatsApp provider.",
      },
      502,
    )
  }

  const providerPayload =
    await providerResponse
      .json()
      .catch(() => null)

  if (
    !providerResponse.ok
    || !providerPayload
  ) {
    console.error(
      "WhatsApp provider rejected message",
      {
        status:
          providerResponse.status,
      },
    )

    return json(
      req,
      {
        error:
          "WhatsApp provider rejected the message.",
      },
      502,
    )
  }

  const whatsappMessageId =
    String(
      providerPayload
        ?.messages?.[0]?.id
      || "",
    ).trim()

  if (!whatsappMessageId) {
    return json(
      req,
      {
        error:
          "WhatsApp provider returned no message identifier.",
      },
      502,
    )
  }

  const {
    error: persistenceError,
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
            whatsappMessageId,
          direction: "outbound",
          message_type: "text",
          body,
          sent_by: actor.id,
        },
        {
          onConflict:
            "whatsapp_message_id",
          ignoreDuplicates: true,
        },
      )

  if (persistenceError) {
    console.error(
      "WhatsApp outbound persistence failed",
      persistenceError,
    )

    return json(
      req,
      {
        error:
          "Message sent but persistence failed.",
      },
      500,
    )
  }

  return json(
    req,
    {
      ok: true,
      messageId:
        whatsappMessageId,
    },
  )
})
