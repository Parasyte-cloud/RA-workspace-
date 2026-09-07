import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  MAX_BODY_BYTES,
  clientSchema,
  validateSubmission,
} from "./validation.mjs"

const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || ""
const rateSecret = Deno.env.get("INTAKE_RATE_LIMIT_SECRET") || ""
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const productionOrigins = new Set([
  "https://ridearrivo.com",
  "https://www.ridearrivo.com",
  "https://intranet.ridearrivo.com",
])

const allowLocalOrigins =
  Deno.env.get("INTAKE_ALLOW_LOCAL_ORIGINS") === "true"

function originAllowed(origin: string) {
  if (!origin) return true
  if (productionOrigins.has(origin)) return true
  if (!allowLocalOrigins) return false
  try {
    const url = new URL(origin)
    return url.hostname === "127.0.0.1" || url.hostname === "localhost"
  } catch {
    return false
  }
}

function cors(req: Request) {
  const origin = req.headers.get("Origin") || ""
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  }
  if (origin && originAllowed(origin)) headers["Access-Control-Allow-Origin"] = origin
  return headers
}

function json(req: Request, body: unknown, status = 200, requestId?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(requestId ? { "X-Request-ID": requestId } : {}),
    },
  })
}

type Actor = { id: string; role: string; email: string }

async function workspaceActor(req: Request, requestId: string): Promise<Actor | null> {
  const header = req.headers.get("Authorization") || ""
  if (!header.startsWith("Bearer ")) return null
  const token = header.slice(7).trim()
  if (!token) return null

  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return null

  const byId = await admin
    .from("employee_profiles")
    .select("id,email,role,active")
    .eq("id", user.id)
    .maybeSingle()

  let profile = byId.data
  if (byId.error) {
    console.error(requestId, "intake profile lookup failed", byId.error.message)
    return null
  }

  if (!profile) {
    const email = String(user.email || "").trim().toLowerCase()
    if (!email.endsWith("@ridearrivo.com")) return null
    const fallback = await admin
      .from("employee_profiles")
      .select("id,email,role,active")
      .ilike("email", email)
      .maybeSingle()
    if (fallback.error) {
      console.error(requestId, "intake profile email fallback failed", fallback.error.message)
      return null
    }
    profile = fallback.data
  }

  if (!profile?.active) return null
  return {
    id: String(profile.id),
    role: String(profile.role || "").toLowerCase(),
    email: String(profile.email || user.email || "").toLowerCase(),
  }
}

async function canAccessRoute(actor: Actor, workstation: string, assignee: string | null) {
  if (actor.role === "manager" || actor.role === "admin") return true
  if (assignee && actor.id === assignee) return true
  const { data, error } = await admin
    .from("workspace_workstation_assignments")
    .select("id")
    .eq("employee_id", actor.id)
    .eq("workstation", workstation)
    .eq("active", true)
    .limit(1)
    .maybeSingle()
  return !error && Boolean(data)
}

async function loadForm(input: { slug: string; scope: "public" | "internal"; actor: Actor | null }) {
  const slugColumn = input.scope === "public" ? "public_slug" : "slug"
  const formResult = await admin
    .from("intake_forms")
    .select("id,category_id,slug,public_slug,destination_workstation,default_assignee_id,visibility,lifecycle_status,published_version_id")
    .eq(slugColumn, input.slug)
    .maybeSingle()

  if (formResult.error || !formResult.data) return null
  const form = formResult.data
  if (form.lifecycle_status !== "published" || !form.published_version_id) return null
  if (input.scope === "public" && form.visibility !== "public") return null
  if (input.scope === "internal" && form.visibility !== "internal") return null

  if (input.scope === "internal") {
    if (!input.actor) return null
    if (!(await canAccessRoute(input.actor, form.destination_workstation, form.default_assignee_id))) return null
  }

  const [categoryResult, versionResult] = await Promise.all([
    admin
      .from("intake_categories")
      .select("id,slug,title,active")
      .eq("id", form.category_id)
      .maybeSingle(),
    admin
      .from("intake_form_versions")
      .select("id,form_id,version_number,title,description,field_schema,published_at")
      .eq("id", form.published_version_id)
      .eq("form_id", form.id)
      .maybeSingle(),
  ])

  if (categoryResult.error || versionResult.error) return null
  if (!categoryResult.data?.active || !versionResult.data?.published_at) return null
  return { form, category: categoryResult.data, version: versionResult.data }
}

