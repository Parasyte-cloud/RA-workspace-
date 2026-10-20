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

// ---------------------------------------------------------------------------
// Workstation safety: emergencies, identity lookup, location sessions,
// watchers, reports, audit, safety settings
// ---------------------------------------------------------------------------

export type IncidentStatus = 'triggered' | 'acknowledged' | 'escalated' | 'resolved'
export type IncidentLocation = { lat: number; lng: number; accuracy_m?: number; heading?: number; recorded_at?: string }
export type IncidentRow = {
  id: string
  public_id: string
  status: IncidentStatus
  subject_type: 'rider' | 'driver'
  activated_at: string
  received_at: string
  last_activation_at: string
  escalation_level: number
  next_escalation_at: string | null
  acknowledged_at: string | null
  resolved_at: string | null
  outcome: string | null
  duplicate_count: number
  assigned_to: string | null
  assigned_name: string | null
  acknowledged_by: string | null
  acknowledged_name: string | null
  /** False for watchers: they see that an emergency exists, not who or where. */
  detail_visible: boolean
  identity_code: string | null
  trip_ref: string | null
  booking_ref: string | null
  vehicle_ref: string | null
  last_location: IncidentLocation | null
  location_age_seconds: number | null
  location_fresh_seconds: number
}
export type IncidentEvent = { id: number; event_type: string; detail: Record<string, unknown>; actor_name: string | null; created_at: string }
export type IncidentDetail = {
  incident: Record<string, unknown>
  original_payload: unknown
  assigned_name: string | null
  events: IncidentEvent[]
  location_sessions: Array<{ id: string; status: string; expires_at: string; requested_by: string; requester_name: string | null }>
}
export const INCIDENT_OUTCOMES = [
  ['assisted_on_scene', 'Assisted, person is safe'],
  ['emergency_services_contacted', 'Emergency services contacted (by staff)'],
  ['false_alarm', 'False alarm, confirmed with the person'],
  ['unreachable', 'Could not reach the person'],
  ['other', 'Other (explain in notes)'],
] as const
export const INCIDENT_ACTIONS = [
  ['note', 'Note'],
  ['contacted_subject', 'Contacted the rider or driver'],
  ['contacted_driver', 'Contacted the driver'],
  ['dispatched_help', 'Dispatched help'],
  ['contacted_emergency_services', 'Contacted emergency services'],
] as const

export async function loadIncidents(): Promise<IncidentRow[]> {
  const { data, error } = await client().from('support_incident_board_view').select('*').order('activated_at', { ascending: false }).limit(100)
  if (error) fail(error, 'Unable to load emergencies')
  return (data || []) as IncidentRow[]
}

export async function canSeeSensitive(): Promise<boolean> {
  const { data, error } = await client().rpc('support_can_see_sensitive')
  if (error) return false
  return Boolean(data)
}

export async function getIncidentDetail(id: string): Promise<IncidentDetail | null> {
  const { data, error } = await client().rpc('support_incident_detail', { p_incident: id })
  if (error) fail(error, 'Unable to open the emergency')
  return (data as IncidentDetail | null) ?? null
}

async function rpcVoid(fn: string, args: Record<string, unknown>, fallback: string) {
  const { error } = await client().rpc(fn, args)
  if (error) fail(error, fallback)
}
export const ackIncident = (id: string) => rpcVoid('support_incident_acknowledge', { p_incident: id }, 'Could not acknowledge')
export const logIncident = (id: string, kind: string, text: string) => rpcVoid('support_incident_log', { p_incident: id, p_kind: kind, p_text: text }, 'Could not record that')
export const reassignIncident = (id: string, to: string, reason: string) => rpcVoid('support_incident_reassign', { p_incident: id, p_to: to, p_reason: reason }, 'Could not reassign')
export const resolveIncident = (id: string, outcome: string, notes: string) => rpcVoid('support_incident_resolve', { p_incident: id, p_outcome: outcome, p_notes: notes }, 'Could not resolve')
export const reopenIncident = (id: string, reason: string) => rpcVoid('support_incident_reopen', { p_incident: id, p_reason: reason }, 'Could not reopen')

export type IdentityResult = {
  status: 'found' | 'not_found' | 'rate_limited'
  code?: string
  subject_type?: 'rider' | 'driver'
  customer_id?: string | null
  display_name?: string | null
  phone?: string | null
  email?: string | null
  full_details?: boolean
  tickets?: Array<{ id: string; public_id: string; subject: string; status: SupportTicketStatus; priority: SupportPriority }>
}
export async function lookupIdentity(code: string, reason: string): Promise<IdentityResult> {
  const { data, error } = await client().rpc('support_lookup_identity', { p_code: code, p_reason: reason || null })
  if (error) fail(error, 'Lookup failed')
  return data as IdentityResult
}

