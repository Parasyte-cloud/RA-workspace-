import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

import {
  corsHeaders,
  getAuthenticatedUser,
  getZohoConnection,
  getZohoAccessToken,
  jsonResponse,
} from "../_shared/zoho.ts"

/*
 * Global search's mail results. Unlike workspace-search (one Postgres
 * round trip across several tables), RideArrivo mail lives in Zoho, not
 * Postgres — zoho_mail_persistence/zoho_multi_mailbox_governance only
 * store OAuth connections and mailbox access grants, never message
 * content — so this has to call Zoho's own search API live, once per
 * mailbox the actor can read.
 *
 * Kept as its own function (rather than folded into workspace-search) so
 * a slow or failing Zoho call never blocks the DB-backed results; the
 * frontend fires both in parallel and merges them.
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const payload = await req.json().catch(() => ({}))
    const query = String(payload?.query || "").trim()

    if (query.length < 2) {
      return jsonResponse({ error: "Search needs at least 2 characters." }, 400)
    }
    if (query.length > 120) {
      return jsonResponse({ error: "Search query is too long." }, 400)
    }

    const { user, admin } = await getAuthenticatedUser(req)

    const access = await admin
      .from("zoho_mailbox_access")
      .select("mailbox_id,is_default")
      .eq("employee_id", user.id)
      .eq("active", true)
      .eq("can_read", true)
      .order("is_default", { ascending: false })
      .limit(5) // a handful of mailboxes at most per person in practice

    const mailboxIds: string[] = (access.data || []).map(
      (row: { mailbox_id: string }) => row.mailbox_id,
    )

    if (mailboxIds.length === 0) {
      return jsonResponse({ query, messages: [] })
    }

    const perMailbox = await Promise.all(
      mailboxIds.map(async (mailboxId) => {
        try {
          const connection = await getZohoConnection(admin, user.id, mailboxId, "read")
          const accessToken = await getZohoAccessToken(connection)
          const apiBase = connection.mail_api_base || "https://mail.zoho.com/api"

          const response = await fetch(
            `${apiBase}/accounts/${connection.zoho_account_id}/messages/search` +
              `?searchKey=${encodeURIComponent(query)}&limit=8`,
            {
              headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
            },
          )

          const data = await response.json().catch(() => ({}))
          if (!response.ok) {
            console.error("zoho-mail-search", mailboxId, data)
            return []
          }

          const rows = Array.isArray(data?.data) ? data.data : []
          return rows.map((row: Record<string, unknown>) => ({
            mailboxId,
            mailboxEmail: connection.email,
            messageId: row.messageId,
            folderId: row.folderId,
            subject: row.subject,
            sender: row.sender,
            summary: row.summary,
            receivedTime: row.receivedTime,
          }))
        } catch (error) {
          console.error("zoho-mail-search mailbox failed", mailboxId, error instanceof Error ? error.message : error)
          return []
        }
      }),
    )

    const messages = perMailbox
      .flat()
      .sort((a, b) => Number(b.receivedTime || 0) - Number(a.receivedTime || 0))
      .slice(0, 10)

    return jsonResponse({ query, messages })
  } catch (error) {
    console.error("zoho-mail-search failed", error)
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Mail search failed." },
      500,
    )
  }
})
