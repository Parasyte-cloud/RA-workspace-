// RA Support Command Centre: typed data access for the workspace.
// Reads go through definer views and RPCs that re-check support_is_staff();
// writes that need a provider (Twilio) go through Edge Functions.
//
// PArAsYtE | RA-Workspace support module

import { supabase } from './supabase'

export type SupportChannel = 'voice' | 'whatsapp' | 'web_chat' | 'email' | 'sms' | 'form'
export type SupportAgentState = 'available' | 'busy' | 'on_call' | 'wrap_up' | 'break' | 'away' | 'offline'
export type SupportPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
export type SupportTicketStatus =
  | 'new' | 'queued' | 'assigned' | 'in_progress' | 'waiting_customer' | 'waiting_internal'
  | 'escalated' | 'resolved' | 'closed' | 'reopened'
export type SupportSlaState = 'ok' | 'at_risk' | 'breached' | 'met'

// States an officer may pick by hand. The rest (busy, on_call, wrap_up) are set by the system.
export const SELECTABLE_STATES: SupportAgentState[] = ['available', 'break', 'away', 'offline']

export type SupportAgentPresence = {
  employee_id: string
  display_name: string
  is_supervisor: boolean
  state: SupportAgentState
  state_reason: string | null
  state_changed_at: string | null
  active_shift: boolean
  voice_capacity: number
  voice_active: number
  messaging_capacity: number
  messaging_active: number
  skills: string[]
  last_seen_at: string | null
}

export type SupportQueueSnapshot = {
  id: string
  name: string
  channel: SupportChannel | null
  waiting: number
  sla_at_risk: number
  sla_breached: number
  oldest_wait_seconds: number
}

export type SupportTicketSummary = {
  id: string
  public_id: string
  subject: string
  category: string | null
  channel: SupportChannel
  priority: SupportPriority
  status: SupportTicketStatus
  queue_name: string | null
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  assigned_agent_id: string | null
  assigned_agent_name: string | null
  first_response_due_at: string | null
  resolution_due_at: string | null
  first_responded_at: string | null
  last_customer_message_at: string | null
  created_at: string
  updated_at: string
  sla_state: SupportSlaState
}

export type SupportCall = {
  id: string
  ticket_id: string | null
  public_id: string | null
  direction: 'inbound' | 'outbound' | null
  status: string
  from_number: string | null
  to_number: string | null
  assigned_agent_name: string | null
  ringing_agent_id: string | null
  abandoned: boolean
  answered_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  wait_seconds: number | null
  created_at: string
  customer_name: string | null
  subject: string | null
  priority: SupportPriority | null
}

export type SupportCallback = {
  id: string
  ticket_id: string
  public_id: string | null
  subject: string | null
  priority: SupportPriority | null
  phone_number: string
  origin: 'agent' | 'missed_call' | 'queue_offer'
  status: 'scheduled' | 'queued' | 'reserved' | 'calling' | 'completed' | 'failed' | 'cancelled'
  attempts: number
  max_attempts: number
  last_error: string | null
  requested_at: string
  not_before: string | null
  assigned_agent_name: string | null
  customer_name: string | null
}

export type SupportKpis = {
  calls_offered: number
  calls_answered: number
  calls_abandoned: number
  answer_rate: number | null
  avg_wait_seconds: number | null
  avg_handle_seconds: number | null
  open_tickets: number
  unassigned_tickets: number
  tickets_today: number
  resolved_today: number
  sla_breached: number
  sla_at_risk: number
  callbacks_pending: number
}

export type SupportChannelStat = { channel: SupportChannel; open_tickets: number; waiting: number; created_today: number }

export type SupportTicketDetail = {
  ticket: SupportTicketSummary & { queue_name: string | null }
  customer: null | {
    id: string
    display_name: string | null
    primary_phone: string | null
    primary_email: string | null
    ticket_count: number
    identities: Array<{ type: string; value: string }>
  }
  interactions: Array<{ id: string; channel: SupportChannel; direction: 'inbound' | 'outbound'; body: string | null; occurred_at: string; metadata: Record<string, unknown> }>
  notes: Array<{ id: string; body: string; created_at: string; author_name: string | null }>
  events: Array<{ id: string; event_type: string; payload: Record<string, unknown>; created_at: string; actor_name: string | null }>
  related: Array<{ id: string; public_id: string; subject: string; status: SupportTicketStatus; priority: SupportPriority; channel: SupportChannel; created_at: string }>
}

export type SupportHeartbeat = {
  provisioned: boolean
  supervisor: boolean
  state?: SupportAgentState
  reason?: string | null
  on_shift?: boolean
}

