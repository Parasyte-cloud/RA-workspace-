import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { callFunction, postLiveSlice, rpc } from './api'
import { chunksFor, forgetSession, markUploaded, putChunk, putMeta, getMeta, type SessionMeta } from './recorderStore'

const CHUNK_MS = 10_000
const LIVE_SLICE_MS = 8_000
const BUCKET = 'room-ai-recordings'

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'uploading' | 'transcribing' | 'done' | 'error'
export type MicProblem = '' | 'denied' | 'missing' | 'lost' | 'unsupported'

export function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

const bare = (m: string) => m.split(';')[0]

async function sha256Hex(blob: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function uploadChunk(sessionId: string, seq: number, blob: Blob, mime: string) {
  const type = bare(mime)
  const sign = await callFunction<{ path: string; token: string }>('room-ai-upload', { action: 'sign', session_id: sessionId, seq, mime: type })
  if (!supabase) throw new Error('Not connected.')
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(sign.path, sign.token, blob, { contentType: type })
  if (error) throw new Error(error.message)
  await callFunction('room-ai-upload', { action: 'ack', session_id: sessionId, seq, mime: type, bytes: blob.size, sha256: await sha256Hex(blob) })
}

// Upload everything not yet confirmed, in order, retrying with backoff.
// Resolves when the buffer is empty; `onProgress` reports what is left.
export async function drainUploads(sessionId: string, onProgress: (left: number) => void, shouldStop: () => boolean = () => false) {
  let delay = 2000
  for (;;) {
    if (shouldStop()) return false
    const pending = (await chunksFor(sessionId)).filter(c => !c.uploaded && c.blob)
    onProgress(pending.length)
    if (pending.length === 0) return true
    let failed = false
    for (const c of pending) {
      try {
        await uploadChunk(sessionId, c.seq, c.blob as Blob, c.mime)
        await markUploaded(sessionId, c.seq)
        delay = 2000
      } catch {
        failed = true
        break
      }
    }
    if (failed) {
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 2, 30_000)
    }
  }
}

// Ends the meeting on the server (if it is not already), uploads the rest, and
// asks for the transcript. Used both by the recorder and by crash recovery.
export async function finishSession(sessionId: string, onPhase: (p: RecorderPhase, left?: number) => void, shouldStop?: () => boolean) {
  const meta = await getMeta(sessionId)
  const chunks = await chunksFor(sessionId)
  const expected = meta?.expected ?? (chunks.length ? Math.max(...chunks.map(c => c.seq)) + 1 : 0)
  if (meta && !meta.ended) {
    await rpc('end_ai_session', { p_session: sessionId, p_expected_chunks: expected, p_duration_seconds: Math.round((meta.elapsedMs || 0) / 1000) })
    await putMeta({ ...meta, ended: true, expected })
  }
  onPhase('uploading', chunks.filter(c => !c.uploaded).length)
  const ok = await drainUploads(sessionId, left => onPhase('uploading', left), shouldStop)
  if (!ok) return 'stopped' as const
  onPhase('transcribing')
  const res = await callFunction<{ state: string; error?: string }>('room-ai-finalize', { session_id: sessionId })
  if (res.state === 'ready') await forgetSession(sessionId)
  return res.state
}

