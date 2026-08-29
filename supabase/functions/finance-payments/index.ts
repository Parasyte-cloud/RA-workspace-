import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const allowedOrigin = "https://intranet.ridearrivo.com"

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || ""
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  })
}

function clampDays(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 30
  return Math.max(1, Math.min(90, Math.trunc(number)))
}

function yyyyMmDd(date: Date) {
  return date.toISOString().slice(0, 10)
}

async function providerJson(url: string, secret: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${secret}`,
      "Accept": "application/json",
    },
  })

  const text = await response.text()
  let payload: any = {}

  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = {}
  }

  if (!response.ok) {
    const message = String(payload?.message || payload?.error || `Provider request failed (${response.status}).`)
    throw new Error(message)
  }

  return payload
}

function paystackTransaction(row: any) {
  return {
    id: String(row?.id ?? ""),
    reference: String(row?.reference || ""),
    amount: Number(row?.amount || 0) / 100,
    currency: String(row?.currency || "NGN"),
    status: String(row?.status || "unknown"),
    channel: String(row?.channel || ""),
    customer: String(row?.customer?.email || ""),
    occurred_at: row?.paid_at || row?.created_at || null,
  }
}

function paystackSettlement(row: any) {
  return {
    id: String(row?.id ?? ""),
    reference: String(row?.settlement_date || row?.id || ""),
    amount: Number(row?.total_amount || row?.effective_amount || 0) / 100,
    currency: String(row?.currency || "NGN"),
    status: String(row?.status || "unknown"),
    occurred_at: row?.settlement_date || row?.createdAt || null,
  }
}

function flutterwaveTransaction(row: any) {
  return {
    id: String(row?.id ?? ""),
    reference: String(row?.tx_ref || row?.flw_ref || ""),
    amount: Number(row?.amount || row?.charged_amount || 0),
    currency: String(row?.currency || "NGN"),
    status: String(row?.status || "unknown"),
    channel: String(row?.payment_type || ""),
    customer: String(row?.customer?.email || row?.customer_email || ""),
    occurred_at: row?.created_at || null,
  }
}

function flutterwaveSettlement(row: any) {
  return {
    id: String(row?.id ?? ""),
    reference: String(row?.settlement_ref || row?.id || ""),
    amount: Number(row?.amount_settled || row?.amount || 0),
    currency: String(row?.currency || "NGN"),
    status: String(row?.status || "unknown"),
    occurred_at: row?.date_settled || row?.created_at || null,
  }
}

async function loadPaystack(secret: string, from: string, to: string) {
  const query = new URLSearchParams({
    perPage: "20",
    page: "1",
    from,
    to,
  })

  const [transactionsPayload, settlementsPayload, totalsPayload] = await Promise.all([
    providerJson(`https://api.paystack.co/transaction?${query.toString()}`, secret),
    providerJson(`https://api.paystack.co/settlement?${query.toString()}`, secret),
    providerJson(`https://api.paystack.co/transaction/totals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, secret),
  ])

  const transactions = Array.isArray(transactionsPayload?.data)
    ? transactionsPayload.data.map(paystackTransaction)
    : []
  const settlements = Array.isArray(settlementsPayload?.data)
    ? settlementsPayload.data.map(paystackSettlement)
    : []

  return {
    configured: true,
    transactions,
    settlements,
    totals: totalsPayload?.data || null,
  }
}

async function loadFlutterwave(secret: string, from: string, to: string) {
  const transactionQuery = new URLSearchParams({
    from,
    to,
    page: "1",
  })

  const settlementQuery = new URLSearchParams({
    from,
    to,
    page: "1",
  })

  const [transactionsPayload, settlementsPayload] = await Promise.all([
    providerJson(`https://api.flutterwave.com/v3/transactions?${transactionQuery.toString()}`, secret),
    providerJson(`https://api.flutterwave.com/v3/settlements?${settlementQuery.toString()}`, secret),
  ])

  const transactions = Array.isArray(transactionsPayload?.data)
    ? transactionsPayload.data.slice(0, 20).map(flutterwaveTransaction)
    : []
  const settlements = Array.isArray(settlementsPayload?.data)
    ? settlementsPayload.data.slice(0, 20).map(flutterwaveSettlement)
    : []

  return {
    configured: true,
    transactions,
    settlements,
    totals: null,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) })
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405)
  }

  const authorization = req.headers.get("Authorization")
  if (!authorization) {
    return json(req, { error: "Missing RideArrivo session." }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("finance-payments: Supabase environment is missing")
    return json(req, { error: "Finance integration service is not configured." }, 500)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = authorization.replace(/^Bearer\s+/i, "")
  const { data: userData, error: userError } = await admin.auth.getUser(token)

  if (userError || !userData?.user) {
    return json(req, { error: "Your RideArrivo session is invalid." }, 401)
  }

  const userId = userData.user.id
  const { data: profile, error: profileError } = await admin
    .from("employee_profiles")
    .select("id,role,active")
    .eq("id", userId)
    .maybeSingle()

  if (profileError || !profile || profile.active !== true) {
    return json(req, { error: "Active employee access is required." }, 403)
  }

  const role = String(profile.role || "employee").toLowerCase()
  let authorised = ["finance", "manager", "admin"].includes(role)

  if (!authorised) {
    const { data: workstation } = await admin
      .from("workspace_workstation_assignments")
      .select("id")
      .eq("employee_id", userId)
      .eq("workstation", "finance")
      .eq("active", true)
      .limit(1)
      .maybeSingle()

    authorised = Boolean(workstation)
  }

  if (!authorised) {
    return json(req, { error: "Finance workstation access is required." }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const days = clampDays(body?.days)
  const toDate = new Date()
  const fromDate = new Date(toDate)
  fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1))
  const from = yyyyMmDd(fromDate)
  const to = yyyyMmDd(toDate)

  const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY") || ""
  const flutterwaveSecret = Deno.env.get("FLUTTERWAVE_SECRET_KEY") || ""

  const [paystackResult, flutterwaveResult] = await Promise.allSettled([
    paystackSecret ? loadPaystack(paystackSecret, from, to) : Promise.resolve({ configured: false, transactions: [], settlements: [], totals: null }),
    flutterwaveSecret ? loadFlutterwave(flutterwaveSecret, from, to) : Promise.resolve({ configured: false, transactions: [], settlements: [], totals: null }),
  ])

  const paystack = paystackResult.status === "fulfilled"
    ? paystackResult.value
    : { configured: true, transactions: [], settlements: [], totals: null, error: paystackResult.reason instanceof Error ? paystackResult.reason.message : "Paystack request failed." }

  const flutterwave = flutterwaveResult.status === "fulfilled"
    ? flutterwaveResult.value
    : { configured: true, transactions: [], settlements: [], totals: null, error: flutterwaveResult.reason instanceof Error ? flutterwaveResult.reason.message : "Flutterwave request failed." }

  return json(req, {
    range: { days, from, to },
    paystack,
    flutterwave,
    generated_at: new Date().toISOString(),
  })
})
