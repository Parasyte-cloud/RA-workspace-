import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  CalendarClock,
  DatabaseBackup,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react'
import {
  loadAdminBackupJobs,
  loadAdminBackupSchedule,
  requestAdminBackup,
  updateAdminBackupSchedule,
  type AdminBackupFrequency,
  type AdminBackupJob,
  type AdminBackupSchedule,
} from '../lib/adminBackups'

type ScheduleForm = {
  enabled: boolean
  frequency: AdminBackupFrequency
  runTime: string
  dayOfWeek: number | null
  dayOfMonth: number | null
  timezone: string
  retentionDays: number
}

const DEFAULT_FORM: ScheduleForm = {
  enabled: true,
  frequency: 'daily',
  runTime: '02:00',
  dayOfWeek: null,
  dayOfMonth: null,
  timezone: 'Africa/Lagos',
  retentionDays: 30,
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const COVERAGE = [
  ['database', 'Database'],
  ['auth', 'Auth'],
  ['storage', 'Storage'],
  ['repository', 'Repository'],
  [
    'configuration_manifest',
    'Configuration',
  ],
] as const

function scheduleToForm(
  schedule: AdminBackupSchedule | null,
): ScheduleForm {
  if (!schedule) return DEFAULT_FORM

  return {
    enabled: schedule.enabled,
    frequency: schedule.frequency,
    runTime:
      schedule.run_time?.slice(0, 5) || '02:00',
    dayOfWeek: schedule.day_of_week,
    dayOfMonth: schedule.day_of_month,
    timezone:
      schedule.timezone || 'Africa/Lagos',
    retentionDays: schedule.retention_days,
  }
}

function when(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function bytes(value: number | null) {
  if (value === null) return '—'

  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 ** 2) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  if (value < 1024 ** 3) {
    return `${(value / 1024 ** 2).toFixed(1)} MB`
  }

  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

function statusTone(status: AdminBackupJob['status']) {
  if (status === 'succeeded') return 'ok'
  if (status === 'failed') return 'off'
  return 'idle'
}

function restoreTone(
  status: AdminBackupJob['restore_status'],
) {
  if (status === 'verified') return 'ok'
  if (status === 'failed') return 'off'
  return 'idle'
}

export default function AdminBackupsPanel() {
  const [schedule, setSchedule] =
    useState<AdminBackupSchedule | null>(null)

  const [jobs, setJobs] =
    useState<AdminBackupJob[]>([])

  const [form, setForm] =
    useState<ScheduleForm>(DEFAULT_FORM)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [requesting, setRequesting] =
    useState(false)

  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const [
        nextSchedule,
        nextJobs,
      ] = await Promise.all([
        loadAdminBackupSchedule(),
        loadAdminBackupJobs(25),
      ])

      setSchedule(nextSchedule)
      setForm(scheduleToForm(nextSchedule))
      setJobs(nextJobs)
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to load backup controls.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const latestJob = jobs[0] || null

  const verifiedCount = useMemo(
    () =>
      jobs.filter(
        (job) =>
          job.restore_status === 'verified',
      ).length,
    [jobs],
  )

  const activeCount = useMemo(
    () =>
      jobs.filter(
        (job) =>
          job.status === 'queued' ||
          job.status === 'running',
      ).length,
    [jobs],
  )

  const handleBackupNow = async () => {
    setRequesting(true)
    setNotice('')
    setError('')

    try {
      const jobId = await requestAdminBackup()

      setNotice(
        `Backup request queued. Job ${jobId.slice(
          0,
          8,
        )}…`,
      )

      const nextJobs =
        await loadAdminBackupJobs(25)

      setJobs(nextJobs)
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to queue backup.',
      )
    } finally {
      setRequesting(false)
    }
  }

  const handleSaveSchedule = async () => {
    setSaving(true)
    setNotice('')
    setError('')

    try {
      await updateAdminBackupSchedule({
        enabled: form.enabled,
        frequency: form.frequency,
        runTime: form.runTime,
        dayOfWeek:
          form.frequency === 'weekly'
            ? form.dayOfWeek
            : null,
        dayOfMonth:
          form.frequency === 'monthly'
            ? form.dayOfMonth
            : null,
        timezone: form.timezone,
        retentionDays: form.retentionDays,
      })

      const nextSchedule =
        await loadAdminBackupSchedule()

      setSchedule(nextSchedule)
      setForm(scheduleToForm(nextSchedule))

      setNotice('Backup schedule updated.')
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to update backup schedule.',
      )
    } finally {
      setSaving(false)
    }
  }

  const resetScheduleForm = () => {
    setForm(scheduleToForm(schedule))
    setNotice('')
    setError('')
  }

  return (
    <section className="adminBackupsPanel">
      <div className="glassCard adminBackupHero">
        <div>
          <span className="eyebrow">
            DISASTER RECOVERY
          </span>

          <h3>Backup Control Centre</h3>

          <p>
            Schedule and request full recovery
            backups covering application data,
            authentication, stored files,
            repository state and configuration
            inventory.
          </p>
        </div>

        <button
          className="glassButton"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={15} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="glassCard adminBackupSecurity">
        <ShieldCheck size={18} />

        <div>
          <strong>
            Privileged execution remains server-side
          </strong>

          <p>
            This workstation can read backup state,
            update the approved schedule and queue a
            backup request. Runner credentials,
            storage credentials and encryption keys
            are never exposed to the browser.
          </p>
        </div>
      </div>

      {error && (
        <div
          className="glassCard adminBackupNotice off"
          role="alert"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          className="glassCard adminBackupNotice ok"
          role="status"
        >
          {notice}
        </div>
      )}

      <div className="adminBackupMetrics">
        <div className="glassCard adminBackupMetric">
          <CalendarClock size={18} />
          <span>Schedule</span>
          <strong>
            {schedule?.enabled
              ? schedule.frequency
              : 'Disabled'}
          </strong>
        </div>

        <div className="glassCard adminBackupMetric">
          <DatabaseBackup size={18} />
          <span>Active jobs</span>
          <strong>{activeCount}</strong>
        </div>

        <div className="glassCard adminBackupMetric">
          <ShieldCheck size={18} />
          <span>Restore verified</span>
          <strong>{verifiedCount}</strong>
        </div>

        <div className="glassCard adminBackupMetric">
          <HardDrive size={18} />
          <span>Latest state</span>
          <strong>
            {latestJob?.status || 'No jobs'}
          </strong>
        </div>
      </div>

      <div className="adminBackupGrid">
        <section className="glassCard adminBackupSchedule">
          <div className="adminBackupSectionHeader">
            <div>
              <span className="eyebrow">
                AUTOMATION
              </span>
              <h3>Backup schedule</h3>
            </div>

            <label className="adminBackupToggle">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    enabled:
                      event.target.checked,
                  }))
                }
              />
              Enabled
            </label>
          </div>

          <div className="adminBackupFormGrid">
            <label>
              <span>Frequency</span>
              <select
                value={form.frequency}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    frequency:
                      event.target
                        .value as AdminBackupFrequency,
                    dayOfWeek:
                      event.target.value ===
                      'weekly'
                        ? current.dayOfWeek ?? 1
                        : null,
                    dayOfMonth:
                      event.target.value ===
                      'monthly'
                        ? current.dayOfMonth ?? 1
                        : null,
                  }))
                }
              >
                <option value="daily">
                  Daily
                </option>
                <option value="weekly">
                  Weekly
                </option>
                <option value="monthly">
                  Monthly
                </option>
              </select>
            </label>

            <label>
              <span>Run time</span>
              <input
                type="time"
                value={form.runTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    runTime: event.target.value,
                  }))
                }
              />
            </label>

            {form.frequency === 'weekly' && (
              <label>
                <span>Day</span>
                <select
                  value={form.dayOfWeek ?? 1}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dayOfWeek: Number(
                        event.target.value,
                      ),
                    }))
                  }
                >
                  {WEEKDAYS.map(
                    (weekday, index) => (
                      <option
                        key={weekday}
                        value={index}
                      >
                        {weekday}
                      </option>
                    ),
                  )}
                </select>
              </label>
            )}

            {form.frequency === 'monthly' && (
              <label>
                <span>Day of month</span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.dayOfMonth ?? 1}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dayOfMonth: Number(
                        event.target.value,
                      ),
                    }))
                  }
                />
              </label>
            )}

            <label>
              <span>Timezone</span>
              <input
                type="text"
                value={form.timezone}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    timezone:
                      event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Retention days</span>
              <input
                type="number"
                min={7}
                max={3650}
                value={form.retentionDays}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    retentionDays: Number(
                      event.target.value,
                    ),
                  }))
                }
              />
            </label>
          </div>

          <div className="adminBackupActions">
            <button
              type="button"
              className="glassButton"
              onClick={resetScheduleForm}
              disabled={saving}
            >
              <RotateCcw size={15} />
              Reset
            </button>

            <button
              type="button"
              className="glassButton primary"
              onClick={() =>
                void handleSaveSchedule()
              }
              disabled={saving}
            >
              <Save size={15} />
              {saving
                ? 'Saving…'
                : 'Save schedule'}
            </button>
          </div>
        </section>

        <section className="glassCard adminBackupManual">
          <span className="eyebrow">
            MANUAL RECOVERY POINT
          </span>

          <DatabaseBackup size={28} />

          <h3>Backup Now</h3>

          <p>
            Queue an immediate full backup request.
            The trusted server-side runner claims and
            executes the job without exposing
            privileged credentials to this
            workstation.
          </p>

          <div className="adminBackupCoverage">
            {COVERAGE.map(([key, label]) => (
              <span key={key}>
                <ShieldCheck size={12} />
                {label}
              </span>
            ))}
          </div>

          <button
            type="button"
            className="glassButton primary"
            onClick={() =>
              void handleBackupNow()
            }
            disabled={requesting}
          >
            <DatabaseBackup size={16} />
            {requesting
              ? 'Queuing…'
              : 'Backup Now'}
          </button>
        </section>
      </div>

      <section className="glassCard adminBackupHistory">
        <div className="adminBackupSectionHeader">
          <div>
            <span className="eyebrow">
              RECOVERY HISTORY
            </span>
            <h3>Recent backup jobs</h3>
          </div>

          <span>
            {jobs.length} recent
            {jobs.length === 1 ? ' job' : ' jobs'}
          </span>
        </div>

        {loading && jobs.length === 0 ? (
          <div className="adminEmpty">
            Loading backup history…
          </div>
        ) : jobs.length === 0 ? (
          <div className="adminEmpty">
            No backup jobs have been recorded yet.
          </div>
        ) : (
          <div className="adminBackupJobList">
            {jobs.map((job) => (
              <article
                key={job.id}
                className="adminBackupJob"
              >
                <div className="adminBackupJobPrimary">
                  <div>
                    <strong
                      title={job.id}
                    >
                      {job.trigger_source ===
                      'manual'
                        ? 'Manual backup'
                        : 'Scheduled backup'}
                    </strong>

                    <small>
                      {when(job.requested_at)}
                      {' · '}
                      {job.id.slice(0, 8)}…
                    </small>
                  </div>

                  <span
                    className={`adminState ${statusTone(
                      job.status,
                    )}`}
                  >
                    {job.status}
                  </span>
                </div>

                <div className="adminBackupJobMeta">
                  <span>
                    Attempts
                    <strong>
                      {job.attempt_count}
                    </strong>
                  </span>

                  <span>
                    Artifact
                    <strong>
                      {bytes(
                        job.artifact_bytes,
                      )}
                    </strong>
                  </span>

                  <span>
                    Restore
                    <strong
                      className={`adminState ${restoreTone(
                        job.restore_status,
                      )}`}
                    >
                      {job.restore_status}
                    </strong>
                  </span>

                  <span>
                    Retain until
                    <strong>
                      {when(
                        job.retention_until,
                      )}
                    </strong>
                  </span>
                </div>

                <div className="adminBackupCoverage compact">
                  {COVERAGE.map(
                    ([key, label]) => (
                      <span
                        key={key}
                        className={
                          job.coverage?.[key]
                            ? 'covered'
                            : 'missing'
                        }
                      >
                        {label}
                      </span>
                    ),
                  )}
                </div>

                {job.error_message && (
                  <p
                    className="adminBackupJobError"
                    role="alert"
                  >
                    {job.error_message}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
