import { supabase } from './supabase'

export type AdminBackupFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'

export type AdminBackupJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type AdminBackupRestoreStatus =
  | 'unverified'
  | 'verified'
  | 'failed'

export type AdminBackupCoverage = {
  database?: boolean
  auth?: boolean
  storage?: boolean
  repository?: boolean
  configuration_manifest?: boolean
}

export type AdminBackupSchedule = {
  id: string
  enabled: boolean
  frequency: AdminBackupFrequency
  run_time: string
  day_of_week: number | null
  day_of_month: number | null
  timezone: string
  retention_days: number
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type AdminBackupJob = {
  id: string
  trigger_source: 'manual' | 'schedule'
  status: AdminBackupJobStatus
  requested_by: string | null
  schedule_id: string | null
  scheduled_for: string | null
  coverage: AdminBackupCoverage
  requested_at: string
  started_at: string | null
  completed_at: string | null
  artifact_path: string | null
  artifact_bytes: number | null
  checksum_sha256: string | null
  manifest: Record<string, unknown>
  restore_status: AdminBackupRestoreStatus
  restore_verified_at: string | null
  restore_notes: string | null
  restore_verifier_id: string | null
  restore_verification: Record<string, unknown>
  error_message: string | null
  runner_id: string | null
  attempt_count: number
  heartbeat_at: string | null
  lease_expires_at: string | null
  retention_until: string | null
}

export type UpdateAdminBackupScheduleInput = {
  enabled: boolean
  frequency: AdminBackupFrequency
  runTime: string
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  timezone: string
  retentionDays: number
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  return supabase
}

function normaliseTime(value: string) {
  const trimmed = value.trim()

  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    throw new Error(
      'Backup time must use HH:MM or HH:MM:SS format.',
    )
  }

  return trimmed.length === 5
    ? `${trimmed}:00`
    : trimmed
}

function validateScheduleInput(
  input: UpdateAdminBackupScheduleInput,
) {
  if (
    !['daily', 'weekly', 'monthly'].includes(
      input.frequency,
    )
  ) {
    throw new Error('Invalid backup frequency.')
  }

  if (!input.timezone.trim()) {
    throw new Error('Backup timezone is required.')
  }

  if (
    !Number.isInteger(input.retentionDays) ||
    input.retentionDays < 7 ||
    input.retentionDays > 3650
  ) {
    throw new Error(
      'Retention must be between 7 and 3650 days.',
    )
  }

  if (input.frequency === 'weekly') {
    if (
      !Number.isInteger(input.dayOfWeek) ||
      (input.dayOfWeek as number) < 0 ||
      (input.dayOfWeek as number) > 6
    ) {
      throw new Error(
        'Weekly backups require a weekday from 0 to 6.',
      )
    }
  }

  if (input.frequency === 'monthly') {
    if (
      !Number.isInteger(input.dayOfMonth) ||
      (input.dayOfMonth as number) < 1 ||
      (input.dayOfMonth as number) > 28
    ) {
      throw new Error(
        'Monthly backups require a day from 1 to 28.',
      )
    }
  }
}

export async function loadAdminBackupSchedule():
  Promise<AdminBackupSchedule | null> {
  const db = requireSupabase()

  const { data, error } = await db
    .from('admin_backup_schedules')
    .select(`
      id,
      enabled,
      frequency,
      run_time,
      day_of_week,
      day_of_month,
      timezone,
      retention_days,
      created_by,
      updated_by,
      created_at,
      updated_at
    `)
    .eq('id', 'primary')
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data as AdminBackupSchedule | null
}

export async function loadAdminBackupJobs(
  limit = 25,
): Promise<AdminBackupJob[]> {
  const db = requireSupabase()

  const safeLimit = Math.max(
    1,
    Math.min(100, Math.trunc(limit)),
  )

  const { data, error } = await db
    .from('admin_backup_jobs')
    .select(`
      id,
      trigger_source,
      status,
      requested_by,
      schedule_id,
      scheduled_for,
      coverage,
      requested_at,
      started_at,
      completed_at,
      artifact_path,
      artifact_bytes,
      checksum_sha256,
      manifest,
      restore_status,
      restore_verified_at,
      restore_notes,
      restore_verifier_id,
      restore_verification,
      error_message,
      runner_id,
      attempt_count,
      heartbeat_at,
      lease_expires_at,
      retention_until
    `)
    .order('requested_at', {
      ascending: false,
    })
    .limit(safeLimit)

  if (error) {
    throw new Error(error.message)
  }

  return (data || []) as AdminBackupJob[]
}

export async function requestAdminBackup():
  Promise<string> {
  const db = requireSupabase()

  const { data, error } = await db.rpc(
    'admin_request_backup',
  )

  if (error) {
    throw new Error(error.message)
  }

  if (
    typeof data !== 'string' ||
    data.trim() === ''
  ) {
    throw new Error(
      'Backup request did not return a job identifier.',
    )
  }

  return data
}

export async function updateAdminBackupSchedule(
  input: UpdateAdminBackupScheduleInput,
): Promise<void> {
  validateScheduleInput(input)

  const db = requireSupabase()

  const runTime = normaliseTime(input.runTime)

  const dayOfWeek =
    input.frequency === 'weekly'
      ? input.dayOfWeek ?? null
      : null

  const dayOfMonth =
    input.frequency === 'monthly'
      ? input.dayOfMonth ?? null
      : null

  const { error } = await db.rpc(
    'admin_update_backup_schedule',
    {
      p_enabled: input.enabled,
      p_frequency: input.frequency,
      p_run_time: runTime,
      p_day_of_week: dayOfWeek,
      p_day_of_month: dayOfMonth,
      p_timezone: input.timezone.trim(),
      p_retention_days: input.retentionDays,
    },
  )

  if (error) {
    throw new Error(error.message)
  }
}
