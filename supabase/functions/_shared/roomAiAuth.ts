import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-r7-seq, x-r7-offset-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

export function json(status: number, body: unknown, headers: HeadersInit = cors): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) throw new HttpError(500, "Server is not configured.")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function authenticate(
  req: Request,
  admin: ReturnType<typeof adminClient>,
): Promise<{ id: string }> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization") || "")
  if (!m?.[1]) throw new HttpError(401, "Missing RideArrivo session.")

  const { data, error } = await admin.auth.getUser(m[1].trim())
  if (error || !data.user) {
    throw new HttpError(401, "Invalid or expired RideArrivo session.")
  }

  const { data: profile, error: pErr } = await admin
    .from("employee_profiles")
    .select("id,active")
    .eq("id", data.user.id)
    .maybeSingle()

  if (pErr) throw new HttpError(500, "Unable to verify your account.")
  if (!profile || profile.active !== true) {
    throw new HttpError(403, "An active RideArrivo employee account is required.")
  }

  return { id: profile.id }
}

export type AiSession = {
  id: string
  state: string
  started_by: string
  live_transcript_enabled: boolean
  expected_chunks: number | null
  processing_revision: number
  retention_mode: string
  title: string
  audio_deleted_at: string | null
}

export async function loadManagedSession(
  admin: ReturnType<typeof adminClient>,
  sessionId: string,
  userId: string,
): Promise<AiSession> {
  const { data, error } = await admin
    .from("workspace_room_ai_sessions")
    .select(
      "id,state,started_by,live_transcript_enabled,expected_chunks,processing_revision,retention_mode,title,audio_deleted_at",
    )
    .eq("id", sessionId)
    .maybeSingle()

  if (error) throw new HttpError(500, "Unable to load the meeting.")
  if (!data || data.started_by !== userId) {
    throw new HttpError(404, "Meeting not found.")
  }

  return data as AiSession
}

export function handle(
  fn: (req: Request) => Promise<Response>,
  responseHeaders: (req: Request) => HeadersInit = () => cors,
) {
  return async (req: Request): Promise<Response> => {
    const headers = responseHeaders(req)

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers })
    }

    try {
      return await fn(req)
    } catch (e) {
      if (e instanceof HttpError) {
        return json(e.status, { error: e.message }, headers)
      }

      console.error("room-ai error:", e instanceof Error ? e.message : "unknown")
      return json(500, { error: "Something went wrong. Try again." }, headers)
    }
  }
}
