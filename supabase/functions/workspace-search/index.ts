import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/*
 * Backs the workspace's global header search (the Search icon in App.tsx's
 * topbar, previously wired to nothing at all). Searches, in parallel:
 *   - people      employee_profiles (directory — any active employee)
 *   - cases       support_cases     (support/manager/admin)
 *   - incidents   incidents         (manager/admin)
 *   - hr          hr_requests       (own + hr/admin)
 *   - leave       leave_requests    (own + manager/hr/admin)
 *   - intake      intake_submissions (assigned to actor, actor's
 *                 workstation, or manager/admin)
 *   - chat        social_messages, scoped to conversations the actor is
 *                 actually a member of
 *
 * This runs on the SERVICE ROLE key (bypassing RLS) so it can search
 * across tables in one round trip, so every filter below is a deliberate,
 * manual re-implementation of that table's real RLS policy (see
 * supabase/migrations/20260827000000_schema_baseline.sql,
 * 20260828123000_strict_department_rls.sql and
 * 20260901230000_native_chat_security.sql) — nothing here should return a
 * row the actor could not already see through the app itself.
 *
 * "Match any of several text columns" is done as one .ilike() query per
 * column (merged/de-duplicated below) rather than a single .or(...)
 * string. postgrest-js's .or() filter is a small string DSL where commas
 * and parentheses are syntactically significant, so a search term
 * containing them would either break the query or need careful DSL
 * quoting on top of the ILIKE wildcard-escaping already needed — two
 * layers of escaping neither this file nor CI can exercise against a
 * real PostgREST parser. Per-column .ilike() calls take the pattern as a
 * plain, library-encoded argument, so there's nothing to get wrong here.
 *
 * Mail is NOT included here: RideArrivo mail is Zoho's, fetched live via
 * the zoho-mail-* functions rather than stored in Postgres, so it needs
 * its own live per-mailbox call (see zoho-mail-search). The frontend
 * fires both this and zoho-mail-search in parallel and merges the
 * results, so a slow/failing mail search never blocks the rest.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://intranet.ridearrivo.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

// Escapes ILIKE's own wildcard characters (and the escape character
// itself) so the search term is matched literally, not as a pattern the
// caller can inject.
function likePattern(raw: string) {
  const escaped = raw.replace(/[\\%_]/g, (char) => `\\${char}`)
  return `%${escaped}%`
}

type Row = { id: string; [key: string]: unknown }

function mergeById(resultSets: Row[][], limit: number): Row[] {
  const byId = new Map<string, Row>()
  for (const rows of resultSets) {
    for (const row of rows) {
      if (!byId.has(row.id)) byId.set(row.id, row)
    }
  }
  return [...byId.values()].slice(0, limit)
}

// Runs one .ilike() query per column against the same base query
// (built fresh each time via `factory`, since a supabase-js query
// builder can't be reused/cloned after `.ilike()` narrows it), merges
// and de-dupes by id, then applies `limit` and `order` deterministically
// (an ordering that would need to happen client-side anyway, once
// results from N queries are merged).
async function searchColumns<T extends Row>(
  factory: () => any,
  columns: string[],
  pattern: string,
  limit: number,
  sortKey?: string,
): Promise<T[]> {
  const responses = await Promise.all(
    columns.map((column) => factory().ilike(column, pattern)),
  )
  for (const response of responses) {
    if (response.error) console.error("workspace-search column query failed", response.error.message)
  }
  const rows = mergeById(
    responses.map((response) => (response.data || []) as Row[]),
    limit * 4, // merge generously, trim after sort
  ) as T[]
  if (sortKey) {
    rows.sort((a, b) => String((b as any)[sortKey] || "").localeCompare(String((a as any)[sortKey] || "")))
  }
  return rows.slice(0, limit)
}

type Actor = { id: string; role: string; active: boolean }

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Search is unavailable." }, 503)
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const authHeader = req.headers.get("Authorization") || ""
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Authenticated RideArrivo workspace access is required." }, 401)
    }
    const { data: userData, error: userError } = await admin.auth.getUser(authHeader.slice(7).trim())
    const user = userData?.user
    if (userError || !user) {
      return json({ error: "Authenticated RideArrivo workspace access is required." }, 401)
    }

    const profileResult = await admin
      .from("employee_profiles")
      .select("id,role,active")
      .eq("id", user.id)
      .maybeSingle()
    if (profileResult.error || !profileResult.data?.active) {
      return json({ error: "Authenticated RideArrivo workspace access is required." }, 401)
    }
    const actor: Actor = {
      id: String(profileResult.data.id),
      role: String(profileResult.data.role || "").toLowerCase(),
      active: true,
    }

    const body = await req.json().catch(() => ({}))
    const rawQuery = String(body?.query || "").trim()
    if (rawQuery.length < 2) {
      return json({ error: "Search needs at least 2 characters." }, 400)
    }
    if (rawQuery.length > 120) {
      return json({ error: "Search query is too long." }, 400)
    }
    const pattern = likePattern(rawQuery)

    const canSeeSupport = ["support", "manager", "admin"].includes(actor.role)
    const canSeeIncidents = ["manager", "admin"].includes(actor.role)
    const canSeeAllHr = ["hr", "admin"].includes(actor.role)
    const canSeeAllLeave = ["manager", "hr", "admin"].includes(actor.role)
    const canSeeAllIntake = ["manager", "admin"].includes(actor.role)

    const intakeWorkstations = canSeeAllIntake
      ? []
      : (
          await admin
            .from("workspace_workstation_assignments")
            .select("workstation")
            .eq("employee_id", actor.id)
            .eq("active", true)
        ).data?.map((row: { workstation: string }) => row.workstation) || []

    const [people, cases, incidents, hrRequests, leaveRequests, intake, chat] = await Promise.all([
      searchColumns(
        () => admin.from("employee_profiles").select("id,full_name,email,department,job_title").eq("active", true),
        ["full_name", "email", "job_title", "department"],
        pattern,
        8,
        "full_name",
      ),

      canSeeSupport
        ? searchColumns(
            () => admin.from("support_cases").select("id,reference,subject,status,priority,opened_at"),
            ["subject", "reference"],
            pattern,
            6,
            "opened_at",
          )
        : Promise.resolve([]),

      canSeeIncidents
        ? searchColumns(
            () => admin.from("incidents").select("id,reference,summary,severity,status,occurred_at"),
            ["summary", "reference"],
            pattern,
            6,
            "occurred_at",
          )
        : Promise.resolve([]),

      searchColumns(
        () => {
          const base = admin.from("hr_requests").select("id,subject,category,status,created_at")
          return canSeeAllHr ? base : base.eq("employee_id", actor.id)
        },
        ["subject"],
        pattern,
        6,
        "created_at",
      ),

      searchColumns(
        () => {
          const base = admin.from("leave_requests").select("id,leave_type,status,start_date,end_date,created_at")
          return canSeeAllLeave ? base : base.eq("employee_id", actor.id)
        },
        ["leave_type"],
        pattern,
        6,
        "created_at",
      ),

      searchColumns(
        () => {
          const base = admin
            .from("intake_submissions")
            .select(
              "id,form_title_snapshot,category_title_snapshot,source_reference,status,destination_workstation,assigned_employee_id,submitted_at",
            )
          if (canSeeAllIntake) return base
          if (intakeWorkstations.length > 0) {
            return base.or(
              `assigned_employee_id.eq.${actor.id},destination_workstation.in.(${intakeWorkstations.join(",")})`,
            )
          }
          return base.eq("assigned_employee_id", actor.id)
        },
        ["form_title_snapshot", "category_title_snapshot", "source_reference"],
        pattern,
        8,
        "submitted_at",
      ),

      (async () => {
        const memberships = await admin
          .from("social_conversation_members")
          .select("conversation_id")
          .eq("user_id", actor.id)
        const conversationIds = (memberships.data || []).map((row: { conversation_id: string }) => row.conversation_id)
        if (conversationIds.length === 0) return [] as Row[]

        return searchColumns(
          () =>
            admin
              .from("social_messages")
              .select("id,conversation_id,sender_id,body,created_at")
              .in("conversation_id", conversationIds)
              .is("deleted_at", null),
          ["body"],
          pattern,
          8,
          "created_at",
        )
      })(),
    ])

    // Note: intakeWorkstations values come from our own DB (workstation
    // names in workspace_workstation_assignments), never from the
    // request, so building that .or(...) string directly is safe — this
    // is the one .or() left in the file, deliberately, for that reason.

    // Chat results need sender names resolved separately (social_messages
    // only has sender_id) — one extra lookup, only for the senders that
    // actually showed up in results.
    const senderIds = [...new Set((chat as Row[]).map((row) => String(row.sender_id)))]
    const senders = senderIds.length
      ? await admin.from("employee_profiles").select("id,full_name").in("id", senderIds)
      : { data: [] as { id: string; full_name: string }[] }
    const senderNames = new Map((senders.data || []).map((row) => [row.id, row.full_name]))

    return json({
      query: rawQuery,
      results: {
        people,
        cases,
        incidents,
        hr: hrRequests,
        leave: leaveRequests,
        intake,
        chat: (chat as Row[]).map((row) => ({
          ...row,
          sender_name: senderNames.get(String(row.sender_id)) || "Unknown",
        })),
      },
    })
  } catch (error) {
    console.error("workspace-search failed", error)
    return json({ error: "Search failed. Please try again." }, 500)
  }
})
