import { supabase } from './supabase'

export type DriverStatus = {
  id: string
  code: string
  label: string
  description: string | null
  is_terminal: boolean
  is_success: boolean
  active: boolean
  sort_order: number
}

export type DriverOutreachCase = {
  ticket_id: string
  public_id: string
  customer_id: string
  driver_name: string | null
  driver_phone: string | null
  area: string | null
  vehicle_details: Record<string, unknown>
  driver_status_id: string | null
  driver_status_code: string | null
  driver_status_label: string | null
  is_terminal: boolean | null
  is_success: boolean | null
  ticket_status: string
  assigned_agent_id: string | null
  assigned_agent_name: string | null
  created_at: string
  updated_at: string
  next_followup_id: string | null
  next_followup_action: string | null
  next_followup_due_at: string | null
  followup_overdue: boolean | null
}


export type DriverTeamActivity = {
  employee_id: string
  officer_name: string
  tickets_today: number
  tickets_7d: number
  calls_today: number
  calls_7d: number
  followups_today: number
  followups_7d: number
}

export type DriverPipeline = {
  status_id: string
  code: string
  label: string
  is_terminal: boolean
  is_success: boolean
  sort_order: number
  driver_count: number
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function fail(error: { message?: string } | null | undefined, fallback: string): never {
  throw new Error(error?.message || fallback)
}

export async function loadDriverOutreach() {
  const c = client()
  const [cases, statuses, pipeline, activity] = await Promise.all([
    c.from('support_driver_outreach_view').select('*').order('updated_at', { ascending: false }).limit(300),
    c.from('support_driver_statuses').select('id, code, label, description, is_terminal, is_success, active, sort_order').order('sort_order').order('label'),
    c.from('support_driver_pipeline_view').select('*').order('sort_order').order('label'),
    c.from('support_driver_team_activity_view').select('*').order('officer_name'),
  ])
  const error = cases.error || statuses.error || pipeline.error || activity.error
  if (error) fail(error, 'Unable to load Driver Outreach CRM')
  return {
    cases: (cases.data || []) as DriverOutreachCase[],
    statuses: (statuses.data || []) as DriverStatus[],
    pipeline: (pipeline.data || []) as DriverPipeline[],
    activity: (activity.data || []) as DriverTeamActivity[],
  }
}

export async function createDriverOutreach(input: {
  name: string
  phone: string
  area?: string
  vehicleDetails?: Record<string, unknown>
  statusId?: string | null
  note?: string
  followUpAction?: string
  followUpDueAt?: string | null
}) {
  const { data, error } = await client().rpc('support_driver_outreach_create', {
    p_name: input.name,
    p_phone: input.phone,
    p_area: input.area || null,
    p_vehicle_details: input.vehicleDetails || {},
    p_status_id: input.statusId || null,
    p_note: input.note || null,
    p_follow_up_action: input.followUpAction || null,
    p_follow_up_due_at: input.followUpDueAt || null,
  })
  if (error) fail(error, 'Unable to create driver outreach ticket')
  return data as string
}

export async function setDriverStatus(ticketId: string, statusId: string) {
  const { error } = await client().rpc('support_driver_set_status', { p_ticket: ticketId, p_status: statusId })
  if (error) fail(error, 'Unable to change driver status')
}

export async function addDriverFollowup(ticketId: string, action: string, dueAt: string) {
  const { error } = await client().rpc('support_driver_add_followup', { p_ticket: ticketId, p_action: action, p_due_at: dueAt })
  if (error) fail(error, 'Unable to add follow-up')
}

export async function completeDriverFollowup(followupId: string) {
  const { error } = await client().rpc('support_driver_complete_followup', { p_followup: followupId })
  if (error) fail(error, 'Unable to complete follow-up')
}

export async function upsertDriverStatus(input: {
  id?: string | null
  code: string
  label: string
  description?: string
  terminal?: boolean
  success?: boolean
  active?: boolean
  sortOrder?: number
}) {
  const { data, error } = await client().rpc('support_driver_status_upsert', {
    p_id: input.id || null,
    p_code: input.code,
    p_label: input.label,
    p_description: input.description || null,
    p_terminal: Boolean(input.terminal),
    p_success: Boolean(input.success),
    p_active: input.active !== false,
    p_sort_order: input.sortOrder ?? 100,
  })
  if (error) fail(error, 'Unable to save driver status')
  return data as string
}

export function watchDriverOutreach(onChange: () => void) {
  if (!supabase) return () => undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 300)
  }
  let channel = supabase.channel('support-driver-outreach')
  for (const table of ['support_driver_cases', 'support_ticket_followups', 'support_driver_statuses']) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, fire)
  }
  channel.subscribe()
  return () => {
    if (timer) clearTimeout(timer)
    void supabase?.removeChannel(channel)
  }
}