export type LocationSession = { id: string; status: 'pending_approval' | 'active' | 'denied' | 'ended' | 'expired'; expires_at: string; existing?: boolean }
export async function requestLocation(input: { ticketId?: string; incidentId?: string; identityCode?: string; reason: string }): Promise<LocationSession> {
  const { data, error } = await client().rpc('support_request_location', {
    p_ticket: input.ticketId ?? null, p_incident: input.incidentId ?? null, p_identity_code: input.identityCode ?? null, p_reason: input.reason,
  })
  if (error) fail(error, 'Could not open a location session')
  return data as LocationSession
}
export const endLocation = (id: string, reason?: string) => rpcVoid('support_end_location', { p_session: id, p_reason: reason ?? null }, 'Could not end the session')
export const decideLocation = (id: string, approve: boolean, note?: string) => rpcVoid('support_decide_location', { p_session: id, p_approve: approve, p_note: note ?? null }, 'Could not record the decision')

export async function findMyLocationSession(scope: { ticketId?: string; incidentId?: string }, meId: string): Promise<LocationSession | null> {
  let q = client().from('support_location_sessions').select('id, status, expires_at')
    .eq('requested_by', meId).in('status', ['active', 'pending_approval']).gt('expires_at', new Date().toISOString())
  q = scope.incidentId ? q.eq('incident_id', scope.incidentId) : q.eq('ticket_id', scope.ticketId ?? '')
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1)
  if (error) return null
  return ((data || [])[0] as LocationSession | undefined) ?? null
}
export async function getLocationSession(id: string): Promise<LocationSession | null> {
  const { data } = await client().from('support_location_sessions').select('id, status, expires_at').eq('id', id).maybeSingle()
  return (data as LocationSession | null) ?? null
}

export type LocationReading = {
  ok: true
  state: 'live' | 'stale' | 'unavailable' | 'not_configured'
  ageSeconds: number | null
  location: { lat: number; lng: number; heading?: number; speed_kmh?: number; accuracy_m?: number; recorded_at?: string } | null
  trip: { status?: string; booking_ref?: string; pickup?: { lat: number; lng: number; label?: string }; dropoff?: { lat: number; lng: number; label?: string }; eta_minutes?: number; vehicle?: string; driver_name?: string; route?: Array<[number, number]> } | null
  trail?: Array<{ lat: number; lng: number; recorded_at?: string }> | null
  source: 'live_service' | 'sos_event' | null
  warning: string | null
  expiresAt: string
  freshSeconds: number
}
export const fetchLocation = (sessionId: string) => invokeSupport<LocationReading>('support-location', { sessionId })

export type PendingLocation = { id: string; status: string; reason: string; requested_by: string; ticket_id: string | null; incident_id: string | null; expires_at: string; created_at: string }
export async function loadLiveLocationSessions(): Promise<PendingLocation[]> {
  const { data, error } = await client().from('support_location_sessions')
    .select('id, status, reason, requested_by, ticket_id, incident_id, expires_at, created_at')
    .in('status', ['pending_approval', 'active']).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(50)
  if (error) fail(error, 'Unable to load location sessions')
  return (data || []) as PendingLocation[]
}

export async function loadWatchers(ticketId: string): Promise<string[]> {
  const { data } = await client().from('support_ticket_watchers').select('employee_id').eq('ticket_id', ticketId)
  return (data || []).map((r: { employee_id: string }) => r.employee_id)
}
export const watchTicket = (ticketId: string) => rpcVoid('support_watch_ticket', { p_ticket: ticketId, p_employee: null }, 'Could not watch the ticket')
export const unwatchTicket = (ticketId: string) => rpcVoid('support_unwatch_ticket', { p_ticket: ticketId, p_employee: null }, 'Could not stop watching')

export type SafetySettings = {
  location_session_minutes: number; location_requires_approval: boolean; location_max_active_per_officer: number; location_fresh_seconds: number
  location_log_retention_days: number; identity_lookups_per_10min: number; identity_failed_per_10min: number
  incident_ack_seconds: number; incident_escalate_seconds: number; incident_followup_seconds: number; incident_max_level: number
}
export async function loadSafetySettings(): Promise<SafetySettings | null> {
  const { data, error } = await client().from('support_safety_settings').select('*').maybeSingle()
  if (error) fail(error, 'Unable to load safety settings')
  return (data as SafetySettings | null) ?? null
}
export async function saveSafetySettings(patch: Partial<SafetySettings>): Promise<SafetySettings> {
  const { data, error } = await client().rpc('support_update_safety_settings', { p_patch: patch })
  if (error) fail(error, 'Could not save safety settings')
  return data as SafetySettings
}

