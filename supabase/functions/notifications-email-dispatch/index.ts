// RideArrivo Workspace: sweep pending `notifications` rows and
// deliver them by email via Resend. Invoked every 2 minutes by
// a pg_cron job (see 20260915093000_notification_email_and_coverage.sql),
// authenticated with the project's own service role key. Not
// meant to be called by any client app.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BATCH_SIZE = 25

function text(value: unknown, max: number) {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, max)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  const authorization = req.headers.get("Authorization") || ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  const dispatchSecret = Deno.env.get("CRON_DISPATCH_SECRET") || ""

  // Only the project's own service role (i.e. the cron job) may
  // invoke this. Anyone else gets rejected before touching the DB.
  if (
    !dispatchSecret ||
    authorization !== `Bearer ${dispatchSecret}`
  ) {
    return json(401, { error: "Not authorized to dispatch notification email." })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const resendApiKey = Deno.env.get("RESEND_API_KEY")
  const fromAddress =
    Deno.env.get("NOTIFICATIONS_FROM_EMAIL") ||
    "RideArrivo Workspace <notifications@ridearrivo.com>"

  if (!supabaseUrl || !serviceRoleKey) {
    return json(503, { error: "Workspace service configuration is missing." })
  }

  if (!resendApiKey) {
    // Nothing we can do — leave rows pending so a future run
    // (once the secret is set) can still deliver them.
    console.error(
      "notifications-email-dispatch: RESEND_API_KEY is not configured; skipping this run.",
    )
    return json(503, { error: "Email provider is not configured." })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: pending, error: pendingError } = await admin
    .from("notifications")
    .select("id,user_id,type,title,body,entity_type,created_at")
    .eq("email_status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE)

  if (pendingError) {
    console.error("notifications-email-dispatch: failed to load pending rows", pendingError)
    return json(500, { error: "Failed to load pending notifications." })
  }

  if (!pending || pending.length === 0) {
    return json(200, { sent: 0, failed: 0, skipped: 0 })
  }

  // Claim this batch immediately so a slow send can't overlap
  // with the next scheduled tick re-processing the same rows.
  const ids = pending.map((row) => row.id)

  await admin
    .from("notifications")
    .update({ email_status: "sending" })
    .in("id", ids)
    .eq("email_status", "pending")

  const employeeIds = Array.from(new Set(pending.map((row) => row.user_id)))

  const { data: employees, error: employeesError } = await admin
    .from("employee_profiles")
    .select("id,email,full_name,active")
    .in("id", employeeIds)

  if (employeesError) {
    console.error("notifications-email-dispatch: failed to load recipients", employeesError)
  }

  const employeeById = new Map(
    (employees || []).map((employee) => [employee.id, employee]),
  )

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const row of pending) {
    const employee = employeeById.get(row.user_id)

    if (!employee || !employee.active || !employee.email) {
      await admin
        .from("notifications")
        .update({
          email_status: "skipped",
          email_error: "No active employee email on file.",
        })
        .eq("id", row.id)

      skipped += 1
      continue
    }

    const title = text(row.title, 200) || "RideArrivo Workspace notification"
    const body = text(row.body, 2000)

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: employee.email,
          subject: title,
          html:
            `<p style="font-family:sans-serif;font-size:15px;color:#0b1411">` +
            `<strong>${escapeHtml(title)}</strong></p>` +
            (body
              ? `<p style="font-family:sans-serif;font-size:14px;color:#333">${escapeHtml(body)}</p>`
              : "") +
            `<p style="font-family:sans-serif;font-size:12px;color:#888">` +
            `Sign in to the RideArrivo Workspace to view and act on this.</p>`,
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => "")

        console.error(
          "notifications-email-dispatch: Resend rejected the email",
          response.status,
          detail,
        )

        await admin
          .from("notifications")
          .update({
            email_status: "failed",
            email_error: `Resend ${response.status}: ${detail.slice(0, 500)}`,
          })
          .eq("id", row.id)

        failed += 1
        continue
      }

      await admin
        .from("notifications")
        .update({
          email_status: "sent",
          email_sent_at: new Date().toISOString(),
        })
        .eq("id", row.id)

      sent += 1
    } catch (error) {
      console.error("notifications-email-dispatch: send failed", error)

      await admin
        .from("notifications")
        .update({
          email_status: "failed",
          email_error: error instanceof Error ? error.message : "Unknown send failure.",
        })
        .eq("id", row.id)

      failed += 1
    }
  }

  return json(200, { sent, failed, skipped })
})
