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

const WORKSPACE_URL = Deno.env.get("WORKSPACE_URL") || "https://intranet.ridearrivo.com"

// Ribbon colours used across the birthday card.
const RIBBON = ["#ff9900", "#e94b8b", "#7a4cc2", "#315bc1", "#1f9d55", "#ffc83d", "#ff6b4a"]

// A strip of coloured bands, like a ribbon.
function ribbonBand(height: number) {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    RIBBON.map((color) => `<td height="${height}" style="background:${color};font-size:0;line-height:0;">&nbsp;</td>`).join("") +
    `</tr></table>`
  )
}

// A row of confetti dots in the ribbon colours.
function confettiRow(offset: number) {
  const sizes = [10, 6, 12, 7, 9, 5, 11, 8, 6, 12, 7, 10]
  const cells = sizes
    .map((size, i) => {
      const color = RIBBON[(i + offset) % RIBBON.length]
      const radius = i % 3 === 0 ? "2px" : "50%"
      return (
        `<td align="center" valign="middle" style="padding:0 7px;">` +
        `<div style="width:${size}px;height:${size}px;background:${color};border-radius:${radius};font-size:0;line-height:0;">&nbsp;</div></td>`
      )
    })
    .join("")
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`
}

function birthdayEmail(fullName: string) {
  const first = escapeHtml(fullName.trim().split(/\s+/)[0] || "friend")
  const font = "'Helvetica Neue',Helvetica,Arial,sans-serif"
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#fbf4ea;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbf4ea;"><tr><td align="center" style="padding:28px 12px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:22px;overflow:hidden;">` +
    `<tr><td>${ribbonBand(12)}</td></tr>` +
    `<tr><td style="padding:26px 24px 4px;">${confettiRow(0)}</td></tr>` +
    // ribbon banner
    `<tr><td align="center" style="padding:18px 24px 0;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="width:0;border-top:21px solid #c97a00;border-bottom:21px solid #c97a00;border-left:0;border-right:16px solid #ff9900;font-size:0;line-height:0;">&nbsp;</td>` +
    `<td style="background:#ff9900;padding:0 26px;height:42px;font-family:${font};font-size:13px;font-weight:800;letter-spacing:4px;color:#071a38;text-align:center;">MAKE A WISH</td>` +
    `<td style="width:0;border-top:21px solid #c97a00;border-bottom:21px solid #c97a00;border-right:0;border-left:16px solid #ff9900;font-size:0;line-height:0;">&nbsp;</td>` +
    `</tr></table></td></tr>` +
    `<tr><td align="center" style="padding:22px 28px 0;font-family:${font};">` +
    `<div style="font-size:42px;line-height:1.1;font-weight:800;color:#071a38;">Happy Birthday</div>` +
    `<div style="font-size:42px;line-height:1.15;font-weight:800;color:#ff9900;padding-top:2px;">${first}!</div>` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:20px 40px 6px;font-family:${font};font-size:16px;line-height:1.65;color:#3a4756;">` +
    `Everyone at RideArrivo is celebrating you today. Thank you for the energy, the ideas and the care you bring to the team. We are glad you are here.` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:6px 40px 10px;font-family:${font};font-size:16px;line-height:1.65;color:#3a4756;">` +
    `Wishing you a day full of joy and a year full of good things.` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:18px 24px 8px;">` +
    `<a href="${WORKSPACE_URL}" style="display:inline-block;background:#071a38;color:#ffffff;text-decoration:none;font-family:${font};font-size:15px;font-weight:700;padding:14px 30px;border-radius:999px;">See your birthday wishes</a>` +
    `</td></tr>` +
    `<tr><td style="padding:22px 24px 4px;">${confettiRow(3)}</td></tr>` +
    `<tr><td align="center" style="padding:14px 28px 26px;font-family:${font};font-size:13px;line-height:1.6;color:#8a95a3;">With warm wishes,<br><strong style="color:#071a38;">The RideArrivo Team</strong></td></tr>` +
    `<tr><td>${ribbonBand(12)}</td></tr>` +
    `</table></td></tr></table></body></html>`

  const textBody =
    `Happy Birthday, ${fullName.trim().split(/\s+/)[0] || "friend"}!\n\n` +
    `Everyone at RideArrivo is celebrating you today. Thank you for the energy, the ideas and the care you bring to the team.\n\n` +
    `Wishing you a day full of joy and a year full of good things.\n\n` +
    `See your birthday wishes: ${WORKSPACE_URL}\n\nThe RideArrivo Team`

  return { html, text: textBody }
}

