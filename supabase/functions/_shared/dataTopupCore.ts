// Core of the data-topup Edge Function: buys each person's daily bundle into their own MTN number.
//
// Kept free of Deno-only imports so Node tests can drive it with a fake database and a fake reseller.
//
// The rules that protect your money:
//   1. Nothing is bought unless the database hands the number out (it checks the master switch,
//      the daily spend cap, the pool and one-delivery-per-person-per-day under a lock).
//   2. An answer we cannot read (timeout, network error, server error, unknown shape) is "pending",
//      never "failed". A pending delivery is asked about again, never bought again.
//   3. Only an explicit refusal from the reseller counts as "failed", and only then may the next run retry.
//   4. A low wallet stops the whole run: the rest are handed back untouched.

export type RpcResult = { data: unknown; error: { message: string } | null }
export type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>

export type Outcome = {
  status: "delivered" | "pending" | "failed"
  code: string
  ref: string | null
  amount: number | null
  message: string
  // The wallet is empty or the credentials are wrong: stop buying for everyone.
  stop?: boolean
}

export type Claimed = {
  id: string
  employee_id: string
  msisdn: string
  variation: string
  request_id: string
  tier_code: string
  bytes: number
  price_ngn: number
}

export type Provider = {
  buy(row: Claimed): Promise<Outcome>
  requery(requestId: string): Promise<Outcome>
}

// ---- formatting helpers -------------------------------------------------------------------------

// The reseller wants request ids that start with the current Lagos date and time: YYYYMMDDHHII.
export function lagosStamp(now: Date): string {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000) // Africa/Lagos is UTC+1 all year
  const p = (n: number) => String(n).padStart(2, "0")
  return `${lagos.getUTCFullYear()}${p(lagos.getUTCMonth() + 1)}${p(lagos.getUTCDate())}${p(lagos.getUTCHours())}${p(lagos.getUTCMinutes())}`
}

// ---- reading the reseller's answer --------------------------------------------------------------

const LOW_WALLET_CODES = new Set(["018"]) // insufficient wallet balance
const AUTH_CODES = new Set(["012", "013", "014"]) // product, key or account problems that will not fix themselves

function text(v: unknown, max = 240): string {
  return typeof v === "string" ? v.slice(0, max) : ""
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

// VTpass answers HTTP 200 with { code, response_description, content: { transactions: { status, transactionId, amount } } }.
export function interpretProviderAnswer(httpStatus: number, body: unknown): Outcome {
  if (httpStatus >= 500 || httpStatus === 408 || httpStatus === 429) {
    return { status: "pending", code: String(httpStatus), ref: null, amount: null, message: `Reseller error ${httpStatus}, will re-check` }
  }
  if (!body || typeof body !== "object") {
    return { status: "pending", code: String(httpStatus), ref: null, amount: null, message: "Unreadable answer from the reseller, will re-check" }
  }
  const b = body as Record<string, unknown>
  const code = typeof b.code === "string" || typeof b.code === "number" ? String(b.code) : ""
  const description = text(b.response_description)
  const content = (b.content && typeof b.content === "object" ? b.content : {}) as Record<string, unknown>
  const tx = (content.transactions && typeof content.transactions === "object" ? content.transactions : {}) as Record<string, unknown>
  const state = text(tx.status, 40).toLowerCase()
  const ref = text(tx.transactionId, 120) || text(b.requestId, 120) || null
  const amount = num(tx.amount) ?? num(b.amount)

  if (state === "delivered") {
    return { status: "delivered", code, ref, amount, message: description || "Delivered" }
  }
  if (state === "failed" || state === "reversed") {
    return { status: "failed", code, ref, amount: null, message: description || "The reseller could not deliver", stop: LOW_WALLET_CODES.has(code) || AUTH_CODES.has(code) }
  }
  if (state === "pending" || state === "initiated" || code === "099") {
    return { status: "pending", code, ref, amount, message: description || "Processing" }
  }
  if (code === "000") {
    // Accepted but not yet confirmed as delivered: wait and ask again.
    return { status: "pending", code, ref, amount, message: description || "Accepted, waiting for confirmation" }
  }
  if (code === "") {
    return { status: "pending", code, ref: null, amount: null, message: "Unknown answer from the reseller, will re-check" }
  }
  // Any other code is the reseller refusing the request, so nothing was bought.
  return { status: "failed", code, ref: null, amount: null, message: description || `Refused (${code})`, stop: LOW_WALLET_CODES.has(code) || AUTH_CODES.has(code) }
}

// ---- VTpass -----------------------------------------------------------------------------------------

export type VtpassConfig = {
  env: "sandbox" | "live"
  apiKey: string
  secretKey: string
  publicKey?: string
}

export function vtpassBase(env: "sandbox" | "live") {
  return env === "live" ? "https://vtpass.com" : "https://sandbox.vtpass.com"
}

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<{ status: number; json(): Promise<unknown> }>

async function callJson(fetchImpl: FetchLike, url: string, init: Record<string, unknown>, timeoutMs = 25000): Promise<Outcome | { status: number; body: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal })
    let body: unknown = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, body }
  } catch {
    // Network failure or timeout: we do not know whether the order went through.
    return { status: "pending", code: "network", ref: null, amount: null, message: "No answer from the reseller, will re-check" }
  } finally {
    clearTimeout(timer)
  }
}

