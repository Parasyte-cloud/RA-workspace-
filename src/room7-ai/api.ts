import { supabase } from '../lib/supabase'

export type AiState = 'preparing' | 'awaiting_consent' | 'recording' | 'paused' | 'finalizing' | 'ready' | 'failed' | 'incomplete_upload'
export type RetentionMode = 'delete_after_finalize' | 'days_7' | 'days_30' | 'days_90' | 'permanent'

export type AiSession = {
  id: string
  mode: 'online' | 'physical' | 'hybrid'
  title: string
  state: AiState
  started_by: string
  started_at: string
  ended_at: string | null
  finalized_at: string | null
  duration_seconds: number | null
  retention_mode: RetentionMode
  delete_after: string | null
  audio_deleted_at: string | null
  live_transcript_enabled: boolean
  summary_text: string | null
  topics: string[]
  processing_revision: number
  error_code: string | null
  error_message: string | null
}

export type AiSegment = { id: number; revision: number; is_final: boolean; speaker_key: string; start_ms: number; end_ms: number; text: string }
export type AiAttendee = { seq: number; user_id: string | null; display_name: string }
export type AiMarker = { id: number; at_ms: number; kind: 'important' | 'note'; body: string | null }
export type AiCorrection = { id: number; speaker_key: string; display_name: string }

export const RETENTION_LABEL: Record<RetentionMode, string> = {
  delete_after_finalize: 'Delete after the transcript is ready',
  days_7: 'Keep 7 days',
  days_30: 'Keep 30 days',
  days_90: 'Keep 90 days',
  permanent: 'Keep permanently',
}

export const STATE_LABEL: Record<AiState, string> = {
  preparing: 'Preparing',
  awaiting_consent: 'Waiting for consent',
  recording: 'Recording',
  paused: 'Paused',
  finalizing: 'Transcribing',
  ready: 'Ready',
  failed: 'Needs attention',
  incomplete_upload: 'Audio still uploading',
}

function client() {
  if (!supabase) throw new Error('The workspace is not connected.')
  return supabase
}

// Edge function errors carry the real message in the response body.
export async function messageFrom(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: unknown })?.context
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json()
      if (body?.error) return String(body.error)
    } catch { /* not JSON */ }
  }
  const msg = (error as { message?: string })?.message
  return msg && !/non-2xx/i.test(msg) ? msg : fallback
}

export async function callFunction<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().functions.invoke(name, { body })
  if (error) throw new Error(await messageFrom(error, 'The request failed. Try again.'))
  return data as T
}

export async function startPhysical(args: {
  title: string
  attendees: { name: string; user_id?: string }[]
  retention: RetentionMode
  live: boolean
  device: string
}): Promise<string> {
  const { data, error } = await client().rpc('start_physical_ai_session', {
    p_title: args.title,
    p_attendees: args.attendees,
    p_retention: args.retention,
    p_live: args.live,
    p_attested: true,
    p_device: args.device,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function rpc(name: string, params: Record<string, unknown>) {
  const { data, error } = await client().rpc(name, params)
  if (error) throw new Error(error.message)
  return data
}

const SESSION_COLS = 'id,mode,title,state,started_by,started_at,ended_at,finalized_at,duration_seconds,retention_mode,delete_after,audio_deleted_at,live_transcript_enabled,summary_text,topics,processing_revision,error_code,error_message'

export async function listSessions(limit = 20): Promise<AiSession[]> {
  const { data, error } = await client().from('workspace_room_ai_sessions').select(SESSION_COLS).order('started_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as AiSession[]
}

export async function loadSession(id: string): Promise<AiSession | null> {
  const { data, error } = await client().from('workspace_room_ai_sessions').select(SESSION_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as AiSession) ?? null
}

export async function loadTranscript(session: AiSession): Promise<AiSegment[]> {
  // The finished record shows the latest final revision. During the meeting it
  // shows the provisional live text (revision 0).
  const revision = session.state === 'ready' || session.processing_revision > 0 ? session.processing_revision : 0
  const { data, error } = await client()
    .from('workspace_room_transcript_segments')
    .select('id,revision,is_final,speaker_key,start_ms,end_ms,text')
    .eq('ai_session_id', session.id)
    .eq('revision', revision)
    .order('start_ms', { ascending: true })
    .limit(5000)
  if (error) throw new Error(error.message)
  return (data ?? []) as AiSegment[]
}

export async function loadExtras(id: string) {
  const c = client()
  const [att, mk, co] = await Promise.all([
    c.from('workspace_room_ai_attendees').select('seq,user_id,display_name').eq('ai_session_id', id).order('seq'),
    c.from('workspace_room_ai_markers').select('id,at_ms,kind,body').eq('ai_session_id', id).order('at_ms'),
    c.from('workspace_room_speaker_corrections').select('id,speaker_key,display_name').eq('ai_session_id', id).order('id'),
  ])
  return {
    attendees: (att.data ?? []) as AiAttendee[],
    markers: (mk.data ?? []) as AiMarker[],
    corrections: (co.data ?? []) as AiCorrection[],
  }
}

export async function listActiveEmployees(): Promise<{ id: string; full_name: string }[]> {
  const { data } = await client().from('employee_profiles').select('id,full_name').eq('active', true).order('full_name').limit(300)
  return ((data ?? []) as { id: string; full_name: string | null }[])
    .filter(r => r.full_name)
    .map(r => ({ id: r.id, full_name: r.full_name as string }))
}

// Raw audio goes straight to the live-transcript function (not through invoke,
// which would JSON-encode the body).
export async function postLiveSlice(sessionId: string, seq: number, offsetMs: number, blob: Blob, mime: string): Promise<boolean> {
  const c = client()
  const { data } = await c.auth.getSession()
  const token = data.session?.access_token
  const base = import.meta.env.VITE_SUPABASE_URL as string
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  if (!token || !base) return false
  try {
    const res = await fetch(`${base}/functions/v1/room-ai-transcribe?session_id=${sessionId}&seq=${seq}&offset_ms=${Math.round(offsetMs)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: key, 'Content-Type': mime },
      body: blob,
    })
    if (!res.ok) return false
    const body = await res.json().catch(() => ({}))
    return !body?.degraded
  } catch {
    return false
  }
}

export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(ms, 0) / 1000)
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

export function speakerName(key: string, corrections: AiCorrection[]): string {
  let fixed = ''
  for (const c of corrections) if (c.speaker_key === key) fixed = c.display_name
  if (fixed) return fixed
  const n = Number(key.replace(/^s/, ''))
  return Number.isFinite(n) ? `Speaker ${n + 1}` : key
}

export function transcriptText(title: string, segs: AiSegment[], corrections: AiCorrection[]): string {
  const lines = [title, '']
  let last = ''
  for (const s of segs) {
    const who = speakerName(s.speaker_key, corrections)
    if (who !== last) {
      if (last) lines.push('')
      lines.push(`[${formatClock(s.start_ms)}] ${who}`)
      last = who
    }
    lines.push(s.text)
  }
  return lines.join('\n').trim() + '\n'
}