export function usePhysicalRecorder(opts: { sessionId: string; title: string; live: boolean; deviceId?: string }) {
  const { sessionId, title, live, deviceId } = opts
  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [problem, setProblem] = useState<MicProblem>('')
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [pendingUploads, setPendingUploads] = useState(0)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [liveHealthy, setLiveHealthy] = useState(true)
  const [message, setMessage] = useState('')
  const [finalState, setFinalState] = useState('')

  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const sliceRec = useRef<MediaRecorder | null>(null)
  const sliceTimer = useRef<number | null>(null)
  const seq = useRef(0)
  const liveSeq = useRef(0)
  const mimeRef = useRef('')
  const startedAt = useRef(0)
  const pausedAt = useRef(0)
  const pausedTotal = useRef(0)
  const phaseRef = useRef<RecorderPhase>('idle')
  const audioCtx = useRef<AudioContext | null>(null)
  const raf = useRef<number | null>(null)
  const wake = useRef<{ release: () => Promise<void> } | null>(null)
  const draining = useRef(false)
  const stopFlag = useRef(false)

  const setPhaseBoth = (p: RecorderPhase) => { phaseRef.current = p; setPhase(p) }
  const elapsedNow = () => (phaseRef.current === 'paused' ? pausedAt.current : Date.now()) - startedAt.current - pausedTotal.current

  const persistMeta = useCallback(async (extra: Partial<SessionMeta> = {}) => {
    const m: SessionMeta = {
      sessionId, title, live, startedAt: startedAt.current, lastSeenAt: Date.now(),
      elapsedMs: Math.max(elapsedNow(), 0), ended: false, expected: null, ...extra,
    }
    try { await putMeta(m) } catch { /* buffer unavailable: recording still works */ }
  }, [sessionId, title, live])

  const kickUploads = useCallback(() => {
    if (draining.current) return
    draining.current = true
    void drainUploads(sessionId, left => setPendingUploads(left), () => stopFlag.current || phaseRef.current === 'done')
      .catch(() => undefined)
      .finally(() => { draining.current = false })
  }, [sessionId])

  const stopSlicer = () => {
    if (sliceTimer.current) window.clearTimeout(sliceTimer.current)
    sliceTimer.current = null
    const r = sliceRec.current
    sliceRec.current = null
    if (r && r.state !== 'inactive') { r.ondataavailable = null; try { r.stop() } catch { /* already stopped */ } }
  }

  // Live text: short self-contained slices, restarted back to back.
  const runSlice = useCallback(() => {
    const s = stream.current
    if (!live || !s || stopFlag.current || phaseRef.current !== 'recording') return
    const mime = mimeRef.current
    const sliceStart = elapsedNow()
    const r = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined)
    sliceRec.current = r
    r.ondataavailable = e => {
      if (e.data.size > 0) {
        const n = liveSeq.current++
        void postLiveSlice(sessionId, n, sliceStart, e.data, bare(mime || e.data.type || 'audio/webm')).then(ok => setLiveHealthy(ok))
      }
    }
    r.onstop = () => { if (phaseRef.current === 'recording') runSlice() }
    r.start()
    sliceTimer.current = window.setTimeout(() => { if (r.state === 'recording') r.stop() }, LIVE_SLICE_MS)
  }, [live, sessionId])

  const watchLevel = (s: MediaStream) => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      audioCtx.current = ctx
      const an = ctx.createAnalyser()
      an.fftSize = 512
      ctx.createMediaStreamSource(s).connect(an)
      const buf = new Uint8Array(an.fftSize)
      let last = 0
      const tick = (t: number) => {
        raf.current = requestAnimationFrame(tick)
        if (t - last < 100) return
        last = t
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) { const d = (v - 128) / 128; sum += d * d }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.2))
        setElapsed(Math.max(elapsedNow(), 0))
      }
      raf.current = requestAnimationFrame(tick)
    } catch { /* meter is cosmetic */ }
  }

  const acquireWake = async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
      if (nav.wakeLock) wake.current = await nav.wakeLock.request('screen')
    } catch { /* optional */ }
  }

  const start = useCallback(async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setProblem('unsupported'); setPhaseBoth('error'); return }
    setPhaseBoth('starting'); setMessage('')
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (e) {
      const name = (e as DOMException)?.name
      setProblem(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'missing')
      setPhaseBoth('error')
      return
    }
    stream.current = s
    const mime = pickMime()
    mimeRef.current = mime
    const rec = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined)
    recorder.current = rec
    startedAt.current = Date.now()
    pausedTotal.current = 0
    rec.ondataavailable = e => {
      if (e.data.size === 0) return
      const n = seq.current++
      const type = bare(mimeRef.current || e.data.type || 'audio/webm')
      void putChunk({ sessionId, seq: n, mime: type, blob: e.data, bytes: e.data.size, uploaded: false })
        .catch(() => undefined)
        .finally(() => { void persistMeta(); kickUploads() })
    }
    s.getAudioTracks()[0].onended = () => {
      if (phaseRef.current === 'recording') { void pause(); setProblem('lost') }
    }
    await persistMeta()
    rec.start(CHUNK_MS)
    setPhaseBoth('recording')
    watchLevel(s)
    void acquireWake()
    runSlice()
  }, [deviceId, sessionId, persistMeta, kickUploads, runSlice])

  const pause = useCallback(async () => {
    const r = recorder.current
    if (!r || phaseRef.current !== 'recording') return
    r.pause(); stopSlicer()
    pausedAt.current = Date.now()
    setPhaseBoth('paused')
    try { await rpc('pause_resume_ai_session', { p_session: sessionId, p_pause: true }) } catch { /* local pause still holds */ }
  }, [sessionId])

  const resume = useCallback(async () => {
    const r = recorder.current
    if (!r || phaseRef.current !== 'paused') return
    try { await rpc('pause_resume_ai_session', { p_session: sessionId, p_pause: false }) } catch { /* keep going locally */ }
    pausedTotal.current += Date.now() - pausedAt.current
    r.resume(); setProblem('')
    setPhaseBoth('recording')
    void acquireWake()
    runSlice()
  }, [sessionId, runSlice])

  const addMarker = useCallback(async (kind: 'important' | 'note', body?: string) => {
    await rpc('add_ai_marker', { p_session: sessionId, p_at_ms: Math.max(elapsedNow(), 0), p_kind: kind, p_body: body ?? null })
  }, [sessionId])

  const end = useCallback(async () => {
    const r = recorder.current
    if (!r || (phaseRef.current !== 'recording' && phaseRef.current !== 'paused')) return
    setPhaseBoth('stopping')
    stopSlicer()
    const total = Math.max(elapsedNow(), 0)
    await new Promise<void>(resolve => {
      r.onstop = () => resolve()
      if (r.state !== 'inactive') r.stop(); else resolve()
    })
    // The last chunk is written in ondataavailable just before onstop.
    await new Promise(res => setTimeout(res, 300))
    stream.current?.getTracks().forEach(t => t.stop())
    if (raf.current) cancelAnimationFrame(raf.current)
    void audioCtx.current?.close().catch(() => undefined)
    void wake.current?.release().catch(() => undefined)
    setLevel(0); setElapsed(total)
    const expected = seq.current
    await persistMeta({ elapsedMs: total, expected })
    try {
      const state = await finishSession(sessionId, (p, left) => { setPhaseBoth(p); if (left !== undefined) setPendingUploads(left) }, () => stopFlag.current)
      setFinalState(state)
      setPhaseBoth('done')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not finish the meeting. Your audio is safe on this device.')
      setPhaseBoth('error')
    }
  }, [sessionId, persistMeta])

  // Retry after a failure without recording again.
  const retryFinish = useCallback(async () => {
    setMessage('')
    try {
      const state = await finishSession(sessionId, (p, left) => { setPhaseBoth(p); if (left !== undefined) setPendingUploads(left) })
      setFinalState(state); setPhaseBoth('done')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Still could not finish. Try again in a moment.')
      setPhaseBoth('error')
    }
  }, [sessionId])

  useEffect(() => {
    stopFlag.current = false
    const on = () => { setOnline(true); kickUploads() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    const vis = () => { if (document.visibilityState === 'visible' && phaseRef.current === 'recording') void acquireWake() }
    document.addEventListener('visibilitychange', vis)
    const warn = (e: BeforeUnloadEvent) => { if (phaseRef.current === 'recording' || phaseRef.current === 'paused') { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('online', on); window.removeEventListener('offline', off)
      document.removeEventListener('visibilitychange', vis); window.removeEventListener('beforeunload', warn)
    }
  }, [kickUploads])

  // Leaving the screen mid-meeting must not leave the microphone on.
  useEffect(() => () => {
    stopFlag.current = true
    stopSlicer()
    try { if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop() } catch { /* ignore */ }
    stream.current?.getTracks().forEach(t => t.stop())
    if (raf.current) cancelAnimationFrame(raf.current)
    void audioCtx.current?.close().catch(() => undefined)
    void wake.current?.release().catch(() => undefined)
  }, [])

  return { phase, problem, level, elapsed, pendingUploads, online, liveHealthy, message, finalState, start, pause, resume, end, retryFinish, addMarker }
}

// Microphone check for the setup screen: opens the mic briefly and reports a level.
export async function listMicrophones(): Promise<{ id: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const all = await navigator.mediaDevices.enumerateDevices()
  return all.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
}