export type SupportSnapshot = {
  agents: SupportAgentPresence[]
  queues: SupportQueueSnapshot[]
  tickets: SupportTicketSummary[]
  calls: SupportCall[]
  callbacks: SupportCallback[]
  channels: SupportChannelStat[]
  kpis: SupportKpis | null
}

export const EMPTY_SNAPSHOT: SupportSnapshot = { agents: [], queues: [], tickets: [], calls: [], callbacks: [], channels: [], kpis: null }

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function fail(error: { message?: string } | null | undefined, fallback: string): never {
  // Postgres raises plain sentences ("this ticket belongs to another officer"); show them as is.
  throw new Error(error?.message || fallback)
}

export async function invokeSupport<T = Record<string, unknown>>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().functions.invoke(fn, { body })
  if (error) {
    // supabase-js hides the JSON body of non-2xx replies; recover our message when possible.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const parsed = await ctx.json().catch(() => null)
      if (parsed?.error) throw new Error(String(parsed.error))
    }
    throw error
  }
  if (data?.error) throw new Error(String(data.error))
  return data as T
}

export const control = <T = Record<string, unknown>>(body: Record<string, unknown>) => invokeSupport<T>('support-taskrouter-control', body)

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function heartbeat(): Promise<SupportHeartbeat> {
  const { data, error } = await client().rpc('support_heartbeat')
  if (error) fail(error, 'Heartbeat failed')
  return data as SupportHeartbeat
}

