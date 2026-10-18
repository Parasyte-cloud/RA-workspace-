// Core of the data-radius Edge Function: turns FreeRADIUS (rlm_rest) requests into calls
// to the radius_* database functions, and database answers into RADIUS replies.
//
// Kept free of Deno-only imports so Node tests can drive it directly.
//
// Fail-closed rule: if the database cannot be reached the answer is HTTP 503, which
// rlm_rest treats as a module failure. FreeRADIUS then does not accept the login and the
// gateway keeps retrying accounting, so nobody gets free data and no usage is lost.

export type RpcResult = { data: unknown; error: { message: string } | null }
export type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>

export type RadiusRequest = {
  method: string
  path: string
  query?: Record<string, string>
  secretHeader: string | null
  body: unknown
}

export type RadiusResponse = { status: number; body: unknown }

export type Deps = {
  rpc: Rpc
  secret: string | undefined
  log?: (line: string) => void
}

const GIGAWORD = 4294967296 // 2^32
const MAX_SAFE = Number.MAX_SAFE_INTEGER

const STATUS_NAMES: Record<string, string> = {
  "1": "Start",
  "2": "Stop",
  "3": "Interim-Update",
  "7": "Accounting-On",
  "8": "Accounting-Off",
  start: "Start",
  stop: "Stop",
  "interim-update": "Interim-Update",
  "accounting-on": "Accounting-On",
  "accounting-off": "Accounting-Off",
}

export function constantTimeEqual(a: string, b: string) {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  // always walk the longer one so length differences take the same time as content ones
  const len = Math.max(x.length, y.length)
  let diff = x.length ^ y.length
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

// FreeRADIUS sends {"User-Name": {"type":"string","value":["alice"]}, ...}.
// Plain {"User-Name":"alice"} is accepted too so the endpoint is easy to test by hand.
export function readAttributes(body: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!body || typeof body !== "object" || Array.isArray(body)) return out
  for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
    let value: unknown = raw
    if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in (raw as object)) {
      value = (raw as { value: unknown }).value
    }
    if (Array.isArray(value)) value = value[0]
    if (value === null || value === undefined) continue
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key.toLowerCase()] = String(value)
    }
  }
  return out
}

function counter(octets: string | undefined, gigawords: string | undefined): number | null {
  const lo = octets === undefined || octets === "" ? 0 : Number(octets)
  const hi = gigawords === undefined || gigawords === "" ? 0 : Number(gigawords)
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi < 0 || lo >= GIGAWORD) return null
  const total = hi * GIGAWORD + lo
  return Number.isSafeInteger(total) && total <= MAX_SAFE ? total : null
}

function clean(value: string | undefined, max: number) {
  return (value ?? "").trim().slice(0, max)
}

const REJECT_MESSAGES: Record<string, string> = {
  quota_exhausted: "Today's data allowance is used up. It resets at midnight.",
  suspended: "Your data plan is suspended. Contact Administration.",
  no_plan: "No data plan is assigned to you. Contact Administration.",
  pool_exhausted: "The company data pool is empty. Contact Administration.",
  locked: "Too many wrong attempts. Try again in 15 minutes.",
}

function attr(value: string | number) {
  return { value: [value], op: ":=" }
}

export function authReply(
  result: { remaining_bytes: number; session_timeout: number },
  vendor: string,
  interimSeconds: number,
) {
  const reply: Record<string, unknown> = {
    "reply:Session-Timeout": attr(Math.max(60, Math.floor(result.session_timeout))),
    "reply:Acct-Interim-Interval": attr(interimSeconds),
  }
  if (vendor === "mikrotik") {
    const remaining = Math.max(0, Math.floor(result.remaining_bytes))
    // The attribute is a 32-bit count of bytes; the Gigawords attribute carries the multiples of 2^32.
    reply["reply:Mikrotik-Total-Limit"] = attr(remaining % GIGAWORD)
    reply["reply:Mikrotik-Total-Limit-Gigawords"] = attr(Math.floor(remaining / GIGAWORD))
  }
  return reply
}

