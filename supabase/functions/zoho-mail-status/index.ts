import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://intranet.ridearrivo.com",
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
        JSON.stringify({ connected: false }),
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

    const token =
      authHeader.replace("Bearer ", "")

    const admin =
      createClient(
        supabaseUrl,
        serviceRoleKey
      )

    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token)

    if (error || !user) {
      return new Response(
        JSON.stringify({ connected: false }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      )
    }

    const { data } = await admin
      .from("zoho_mail_connections")
      .select("email, connected_at")
      .eq("user_id", user.id)
      .maybeSingle()

    return new Response(
      JSON.stringify({
        connected: Boolean(data),
        email: data?.email || null,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    )
  } catch (error) {
    console.error(error)

    return new Response(
      JSON.stringify({ connected: false }),
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
