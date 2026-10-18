// data-topup: buys each person's daily data bundle into their own MTN number.
//
//   POST {"action":"run"}         the daily delivery (cron, or an administrator pressing Run now)
//   POST {"action":"variations"}  the reseller's MTN bundle list, so an administrator can pick one per plan
//   POST {"action":"status"}      whether the reseller keys are set and whether this is sandbox or live
//
// Who may call it:
//   * the daily schedule, with the same cron secret the other scheduled functions use, or
//   * a signed-in workspace administrator (checked by asking the database as that person).
//
// Secrets (set them yourself, they never go in git or chat):
//   supabase secrets set VTPASS_API_KEY=... VTPASS_SECRET_KEY=... VTPASS_PUBLIC_KEY=...
//   supabase secrets set VTPASS_ENV=sandbox      # change to live only when you are ready to spend real money
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { adminClient, authenticate, cors, HttpError, json } from "../_shared/roomAiAuth.ts"
import { constantTimeEqual } from "../_shared/dataRadiusCore.ts"
import { fetchVtpassVariations, runTopups, vtpassProvider, type VtpassConfig } from "../_shared/dataTopupCore.ts"

function config(): VtpassConfig | null {
  const apiKey = Deno.env.get("VTPASS_API_KEY") || ""
  const secretKey = Deno.env.get("VTPASS_SECRET_KEY") || ""
  if (!apiKey || !secretKey) return null
  return {
    env: (Deno.env.get("VTPASS_ENV") || "sandbox").toLowerCase() === "live" ? "live" : "sandbox",
    apiKey,
    secretKey,
    publicKey: Deno.env.get("VTPASS_PUBLIC_KEY") || undefined,
  }
}

async function callerIsCron(req: Request) {
  const secret = Deno.env.get("CRON_DISPATCH_SECRET") || ""
  const header = req.headers.get("Authorization") || ""
  return !!secret && constantTimeEqual(header, `Bearer ${secret}`)
}

async function requireAdmin(req: Request) {
  const admin = adminClient()
  await authenticate(req, admin)
  const url = Deno.env.get("SUPABASE_URL")!
  const anon = Deno.env.get("SUPABASE_ANON_KEY")
  if (!anon) throw new HttpError(500, "Server is not configured.")
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Only administrators get an answer from this function.
  const { error } = await asUser.rpc("admin_data_topup_overview")
  if (error) throw new HttpError(403, "Administrator access is required.")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json(405, { error: "Use POST." })

  try {
    const cron = await callerIsCron(req)
    if (!cron) await requireAdmin(req)

    let action = "run"
    try {
      const body = await req.json()
      if (body && typeof body.action === "string") action = body.action
    } catch {
      /* an empty body means run */
    }

    const cfg = config()

    if (action === "status") {
      return json(200, { configured: !!cfg, env: cfg?.env ?? null, can_list_bundles: !!cfg?.publicKey })
    }
    if (!cfg) return json(503, { error: "Reseller keys are not set. See docs/data-allocation.md." })

    if (action === "variations") {
      if (cron) return json(403, { error: "Not available to the schedule." })
      return json(200, { variations: await fetchVtpassVariations(cfg, fetch as never) })
    }

    if (action !== "run") return json(400, { error: "Unknown action." })

    const admin = adminClient()
    const summary = await runTopups({
      rpc: (name, args) => admin.rpc(name, args),
      provider: vtpassProvider(cfg, fetch as never),
      log: (line) => console.log(line),
    })
    return json(200, { env: cfg.env, ...summary })
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message })
    console.error("data-topup failed", e instanceof Error ? e.message : e)
    return json(500, { error: e instanceof Error ? e.message : "Delivery run failed." })
  }
})
