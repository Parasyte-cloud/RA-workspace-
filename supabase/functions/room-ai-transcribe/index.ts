// R7 AI Assistant: live (provisional) transcript.
// The browser cuts a short, self-contained audio slice every few seconds and
// posts the raw bytes here. We pass it to Deepgram with a server-side key and
// store the result as PROVISIONAL text. Slices are never stored; the durable
// recording is the chunk stream, and the final transcript replaces this one.
import { adminClient, authenticate, handle, json, loadManagedSession, HttpError } from "../_shared/roomAiAuth.ts"
import { baseMime, deepgramQuery, isUuid, MAX_LIVE_SLICE_BYTES, normalizeUtterances } from "../_shared/roomAiCore.ts"

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.")
  const admin = adminClient()
  const me = await authenticate(req, admin)

  const url = new URL(req.url)
  const sessionId = url.searchParams.get("session_id")
  const seq = Number(url.searchParams.get("seq"))
  const offsetMs = Number(url.searchParams.get("offset_ms") || 0)
  const mime = baseMime(req.headers.get("content-type"))
  if (!isUuid(sessionId)) throw new HttpError(400, "Missing meeting.")
  if (!Number.isInteger(seq) || seq < 0 || seq > 100000) throw new HttpError(400, "Bad slice number.")
  if (!Number.isFinite(offsetMs) || offsetMs < 0 || offsetMs > 24 * 3600 * 1000) throw new HttpError(400, "Bad offset.")
  if (!mime) throw new HttpError(400, "That audio format is not supported.")

  const session = await loadManagedSession(admin, sessionId, me.id)
  if (!session.live_transcript_enabled) throw new HttpError(409, "Live transcript is off for this meeting.")
  if (session.state !== "recording") return json(200, { segments: 0, skipped: "not_recording" })

  const key = Deno.env.get("DEEPGRAM_API_KEY")
  if (!key) throw new HttpError(503, "Transcription is not configured yet.")

  const audio = new Uint8Array(await req.arrayBuffer())
  if (audio.byteLength < 800) return json(200, { segments: 0 })
  if (audio.byteLength > MAX_LIVE_SLICE_BYTES) throw new HttpError(413, "That slice is too large.")

  const dg = await fetch(
    `https://api.deepgram.com/v1/listen?${deepgramQuery({
      model: Deno.env.get("DEEPGRAM_MODEL") || "nova-3",
      language: Deno.env.get("DEEPGRAM_LANGUAGE") || "en",
      diarize: false,
      summarize: false,
    })}`,
    { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": mime }, body: audio },
  )
  if (!dg.ok) {
    console.error("deepgram live status", dg.status)
    // The recording is fine; only the live text is behind.
    return json(200, { segments: 0, degraded: true })
  }
  const result = await dg.json()
  const segs = normalizeUtterances(result?.results?.utterances, offsetMs)
  if (!segs.length) return json(200, { segments: 0 })

  const rows = segs.map((s, i) => ({
    ai_session_id: sessionId,
    revision: 0,
    is_final: false,
    source: "room_mic",
    seq: seq * 100 + i,
    speaker_key: "s0", // live slices are not diarized; the final pass names speakers
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    text: s.text,
    confidence: s.confidence,
  }))
  const { error } = await admin.from("workspace_room_transcript_segments")
    .upsert(rows, { onConflict: "ai_session_id,revision,source,seq" })
  if (error) throw new HttpError(500, "Could not save the live transcript.")
  return json(200, { segments: rows.length })
}))
