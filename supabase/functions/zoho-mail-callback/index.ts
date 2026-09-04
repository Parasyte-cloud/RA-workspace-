import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const WORKSPACE_URL =
  "https://intranet.ridearrivo.com"

function redirect(reason: string, ok = false) {
  const destination =
    ok
      ? `${WORKSPACE_URL}?mail=connected`
      : `${WORKSPACE_URL}?mail=error&reason=${encodeURIComponent(reason)}`

  return Response.redirect(
    destination,
    302,
  )
}

serve(async (req) => {
  try {
    const url = new URL(req.url)

    const code =
      url.searchParams.get("code")

    const state =
      url.searchParams.get("state")

    if (!code || !state) {
      return redirect(
        "missing_oauth_parameters",
      )
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      )

    const clientId =
      Deno.env.get("ZOHO_CLIENT_ID")

    const clientSecret =
      Deno.env.get(
        "ZOHO_CLIENT_SECRET",
      )

    const redirectUri =
      Deno.env.get(
        "ZOHO_REDIRECT_URI",
      )

    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !clientId ||
      !clientSecret ||
      !redirectUri
    ) {
      return redirect(
        "oauth_configuration_missing",
      )
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    )

    // Consume once, while still unexpired, before any provider call.
    const { data: stateRow, error: stateError } =
      await admin
        .from("zoho_oauth_states")
        .delete()
        .eq("state", state)
        .gt("expires_at", new Date().toISOString())
        .select("*")
        .maybeSingle()

    if (
      stateError ||
      !stateRow
    ) {
      return redirect(
        "invalid_oauth_state",
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
          grant_type:
            "authorization_code",
          client_id:
            clientId,
          client_secret:
            clientSecret,
          redirect_uri:
            redirectUri,
          code,
        }),
      },
    )

    const tokenData =
      await tokenResponse
        .json()
        .catch(() => ({}))

    if (
      !tokenResponse.ok ||
      !tokenData?.access_token ||
      !tokenData?.refresh_token
    ) {
      console.error(
        "Zoho OAuth token exchange failed",
        {
          status:
            tokenResponse.status,
          providerError:
            String(
              tokenData?.error ||
              tokenData?.error_description ||
              "unknown",
            ).slice(0,160),
        },
      )

      return redirect(
        "token_exchange_failed",
      )
    }

    const accountResponse = await fetch(
      "https://mail.zoho.com/api/accounts",
      {
        headers: {
          Authorization:
            `Zoho-oauthtoken ${tokenData.access_token}`,
          Accept:
            "application/json",
        },
      },
    )

    const accountData =
      await accountResponse
        .json()
        .catch(() => ({}))

    const account =
      Array.isArray(accountData?.data)
        ? accountData.data[0]
        : null

    if (
      !accountResponse.ok ||
      !account?.accountId
    ) {
      return redirect(
        "account_lookup_failed",
      )
    }

    const providerEmail =
      String(
        account.primaryEmailAddress ||
        account.emailAddress ||
        "",
      )
        .trim()
        .toLowerCase()

    if (!providerEmail) {
      return redirect(
        "provider_email_missing",
      )
    }

    const { error: connectionError } =
      await admin.rpc(
        "complete_zoho_mail_oauth_connection",
        {
          p_owner_id:
            stateRow.user_id,

          p_provider_email:
            providerEmail,

          p_zoho_account_id:
            String(account.accountId),

          p_refresh_token:
            String(tokenData.refresh_token),

          p_accounts_domain:
            "https://accounts.zoho.com",

          p_mail_api_base:
            "https://mail.zoho.com/api",
        },
      )

    if (connectionError) {
      console.error(
        "Zoho OAuth persistence failed",
        String(
          connectionError.message ||
          "unknown",
        ).slice(0,200),
      )

      return redirect(
        "connection_persistence_failed",
      )
    }

    return redirect(
      "connected",
      true,
    )

  } catch (error) {
    console.error(
      "Zoho OAuth callback failed",
      error instanceof Error
        ? error.message
        : "unknown",
    )

    return redirect(
      "oauth_callback_failed",
    )
  }
})