function json(status: number, body: unknown): RadiusResponse {
  return { status, body }
}

export async function handleRadius(req: RadiusRequest, deps: Deps): Promise<RadiusResponse> {
  const log = deps.log ?? (() => {})

  if (!deps.secret) {
    log("data-radius: DATA_RADIUS_SECRET is not configured, refusing every request")
    return json(503, { error: "not_configured" })
  }
  if (!req.secretHeader || !constantTimeEqual(req.secretHeader, deps.secret)) {
    return json(401, { error: "unauthorized" })
  }

  const route = req.path.replace(/\/+$/, "").split("/").pop() ?? ""
  const method = req.method.toUpperCase()

  if (route === "health" && method === "GET") {
    return json(200, { ok: true })
  }

  if (route === "over-quota" && method === "GET") {
    // Close sessions that stopped reporting first, so the list only holds live ones.
    await deps.rpc("radius_close_stale_sessions", {})
    const { data, error } = await deps.rpc("radius_over_quota", {})
    if (error) {
      log(`data-radius over-quota failed: ${error.message}`)
      return json(503, { error: "database_unavailable" })
    }
    return json(200, { sessions: Array.isArray(data) ? data : [] })
  }

  if (method !== "POST") return json(405, { error: "method_not_allowed" })

  const a = readAttributes(req.body)

  if (route === "authenticate") {
    const username = clean(a["user-name"], 254)
    const password = a["user-password"] ?? ""
    if (!username || !password || password.length > 256) {
      return json(401, { "reply:Reply-Message": "Access denied" })
    }

    const { data, error } = await deps.rpc("radius_verify", { p_username: username, p_password: password })
    if (error || !data || typeof data !== "object") {
      log(`data-radius authenticate failed: ${error?.message ?? "empty answer"}`)
      return json(503, { error: "database_unavailable" })
    }
    const result = data as {
      ok: boolean
      reason?: string
      remaining_bytes: number
      session_timeout: number
    }

    if (!result.ok) {
      log(`data-radius reject ${username}: ${result.reason}`)
      return json(401, {
        "reply:Reply-Message": REJECT_MESSAGES[result.reason ?? ""] ?? "Access denied",
      })
    }

    const vendor = (req.query?.vendor ?? "generic").toLowerCase()
    const interim = Math.min(Math.max(Number(req.query?.interim) || 60, 30), 600)
    return json(200, authReply(result, vendor, interim))
  }

  if (route === "accounting") {
    const status = STATUS_NAMES[(a["acct-status-type"] ?? "").toLowerCase()]
    if (!status) return json(204, null) // Accounting-Failed and unknown types: acknowledge and ignore

    const input = counter(a["acct-input-octets"], a["acct-input-gigawords"])
    const output = counter(a["acct-output-octets"], a["acct-output-gigawords"])
    if (input === null || output === null) {
      log("data-radius accounting: counters out of range, acknowledged without charging")
      return json(204, null)
    }

    const { error } = await deps.rpc("radius_account", {
      p_username: clean(a["user-name"], 254),
      p_status: status,
      p_session_id: clean(a["acct-session-id"], 128),
      p_input_octets: input,
      p_output_octets: output,
      p_nas_ip: clean(a["nas-ip-address"], 64),
      p_nas_identifier: clean(a["nas-identifier"], 128),
      p_framed_ip: clean(a["framed-ip-address"], 64),
      p_calling_station: clean(a["calling-station-id"], 64),
    })
    if (error) {
      // 5xx makes FreeRADIUS withhold its Accounting-Response, so the NAS resends the packet.
      log(`data-radius accounting failed: ${error.message}`)
      return json(503, { error: "database_unavailable" })
    }
    return json(204, null)
  }

  return json(404, { error: "not_found" })
}