export async function loadSnapshot(opts: { supervisor: boolean }): Promise<SupportSnapshot> {
  const c = client()
  const [agents, queues, tickets, calls, callbacks, channels, kpis] = await Promise.all([
    c.from('support_agent_presence_view').select('*').order('display_name'),
    c.from('support_queue_snapshot_view').select('*').order('name'),
    c.from('support_ticket_summary_view').select('*').not('status', 'in', '(closed)').order('updated_at', { ascending: false }).limit(200),
    c.from('support_active_calls_view').select('*').order('created_at', { ascending: false }).limit(100),
    c.from('support_callbacks_view').select('*').order('requested_at', { ascending: false }).limit(100),
    c.from('support_channel_stats_view').select('*'),
    opts.supervisor ? c.from('support_kpi_today_view').select('*').maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const first = agents.error || queues.error || tickets.error || calls.error || callbacks.error || channels.error || kpis.error
  if (first) fail(first, 'Unable to load the Support Command Centre')
  return {
    agents: (agents.data || []) as SupportAgentPresence[],
    queues: (queues.data || []) as SupportQueueSnapshot[],
    tickets: (tickets.data || []) as SupportTicketSummary[],
    calls: (calls.data || []) as SupportCall[],
    callbacks: (callbacks.data || []) as SupportCallback[],
    channels: (channels.data || []) as SupportChannelStat[],
    kpis: (kpis.data || null) as SupportKpis | null,
  }
}

export async function getTicketDetail(ticketId: string): Promise<SupportTicketDetail | null> {
  const { data, error } = await client().rpc('support_ticket_detail', { p_ticket: ticketId })
  if (error) fail(error, 'Unable to load the ticket')
  return (data as SupportTicketDetail | null) ?? null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function claimTicket(ticketId: string) {
  const { error } = await client().rpc('support_claim_ticket', { p_ticket: ticketId })
  if (error) fail(error, 'Unable to take the ticket')
}

export async function assignTicket(ticketId: string, employeeId: string | null) {
  const { error } = await client().rpc('support_assign_ticket', { p_ticket: ticketId, p_to: employeeId })
  if (error) fail(error, 'Unable to assign the ticket')
}

export async function updateTicket(ticketId: string, patch: { status?: SupportTicketStatus; priority?: SupportPriority; category?: string; subject?: string }) {
  const { error } = await client().rpc('support_update_ticket', {
    p_ticket: ticketId,
    p_status: patch.status ?? null,
    p_priority: patch.priority ?? null,
    p_category: patch.category ?? null,
    p_subject: patch.subject ?? null,
  })
  if (error) fail(error, 'Unable to update the ticket')
}

export async function addNote(ticketId: string, body: string) {
  const text = body.trim()
  if (!text) throw new Error('Write a note first.')
  const { error } = await client().rpc('support_add_note', { p_ticket: ticketId, p_body: text })
  if (error) fail(error, 'Unable to save the note')
}

export const setMyState = (state: SupportAgentState) => control<{ ok: true; state: SupportAgentState; routing: boolean }>({ action: 'presence', state })

export const queueCallback = (input: { ticketId: string; phoneNumber: string; notBefore?: string }) =>
  control<{ ok: true; callbackId: string; taskSid: string | null }>({ action: 'queue_callback', ...input })

// ---------------------------------------------------------------------------
// Realtime: refresh when anything we show changes. Debounced so a burst of
// inserts is one reload, with the caller keeping a polling fallback.
// ---------------------------------------------------------------------------

const WATCHED = ['support_tickets', 'support_interactions', 'support_agent_presence', 'support_calls', 'support_callbacks']

export function watchSupport(onChange: () => void): () => void {
  if (!supabase) return () => undefined
  const c = supabase
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 400)
  }
  let channel = c.channel('support-command-centre')
  for (const table of WATCHED) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, fire)
  channel.subscribe()
  return () => {
    if (timer) clearTimeout(timer)
    void c.removeChannel(channel)
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers shared by the views
// ---------------------------------------------------------------------------

export function formatDuration(totalSeconds: number | null | undefined): string {
  const value = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const h = Math.floor(value / 3600)
  const m = Math.floor((value % 3600) / 60)
  const s = value % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never'
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function dueLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const diff = Math.floor((Date.parse(iso) - now) / 1000)
  const abs = Math.abs(diff)
  const text = abs < 3600 ? `${Math.max(1, Math.floor(abs / 60))}m` : `${Math.floor(abs / 3600)}h ${Math.floor((abs % 3600) / 60)}m`
  return diff >= 0 ? `due in ${text}` : `${text} overdue`
}

export const label = (value: string | null | undefined) => (value || '').replace(/_/g, ' ')

// ---------------------------------------------------------------------------
// Telephony controls: health, alerts, recordings
// ---------------------------------------------------------------------------

export type TelephonyHealth = {
  samples_24h: number
  avg_mos: number | null
  avg_jitter_ms: number | null
  avg_rtt_ms: number | null
  avg_loss_pct: number | null
  poor_samples_24h: number
  outbound_24h: number
  outbound_asr: number | null
  outbound_acd_seconds: number | null
  spend_today: number
  spend_cap_daily: number | null
  spend_alert_daily: number | null
  open_fraud_alerts: number
  voicemails_open: number
}

export type FraudAlert = {
  id: string
  kind: 'call_burst' | 'many_countries' | 'short_call_burst' | 'spend_alert' | 'spend_cap'
  severity: 'info' | 'warning' | 'critical'
  agent_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

export type TelephonySettings = {
  timezone: string
  hours_enforced: boolean
  closed_message_text: string
  voicemail_enabled: boolean
  voicemail_prompt_text: string
  voicemail_max_seconds: number
  recording_retention_days: number
  voicemail_retention_days: number
  byoc_fallback_to_pstn: boolean
  dnc_enforced: boolean
  spend_alert_daily: number | null
  spend_cap_daily: number | null
  fraud_calls_per_hour: number
}

export type TicketCall = {
  id: string
  direction: 'inbound' | 'outbound' | null
  status: string
  started_at: string | null
  duration_seconds: number | null
  is_voicemail: boolean
  recording_sid: string | null
  recording_deleted_at: string | null
}

export async function loadTelephonyHealth(): Promise<{ health: TelephonyHealth | null; alerts: FraudAlert[] }> {
  const c = client()
  const [health, alerts] = await Promise.all([
    c.from('support_telephony_health_view').select('*').maybeSingle(),
    c.from('support_fraud_alerts').select('id, kind, severity, agent_id, detail, created_at').is('resolved_at', null).order('created_at', { ascending: false }).limit(20),
  ])
  const first = health.error || alerts.error
  if (first) fail(first, 'Unable to load telephony health')
  return { health: (health.data || null) as TelephonyHealth | null, alerts: (alerts.data || []) as FraudAlert[] }
}

export async function loadTicketCalls(ticketId: string): Promise<TicketCall[]> {
  const { data, error } = await client()
    .from('support_calls')
    .select('id, direction, status, started_at, duration_seconds, is_voicemail, recording_sid, recording_deleted_at')
    .eq('ticket_id', ticketId)
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) fail(error, 'Unable to load calls for this ticket')
  return (data || []) as TicketCall[]
}

/** Fetch audited audio for a call and return an object URL. The caller must revoke it. */
export async function fetchRecordingUrl(callId: string): Promise<string> {
  const { data, error } = await client().functions.invoke('support-recording', { body: { callId } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const parsed = await ctx.json().catch(() => null)
      if (parsed?.error) throw new Error(String(parsed.error))
    }
    throw error
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: 'audio/mpeg' })
  return URL.createObjectURL(blob)
}
