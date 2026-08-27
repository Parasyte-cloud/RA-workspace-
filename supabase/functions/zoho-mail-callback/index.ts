import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const WORKSPACE_URL = "https://intranet.ridearrivo.com"

serve(async (req) => {
  try {
    const url = new URL(req.url)

    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")

    if (!code || !state) {
      return Response.redirect(
        `${WORKSPACE_URL}?mail=error&reason=missing_oauth_parameters`,
        302
      )
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const clientId = Deno.env.get("ZOHO_CLIENT_ID")!
    const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET")!
    const redirectUri = Deno.env.get("ZOHO_REDIRECT_URI")!

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey
    )

    const { data: stateRow, error: stateError } = await admin
      .from("zoho_oauth_states")
      .select("*")
      .eq("state", state)
      .single()

    if (
      stateError ||
      !stateRow ||
      new Date(stateRow.expires_at).getTime() < Date.now()
    ) {
      return Response.redirect(
        `${WORKSPACE_URL}?mail=error&reason=invalid_oauth_state`,
        302
      )
    }

    const tokenResponse = await fetch(
      "https://accounts.zoho.com/oauth/v2/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
        }),
      }
    )

    const tokenData = await tokenResponse.json()

    if (!tokenResponse.ok || !tokenData.refresh_token) {
      console.error(tokenData)

      return Response.redirect(
        `${WORKSPACE_URL}?mail=error&reason=token_exchange_failed`,
        302
      )
    }

    const accountResponse = await fetch(
      "https://mail.zoho.com/api/accounts",
      {
        headers: {
          Authorization:
            `Zoho-oauthtoken ${tokenData.access_token}`,
        },
      }
    )

    const accountData = await accountResponse.json()

    const account =
      accountData?.data?.[0]

    if (!account?.accountId) {
      console.error(accountData)

      return Response.redirect(
        `${WORKSPACE_URL}?mail=error&reason=account_lookup_failed`,
        302
      )
    }

    const { error: connectionError } = await admin
      .from("zoho_mail_connections")
      .upsert({
        user_id: stateRow.user_id,
        email:
          account.primaryEmailAddress ||
          account.emailAddress ||
          null,
        zoho_account_id: String(account.accountId),
        refresh_token: tokenData.refresh_token,
        updated_at: new Date().toISOString(),
      })

    if (connectionError) {
      throw connectionError
    }

    await admin
      .from("zoho_oauth_states")
      .delete()
      .eq("state", state)

    return Response.redirect(
      `${WORKSPACE_URL}?mail=connected`,
      302
    )
  } catch (error) {
    console.error(error)

    return Response.redirect(
      `${WORKSPACE_URL}?mail=error`,
      302
    )
  }
})