export type AuditRow = { id: number; created_at: string; actor_id: string | null; actor_name: string | null; action: string; entity_type: string | null; entity_id: string | null; payload: Record<string, unknown> }
export async function searchAudit(f: { action?: string; actor?: string; from?: string; to?: string; limit?: number }): Promise<AuditRow[]> {
  const { data, error } = await client().rpc('support_audit_search', {
    p_action: f.action || null, p_actor: f.actor || null, p_from: f.from || null, p_to: f.to || null, p_limit: f.limit ?? 200,
  })
  if (error) fail(error, 'Unable to search the audit log')
  return (data || []) as AuditRow[]
}

export type SupportReport = {
  range: { from: string; to: string }
  cases: {
    total: number; open: number; resolved: number; reopened: number; escalated: number
    avg_first_response_minutes: number | null; avg_resolution_minutes: number | null; avg_waiting_minutes: number | null; avg_active_minutes: number | null
    first_response_sla_pct: number | null; resolution_sla_pct: number | null
  }
  by_category: Array<{ category: string; total: number; open: number; resolved: number }>
  by_priority: Array<{ priority: string; total: number }>
  by_agent: Array<{ employee_id: string; name: string; handled: number; resolved: number; avg_resolution_minutes: number | null }>
  queue_aging_now: { unassigned: number; oldest_minutes: number }
  emergencies: { total: number; unresolved: number; escalated: number; avg_seconds_to_acknowledge: number | null; max_seconds_to_acknowledge: number | null; avg_minutes_to_resolve: number | null }
  location: { sessions: number; fetches: number; served: number; stale: number; unavailable: number; availability_pct: number | null }
}
export async function loadReport(f: { from?: string; to?: string; agent?: string; category?: string }): Promise<SupportReport> {
  const { data, error } = await client().rpc('support_report_summary', {
    p_from: f.from || null, p_to: f.to || null, p_agent: f.agent || null, p_category: f.category || null,
  })
  if (error) fail(error, 'Unable to build the report')
  return data as SupportReport
}
export const logExport = (kind: string, rows: number) => rpcVoid('support_log_export', { p_kind: kind, p_rows: rows }, 'Could not record the export')

/** Seconds as "2m 05s" for emergencies, where seconds matter. */
export function shortAge(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return '-'
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value)
  // A leading = + - @ makes spreadsheets run the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// ---------------------------------------------------------------------------
// Staff invites (support-invite function; list is a direct RPC)
// ---------------------------------------------------------------------------

export type InviteRole = 'watcher' | 'agent' | 'supervisor'
export type StaffInvite = {
  id: string; email: string; full_name: string; phone: string | null; role_kind: InviteRole; job_title: string
  status: 'pending' | 'redeemed' | 'revoked' | 'expired' | 'locked'; attempts: number; expires_at: string; created_at: string
  created_by_name: string | null; last_sent_at: string | null; send_count: number
  delivery: Record<string, { ok: boolean; at: string; detail: string }>; redeemed_at: string | null
  security_state: 'normal' | 'cooldown' | 'held'; cooldown_until: string | null; held_at: string | null
  failed_attempts_window: number
}
export type InviteOutcome = {
  ok: boolean; inviteId: string; expiresAt: string; code: string; joinUrl: string | null
  delivery: Record<string, { ok: boolean; detail: string }>
}

export async function canInviteStaff(): Promise<boolean> {
  const { data, error } = await client().rpc('support_can_invite')
  return !error && data === true
}
export async function listInvites(): Promise<StaffInvite[]> {
  const { data, error } = await client().rpc('support_invites_list')
  if (error) fail(error, 'Unable to load invites')
  return (data || []) as StaffInvite[]
}
export const createInvite = (p: { email: string; fullName: string; phone?: string; roleKind: InviteRole; jobTitle?: string; teamId?: string; channels: Array<'email' | 'whatsapp'> }) =>
  invokeSupport<InviteOutcome>('support-invite', { action: 'create', ...p })
export const resendInvite = (inviteId: string, channels: Array<'email' | 'whatsapp'>) =>
  invokeSupport<InviteOutcome>('support-invite', { action: 'resend', inviteId, channels })
export const revokeInvite = (inviteId: string) => invokeSupport('support-invite', { action: 'revoke', inviteId })
export const delegateInvites = (employeeId: string, value: boolean) => invokeSupport('support-invite', { action: 'delegate', employeeId, value })

// ---------------------------------------------------------------------------
// Alerts outside the screen: notification centre, devices, phone contact, rules
// ---------------------------------------------------------------------------

