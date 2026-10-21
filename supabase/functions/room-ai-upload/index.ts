// R7 AI Assistant: short-lived upload permission for audio chunks.
// The browser never gets a storage credential. It asks here for a one-time
// signed upload URL for ONE chunk of ONE session it owns, uploads straight to
// private storage (audio never passes through this function), then calls
// `ack` with the size and SHA-256 so the server can prove nothing is missing.
import { adminClient, authenticate, handle, json, loadManagedSession, HttpError } from "../_shared/roomAiAuth.ts"
import { roomAiCors, roomAiJson } from "../_shared/roomAiCors.ts"
import { baseMime, chunkPath, isSha256, isUuid, validSeq, MAX_CHUNK_BYTES } from "../_shared/roomAiCore.ts"

const BUCKET = "room-ai-recordings"
const OPEN_STATES = new Set(["recording", "paused", "finalizing", "incomplete_upload"])

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.")
  const admin = adminClient()
  const me = await authenticate(req, admin)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { throw new HttpError(400, "Send JSON.") }

  const sessionId = body.session_id
  const seq = body.seq
  const mime = baseMime(body.mime)
  if (!isUuid(sessionId)) throw new HttpError(400, "Missing meeting.")
  if (!validSeq(seq)) throw new HttpError(400, "Bad chunk number.")
  if (!mime) throw new HttpError(400, "That audio format is not supported.")

  const session = await loadManagedSession(admin, sessionId, me.id)
  if (session.audio_deleted_at) throw new HttpError(409, "The audio for this meeting has been deleted.")
  if (!OPEN_STATES.has(session.state)) throw new HttpError(409, "This meeting is not accepting audio.")

  const path = chunkPath(sessionId, seq, mime)

  if (body.action === "sign") {
    // upsert lets a retried chunk replace a half-uploaded one.
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
    if (error || !data) throw new HttpError(500, "Could not prepare the upload.")
    return roomAiJson(req, 200, { path, token: data.token, signed_url: data.signedUrl })
  }

  if (body.action === "ack") {
    const bytes = body.bytes
    const sha = body.sha256
    if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_CHUNK_BYTES) {
      throw new HttpError(400, "Bad chunk size.")
    }
    if (!isSha256(sha)) throw new HttpError(400, "Bad checksum.")

    // The object must really be there, with the size the browser claims.
    const dir = path.slice(0, path.lastIndexOf("/"))
    const file = path.slice(path.lastIndexOf("/") + 1)
    const { data: listed, error: listErr } = await admin.storage.from(BUCKET).list(dir, { search: file, limit: 5 })
    if (listErr) throw new HttpError(500, "Could not verify the upload.")
    const found = (listed ?? []).find((o) => o.name === file)
    const storedSize = Number((found as any)?.metadata?.size ?? 0)
    if (!found || storedSize !== bytes) throw new HttpError(409, "The uploaded chunk does not match. Upload it again.")

    const { error } = await admin.from("workspace_room_ai_chunks").upsert({
      ai_session_id: sessionId, seq, storage_path: path, bytes, sha256: sha, mime,
    }, { onConflict: "ai_session_id,seq" })
    if (error) throw new HttpError(500, "Could not record the chunk.")
    return roomAiJson(req, 200, { ok: true, seq })
  }

  throw new HttpError(400, "Unknown action.")
}, roomAiCors))
