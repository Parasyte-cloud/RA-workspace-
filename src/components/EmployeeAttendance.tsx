import {
  Coffee,
  LogIn,
  LogOut,
  RefreshCw,
  TimerReset,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  clockIn,
  clockOut,
  endBreak,
  formatAttendanceTime,
  lagosDateKey,
  loadDefaultWorkSchedule,
  loadMyAttendance,
  loadMyAttendanceBreaks,
  minutesToDuration,
  startBreak,
  type AttendanceBreak,
  type AttendanceMetrics,
  type WorkSchedule,
} from '../lib/attendance'
import '../employee-attendance.css'

type BusyAction =
  | 'clock-in'
  | 'start-break'
  | 'end-break'
  | 'clock-out'
  | 'refresh'
  | null

function errorMessage(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : String(error || '')

  const value = raw.toLowerCase()

  if (
    value.includes('jwt') ||
    value.includes('session') ||
    value.includes('authentication required') ||
    value.includes('not authenticated')
  ) {
    return 'Your session has expired. Sign in again and retry.'
  }

  if (
    value.includes('permission') ||
    value.includes('row-level security') ||
    value.includes('rls') ||
    value.includes('forbidden') ||
    value.includes('not allowed')
  ) {
    return 'You do not have permission to perform this attendance action.'
  }

  if (
    value.includes('failed to fetch') ||
    value.includes('network') ||
    value.includes('offline') ||
    value.includes('fetch')
  ) {
    return 'We could not reach the attendance service. Check your connection and try again.'
  }

  if (
    value.includes('schedule') &&
    (
      value.includes('unavailable') ||
      value.includes('not found')
    )
  ) {
    return 'The company attendance schedule is temporarily unavailable. Please try again shortly.'
  }

  return 'Attendance is temporarily unavailable. Please try again.'
}

function scheduleDaysLabel(
  workDays: number[] | null | undefined,
) {
  const names:Record<number,string> = {
    1:'Monday',
    2:'Tuesday',
    3:'Wednesday',
    4:'Thursday',
    5:'Friday',
    6:'Saturday',
    7:'Sunday',
  }

  const days =
    (workDays || [])
      .filter(day => names[day])

  if (!days.length) {
    return 'Schedule unavailable'
  }

  if (days.join(',') === '1,2,3,4,5') {
    return 'Monday – Friday'
  }

  return days
    .map(day => names[day])
    .join(', ')
}

function scheduleTime(value?: string | null) {
  if (!value) return '—'

  const [hourRaw, minuteRaw] = value.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw || 0)

  if (!Number.isFinite(hour)) return value

  const suffix = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12

  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)

  if (!year || !month || !day) return value

  return new Intl.DateTimeFormat('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  }).format(
    new Date(Date.UTC(year, month - 1, day, 12, 0, 0)),
  )
}

