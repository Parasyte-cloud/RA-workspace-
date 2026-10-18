// data-radius: the HTTP side of the office FreeRADIUS server (rlm_rest).
//
//   POST /authenticate   username + password check, then today's remaining data
//   POST /accounting     usage counters from the gateway, debited from the daily allowance
//   GET  /over-quota     open sessions that must be disconnected now (polled by the enforcer)
//   GET  /health         shared-secret check
//
// Not a browser endpoint: no JWT (FreeRADIUS has none), no CORS. Every request must carry
// the shared secret in X-Radius-Secret. Set it with:
//   supabase secrets set DATA_RADIUS_SECRET="$(openssl rand -hex 32)"
// and put the same value in /etc/freeradius/3.0/ra-data.secret on the RADIUS server.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleRadius } from "../_shared/dataRadiusCore.ts"

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => { query[key] = value })

  let body: unknown = null
  if (req.method === "POST") {
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: "bad_json" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const result = await handleRadius(
    {
      method: req.method,
      path: url.pathname,
      query,
      secretHeader: req.headers.get("x-radius-secret"),
      body,
    },
    {
      secret: Deno.env.get("DATA_RADIUS_SECRET") || undefined,
      rpc: (name, args) => admin.rpc(name, args),
      log: (line) => console.error(line),
    },
  )

  if (result.status === 204) return new Response(null, { status: 204 })
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  })
})
