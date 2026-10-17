// R7 AI Assistant: delete audio whose retention deadline has passed.
// Called every 15 minutes by pg_cron with the cron secret. Idempotent: running
// it twice, or after a partial failure, never claims a deletion that storage
// has not confirmed. Transcripts and minutes are NOT touched.
import { adminClient, cors, json } from "../_shared/roomAiAuth.ts"
import { sameSecret } from "../_shared/roomAiCore.ts"

const BUCKET = "room-ai-recordings"

async function listAll(admin: ReturnType<typeof adminClient>, prefix: string): Promise<string[]> {
  const out: string[] = []
  const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 })
  if (error) throw new Error(error.message)
  for (const o of data ?? []) {
    if (o.id === null || (o as any).metadata == null) {
      // a folder: go one level down
      out.push(...await listAll(admin, `${prefix}/${o.name}`))
    } else {
      out.push(`${prefix}/${o.name}`)
    }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  const secret = Deno.env.get("CRON_DISPATCH_SECRET") || ""
  if (!secret || !sameSecret(req.headers.get("Authorization") || "", `Bearer ${secret}`)) {
    return json(401, { error: "Not authorized." })
  }
  const admin = adminClient()
  const { data: due, error } = await admin.rpc("r7_ai_sessions_due_for_deletion", { p_limit: 25 })
  if (error) return json(500, { error: "Could not list due recordings." })

  let deleted = 0
  let failed = 0
  for (const row of due ?? []) {
    const id = String((row as any).id)
    try {
      const paths = await listAll(admin, id)
      if (paths.length) {
        const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths)
        if (rmErr) throw new Error(rmErr.message)
      }
      // Confirm nothing is left before saying it is gone.
      const left = await listAll(admin, id)
      if (left.length) throw new Error(`${left.length} object(s) remain`)
      await admin.rpc("r7_ai_mark_audio_deleted", { p_session: id, p_ok: true })
      deleted++
    } catch (e) {
      failed++
      await admin.rpc("r7_ai_mark_audio_deleted", { p_session: id, p_ok: false, p_error: e instanceof Error ? e.message : "unknown" })
    }
  }
  return json(200, { deleted, failed })
})