export default function EmployeeAttendance() {
  const [schedule, setSchedule] =
    useState<WorkSchedule | null>(null)

  const [today, setToday] =
    useState<AttendanceMetrics | null>(null)

  const [breaks, setBreaks] =
    useState<AttendanceBreak[]>([])

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const todayKey = lagosDateKey()

  const load = useCallback(async () => {
    setError('')

    try {
      const [nextSchedule, sessions] =
        await Promise.all([
          loadDefaultWorkSchedule(),
          loadMyAttendance(todayKey, todayKey),
        ])

      const current = sessions[0] || null

      setSchedule(nextSchedule)
      setToday(current)

      if (current) {
        const nextBreaks =
          await loadMyAttendanceBreaks(current.id)

        setBreaks(nextBreaks)
      } else {
        setBreaks([])
      }
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }, [todayKey])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setLoading(true)

      try {
        await load()
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [load])

  const activeBreak = useMemo(
    () => breaks.find(item => !item.ended_at) || null,
    [breaks],
  )

  const isOpen =
    today?.status === 'open' && !today.clock_out_at

  const run = useCallback(
    async (
      action: Exclude<BusyAction, 'refresh' | null>,
      successMessage: string,
      operation: () => Promise<unknown>,
    ) => {
      setBusy(action)
      setError('')
      setNotice('')

      try {
        await operation()
        await load()
        setNotice(successMessage)
      } catch (nextError) {
        setError(errorMessage(nextError))
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  const refresh = useCallback(async () => {
    setBusy('refresh')
    setNotice('')

    try {
      await load()
    } finally {
      setBusy(null)
    }
  }, [load])

  if (loading) {
    return (
      <section
        className="employeeAttendance glassCard"
        aria-busy="true"
      >
        <div className="attendanceLoading">
          <RefreshCw size={18} className="spinIcon" />
          <span>Loading attendance…</span>
        </div>
      </section>
    )
  }

  return (
    <section className="employeeAttendance glassCard">
      <header className="attendanceHeader">
        <div>
          <span className="eyebrow">
            TIME &amp; ATTENDANCE
          </span>

          <h3>My workday</h3>

          <p>
            {formatDate(todayKey)}
            {' · '}
            Africa/Lagos
          </p>
        </div>

        <button
          type="button"
          className="glassButton attendanceRefresh"
          onClick={() => void refresh()}
          disabled={busy !== null}
          aria-label="Refresh attendance"
        >
          <RefreshCw
            size={15}
            className={
              busy === 'refresh' ? 'spinIcon' : ''
            }
          />
          Refresh
        </button>
      </header>

      <div className="attendanceSchedule">
        <div>
          <span>Standard workday</span>
          <strong>
            {scheduleTime(schedule?.start_time)}
            {' – '}
            {scheduleTime(schedule?.end_time)}
          </strong>
        </div>

        <div>
          <span>Work week</span>
          <strong>{scheduleDaysLabel(schedule?.work_days)}</strong>
        </div>

        <div>
          <span>Timezone</span>
          <strong>
            {schedule?.timezone || 'Africa/Lagos'}
          </strong>
        </div>
      </div>

      {error && (
        <div
          className="attendanceMessage attendanceError"
          role="alert"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          className="attendanceMessage attendanceSuccess"
          role="status"
        >
          {notice}
        </div>
      )}

      {!today ? (
        <div className="attendanceNotStarted">
          <div className="attendanceStateIcon">
            <LogIn size={22} />
          </div>

          <div>
            <strong>Your workday has not started.</strong>
            <p>
              Clock in when you begin work. The recorded
              timestamp comes from the RideArrivo server.
            </p>
          </div>

          <button
            type="button"
            className="primaryButton"
            disabled={busy !== null}
            onClick={() =>
              void run(
                'clock-in',
                'Clock-in recorded.',
                clockIn,
              )
            }
          >
            <LogIn size={16} />
            {busy === 'clock-in'
              ? 'Clocking in…'
              : 'Clock In'}
          </button>
        </div>
      ) : (
        <>
          <div className="attendanceMetrics">
            <article>
              <span>Clock in</span>
              <strong>
                {formatAttendanceTime(today.clock_in_at)}
              </strong>
              <small>
                {Number(today.late_minutes || 0) > 0
                  ? `${minutesToDuration(
                      today.late_minutes,
                    )} late`
                  : 'On time'}
              </small>
            </article>

            <article>
              <span>Clock out</span>
              <strong>
                {formatAttendanceTime(today.clock_out_at)}
              </strong>
              <small>
                {today.clock_out_at
                  ? 'Workday completed'
                  : 'Still working'}
              </small>
            </article>

            <article>
              <span>Worked</span>
              <strong>
                {minutesToDuration(
                  today.net_worked_minutes,
                )}
              </strong>
              <small>
                Net of recorded breaks
              </small>
            </article>

            <article>
              <span>Breaks</span>
              <strong>
                {minutesToDuration(today.break_minutes)}
              </strong>
              <small>
                {breaks.length
                  ? `${breaks.length} recorded`
                  : 'No breaks recorded'}
              </small>
            </article>
          </div>

          {activeBreak && (
            <div
              className="attendanceBreakActive"
              role="status"
            >
              <Coffee size={18} />

              <div>
                <strong>Break in progress</strong>
                <span>
                  Started at{' '}
                  {formatAttendanceTime(
                    activeBreak.started_at,
                  )}
                </span>
              </div>
            </div>
          )}

          {isOpen && (
            <div className="attendanceActions">
              {!activeBreak ? (
                <button
                  type="button"
                  className="glassButton"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      'start-break',
                      'Break started.',
                      startBreak,
                    )
                  }
                >
                  <Coffee size={16} />
                  {busy === 'start-break'
                    ? 'Starting…'
                    : 'Start Break'}
                </button>
              ) : (
                <button
                  type="button"
                  className="glassButton"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      'end-break',
                      'Break ended.',
                      endBreak,
                    )
                  }
                >
                  <TimerReset size={16} />
                  {busy === 'end-break'
                    ? 'Ending…'
                    : 'End Break'}
                </button>
              )}

              <button
                type="button"
                className="primaryButton"
                disabled={
                  busy !== null || Boolean(activeBreak)
                }
                title={
                  activeBreak
                    ? 'End your active break before clocking out'
                    : undefined
                }
                onClick={() =>
                  void run(
                    'clock-out',
                    'Clock-out recorded.',
                    clockOut,
                  )
                }
              >
                <LogOut size={16} />
                {busy === 'clock-out'
                  ? 'Clocking out…'
                  : 'Clock Out'}
              </button>
            </div>
          )}

          {!isOpen && (
            <div className="attendanceCompleted">
              <strong>Workday completed</strong>
              <span>
                Recorded attendance for {formatDate(today.work_date)}.
              </span>
            </div>
          )}
        </>
      )}

      <footer className="attendancePrivacyNote">
        Attendance actions use server-recorded timestamps.
        Changing your computer clock does not change the
        official attendance record.
      </footer>
    </section>
  )
}
