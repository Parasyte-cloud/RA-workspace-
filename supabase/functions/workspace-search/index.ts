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
 * A second group of areas (tasks, knowledge base, company files,
 * announcements, calendar, shared workspaces, brand library, CRM, legal and
 * meeting rooms) is searched with a client that carries the CALLER'S OWN
 * access token and the anon key, so Postgres row level security decides what
 * comes back and there is no hand-copied rule to drift. That is only safe if
 * every one of those tables really has RLS on, which is why
 * supabase/checks/workspace_search_rls_check.sql exists and a contract test
 * keeps its table list in step with USER_SCOPED_DOMAINS below. Legal areas
 * also carry a role guard in code, as a second lock.
 *
 * Deliberately NOT searchable: employee KYC documents and HR detail records,
 * performance reviews, candidates, bank and ledger records, marketing wallet
 * records and stored mail bodies. Those stay in their own screens.
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
  ascending = false,
): Promise<T[]> {
  // Order and cap inside Postgres, per column. Without this each column query
  // returned every matching row and the trimming happened afterwards, so a
  // common word could move thousands of rows through the function.
  const responses = await Promise.all(
    columns.map((column) => {
      const query = factory().ilike(column, pattern)
      return (sortKey ? query.order(sortKey, { ascending }) : query).limit(limit * 2)
    }),
  )
  for (const response of responses) {
    if (response.error) console.error("workspace-search column query failed", response.error.message)
  }
  const rows = mergeById(
    responses.map((response) => (response.data || []) as Row[]),
    limit * 4, // merge generously, trim after sort
  ) as T[]
  if (sortKey) {
    // People used to be sorted Z to A, because the comparison was always
    // newest-first. Names read A to Z; dates stay newest-first.
    rows.sort((a, b) => {
      const left = String((a as any)[sortKey] || "")
      const right = String((b as any)[sortKey] || "")
      return ascending ? left.localeCompare(right) : right.localeCompare(left)
    })
  }
  return rows.slice(0, limit)
}

type Actor = { id: string; role: string; active: boolean }

// Areas searched as the signed-in user (row level security applies). Each
// entry names ONE table; `roles` is an extra guard in code on top of RLS and
// `filter` only hides rows that are not meant to be listed anyway (drafts,
// archived records), it is never a security rule.
type Domain = {
  key: string
  table: string
  select: string
  columns: string[]
  titleColumn: string
  sortKey: string
  limit: number
  roles?: string[]
  filter?: (query: any) => any
}

const LEGAL_ROLES = ["legal", "manager", "admin"]

const USER_SCOPED_DOMAINS: Domain[] = [
  {
    key: "tasks", table: "work_items",
    select: "id,title,status,priority,department,due_at,created_at",
    columns: ["title", "description"], titleColumn: "title", sortKey: "created_at", limit: 8,
  },
  {
    key: "knowledge", table: "workspace_knowledge_articles",
    select: "id,title,slug,summary,category,status,updated_at",
    columns: ["title", "summary", "category", "content"], titleColumn: "title", sortKey: "updated_at", limit: 6,
    filter: (query) => query.eq("status", "published"),
  },
  {
    key: "files", table: "workspace_files",
    select: "id,name,description,folder_path,department,file_type,updated_at",
    columns: ["name", "description", "folder_path"], titleColumn: "name", sortKey: "updated_at", limit: 6,
    filter: (query) => query.eq("is_active", true),
  },
  {
    key: "announcements", table: "workspace_announcements",
    select: "id,title,category,priority,published_at",
    columns: ["title", "body"], titleColumn: "title", sortKey: "published_at", limit: 5,
    filter: (query) => query.eq("published", true),
  },
  {
    key: "calendar", table: "workspace_events",
    select: "id,title,description,event_type,location,starts_at",
    columns: ["title", "description", "location"], titleColumn: "title", sortKey: "starts_at", limit: 5,
  },
  {
    key: "shared", table: "collaboration_spaces",
    select: "id,name,description,space_type,home_department,updated_at",
    columns: ["name", "description"], titleColumn: "name", sortKey: "updated_at", limit: 5,
    filter: (query) => query.is("archived_at", null),
  },
  {
    key: "brand", table: "brand_assets",
    select: "id,name,description,category,updated_at",
    columns: ["name", "description"], titleColumn: "name", sortKey: "updated_at", limit: 5,
    filter: (query) => query.eq("is_active", true),
  },
  {
    key: "crmAccounts", table: "crm_accounts",
    select: "id,name,account_type,status,lifecycle_stage,updated_at",
    columns: ["name"], titleColumn: "name", sortKey: "updated_at", limit: 5,
  },
  {
    key: "crmContacts", table: "crm_contacts",
    select: "id,account_id,full_name,email,contact_type,created_at",
    columns: ["full_name", "email"], titleColumn: "full_name", sortKey: "created_at", limit: 5,
  },
  {
    key: "legalStatutes", table: "legal_statutes_regulations",
    select: "id,title,instrument_type,status,reference_number,risk_rating,updated_at",
    columns: ["title", "reference_number", "summary"], titleColumn: "title", sortKey: "updated_at", limit: 5,
    roles: LEGAL_ROLES,
  },
  {
    key: "legalOpinions", table: "legal_research_opinions",
    select: "id,title,status,risk_rating,privileged,updated_at",
    columns: ["title", "question_presented"], titleColumn: "title", sortKey: "updated_at", limit: 5,
    roles: LEGAL_ROLES,
  },
  {
    key: "legalContracts", table: "legal_contracts",
    select: "id,title,counterparty,status,renewal_date,created_at",
    columns: ["title", "counterparty"], titleColumn: "title", sortKey: "created_at", limit: 5,
    roles: LEGAL_ROLES,
  },
  {
    key: "rooms", table: "workspace_rooms",
    select: "id,room_code,title,status,started_at,created_at",
    columns: ["title", "room_code"], titleColumn: "title", sortKey: "created_at", limit: 5,
  },
]

