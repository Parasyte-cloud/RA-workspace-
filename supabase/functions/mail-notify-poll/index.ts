// RideArrivo Workspace: tell people when new email arrives, even with the app closed.
//
// Runs every two minutes from a database schedule (see 20261016270000_push_everywhere.sql),
// authenticated by the same shared secret as push-dispatch. For each person who has
// phone alerts on and can read a mailbox, it looks at the newest inbox messages and
// creates ONE notification when something arrived since the last look. Creating the
// notification row is what sends the push (the database trigger does that), so email
// uses the same settings, quiet hours and delivery log as everything else.
//
// The first look at a mailbox only records where it is up to; nobody gets a wall of
// alerts for mail that was already there.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getZohoAccessToken } from "../_shared/zoho.ts"

const SECRET = Deno.env.get("PUSH_DISPATCH_SECRET") || ""
const MAX_PEOPLE = 200
const MAX_MAILBOXES_PER_PERSON = 5
const DEADLINE_MS = 100_000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "")

async function zohoGet(url: string, token: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: "application/json" },
  })
  if (!response.ok) throw new Error(`Zoho answered ${response.status}`)
  return await response.json()
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405)
  if (!SECRET || !sameSecret(request.headers.get("x-push-secret") || "", SECRET)) return json({ error: "Forbidden" }, 403)

  const started = Date.now()
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  })

  // Only people who can actually be alerted are worth a call to Zoho.
  const { data: subs } = await admin.from("push_subscriptions").select("user_id")
  const people = [...new Set((subs || []).map((row: { user_id: string }) => row.user_id))].slice(0, MAX_PEOPLE)

  let notified = 0
  let checked = 0
  let failed = 0

  for (const employeeId of people) {
    if (Date.now() - started > DEADLINE_MS) break

    const { data: prefs } = await admin
      .from("notification_preferences")
      .select("push_mail")
      .eq("user_id", employeeId)
      .maybeSingle()
    if (prefs && prefs.push_mail === false) continue

    const { data: access } = await admin
      .from("zoho_mailbox_access")
      .select("mailbox_id")
      .eq("employee_id", employeeId)
      .eq("active", true)
      .eq("can_read", true)
      .limit(MAX_MAILBOXES_PER_PERSON)

    for (const grant of access || []) {
      if (Date.now() - started > DEADLINE_MS) break
      try {
        const { data: resolved, error: resolveError } = await admin.rpc("resolve_zoho_mailbox_connection", {
          p_employee_id: employeeId,
          p_mailbox_id: grant.mailbox_id,
          p_capability: "read",
        })
        const connection = Array.isArray(resolved) ? resolved[0] : resolved
        if (resolveError || !connection) continue

        const token = await getZohoAccessToken(connection)
        const apiBase = String(connection.mail_api_base || "https://mail.zoho.com/api").replace(/\/$/, "")
        const account = encodeURIComponent(String(connection.zoho_account_id))

        const folders = await zohoGet(`${apiBase}/accounts/${account}/folders`, token)
        const inbox = (folders?.data || []).find(
          (folder: { type?: string }) => String(folder?.type || "").toLowerCase() === "inbox",
        )
        if (!inbox?.folderId) continue

        const list = await zohoGet(
          `${apiBase}/accounts/${account}/messages/view?folderId=${encodeURIComponent(String(inbox.folderId))}&limit=10`,
          token,
        )
        const messages = (Array.isArray(list?.data) ? list.data : [])
          .map((message: Record<string, unknown>) => ({
            at: Number(message.receivedTime) || 0,
            sender: clip(message.sender, 80) || clip(message.fromAddress, 120),
            subject: clip(message.subject, 120),
          }))
          .filter((message: { at: number }) => message.at > 0)
        checked++

        const newest = messages.reduce((max: number, message: { at: number }) => Math.max(max, message.at), 0)
        const { data: state } = await admin
          .from("mail_watch_state")
          .select("last_seen_ms")
          .eq("employee_id", employeeId)
          .eq("mailbox_id", grant.mailbox_id)
          .maybeSingle()

        // First look: remember where the inbox is up to, say nothing.
        if (!state) {
          await admin.from("mail_watch_state").upsert({
            employee_id: employeeId,
            mailbox_id: grant.mailbox_id,
            last_seen_ms: newest || Date.now(),
            checked_at: new Date().toISOString(),
          })
          continue
        }

        const fresh = messages
          .filter((message: { at: number }) => message.at > Number(state.last_seen_ms))
          .sort((a: { at: number }, b: { at: number }) => b.at - a.at)

        if (fresh.length) {
          const latest = fresh[0]
          const mailbox = clip(connection.primary_address, 80)
          await admin.from("notifications").insert({
            user_id: employeeId,
            type: "mail_message",
            title: fresh.length === 1
              ? `New email from ${latest.sender || "someone"}`
              : `${fresh.length} new emails${mailbox ? ` in ${mailbox}` : ""}`,
            body: latest.subject || "(no subject)",
            entity_type: "mailbox",
            entity_id: grant.mailbox_id,
            // A phone and bell alert only. Emailing "you have email" would be silly.
            email_status: "skipped",
          })
          notified++
        }

        await admin.from("mail_watch_state").upsert({
          employee_id: employeeId,
          mailbox_id: grant.mailbox_id,
          last_seen_ms: Math.max(Number(state.last_seen_ms), newest),
          checked_at: new Date().toISOString(),
        })
      } catch (error) {
        failed++
        console.error("mail-notify-poll mailbox failed", { message: String((error as Error)?.message || error).slice(0, 160) })
      }
    }
  }

  return json({ people: people.length, checked, notified, failed })
})
