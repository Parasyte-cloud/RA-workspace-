import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN")!
const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const { conversationId, to, body } = await req.json()

  const response = await fetch(
    `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body }
      })
    }
  )

  const result = await response.json()

  if (!response.ok) {
    return new Response(JSON.stringify(result), {
      status: response.status,
      headers: { "Content-Type": "application/json" }
    })
  }

  await supabase
    .from("support_whatsapp_messages")
    .insert({
      conversation_id: conversationId,
      whatsapp_message_id: result?.messages?.[0]?.id,
      direction: "outbound",
      message_type: "text",
      body,
      status: "sent"
    })

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" }
  })
})
