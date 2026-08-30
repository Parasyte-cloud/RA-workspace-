import { supabase } from './supabase'

export type AttendanceSession = {
  id: string
  employee_id: string
  work_date: string
  schedule_id: string
  timezone: string
  scheduled_start_time: string
  scheduled_end_time: string
  clock_in_at: string
  clock_out_at: string | null
  status: 'open' | 'closed' | 'corrected'
}

export type AttendanceMetrics = AttendanceSession & {
  scheduled_minutes: number | null
  break_minutes: number | null
  late_minutes: number | null
  early_departure_minutes: number | null
  net_worked_minutes: number | null
  approved_overtime_minutes: number | null
}

export type AttendanceBreak = {
  id: string
  session_id: string
  started_at: string
  ended_at: string | null
  created_at: string
}

export type AttendanceCorrection = {
  id: string
  session_id: string
  employee_id: string
  requested_by: string
  original_clock_in_at: string
  original_clock_out_at: string | null
  requested_clock_in_at: string | null
  requested_clock_out_at: string | null
  reason: string
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
  reviewed_by: string | null
  review_note: string | null
  created_at: string
  reviewed_at: string | null
}

export type AttendanceOvertimeRequest = {
  id: string
  session_id: string
  employee_id: string
  requested_minutes: number
  approved_minutes: number | null
  reason: string
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
  requested_by: string
  reviewed_by: string | null
  review_note: string | null
  created_at: string
  reviewed_at: string | null
}

export type WorkSchedule = {
  id: string
  name: string
  timezone: string
  start_time: string
  end_time: string
  work_days: number[]
  grace_minutes: number
  active: boolean
  is_default: boolean
}

function throwIfError(error: { message?: string } | null) {
  if (error) {
    throw new Error(error.message || 'Attendance request failed')
  }
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  return supabase
}

export async function loadDefaultWorkSchedule() {
  const { data, error } = await requireSupabase()
    .from('work_schedules')
    .select(
      'id,name,timezone,start_time,end_time,work_days,grace_minutes,active,is_default',
    )
    .eq('active', true)
    .eq('is_default', true)
    .maybeSingle()

  throwIfError(error)
  return data as WorkSchedule | null
}

export async function loadMyAttendance(
  fromDate?: string,
  toDate?: string,
) {
  const {
    data: { user },
    error: userError,
  } = await requireSupabase().auth.getUser()

  throwIfError(userError)

  if (!user) {
    throw new Error('Authentication required')
  }

  let query = requireSupabase()
    .from('attendance_daily_metrics')
    .select('*')
    .eq('employee_id', user.id)
    .order('work_date', { ascending: false })

  if (fromDate) {
    query = query.gte('work_date', fromDate)
  }

  if (toDate) {
    query = query.lte('work_date', toDate)
  }

  const { data, error } = await query

  throwIfError(error)
  return (data || []) as AttendanceMetrics[]
}

export async function loadMyAttendanceBreaks(sessionId: string) {
  const { data, error } = await requireSupabase()
    .from('attendance_breaks')
    .select('id,session_id,started_at,ended_at,created_at')
    .eq('session_id', sessionId)
    .order('started_at', { ascending: true })

  throwIfError(error)
  return (data || []) as AttendanceBreak[]
}

export async function clockIn() {
  const { data, error } = await requireSupabase().rpc('attendance_clock_in')
  throwIfError(error)
  return data as string
}

export async function startBreak() {
  const { data, error } = await requireSupabase().rpc('attendance_start_break')
  throwIfError(error)
  return data as string
}

export async function endBreak() {
  const { error } = await requireSupabase().rpc('attendance_end_break')
  throwIfError(error)
}

export async function clockOut() {
  const { error } = await requireSupabase().rpc('attendance_clock_out')
  throwIfError(error)
}

export async function requestAttendanceCorrection(input: {
  sessionId: string
  clockInAt?: string | null
  clockOutAt?: string | null
  reason: string
}) {
  const { data, error } = await requireSupabase().rpc(
    'request_attendance_correction',
    {
      p_session_id: input.sessionId,
      p_clock_in_at: input.clockInAt || null,
      p_clock_out_at: input.clockOutAt || null,
      p_reason: input.reason,
    },
  )

  throwIfError(error)
  return data as string
}

export async function requestAttendanceOvertime(input: {
  sessionId: string
  minutes: number
  reason: string
}) {
  const { data, error } = await requireSupabase().rpc(
    'request_attendance_overtime',
    {
      p_session_id: input.sessionId,
      p_minutes: input.minutes,
      p_reason: input.reason,
    },
  )

  throwIfError(error)
  return data as string
}

export async function reviewAttendanceCorrection(input: {
  correctionId: string
  decision: 'approved' | 'declined'
  reviewNote?: string
}) {
  const { error } = await requireSupabase().rpc(
    'review_attendance_correction',
    {
      p_correction_id: input.correctionId,
      p_decision: input.decision,
      p_review_note: input.reviewNote || null,
    },
  )

  throwIfError(error)
}

export async function reviewAttendanceOvertime(input: {
  requestId: string
  decision: 'approved' | 'declined'
  approvedMinutes?: number | null
  reviewNote?: string
}) {
  const { error } = await requireSupabase().rpc(
    'review_attendance_overtime',
    {
      p_request_id: input.requestId,
      p_decision: input.decision,
      p_approved_minutes:
        input.approvedMinutes === undefined
          ? null
          : input.approvedMinutes,
      p_review_note: input.reviewNote || null,
    },
  )

  throwIfError(error)
}

export async function loadAttendanceCorrections(
  status?: AttendanceCorrection['status'],
) {
  let query = requireSupabase()
    .from('attendance_corrections')
    .select('*')
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  throwIfError(error)

  return (data || []) as AttendanceCorrection[]
}

export async function loadAttendanceOvertimeRequests(
  status?: AttendanceOvertimeRequest['status'],
) {
  let query = requireSupabase()
    .from('attendance_overtime_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  throwIfError(error)

  return (data || []) as AttendanceOvertimeRequest[]
}

export function lagosDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const map = Object.fromEntries(
    parts.map(part => [part.type, part.value]),
  )

  return `${map.year}-${map.month}-${map.day}`
}

export function formatAttendanceTime(
  value: string | null | undefined,
) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value))
}

export function minutesToDuration(
  value: number | null | undefined,
) {
  const minutes = Math.max(0, Math.round(Number(value || 0)))
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  if (!hours) return `${remainder}m`
  if (!remainder) return `${hours}h`

  return `${hours}h ${remainder}m`
}
