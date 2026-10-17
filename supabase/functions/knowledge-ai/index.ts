// AI Knowledge Manager (admin only).
//
//   POST { action: "status" }                  -> is the AI configured and on?
//   POST { action: "run", topic?: string }     -> research, then queue proposals
//
// The function never publishes anything. It writes proposals to a review queue;
// an administrator approves or rejects each one in the workspace
// (decide_knowledge_ai_proposal). Secrets: ANTHROPIC_API_KEY (required),
// KNOWLEDGE_AI_MODEL (optional, defaults below).
import { adminClient, authenticate, handle, HttpError, json } from "../_shared/roomAiAuth.ts"
import {
  buildSystemPrompt,
  buildUserPrompt,
  cleanProposals,
  collectSeenUrls,
  LIMITS,
  plain,
  SUBMIT_TOOL,
  type ExistingArticle,
} from "../_shared/knowledgeAiCore.ts"

const DEFAULT_MODEL = "claude-sonnet-5-5"
const MAX_SEARCHES = 6
const MAX_RUNS_PER_DAY = 12
const DEADLINE_MS = 125_000

async function requireAdmin(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin.from("employee_profiles").select("role,active").eq("id", userId).maybeSingle()
  if (error) throw new HttpError(500, "Unable to verify your role.")
  if (!data || data.active !== true || data.role !== "admin") {
    throw new HttpError(403, "Only an administrator can use the Knowledge Manager.")
  }
}

async function callModel(apiKey: string, body: unknown, msLeft: number) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(5_000, msLeft)),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error("knowledge-ai model error", res.status, text.slice(0, 300))
    if (res.status === 401) throw new HttpError(502, "The AI key was rejected. Check ANTHROPIC_API_KEY.")
    if (res.status === 429) throw new HttpError(429, "The AI provider is rate limiting. Try again in a minute.")
    throw new HttpError(502, "The AI provider returned an error. Try again.")
  }
  return JSON.parse(text)
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.")
  const admin = adminClient()
  const user = await authenticate(req, admin)
  await requireAdmin(admin, user.id)

  const payload = await req.json().catch(() => ({}))
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || ""
  const model = Deno.env.get("KNOWLEDGE_AI_MODEL") || DEFAULT_MODEL
  const { data: settings } = await admin.from("knowledge_ai_settings").select("enabled,focus").eq("id", true).maybeSingle()

  if (payload.action === "status") {
    return json(200, { configured: Boolean(apiKey), enabled: settings?.enabled !== false, model })
  }
  if (payload.action !== "run") throw new HttpError(400, "Unknown action.")
  if (!apiKey) throw new HttpError(503, "The AI is not configured yet. Set the ANTHROPIC_API_KEY function secret.")
  if (settings && settings.enabled === false) throw new HttpError(409, "The Knowledge Manager is switched off.")

  // Guard rails: one run at a time, and a daily ceiling on cost.
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString()
  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const { count: running } = await admin.from("knowledge_ai_runs").select("id", { count: "exact", head: true })
    .eq("status", "running").gte("created_at", tenMinAgo)
  if ((running ?? 0) > 0) throw new HttpError(409, "A research run is already in progress.")
  const { count: today } = await admin.from("knowledge_ai_runs").select("id", { count: "exact", head: true })
    .gte("created_at", dayAgo)
  if ((today ?? 0) >= MAX_RUNS_PER_DAY) throw new HttpError(429, "Daily research limit reached. Try again tomorrow.")

  const topic = plain(payload.topic, LIMITS.topic)
  const { data: run, error: runErr } = await admin.from("knowledge_ai_runs")
    .insert({ requested_by: user.id, topic, model }).select("id").single()
  if (runErr || !run) throw new HttpError(500, "Could not start the run.")

  const finish = async (patch: Record<string, unknown>) => {
    await admin.from("knowledge_ai_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", run.id)
  }

  try {
    const { data: rows } = await admin.from("workspace_knowledge_articles")
      .select("id,slug,title,summary,category,content,status").neq("status", "archived")
      .order("category").order("title").limit(80)
    const existing = (rows ?? []) as ExistingArticle[]
    const { data: pend } = await admin.from("knowledge_ai_proposals").select("slug").eq("status", "pending")
    const pendingSlugs = new Set((pend ?? []).map((p: { slug: string }) => p.slug))

    const started = Date.now()
    const seen = new Map<string, string>()
    let searches = 0
    const messages: unknown[] = [{ role: "user", content: buildUserPrompt(topic, settings?.focus ?? "", existing) }]
    const tools = [
      { type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES },
      SUBMIT_TOOL,
    ]
    let submitted: { summary?: unknown; proposals?: unknown } | null = null

    for (let turn = 0; turn < 6 && !submitted; turn++) {
      const left = DEADLINE_MS - (Date.now() - started)
      if (left < 8_000) throw new HttpError(504, "Research took too long. Try a narrower request.")
      const forced = turn >= 4
      // A forced tool call cannot follow an assistant message (a paused turn
      // ends on one), so close the exchange with a user message first.
      if (forced && (messages[messages.length - 1] as { role: string }).role === "assistant") {
        messages.push({ role: "user", content: "Research is finished. Call submit_proposals now." })
      }
      const res = await callModel(apiKey, {
        model,
        max_tokens: 8000,
        system: buildSystemPrompt(),
        tools,
        ...(forced ? { tool_choice: { type: "tool", name: SUBMIT_TOOL.name } } : {}),
        messages,
      }, left)
      const blocks: unknown[] = Array.isArray(res.content) ? res.content : []
      collectSeenUrls(blocks, seen)
      searches += Number(res.usage?.server_tool_use?.web_search_requests ?? 0)
      const call = (blocks as any[]).find(b => b?.type === "tool_use" && b.name === SUBMIT_TOOL.name)
      if (call) { submitted = call.input ?? {}; break }
      messages.push({ role: "assistant", content: blocks })
      if (res.stop_reason !== "pause_turn") {
        messages.push({ role: "user", content: "Research is finished. Call submit_proposals now with your result, or an empty list if nothing reliable was found." })
      }
    }
    if (!submitted) throw new HttpError(502, "The AI did not return a result. Try again.")

    const clean = cleanProposals(submitted.proposals, existing, seen, pendingSlugs)
    if (clean.length) {
      const { error } = await admin.from("knowledge_ai_proposals").insert(
        clean.map(p => ({ ...p, run_id: run.id })),
      )
      if (error) throw new HttpError(500, "Could not save the proposals.")
    }
    const summary = plain(submitted.summary, 800)
    await finish({ status: "done", summary, searches_used: searches, proposals_count: clean.length })
    return json(200, { run_id: run.id, proposals: clean.length, searches, summary })
  } catch (e) {
    const message = e instanceof HttpError ? e.message : "Something went wrong. Try again."
    await finish({ status: "failed", error: message })
    throw e
  }
}))