export type NotificationRow = {
  id: number; kind: string; severity: 'info' | 'warning' | 'critical'; title: string; body: string
  entity_type: string | null; entity_id: string | null; level: number; data: Record<string, unknown> | null
  created_at: string; read_at: string | null
}
export type AlertChannel = 'push' | 'sms' | 'whatsapp' | 'voice'
export type AlertRule = { id: number; kind: string; audience: 'responder' | 'supervisors' | 'on_duty'; channel: AlertChannel; enabled: boolean; min_level: number; delay_seconds: number }
export type MyContact = { phone: string | null; allow_sms: boolean; allow_whatsapp: boolean; allow_voice: boolean }
export type PushDevice = { id: string; user_agent: string | null; created_at: string; last_success_at: string | null }
export type DeliveryReport = {
  by_channel: Array<{ channel: AlertChannel; sent: number; failed: number; skipped: number; queued: number }>
  oldest_queued_seconds: number | null
  recent_problems: Array<{ at: string; channel: AlertChannel; status: string; error: string | null; kind: string; title: string; recipient: string }>
  staff_without_path: Array<{ employee_id: string; name: string; push: boolean; phone: boolean }>
}

export async function loadNotifications(limit = 40): Promise<NotificationRow[]> {
  const { data, error } = await client().from('support_notifications')
    .select('id, kind, severity, title, body, entity_type, entity_id, level, data, created_at, read_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) fail(error, 'Unable to load notifications')
  return (data || []) as NotificationRow[]
}
export async function markNotificationsRead(ids?: number[]): Promise<void> {
  const { error } = await client().rpc('support_notifications_mark_read', { p_ids: ids ?? null })
  if (error) fail(error, 'Unable to mark as read')
}
export async function loadMyContact(): Promise<MyContact> {
  const { data: u } = await client().auth.getUser()
  const id = u.user?.id
  if (!id) return { phone: null, allow_sms: true, allow_whatsapp: true, allow_voice: true }
  const { data } = await client().from('support_staff_contacts').select('phone, allow_sms, allow_whatsapp, allow_voice').eq('employee_id', id).maybeSingle()
  return (data as MyContact | null) ?? { phone: null, allow_sms: true, allow_whatsapp: true, allow_voice: true }
}
export async function saveMyContact(c: { phone: string; sms: boolean; whatsapp: boolean; voice: boolean }): Promise<void> {
  const { error } = await client().rpc('support_set_my_contact', { p_phone: c.phone, p_sms: c.sms, p_whatsapp: c.whatsapp, p_voice: c.voice })
  if (error) fail(error, 'Unable to save your number')
}
export const pushConfig = () => invokeSupport<{ publicKey: string | null; configured: boolean }>('support-taskrouter-control', { action: 'push_config' })
export const dispatchAlertsNow = () => invokeSupport('support-taskrouter-control', { action: 'notify_dispatch' })
export async function registerPushDevice(sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string): Promise<void> {
  const { error } = await client().rpc('support_push_subscribe', { p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth, p_user_agent: userAgent })
  if (error) fail(error, 'Unable to register this device')
}
export async function unregisterPushDevice(endpoint: string): Promise<void> {
  const { error } = await client().rpc('support_push_unsubscribe', { p_endpoint: endpoint })
  if (error) fail(error, 'Unable to remove this device')
}
export async function myPushDevices(): Promise<PushDevice[]> {
  const { data, error } = await client().rpc('support_my_push_devices')
  if (error) fail(error, 'Unable to load devices')
  return (data || []) as PushDevice[]
}
export async function sendTestAlert(channel: AlertChannel): Promise<void> {
  const { error } = await client().rpc('support_send_test_alert', { p_channel: channel })
  if (error) fail(error, 'Unable to send a test')
  await dispatchAlertsNow().catch(() => undefined)
}
export async function loadAlertRules(): Promise<AlertRule[]> {
  const { data, error } = await client().from('support_alert_rules').select('id, kind, audience, channel, enabled, min_level, delay_seconds').order('kind').order('audience').order('channel')
  if (error) fail(error, 'Unable to load alert rules')
  return (data || []) as AlertRule[]
}
export const saveAlertRule = (id: number, patch: { enabled?: boolean; delaySeconds?: number; minLevel?: number }) =>
  invokeSupport('support-taskrouter-control', { action: 'alert_rule_save', id, ...patch })
export const saveStaffContact = (employeeId: string, c: { phone: string; allowSms: boolean; allowWhatsapp: boolean; allowVoice: boolean }) =>
  invokeSupport('support-taskrouter-control', { action: 'contact_save', employeeId, ...c })
export async function loadDeliveryReport(): Promise<DeliveryReport> {
  const { data, error } = await client().rpc('support_delivery_report')
  if (error) fail(error, 'Unable to load the delivery report')
  return data as DeliveryReport
}
export async function loadStaffContacts(): Promise<Array<{ employee_id: string; phone: string | null; allow_sms: boolean; allow_whatsapp: boolean; allow_voice: boolean }>> {
  const { data, error } = await client().from('support_staff_contacts').select('employee_id, phone, allow_sms, allow_whatsapp, allow_voice')
  if (error) fail(error, 'Unable to load contacts')
  return data || []
}
