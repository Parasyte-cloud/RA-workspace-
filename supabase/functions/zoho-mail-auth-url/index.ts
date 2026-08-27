import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get("Authorization")

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      )
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const token = authHeader.replace("Bearer ", "")

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey
    )

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token)

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      )
    }

    const clientId = Deno.env.get("ZOHO_CLIENT_ID")
    const redirectUri = Deno.env.get("ZOHO_REDIRECT_URI")

    if (!clientId || !redirectUri) {
      throw new Error("Zoho OAuth configuration is missing")
    }

    const state = crypto.randomUUID()
    const expiresAt =
      new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const { error: stateError } = await admin
      .from("zoho_oauth_states")
      .insert({
        state,
        user_id: user.id,
        expires_at: expiresAt,
      })

    if (stateError) throw stateError

    const scopes = [
      "ZohoMail.accounts.READ",
      "ZohoMail.folders.READ",
      "ZohoMail.messages.READ",
      "ZohoMail.messages.CREATE",
    ].join(",")

    const params = new URLSearchParams({
      scope: scopes,
      client_id: clientId,
      response_type: "code",
      access_type: "offline",
      redirect_uri: redirectUri,
      state,
      prompt: "consent",
    })

    const url =
      `https://accounts.zoho.com/oauth/v2/auth?${params.toString()}`

    return new Response(
      JSON.stringify({ url }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    )
  } catch (error) {
    console.error(error)

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unable to create Zoho authorization URL",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    )
  }
})