export function vtpassProvider(cfg: VtpassConfig, fetchImpl: FetchLike): Provider {
  const base = vtpassBase(cfg.env)
  const headers = { "Content-Type": "application/json", "api-key": cfg.apiKey, "secret-key": cfg.secretKey }

  const settle = (r: Outcome | { status: number; body: unknown }): Outcome =>
    typeof (r as Outcome).code === "string" && typeof (r as Outcome).status === "string"
      ? (r as Outcome)
      : interpretProviderAnswer((r as { status: number }).status, (r as { body: unknown }).body)

  return {
    async buy(row) {
      const r = await callJson(fetchImpl, `${base}/api/pay`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          request_id: row.request_id,
          serviceID: "mtn-data",
          billersCode: row.msisdn,
          variation_code: row.variation,
          phone: row.msisdn,
        }),
      })
      return settle(r)
    },
    async requery(requestId) {
      const r = await callJson(fetchImpl, `${base}/api/requery`, {
        method: "POST",
        headers,
        body: JSON.stringify({ request_id: requestId }),
      })
      return settle(r)
    },
  }
}

export type Variation = { code: string; name: string; price: number }

export async function fetchVtpassVariations(cfg: VtpassConfig, fetchImpl: FetchLike): Promise<Variation[]> {
  if (!cfg.publicKey) throw new Error("VTPASS_PUBLIC_KEY is not set")
  const r = await callJson(fetchImpl, `${vtpassBase(cfg.env)}/api/service-variations?serviceID=mtn-data`, {
    method: "GET",
    headers: { "api-key": cfg.apiKey, "public-key": cfg.publicKey },
  }, 20000)
  if (!("body" in r)) throw new Error("The reseller did not answer. Try again.")
  const content = ((r.body as Record<string, unknown> | null)?.content ?? {}) as Record<string, unknown>
  const list = (content.variations ?? content.varations ?? []) as unknown
  if (!Array.isArray(list)) throw new Error("The reseller sent an unreadable list of bundles.")
  const seen = new Set<string>()
  const out: Variation[] = []
  for (const v of list) {
    const item = v as Record<string, unknown>
    const code = text(item.variation_code, 80)
    const price = num(item.variation_amount)
    if (!code || price === null || seen.has(code)) continue
    seen.add(code)
    out.push({ code, name: text(item.name, 160), price })
  }
  return out
}

// ---- the run ---------------------------------------------------------------------------------------

export type RunSummary = {
  requeried: number
  delivered: number
  pending: number
  failed: number
  skipped: number
  stopped: string | null
}

type Deps = {
  rpc: Rpc
  provider: Provider
  now?: () => Date
  log?: (line: string) => void
  limit?: number
  concurrency?: number
}

async function record(rpc: Rpc, id: string, o: Outcome) {
  const { error } = await rpc("topup_complete", {
    p_id: id,
    p_status: o.status,
    p_ref: o.ref,
    p_amount: o.amount,
    p_message: o.message,
  })
  if (error) throw new Error(`could not record the outcome: ${error.message}`)
}

export async function runTopups(deps: Deps): Promise<RunSummary> {
  const log = deps.log ?? (() => {})
  const now = deps.now ?? (() => new Date())
  const summary: RunSummary = { requeried: 0, delivered: 0, pending: 0, failed: 0, skipped: 0, stopped: null }
  const count = (o: Outcome) => { summary[o.status] += 1 }

  // 1. Ask about anything still waiting, before buying anything new.
  const waiting = await deps.rpc("topup_pending", { p_limit: 100 })
  if (waiting.error) throw new Error(`could not list waiting deliveries: ${waiting.error.message}`)
  for (const w of (Array.isArray(waiting.data) ? waiting.data : []) as { id: string; request_id: string }[]) {
    const o = await deps.provider.requery(w.request_id)
    summary.requeried += 1
    // Asking again must never turn a waiting delivery into a failure: the reseller may simply not
    // know the id yet. Only a delivery confirmation changes it; a failure needs the administrator.
    if (o.status === "delivered") {
      await record(deps.rpc, w.id, o)
      summary.delivered += 1
    } else {
      log(`data-topup: ${w.request_id} still ${o.status} (${o.code})`)
    }
  }

  // 2. Reserve today's deliveries in the database, then buy them.
  const stamp = lagosStamp(now())
  const claimed = await deps.rpc("topup_claim_batch", { p_stamp: stamp, p_limit: deps.limit ?? 40 })
  if (claimed.error) throw new Error(`could not reserve deliveries: ${claimed.error.message}`)
  const rows = (Array.isArray(claimed.data) ? claimed.data : []) as Claimed[]

  const concurrency = Math.max(1, Math.min(deps.concurrency ?? 4, 8))
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= rows.length) return
      const row = rows[i]
      if (summary.stopped) {
        await deps.rpc("topup_complete", { p_id: row.id, p_status: "skipped", p_ref: null, p_amount: null, p_message: `Not attempted: ${summary.stopped}` })
        summary.skipped += 1
        continue
      }
      let o: Outcome
      try {
        o = await deps.provider.buy(row)
      } catch (e) {
        o = { status: "pending", code: "error", ref: null, amount: null, message: `Unexpected error, will re-check: ${e instanceof Error ? e.message : "unknown"}`.slice(0, 240) }
      }
      try {
        await record(deps.rpc, row.id, o)
      } catch (e) {
        log(`data-topup: ${row.request_id} bought but not recorded: ${e instanceof Error ? e.message : "unknown"}`)
      }
      count(o)
      if (o.stop && !summary.stopped) {
        summary.stopped = o.message || "the reseller refused every purchase"
        log(`data-topup: stopping the run: ${summary.stopped}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()))
  return summary
}
