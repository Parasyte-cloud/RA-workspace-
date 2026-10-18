// R7 AI Assistant: turn the recording into the finished meeting record.
// Safe to call more than once: a claim stops two runs working at the same time,
// and a meeting that is already ready just reports ready.
//
// Steps: check every chunk arrived -> join them into one recording in private
// storage -> ask Deepgram (diarized, with summary and topics) -> write a NEW
// transcript revision -> mark ready. Audio deletion is NOT done here; the
// database retention clock and room-ai-retention own that, so a meeting set to
// "delete after finalize" only loses audio after this function succeeded.
import { adminClient, authenticate, handle, json, loadManagedSession, HttpError } from "../_shared/roomAiAuth.ts"
import {
  baseMime, deepgramQuery, finalPath, isUuid, MAX_ASSEMBLED_BYTES, MAX_CHUNKS, missingChunks,
  normalizeUtterances, summaryFrom, topicsFrom,
} from "../_shared/roomAiCore.ts"

const BUCKET = "room-ai-recordings"

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.")
  const admin = adminClient()
  const me = await authenticate(req, admin)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { throw new HttpError(400, "Send JSON.") }
  const sessionId = body.session_id
  if (!isUuid(sessionId)) throw new HttpError(400, "Missing meeting.")

  const session = await loadManagedSession(admin, sessionId, me.id)
  if (session.audio_deleted_at) throw new HttpError(409, "The audio was deleted, so this meeting cannot be reprocessed.")
  if (session.state === "recording" || session.state === "paused") throw new HttpError(409, "End the meeting first.")
  if (session.state === "ready" && body.reprocess !== true) return json(200, { state: "ready" })

  // Retry from failed / incomplete / reprocess by moving back to finalizing.
  if (session.state !== "finalizing") {
    const { error } = await admin.from("workspace_room_ai_sessions")
      .update({ state: "finalizing", finalize_claimed_at: null }).eq("id", sessionId).eq("state", session.state)
    if (error) throw new HttpError(409, "The meeting changed. Reload and try again.")
  }

  // One worker at a time. A stale claim (crash) expires after 10 minutes.
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: claimed } = await admin.from("workspace_room_ai_sessions")
    .update({ finalize_claimed_at: new Date().toISOString() })
    .eq("id", sessionId).eq("state", "finalizing")
    .or(`finalize_claimed_at.is.null,finalize_claimed_at.lt.${staleBefore}`)
    .select("id")
  if (!claimed?.length) return json(202, { state: "finalizing", note: "Already being processed." })

  const fail = async (state: "failed" | "incomplete_upload", code: string, message: string, extra: Record<string, unknown> = {}) => {
    await admin.from("workspace_room_ai_sessions")
      .update({ state, error_code: code, error_message: message.slice(0, 500), finalize_claimed_at: null })
      .eq("id", sessionId)
    await admin.from("workspace_room_ai_audit").insert({ ai_session_id: sessionId, actor_id: me.id, event: "finalize_" + code, detail: extra })
    return json(200, { state, error: message, ...extra })
  }

  const key = Deno.env.get("DEEPGRAM_API_KEY")
  if (!key) return await fail("failed", "provider_not_configured", "Transcription is not configured yet. The audio is kept; try again once it is.")

  // 1. Every chunk present?
  const expected = session.expected_chunks ?? 0
  const { data: chunks, error: cErr } = await admin.from("workspace_room_ai_chunks")
    .select("seq,storage_path,bytes,mime,sha256").eq("ai_session_id", sessionId).order("seq")
  if (cErr) return await fail("failed", "chunk_lookup", "Could not read the uploaded audio.")
  if (expected === 0 || !chunks?.length) return await fail("failed", "no_audio", "No audio was uploaded for this meeting.")
  // end_ai_session already refuses more than this; check again so an old or
  // hand-edited row can never make us loop over an enormous range.
  if (expected > MAX_CHUNKS) return await fail("failed", "too_many_chunks", "That recording is longer than ROOM 7 can process.")
  const missing = missingChunks(expected, chunks.map((c) => c.seq))
  if (missing.length) {
    return await fail("incomplete_upload", "missing_chunks", `${missing.length} audio part(s) have not arrived yet.`, { missing: missing.slice(0, 50) })
  }

  // 2. Join the chunks into one recording.
  const mime = baseMime(chunks[0].mime) ?? "audio/webm"
  const total = chunks.reduce((n, c) => n + c.bytes, 0)
  if (total > MAX_ASSEMBLED_BYTES) return await fail("failed", "too_large", "The recording is too large to process in one piece.")
  const joined = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    const { data, error } = await admin.storage.from(BUCKET).download(c.storage_path)
    if (error || !data) return await fail("incomplete_upload", "chunk_unreadable", `Audio part ${c.seq} could not be read.`, { missing: [c.seq] })
    const part = new Uint8Array(await data.arrayBuffer())
    if (part.byteLength !== c.bytes) return await fail("incomplete_upload", "chunk_size_mismatch", `Audio part ${c.seq} is damaged.`, { missing: [c.seq] })
    // The browser sent the SHA-256 of each chunk when it confirmed the upload.
    // Check the bytes we just read really are those bytes, so a truncated,
    // swapped or tampered object is caught before it is joined and transcribed.
    if ((await sha256Hex(part)) !== c.sha256) return await fail("incomplete_upload", "chunk_checksum_mismatch", `Audio part ${c.seq} does not match what was recorded.`, { missing: [c.seq] })
    joined.set(part, at)
    at += part.byteLength
  }
  const path = finalPath(sessionId, mime)
  const up = await admin.storage.from(BUCKET).upload(path, joined, { contentType: mime, upsert: true })
  if (up.error) return await fail("failed", "assemble_failed", "Could not save the joined recording.")
  await admin.from("workspace_room_recordings").upsert({
    ai_session_id: sessionId, storage_path: path, bytes: total, mime, sha256: await sha256Hex(joined),
  }, { onConflict: "ai_session_id" })

  // 3. Transcribe from a one-hour signed URL (audio is not proxied through us).
  const { data: signed, error: sErr } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (sErr || !signed) return await fail("failed", "sign_failed", "Could not prepare the recording for transcription.")
  const dg = await fetch(
    `https://api.deepgram.com/v1/listen?${deepgramQuery({
      model: Deno.env.get("DEEPGRAM_MODEL") || "nova-3",
      language: Deno.env.get("DEEPGRAM_LANGUAGE") || "en",
      diarize: true,
      summarize: true,
    })}`,
    { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ url: signed.signedUrl }) },
  )
  if (!dg.ok) {
    console.error("deepgram final status", dg.status)
    return await fail("failed", "transcription_failed", "The transcription service could not process this recording. The audio is kept; try again.", { status: dg.status })
  }
  const result = await dg.json()
  const segments = normalizeUtterances(result?.results?.utterances, 0)
  if (!segments.length) return await fail("failed", "empty_transcript", "No speech was found in the recording.")

  // 4. Write a new revision. Old revisions and human corrections are untouched.
  const revision = session.processing_revision + 1
  const rows = segments.map((s, i) => ({
    ai_session_id: sessionId, revision, is_final: true, source: "room_mic", seq: i,
    speaker_key: s.speaker_key, start_ms: s.start_ms, end_ms: s.end_ms, text: s.text, confidence: s.confidence,
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("workspace_room_transcript_segments").insert(rows.slice(i, i + 500))
    if (error) {
      await admin.from("workspace_room_transcript_segments").delete().eq("ai_session_id", sessionId).eq("revision", revision)
      return await fail("failed", "save_failed", "Could not save the transcript. Try again.")
    }
  }

  const { error: doneErr } = await admin.from("workspace_room_ai_sessions").update({
    state: "ready", processing_revision: revision, summary_text: summaryFrom(result), topics: topicsFrom(result),
    finalize_claimed_at: null,
  }).eq("id", sessionId)
  if (doneErr) return await fail("failed", "finish_failed", "Saved the transcript but could not finish. Try again.")

  await admin.from("workspace_room_ai_audit").insert({
    ai_session_id: sessionId, actor_id: me.id, event: "finalized",
    detail: { revision, segments: rows.length, bytes: total },
  })
  return json(200, { state: "ready", revision, segments: rows.length })
}))