// 0 = exact title, 1 = title starts with the term, 2 = title contains it,
// 3 = matched only in another column. Lower ranks first.
function relevance(row: Row, titleColumn: string, needle: string) {
  const title = String(row[titleColumn] || "").toLowerCase()
  if (title === needle) return 0
  if (title.startsWith(needle)) return 1
  if (title.includes(needle)) return 2
  return 3
}

async function searchDomain(
  client: any,
  actor: Actor,
  domain: Domain,
  pattern: string,
  needle: string,
): Promise<{ key: string; rows: Row[]; failed: boolean }> {
  if (domain.roles && !domain.roles.includes(actor.role)) {
    return { key: domain.key, rows: [], failed: false }
  }
  try {
    const responses = await Promise.all(
      domain.columns.map((column) => {
        let query = client.from(domain.table).select(domain.select)
        if (domain.filter) query = domain.filter(query)
        return query.ilike(column, pattern).order(domain.sortKey, { ascending: false }).limit(domain.limit * 2)
      }),
    )
    let errors = 0
    for (const response of responses) {
      if (response.error) {
        errors += 1
        console.error("workspace-search domain query failed", domain.key, response.error.message)
      }
    }
    const rows = mergeById(responses.map((response: any) => (response.data || []) as Row[]), domain.limit * 4)
    rows.sort((a, b) => {
      const byRelevance = relevance(a, domain.titleColumn, needle) - relevance(b, domain.titleColumn, needle)
      if (byRelevance !== 0) return byRelevance
      return String(b[domain.sortKey] || "").localeCompare(String(a[domain.sortKey] || ""))
    })
    // Only report a failure when every column query failed and nothing came
    // back, so one odd column cannot hide results the others found.
    return { key: domain.key, rows: rows.slice(0, domain.limit), failed: errors === responses.length && rows.length === 0 }
  } catch (error) {
    console.error("workspace-search domain threw", domain.key, error)
    return { key: domain.key, rows: [], failed: true }
  }
}

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

    // Second client: the caller's own token plus the anon key, so RLS applies.
    // If the anon key is not configured the extra areas are skipped and
    // reported as unavailable instead of falling back to the service role.
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || ""
    const userClient = anonKey
      ? createClient(supabaseUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: authHeader } },
        })
      : null
    const scopedPromise = userClient
      ? Promise.all(
          USER_SCOPED_DOMAINS.map((domain) =>
            searchDomain(userClient, actor, domain, pattern, rawQuery.toLowerCase()),
          ),
        )
      : Promise.resolve(
          USER_SCOPED_DOMAINS.map((domain) => ({ key: domain.key, rows: [] as Row[], failed: true })),
        )

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
        true,
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

    const scoped = await scopedPromise
    const scopedResults: Record<string, Row[]> = {}
    const partial: string[] = []
    for (const entry of scoped) {
      scopedResults[entry.key] = entry.rows
      if (entry.failed) partial.push(entry.key)
    }

    return json({
      query: rawQuery,
      partial,
      results: {
        ...scopedResults,
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
