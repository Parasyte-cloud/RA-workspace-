import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!

serve(async (req) => {
  const url = new URL(req.url)

  // Meta webhook verification
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const challenge = url.searchParams.get("hub.challenge")

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 })
    }

    return new Response("Forbidden", { status: 403 })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const payload = await req.json()

  try {
    const value =
      payload?.entry?.[0]?.changes?.[0]?.value

    const messages = value?.messages ?? []
    const contacts = value?.contacts ?? []

    for (const message of messages) {
      const waId = message.from
      const contact =
        contacts.find((c: any) => c.wa_id === waId)

      const customerName =
        contact?.profile?.name ?? "WhatsApp Customer"

      const { data: conversation, error: conversationError } =
        await supabase
          .from("support_whatsapp_conversations")
          .upsert(
            {
              wa_id: waId,
              phone: waId,
              customer_name: customerName,
              last_message_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            { onConflict: "wa_id" }
          )
          .select()
          .single()

      if (conversationError) throw conversationError

      let body = ""

      if (message.type === "text") {
        body = message.text?.body ?? ""
      } else {
        body = `[${message.type} message]`
      }

      const { error: messageError } = await supabase
        .from("support_whatsapp_messages")
        .insert({
          conversation_id: conversation.id,
          whatsapp_message_id: message.id,
          direction: "inbound",
          message_type: message.type,
          body
        })

      if (messageError) throw messageError
    }

    return new Response("OK", { status: 200 })
  } catch (error) {
    console.error(error)
    return new Response("Webhook processing failed", { status: 500 })
  }
})