// Monthly ribbon digest for leadership. `body` is plain text made by the database.
function ribbonDigestEmail(title: string, summary: string, fullName: string) {
  const first = escapeHtml(fullName.trim().split(/\s+/)[0] || "there")
  const font = "'Helvetica Neue',Helvetica,Arial,sans-serif"
  const blocks = summary.split(/\n{2,}/).map((part) => {
    const lines = part.split("\n")
    const heading = lines.length > 1 ? lines[0] : ""
    const rest = heading ? lines.slice(1) : lines
    return (
      (heading
        ? `<div style="font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#b8860b;padding:6px 0 4px;">${escapeHtml(heading)}</div>`
        : "") +
      `<p style="margin:0 0 12px;">${rest.map((line) => escapeHtml(line)).join("<br>")}</p>`
    )
  }).join("")
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f9;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">` +
    `<tr><td>${ribbonBand(10)}</td></tr>` +
    `<tr><td style="background:#071a38;padding:18px 24px;font-family:${font};font-size:12px;font-weight:800;letter-spacing:3px;color:#ffc83d;">RIBBON DIGEST</td></tr>` +
    `<tr><td style="padding:22px 24px 6px;font-family:${font};font-size:22px;font-weight:800;color:#071a38;">${escapeHtml(title)}</td></tr>` +
    `<tr><td style="padding:6px 24px 4px;font-family:${font};font-size:14px;line-height:1.6;color:#3a4756;">Hi ${first}, here is how the team recognised each other last month.</td></tr>` +
    `<tr><td style="padding:10px 24px 8px;font-family:${font};font-size:14px;line-height:1.65;color:#1d2733;">${blocks}</td></tr>` +
    `<tr><td align="center" style="padding:10px 24px 22px;"><a href="${WORKSPACE_URL}" style="display:inline-block;background:#ff9900;color:#071a38;text-decoration:none;font-family:${font};font-size:14px;font-weight:800;padding:12px 26px;border-radius:999px;">Open the Hall of Fame</a></td></tr>` +
    `<tr><td>${ribbonBand(10)}</td></tr>` +
    `</table></td></tr></table></body></html>`
  const textBody =
    `${title}\n\nHi ${fullName.trim().split(/\s+/)[0] || "there"}, here is how the team recognised each other last month.\n\n${summary}\n\n` +
    `Open the Hall of Fame: ${WORKSPACE_URL}`
  return { html, text: textBody }
}

// Meeting summary: the text in `body` is already plain and short.
function minutesEmail(title: string, summary: string, fullName: string) {
  const first = escapeHtml(fullName.trim().split(/\s+/)[0] || "there")
  const font = "'Helvetica Neue',Helvetica,Arial,sans-serif"
  const paragraphs = summary
    .split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 12px;">${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("")
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f9;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">` +
    `<tr><td style="background:#071a38;padding:18px 24px;font-family:${font};font-size:12px;font-weight:800;letter-spacing:3px;color:#ff9900;">ROOM 7 MEETING SUMMARY</td></tr>` +
    `<tr><td style="padding:22px 24px 6px;font-family:${font};font-size:20px;font-weight:800;color:#071a38;">${escapeHtml(title)}</td></tr>` +
    `<tr><td style="padding:6px 24px 4px;font-family:${font};font-size:14px;line-height:1.6;color:#3a4756;">Hi ${first}, here is what was covered.</td></tr>` +
    `<tr><td style="padding:10px 24px 8px;font-family:${font};font-size:14px;line-height:1.65;color:#1d2733;">${paragraphs}</td></tr>` +
    `<tr><td align="center" style="padding:10px 24px 20px;"><a href="${WORKSPACE_URL}" style="display:inline-block;background:#ff9900;color:#071a38;text-decoration:none;font-family:${font};font-size:14px;font-weight:800;padding:12px 26px;border-radius:999px;">Open the workspace</a></td></tr>` +
    `<tr><td style="padding:0 24px 22px;font-family:${font};font-size:12px;line-height:1.6;color:#8a95a3;">This summary was written by AI notes and may contain mistakes. It was sent to the host and the colleagues who joined. Do not forward it outside RideArrivo.</td></tr>` +
    `</table></td></tr></table></body></html>`
  const textBody =
    `${title}\n\nHi ${fullName.trim().split(/\s+/)[0] || "there"}, here is what was covered.\n\n${summary}\n\n` +
    `Open the workspace: ${WORKSPACE_URL}\n\n` +
    `This summary was written by AI notes and may contain mistakes. It was sent to the host and the colleagues who joined. Do not forward it outside RideArrivo.`
  return { html, text: textBody }
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
    !sameSecret(authorization, `Bearer ${dispatchSecret}`)
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
    // Nothing we can do - leave rows pending so a future run
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
    const isBirthday = row.type === "birthday"
    const displayName = employee.full_name || String(employee.email).split("@")[0]
    const card = isBirthday
      ? birthdayEmail(displayName)
      : row.type === "room_minutes" && body
        ? minutesEmail(title, body, displayName)
        : row.type === "ribbon_digest" && body
          ? ribbonDigestEmail(title, body, displayName)
          : null

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
          ...(card ? { text: card.text } : {}),
          html: card ? card.html :
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

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
