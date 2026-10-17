// R7 AI Assistant: pure helpers shared by the room-ai-* functions and tests.
// Nothing here touches the network, Deno or the database.

export const MAX_CHUNK_BYTES = 15 * 1024 * 1024
export const MAX_LIVE_SLICE_BYTES = 2 * 1024 * 1024
export const MAX_ASSEMBLED_BYTES = 45 * 1024 * 1024
export const MAX_CHUNKS = 20000

const MIME_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

// "audio/webm;codecs=opus" -> "audio/webm". Storage allow-lists the bare type.
export function baseMime(raw: unknown): string | null {
  const base = String(raw ?? '').split(';')[0].trim().toLowerCase()
  return MIME_EXT[base] ? base : null
}

export function extFor(mime: string): string {
  return MIME_EXT[mime] ?? 'bin'
}

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export const isSha256 = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

export function validSeq(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < MAX_CHUNKS
}

export function chunkPath(sessionId: string, seq: number, mime: string): string {
  return `${sessionId}/chunks/${String(seq).padStart(6, '0')}.${extFor(mime)}`
}

export function finalPath(sessionId: string, mime: string): string {
  return `${sessionId}/final.${extFor(mime)}`
}

// Which of the numbers 0..expected-1 are not in `have`.
export function missingChunks(expected: number, have: Iterable<number>): number[] {
  const got = new Set(have)
  const out: number[] = []
  for (let i = 0; i < expected; i++) if (!got.has(i)) out.push(i)
  return out
}

export type Utterance = {
  start: number
  end: number
  transcript: string
  speaker?: number
  confidence?: number
}

export type Segment = {
  speaker_key: string
  start_ms: number
  end_ms: number
  text: string
  confidence: number | null
}

// Deepgram's utterances -> our segment rows. Speaker numbers become stable
// keys ("s0", "s1"); a missing speaker becomes "s0". `offsetMs` shifts a live
// slice to its place in the meeting.
export function normalizeUtterances(raw: unknown, offsetMs = 0): Segment[] {
  const list = Array.isArray(raw) ? (raw as Utterance[]) : []
  const out: Segment[] = []
  for (const u of list) {
    const text = String(u?.transcript ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const start = Math.max(0, Math.round(Number(u.start) * 1000) + offsetMs)
    const end = Math.max(start, Math.round(Number(u.end) * 1000) + offsetMs)
    const speaker = Number.isInteger(u.speaker) ? Number(u.speaker) : 0
    const conf = Number(u.confidence)
    out.push({
      speaker_key: `s${Math.min(Math.max(speaker, 0), 98)}`,
      start_ms: start,
      end_ms: end,
      text: text.slice(0, 8000),
      confidence: Number.isFinite(conf) && conf >= 0 && conf <= 1 ? conf : null,
    })
  }
  return out
}

// Speaker labels: a person's correction wins, otherwise "Speaker N".
export function speakerLabel(key: string, corrections: Map<string, string>): string {
  const fixed = corrections.get(key)
  if (fixed) return fixed
  const n = Number(key.replace(/^s/, ''))
  return Number.isFinite(n) ? `Speaker ${n + 1}` : key
}

// Latest correction per speaker. Rows must be in ascending id order.
export function latestCorrections(rows: { speaker_key: string; display_name: string }[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of rows) m.set(r.speaker_key, r.display_name)
  return m
}

export function clock(ms: number): string {
  const total = Math.floor(Math.max(ms, 0) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// Plain-text transcript, one paragraph per run of the same speaker.
export function transcriptToText(
  title: string,
  segments: { speaker_key: string; start_ms: number; text: string }[],
  corrections: Map<string, string>,
): string {
  const lines: string[] = [title, '']
  let last = ''
  for (const s of segments) {
    const who = speakerLabel(s.speaker_key, corrections)
    if (who !== last) {
      if (last) lines.push('')
      lines.push(`[${clock(s.start_ms)}] ${who}`)
      last = who
    }
    lines.push(s.text)
  }
  return lines.join('\n').trim() + '\n'
}

export type RetentionMode = 'delete_after_finalize' | 'days_7' | 'days_30' | 'days_90' | 'permanent'

// Mirrors the retention clock in the database trigger.
export function retentionDeadline(mode: RetentionMode, finalizedAt: Date): Date | null {
  const day = 24 * 3600 * 1000
  switch (mode) {
    case 'delete_after_finalize': return new Date(finalizedAt)
    case 'days_7': return new Date(finalizedAt.getTime() + 7 * day)
    case 'days_30': return new Date(finalizedAt.getTime() + 30 * day)
    case 'days_90': return new Date(finalizedAt.getTime() + 90 * day)
    default: return null
  }
}

export function deepgramQuery(opts: { model?: string; language?: string; diarize: boolean; summarize: boolean }): string {
  const q = new URLSearchParams({
    model: opts.model || 'nova-3',
    smart_format: 'true',
    punctuate: 'true',
    utterances: 'true',
    diarize: opts.diarize ? 'true' : 'false',
  })
  q.set('language', opts.language || 'en')
  if (opts.summarize) {
    q.set('summarize', 'v2')
    q.set('detect_topics', 'true')
  }
  return q.toString()
}

// Constant-time comparison for the cron secret.
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function topicsFrom(dg: any): string[] {
  const out = new Set<string>()
  const segs = dg?.results?.topics?.segments
  if (Array.isArray(segs)) {
    for (const seg of segs) {
      for (const t of seg?.topics ?? []) {
        const name = String(t?.topic ?? '').trim()
        if (name) out.add(name)
        if (out.size >= 12) return [...out]
      }
    }
  }
  return [...out]
}

export function summaryFrom(dg: any): string | null {
  const s = dg?.results?.summary?.short
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, 100000) : null
}
