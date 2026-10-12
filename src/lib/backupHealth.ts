import type {
  AdminBackupJob,
  AdminBackupSchedule,
} from './adminBackups'

export type BackupHealthLevel = 'critical' | 'warning'

export type BackupHealthIssue = {
  id:
    | 'no-backup'
    | 'runner-offline'
    | 'last-failed'
    | 'schedule-off'
    | 'stale'
    | 'untested'
  level: BackupHealthLevel
  title: string
  detail: string
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

// A queued job normally starts within the writer's polling interval.
// Two hours with no attempt at all means nothing is claiming work.
export const QUEUE_STUCK_AFTER_MS = 2 * HOUR

// How old the newest good backup may be before it is a problem, by how
// often the schedule says one should be made. Each is one cycle plus a
// day and a half of slack for a slow or retried run.
export function staleAfterMs(
  frequency: AdminBackupSchedule['frequency'],
): number {
  if (frequency === 'weekly') return 8.5 * DAY
  if (frequency === 'monthly') return 32 * DAY
  return 36 * HOUR
}

function ageLabel(ms: number): string {
  if (ms >= 2 * DAY) return `${Math.floor(ms / DAY)} days`
  if (ms >= 2 * HOUR) return `${Math.floor(ms / HOUR)} hours`
  return `${Math.max(1, Math.floor(ms / 60_000))} minutes`
}

function time(job: AdminBackupJob): number {
  return Date.parse(job.requested_at) || 0
}

/**
 * Reads the schedule and recent jobs and says what is wrong, worst first.
 * Pure on purpose: no clock, no network, so it can be tested.
 */
export function assessBackupHealth(
  schedule: AdminBackupSchedule | null,
  jobs: AdminBackupJob[],
  now: number = Date.now(),
): BackupHealthIssue[] {
  const issues: BackupHealthIssue[] = []
  const newestFirst = [...jobs].sort((a, b) => time(b) - time(a))

  const succeeded = newestFirst.filter(j => j.status === 'succeeded')
  const lastGood = succeeded[0]

  const waiting = newestFirst.filter(
    j =>
      j.status === 'queued' &&
      j.attempt_count === 0 &&
      now - time(j) > QUEUE_STUCK_AFTER_MS,
  )

  if (waiting.length > 0) {
    const oldest = waiting[waiting.length - 1]
    issues.push({
      id: 'runner-offline',
      level: 'critical',
      title: 'The backup runner is not picking up jobs',
      detail:
        `${waiting.length} request${waiting.length === 1 ? ' has' : 's have'} ` +
        `been waiting for ${ageLabel(now - time(oldest))} with no attempt. ` +
        'Check the Admin Backup Writer workflow: the repository variable ' +
        'ADMIN_BACKUP_WRITER_ENABLED must be true and the ADMIN_BACKUP_* secrets set.',
    })
  }

  if (!lastGood) {
    issues.push({
      id: 'no-backup',
      level: 'critical',
      title: 'No backup has ever completed',
      detail:
        'There is nothing to restore from. Until a job succeeds, ' +
        'the data in this workspace exists in one place only.',
    })
  }

  const latest = newestFirst.find(j => j.status !== 'queued' && j.status !== 'running')
  if (latest && latest.status === 'failed') {
    issues.push({
      id: 'last-failed',
      level: 'critical',
      title: 'The most recent backup failed',
      detail:
        (latest.error_message || 'The runner reported a failure.') +
        ' Open the Admin Backup Writer run in GitHub Actions for the full log.',
    })
  }

  if (!schedule || !schedule.enabled) {
    issues.push({
      id: 'schedule-off',
      level: 'warning',
      title: 'Automatic backups are off',
      detail:
        'Nothing is backed up unless someone presses Backup Now. ' +
        'Turn the schedule on and save it.',
    })
  } else if (lastGood) {
    const completed = Date.parse(lastGood.completed_at || '') || time(lastGood)
    const limit = staleAfterMs(schedule.frequency)
    if (now - completed > limit) {
      issues.push({
        id: 'stale',
        level: 'warning',
        title: 'The newest good backup is out of date',
        detail:
          `The last successful backup finished ${ageLabel(now - completed)} ago, ` +
          `but the schedule is ${schedule.frequency}.`,
      })
    }
  }

  if (lastGood && !jobs.some(j => j.restore_status === 'verified')) {
    issues.push({
      id: 'untested',
      level: 'warning',
      title: 'No backup has been restore-tested',
      detail:
        'A backup that has never been restored is a hope, not a backup. ' +
        'Run a restore drill and record it.',
    })
  }

  const rank = { critical: 0, warning: 1 } as const
  return issues.sort((a, b) => rank[a.level] - rank[b.level])
}