async function hmacKey(value: string) {
  if (rateSecret.length < 32) throw new Error("INTAKE_RATE_LIMIT_SECRET must contain at least 32 characters.")
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(rateSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function clientAddress(req: Request) {
  return String(
    req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0] ||
      "unknown",
  ).trim()
}

async function consumeRateLimit(req: Request, formId: string, actor: Actor | null) {
  const identity = actor ? `actor:${actor.id}` : `ip:${clientAddress(req)}`
  const keyHash = await hmacKey(`intake:${formId}:${identity}`)
  const limit = actor ? 60 : 10
  const { data, error } = await admin.rpc("consume_intake_rate_limit", {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: 600,
  })
  if (error) throw new Error(`Rate limiter failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return Boolean(row?.allowed)
}

async function canLinkWhatsApp(actor: Actor | null, conversationId: string) {
  if (!actor) return false
  if (["support", "operations", "manager", "admin"].includes(actor.role)) {
    const found = await admin
      .from("support_whatsapp_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle()
    return !found.error && Boolean(found.data)
  }
  const assignment = await admin
    .from("workspace_workstation_assignments")
    .select("id")
    .eq("employee_id", actor.id)
    .eq("workstation", "support")
    .eq("active", true)
    .limit(1)
    .maybeSingle()
  if (assignment.error || !assignment.data) return false
  const found = await admin
    .from("support_whatsapp_conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle()
  return !found.error && Boolean(found.data)
}

serve(async (req) => {
  const requestId = crypto.randomUUID()
  try {
    if (!originAllowed(req.headers.get("Origin") || "")) {
      return json(req, { error: "Origin not allowed." }, 403, requestId)
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(req) })
    }

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(requestId, "Supabase service configuration missing")
      return json(req, { error: "Intake service is unavailable." }, 503, requestId)
    }

    const url = new URL(req.url)
    const scope = url.searchParams.get("scope") === "internal" ? "internal" : "public"
    const actor = await workspaceActor(req, requestId)

    if (scope === "internal" && !actor) {
      return json(req, { error: "Authenticated RideArrivo workspace access is required." }, 401, requestId)
    }

    if (req.method === "GET") {
      const slug = String(url.searchParams.get("slug") || "").trim().toLowerCase()
      if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
        return json(req, { error: "A valid form slug is required." }, 400, requestId)
      }
      const loaded = await loadForm({ slug, scope, actor })
      if (!loaded) return json(req, { error: "Form not found." }, 404, requestId)
      const schema = clientSchema(loaded.version.field_schema)
      if (!schema.ok) return json(req, { error: "Published form schema is invalid." }, 500, requestId)
      return json(req, {
        form: {
          slug: scope === "public" ? loaded.form.public_slug : loaded.form.slug,
          title: loaded.version.title,
          description: loaded.version.description,
          category: { slug: loaded.category.slug, title: loaded.category.title },
          version: loaded.version.version_number,
          fields: schema.fields,
        },
      }, 200, requestId)
    }

    if (req.method !== "POST") {
      return json(req, { error: "Method not allowed." }, 405, requestId)
    }

    const contentLength = Number(req.headers.get("content-length") || "0")
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return json(req, { error: "Request body is too large." }, 413, requestId)
    }

    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json(req, { error: "Request body is too large." }, 413, requestId)
    }

    let body: Record<string, unknown>
    try {
      const parsed = JSON.parse(rawBody || "{}")
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape")
      body = parsed
    } catch {
      return json(req, { error: "Invalid JSON body." }, 400, requestId)
    }

    const slug = String(body.slug || "").trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
      return json(req, { error: "A valid form slug is required." }, 400, requestId)
    }

    if (typeof body.website === "string" && body.website.trim()) {
      return json(req, { ok: true }, 202, requestId)
    }

    const loaded = await loadForm({ slug, scope, actor })
    if (!loaded) return json(req, { error: "Form not found." }, 404, requestId)

    if (!(await consumeRateLimit(req, loaded.form.id, actor))) {
      return json(req, { error: "Too many submissions. Please try again later." }, 429, requestId)
    }

    const validation = validateSubmission(loaded.version.field_schema, body.payload)
    if (!validation.ok) {
      return json(req, { error: "Submission validation failed.", fields: validation.errors }, 422, requestId)
    }

    let whatsappConversationId: string | null = null
    if (body.whatsappConversationId !== undefined && body.whatsappConversationId !== null) {
      if (scope !== "internal") {
        return json(req, { error: "Public submissions cannot link WhatsApp conversations." }, 403, requestId)
      }
      const candidate = String(body.whatsappConversationId).trim()
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) {
        return json(req, { error: "Invalid WhatsApp conversation identifier." }, 400, requestId)
      }
      if (!(await canLinkWhatsApp(actor, candidate))) {
        return json(req, { error: "WhatsApp conversation access is not authorised." }, 403, requestId)
      }
      whatsappConversationId = candidate
    }

    const sourceReference = crypto.randomUUID()
    const insert = await admin
      .from("intake_submissions")
      .insert({
        form_id: loaded.form.id,
        payload: validation.value,
        source: scope === "public" ? "public_form" : "workspace_form",
        source_reference: sourceReference,
        submitted_by_user_id: actor?.id || null,
        whatsapp_conversation_id: whatsappConversationId,
      })
      .select("id,status,submitted_at")
      .single()

    if (insert.error || !insert.data) {
      console.error(requestId, "intake submission insert failed", insert.error?.message || "missing row")
      return json(req, { error: "Unable to create submission." }, 500, requestId)
    }

    return json(req, {
      ok: true,
      submission: {
        id: insert.data.id,
        reference: sourceReference,
        status: insert.data.status,
        submittedAt: insert.data.submitted_at,
      },
    }, 201, requestId)
  } catch (error) {
    console.error(requestId, "intake service failure", error instanceof Error ? error.message : String(error))
    return json(req, { error: "Intake service failed safely." }, 500, requestId)
  }
})
