import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Coffee,
  FileCheck2,
  RefreshCw,
  TimerReset,
  Users,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { supabase } from '../lib/supabase'
import {
  formatAttendanceTime,
  lagosDateKey,
  loadAttendanceCorrections,
  loadAttendanceOvertimeRequests,
  loadDefaultWorkSchedule,
  minutesToDuration,
  reviewAttendanceCorrection,
  reviewAttendanceOvertime,
  type AttendanceCorrection,
  type AttendanceMetrics,
  type AttendanceOvertimeRequest,
  type WorkSchedule,
} from '../lib/attendance'
import '../attendance-admin.css'

type View =
  | 'today'
  | 'week'
  | 'month'
  | 'corrections'
  | 'reports'

type Employee = {
  id:string
  full_name:string|null
  email:string
  department:string|null
  job_title:string|null
  role:string
  manager_id:string|null
  active:boolean
}

type Leave = {
  id:string
  employee_id:string
  leave_type:string
  start_date:string
  end_date:string
  status:string
}

type Holiday = {
  id:string
  holiday_date:string
  name:string
}

type ActiveBreak = {
  id:string
  session_id:string
  started_at:string
  ended_at:string|null
}

type SummaryRow = {
  employee:Employee
  expectedDays:number
  presentDays:number
  absentDays:number
  onTimeDays:number
  scheduledMinutes:number
  workedMinutes:number
  overtimeMinutes:number
  lateMinutes:number
  earlyMinutes:number
  incomplete:number
  attendanceRate:number|null
  onTimeRate:number|null
}

type TodayRow = {
  employee:Employee
  metric:AttendanceMetrics|null
  leave:Leave|null
  expected:boolean
  holiday:Holiday|null
  onBreak:boolean
  status:string
}

function requireClient(){
  if(!supabase){
    throw new Error(
      'Supabase is not configured.'
    )
  }
  return supabase
}

function errorMessage(error:unknown){
  const raw =
    error instanceof Error
      ? error.message
      : String(error || '')

  const value = raw.toLowerCase()

  if(
    value.includes('jwt') ||
    value.includes('session') ||
    value.includes('authentication required') ||
    value.includes('not authenticated')
  ){
    return 'Your session has expired. Sign in again and retry.'
  }

  if(
    value.includes('permission') ||
    value.includes('row-level security') ||
    value.includes('rls') ||
    value.includes('forbidden') ||
    value.includes('not allowed')
  ){
    return 'You do not have permission to view or manage this attendance information.'
  }

  if(
    value.includes('failed to fetch') ||
    value.includes('network') ||
    value.includes('offline') ||
    value.includes('fetch')
  ){
    return 'We could not reach the attendance service. Check your connection and try again.'
  }

  if(
    value.includes('schedule') &&
    (
      value.includes('unavailable') ||
      value.includes('not found')
    )
  ){
    return 'The company attendance schedule is temporarily unavailable. Attendance reporting has been paused to avoid incorrect results.'
  }

  return 'The attendance control plane is temporarily unavailable. Please try again.'
}

function parseKey(value:string){
  const [year,month,day]=
    value.split('-').map(Number)

  return new Date(
    Date.UTC(
      year,
      month-1,
      day,
      12,
      0,
      0
    )
  )
}

function keyOf(date:Date){
  return date.toISOString().slice(0,10)
}

function shiftKey(
  value:string,
  days:number
){
  const date=parseKey(value)
  date.setUTCDate(
    date.getUTCDate()+days
  )
  return keyOf(date)
}

function weekRange(today:string){
  const date=parseKey(today)
  const jsDay=date.getUTCDay()
  const isoDay=jsDay===0 ? 7 : jsDay

  const start=shiftKey(
    today,
    -(isoDay-1)
  )

  return {
    start,
    end:shiftKey(start,6),
  }
}

function monthRange(today:string){
  const date=parseKey(today)

  const start=
    `${date.getUTCFullYear()}-${String(
      date.getUTCMonth()+1
    ).padStart(2,'0')}-01`

  const endDate=
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth()+1,
        0,
        12
      )
    )

  return {
    start,
    end:keyOf(endDate),
  }
}

function rangeKeys(
  start:string,
  end:string
){
  const keys:string[]=[]
  let current=start

  while(current<=end){
    keys.push(current)
    current=shiftKey(current,1)
  }

  return keys
}

function isoWeekday(key:string){
  const day=parseKey(key).getUTCDay()
  return day===0 ? 7 : day
}

function scheduledDay(
  key:string,
  schedule:WorkSchedule|null
){
  if(
    !schedule ||
    !schedule.work_days?.length
  ){
    return false
  }

  return schedule.work_days.includes(
    isoWeekday(key)
  )
}

function timeMinutes(
  value:string|undefined|null
){
  if(!value) return 0

  const [hours,minutes]=
    value.split(':').map(Number)

  return (
    (Number.isFinite(hours) ? hours : 0)*60+
    (Number.isFinite(minutes) ? minutes : 0)
  )
}

function scheduleMinutes(
  schedule:WorkSchedule|null
){
  if(
    !schedule?.start_time ||
    !schedule?.end_time
  ){
    return 0
  }

  const start=
    timeMinutes(
      schedule.start_time
    )

  const end=
    timeMinutes(
      schedule.end_time
    )

  return Math.max(0,end-start)
}

function displayDate(key:string){
  return new Intl.DateTimeFormat(
    'en-NG',
    {
      timeZone:'Africa/Lagos',
      day:'numeric',
      month:'short',
      year:'numeric',
    }
  ).format(parseKey(key))
}

function displayScheduleTime(
  value:string|undefined|null
){
  if(!value) return '—'

  const [hourRaw,minuteRaw]=
    value.split(':')

  const hour=Number(hourRaw)
  const minute=Number(minuteRaw || 0)

  if(!Number.isFinite(hour)){
    return value
  }

  const suffix=hour>=12 ? 'PM' : 'AM'
  const displayHour=hour%12 || 12

  return `${displayHour}:${String(
    minute
  ).padStart(2,'0')} ${suffix}`
}

function percent(
  numerator:number,
  denominator:number
){
  if(denominator<=0) return null

  return Math.round(
    (numerator/denominator)*1000
  )/10
}

function percentLabel(
  value:number|null
){
  return value===null
    ? '—'
    : `${value.toFixed(1)}%`
}

function leaveFor(
  leaves:Leave[],
  employeeId:string,
  date:string
){
  return leaves.find(
    leave=>
      leave.employee_id===employeeId &&
      leave.status==='approved' &&
      leave.start_date<=date &&
      leave.end_date>=date
  ) || null
}

function employeeName(
  employee:Employee
){
  return (
    employee.full_name ||
    employee.email ||
    'Employee'
  )
}

function CorrectionReview({
  row,
  name,
  busy,
  onReviewed,
}:{
  row:AttendanceCorrection
  name:string
  busy:boolean
  onReviewed:()=>Promise<void>
}){
  const [note,setNote]=useState('')

  const review=async(
    decision:'approved'|'declined'
  )=>{
    const verb=
      decision==='approved'
        ? 'Approve'
        : 'Decline'

    if(
      !window.confirm(
        `${verb} this attendance correction for ${name}?`
      )
    ){
      return
    }

    await reviewAttendanceCorrection({
      correctionId:row.id,
      decision,
      reviewNote:
        note.trim() || undefined,
    })

    await onReviewed()
  }

  return (
    <article className="attendanceReviewCard">
      <div className="attendanceReviewHead">
        <div>
          <strong>{name}</strong>
          <span>
            Correction request · {displayDate(
              row.created_at.slice(0,10)
            )}
          </span>
        </div>
        <span className="attendanceStatus pending">
          Pending
        </span>
      </div>

      <div className="attendanceCorrectionTimes">
        <div>
          <span>Original clock in</span>
          <strong>
            {formatAttendanceTime(
              row.original_clock_in_at
            )}
          </strong>
        </div>

        <div>
          <span>Requested clock in</span>
          <strong>
            {formatAttendanceTime(
              row.requested_clock_in_at
            )}
          </strong>
        </div>

        <div>
          <span>Original clock out</span>
          <strong>
            {formatAttendanceTime(
              row.original_clock_out_at
            )}
          </strong>
        </div>

        <div>
          <span>Requested clock out</span>
          <strong>
            {formatAttendanceTime(
              row.requested_clock_out_at
            )}
          </strong>
        </div>
      </div>

      <p className="attendanceReason">
        {row.reason}
      </p>

      <label className="attendanceReviewNote">
        Review note
        <textarea
          value={note}
          onChange={event=>
            setNote(event.target.value)
          }
          placeholder="Optional review note"
        />
      </label>

      <div className="attendanceReviewActions">
        <button
          type="button"
          className="glassButton"
          disabled={busy}
          onClick={()=>
            void review('declined')
          }
        >
          Decline
        </button>

        <button
          type="button"
          className="primaryButton"
          disabled={busy}
          onClick={()=>
            void review('approved')
          }
        >
          <CheckCircle2 size={15}/>
          Approve correction
        </button>
      </div>
    </article>
  )
}

function OvertimeReview({
  row,
  name,
  busy,
  onReviewed,
}:{
  row:AttendanceOvertimeRequest
  name:string
  busy:boolean
  onReviewed:()=>Promise<void>
}){
  const [note,setNote]=useState('')
  const [minutes,setMinutes]=
    useState(
      String(row.requested_minutes)
    )

  const review=async(
    decision:'approved'|'declined'
  )=>{
    const approved=
      Math.max(
        0,
        Math.min(
          720,
          Number(minutes) || 0
        )
      )

    if(
      decision==='approved' &&
      approved<=0
    ){
      window.alert(
        'Enter approved overtime minutes.'
      )
      return
    }

    const verb=
      decision==='approved'
        ? 'Approve'
        : 'Decline'

    if(
      !window.confirm(
        `${verb} this overtime request for ${name}?`
      )
    ){
      return
    }

    await reviewAttendanceOvertime({
      requestId:row.id,
      decision,
      approvedMinutes:
        decision==='approved'
          ? approved
          : 0,
      reviewNote:
        note.trim() || undefined,
    })

    await onReviewed()
  }

  return (
    <article className="attendanceReviewCard">
      <div className="attendanceReviewHead">
        <div>
          <strong>{name}</strong>
          <span>
            Overtime request ·{' '}
            {minutesToDuration(
              row.requested_minutes
            )}
          </span>
        </div>

        <span className="attendanceStatus pending">
          Pending
        </span>
      </div>

      <p className="attendanceReason">
        {row.reason}
      </p>

      <div className="attendanceOvertimeFields">
        <label>
          Approved minutes
          <input
            type="number"
            min="1"
            max="720"
            value={minutes}
            onChange={event=>
              setMinutes(event.target.value)
            }
          />
        </label>

        <label>
          Review note
          <textarea
            value={note}
            onChange={event=>
              setNote(event.target.value)
            }
            placeholder="Optional review note"
          />
        </label>
      </div>

      <div className="attendanceReviewActions">
        <button
          type="button"
          className="glassButton"
          disabled={busy}
          onClick={()=>
            void review('declined')
          }
        >
          Decline
        </button>

        <button
          type="button"
          className="primaryButton"
          disabled={busy}
          onClick={()=>
            void review('approved')
          }
        >
          <CheckCircle2 size={15}/>
          Approve overtime
        </button>
      </div>
    </article>
  )
}

export default function AttendanceAdminPanel(){
  const [view,setView]=
    useState<View>('today')

  const [schedule,setSchedule]=
    useState<WorkSchedule|null>(null)

  const [employees,setEmployees]=
    useState<Employee[]>([])

  const [metrics,setMetrics]=
    useState<AttendanceMetrics[]>([])

  const [leaves,setLeaves]=
    useState<Leave[]>([])

  const [holidays,setHolidays]=
    useState<Holiday[]>([])

  const [activeBreaks,setActiveBreaks]=
    useState<ActiveBreak[]>([])

  const [corrections,setCorrections]=
    useState<AttendanceCorrection[]>([])

  const [overtime,setOvertime]=
    useState<AttendanceOvertimeRequest[]>([])

  const [loading,setLoading]=useState(true)
  const [reviewBusy,setReviewBusy]=useState(false)
  const [message,setMessage]=useState('')

  const today=lagosDateKey()
  const week=useMemo(
    ()=>weekRange(today),
    [today]
  )
  const month=useMemo(
    ()=>monthRange(today),
    [today]
  )

  const loadReviews=
    useCallback(async()=>{
      const [
        nextCorrections,
        nextOvertime,
      ] =
        await Promise.all([
          loadAttendanceCorrections(
            'pending'
          ),
          loadAttendanceOvertimeRequests(
            'pending'
          ),
        ])

      setCorrections(nextCorrections)
      setOvertime(nextOvertime)
    },[])

  const load=
    useCallback(async()=>{
      setLoading(true)
      setMessage('')

      try{
        const client=requireClient()

        const rangeStart=
          month.start<week.start
            ? month.start
            : week.start

        const rangeEnd=
          month.end>week.end
            ? month.end
            : week.end

        const [
          nextSchedule,
          peopleResult,
          metricsResult,
          leaveResult,
          holidayResult,
        ] =
          await Promise.all([
            loadDefaultWorkSchedule(),

            client
              .from('employee_profiles')
              .select(
                'id,full_name,email,department,job_title,role,manager_id,active'
              )
              .eq('active',true)
              .order('full_name'),

            client
              .from('attendance_daily_metrics')
              .select('*')
              .gte('work_date',rangeStart)
              .lte('work_date',rangeEnd)
              .order(
                'work_date',
                {ascending:false}
              ),

            client
              .from('leave_requests')
              .select(
                'id,employee_id,leave_type,start_date,end_date,status'
              )
              .eq('status','approved')
              .lte('start_date',rangeEnd)
              .gte('end_date',rangeStart),

            client
              .from('company_holidays')
              .select(
                'id,holiday_date,name'
              )
              .gte(
                'holiday_date',
                rangeStart
              )
              .lte(
                'holiday_date',
                rangeEnd
              ),
          ])

        if(peopleResult.error){
          throw peopleResult.error
        }

        if(metricsResult.error){
          throw metricsResult.error
        }

        if(leaveResult.error){
          throw leaveResult.error
        }

        if(holidayResult.error){
          throw holidayResult.error
        }

        const nextMetrics=
          (metricsResult.data || []) as AttendanceMetrics[]

        if(!nextSchedule){
          throw new Error(
            'Attendance schedule unavailable'
          )
        }

        setSchedule(nextSchedule)

        setEmployees(
          (peopleResult.data || []) as Employee[]
        )

        setMetrics(nextMetrics)

        setLeaves(
          (leaveResult.data || []) as Leave[]
        )

        setHolidays(
          (holidayResult.data || []) as Holiday[]
        )

        const todaySessions=
          nextMetrics
            .filter(
              item=>
                item.work_date===today
            )
            .map(item=>item.id)

        if(todaySessions.length){
          const breakResult=
            await client
              .from('attendance_breaks')
              .select(
                'id,session_id,started_at,ended_at'
              )
              .in(
                'session_id',
                todaySessions
              )
              .is('ended_at',null)

          if(breakResult.error){
            throw breakResult.error
          }

          setActiveBreaks(
            (breakResult.data || []) as ActiveBreak[]
          )
        }else{
          setActiveBreaks([])
        }

        await loadReviews()
      }catch(error){
        setMessage(
          errorMessage(error)
        )
      }finally{
        setLoading(false)
      }
    },[
      loadReviews,
      month.end,
      month.start,
      today,
      week.end,
      week.start,
    ])

  useEffect(()=>{
    void load()
  },[load])

  const employeeMap=
    useMemo(
      ()=>new Map(
        employees.map(
          employee=>[
            employee.id,
            employee,
          ]
        )
      ),
      [employees]
    )

  const holidayMap=
    useMemo(
      ()=>new Map(
        holidays.map(
          holiday=>[
            holiday.holiday_date,
            holiday,
          ]
        )
      ),
      [holidays]
    )

  const breakSessions=
    useMemo(
      ()=>new Set(
        activeBreaks.map(
          item=>item.session_id
        )
      ),
      [activeBreaks]
    )

  const todayRows=
    useMemo<TodayRow[]>(()=>{
      return employees.map(employee=>{
        const metric=
          metrics.find(
            item=>
              item.employee_id===
                employee.id &&
              item.work_date===today
          ) || null

        const leave=
          leaveFor(
            leaves,
            employee.id,
            today
          )

        const holiday=
          holidayMap.get(today) || null

        const expected=
          scheduledDay(
            today,
            schedule
          ) &&
          !holiday &&
          !leave

        const onBreak=
          metric
            ? breakSessions.has(metric.id)
            : false

        let status='Not scheduled'

        if(holiday){
          status=`Holiday · ${holiday.name}`
        }else if(leave){
          status=`Leave · ${leave.leave_type}`
        }else if(!scheduledDay(today,schedule)){
          status='Not scheduled'
        }else if(!metric){
          status='Absent / not clocked in'
        }else if(onBreak){
          status='On break'
        }else if(
          metric.clock_out_at ||
          metric.status==='closed' ||
          metric.status==='corrected'
        ){
          status='Completed'
        }else if(
          Number(
            metric.late_minutes || 0
          )>0
        ){
          status='Working · late arrival'
        }else{
          status='Working · on time'
        }

        return {
          employee,
          metric,
          leave,
          expected,
          holiday,
          onBreak,
          status,
        }
      })
    },[
      breakSessions,
      employees,
      holidayMap,
      leaves,
      metrics,
      schedule,
      today,
    ])

  const buildSummary=
    useCallback((
      start:string,
      end:string
    ):SummaryRow[]=>{
      const allKeys=
        rangeKeys(start,end)

      const dailyScheduledMinutes=
        scheduleMinutes(schedule)

      return employees.map(employee=>{
        const expectedKeys=
          allKeys.filter(key=>
            scheduledDay(
              key,
              schedule
            ) &&
            !holidayMap.has(key) &&
            !leaveFor(
              leaves,
              employee.id,
              key
            )
          )

        const employeeMetrics=
          metrics.filter(
            item=>
              item.employee_id===
                employee.id &&
              item.work_date>=start &&
              item.work_date<=end
          )

        const scheduledMetrics=
          employeeMetrics.filter(
            item=>
              expectedKeys.includes(
                item.work_date
              )
          )

        const presentDates=
          new Set(
            scheduledMetrics.map(
              item=>item.work_date
            )
          )

        const onTimeDays=
          scheduledMetrics.filter(
            item=>
              Number(
                item.late_minutes || 0
              )<=0
          ).length

        const workedMinutes=
          employeeMetrics.reduce(
            (total,item)=>
              total+
              Number(
                item.net_worked_minutes ||
                0
              ),
            0
          )

        const overtimeMinutes=
          employeeMetrics.reduce(
            (total,item)=>
              total+
              Number(
                item.approved_overtime_minutes ||
                0
              ),
            0
          )

        const lateMinutes=
          employeeMetrics.reduce(
            (total,item)=>
              total+
              Number(
                item.late_minutes || 0
              ),
            0
          )

        const earlyMinutes=
          employeeMetrics.reduce(
            (total,item)=>
              total+
              Number(
                item.early_departure_minutes ||
                0
              ),
            0
          )

        const incomplete=
          employeeMetrics.filter(
            item=>
              item.status==='open' &&
              !item.clock_out_at
          ).length

        return {
          employee,
          expectedDays:
            expectedKeys.length,
          presentDays:
            presentDates.size,
          absentDays:
            Math.max(
              0,
              expectedKeys.length-
              presentDates.size
            ),
          onTimeDays,
          scheduledMinutes:
            expectedKeys.length*
            dailyScheduledMinutes,
          workedMinutes,
          overtimeMinutes,
          lateMinutes,
          earlyMinutes,
          incomplete,
          attendanceRate:
            percent(
              presentDates.size,
              expectedKeys.length
            ),
          onTimeRate:
            percent(
              onTimeDays,
              presentDates.size
            ),
        }
      })
    },[
      employees,
      holidayMap,
      leaves,
      metrics,
      schedule,
    ])

  const weekRows=
    useMemo(
      ()=>buildSummary(
        week.start,
        week.end
      ),
      [
        buildSummary,
        week.end,
        week.start,
      ]
    )

  const monthRows=
    useMemo(
      ()=>buildSummary(
        month.start,
        month.end
      ),
      [
        buildSummary,
        month.end,
        month.start,
      ]
    )

  const expectedToday=
    todayRows.filter(
      row=>row.expected
    ).length

  const presentToday=
    todayRows.filter(
      row=>
        row.expected &&
        Boolean(row.metric)
    ).length

  const onTimeToday=
    todayRows.filter(
      row=>
        row.expected &&
        row.metric &&
        Number(
          row.metric.late_minutes || 0
        )<=0
    ).length

  const lateToday=
    todayRows.filter(
      row=>
        row.expected &&
        row.metric &&
        Number(
          row.metric.late_minutes || 0
        )>0
    ).length

  const absentToday=
    todayRows.filter(
      row=>
        row.expected &&
        !row.metric
    ).length

  const onBreakToday=
    todayRows.filter(
      row=>row.onBreak
    ).length

  const completedToday=
    todayRows.filter(
      row=>
        Boolean(
          row.metric?.clock_out_at
        )
    ).length

  const attendanceToday=
    percent(
      presentToday,
      expectedToday
    )

  const reviewAndReload=
    useCallback(async()=>{
      setReviewBusy(true)
      setMessage('')

      try{
        await loadReviews()
      }catch(error){
        setMessage(
          errorMessage(error)
        )
      }finally{
        setReviewBusy(false)
      }
    },[loadReviews])

  const views:Array<
    [
      View,
      string,
      typeof Clock3
    ]
  >=[
    ['today','Today',Clock3],
    ['week','This Week',CalendarDays],
    ['month','This Month',Users],
    ['corrections','Corrections',FileCheck2],
    ['reports','Reports',TimerReset],
  ]

  return (
    <section className="attendanceAdmin">
      <div className="attendanceAdminHero glassCard">
        <div>
          <span className="eyebrow">
            TIME &amp; ATTENDANCE
          </span>

          <h3>
            Workforce attendance control
          </h3>

          <p>
            Server-recorded employee attendance,
            breaks, exceptions, corrections and
            approved overtime in Africa/Lagos.
          </p>
        </div>

        <div className="attendanceAdminHeroActions">
          <div className="attendanceScheduleBadge">
            <Clock3 size={15}/>
            <span>
              {displayScheduleTime(
                schedule?.start_time
              )}
              {' – '}
              {displayScheduleTime(
                schedule?.end_time
              )}
              {' · '}
              {schedule?.timezone ||
                'Africa/Lagos'}
            </span>
          </div>

          <button
            type="button"
            className="glassButton"
            onClick={()=>void load()}
            disabled={loading}
          >
            <RefreshCw
              size={15}
              className={
                loading
                  ? 'attendanceSpin'
                  : ''
              }
            />
            Refresh
          </button>
        </div>
      </div>

      <nav
        className="attendanceAdminTabs"
        aria-label="Time and attendance views"
      >
        {views.map(
          ([id,label,Icon])=>(
            <button
              key={id}
              type="button"
              className={
                view===id
                  ? 'active'
                  : ''
              }
              onClick={()=>setView(id)}
            >
              <Icon size={15}/>
              <span>{label}</span>

              {id==='corrections' &&
                corrections.length+
                overtime.length>0 &&
                <b>
                  {corrections.length+
                    overtime.length}
                </b>
              }
            </button>
          )
        )}
      </nav>

      {message &&
        <div
          className="moduleNotice"
          role="alert"
        >
          {message}
        </div>
      }

      {loading ? (
        <div className="glassCard attendanceAdminLoading">
          <RefreshCw
            size={18}
            className="attendanceSpin"
          />
          Loading attendance control plane...
        </div>
      ) : (
        <>
          {view==='today' &&
            <div className="attendanceAdminView">
              <div className="attendanceAdminMetrics">
                <article className="glassCard">
                  <span>Expected</span>
                  <strong>{expectedToday}</strong>
                  <small>
                    Scheduled employees
                  </small>
                </article>

                <article className="glassCard">
                  <span>Present</span>
                  <strong>{presentToday}</strong>
                  <small>
                    {percentLabel(
                      attendanceToday
                    )} attendance
                  </small>
                </article>

                <article className="glassCard">
                  <span>On time</span>
                  <strong>{onTimeToday}</strong>
                  <small>
                    {lateToday} late
                  </small>
                </article>

                <article className="glassCard">
                  <span>Absent</span>
                  <strong>{absentToday}</strong>
                  <small>
                    Excludes approved leave
                  </small>
                </article>

                <article className="glassCard">
                  <span>On break</span>
                  <strong>{onBreakToday}</strong>
                  <small>
                    Active breaks
                  </small>
                </article>

                <article className="glassCard">
                  <span>Completed</span>
                  <strong>{completedToday}</strong>
                  <small>
                    Clocked out
                  </small>
                </article>
              </div>

              <div className="glassCard attendanceAdminTableCard">
                <div className="attendanceTableHeading">
                  <div>
                    <span className="eyebrow">
                      TODAY
                    </span>
                    <h3>
                      {displayDate(today)}
                    </h3>
                  </div>

                  <span>
                    Server timestamps · Lagos time
                  </span>
                </div>

                <div className="attendanceTableWrap">
                  <table className="attendanceAdminTable">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Status</th>
                        <th>Clock in</th>
                        <th>Clock out</th>
                        <th>Worked</th>
                        <th>Late</th>
                      </tr>
                    </thead>

                    <tbody>
                      {todayRows.map(row=>
                        <tr key={row.employee.id}>
                          <td>
                            <strong>
                              {employeeName(
                                row.employee
                              )}
                            </strong>
                            <small>
                              {row.employee.department ||
                                row.employee.job_title ||
                                row.employee.role}
                            </small>
                          </td>

                          <td>
                            <span
                              className={
                                `attendanceStatus ${
                                  row.status.includes(
                                    'Absent'
                                  )
                                    ? 'danger'
                                    : row.status.includes(
                                        'late'
                                      )
                                      ? 'warning'
                                      : row.status.includes(
                                          'Leave'
                                        ) ||
                                        row.status.includes(
                                          'Holiday'
                                        )
                                        ? 'neutral'
                                        : 'ok'
                                }`
                              }
                            >
                              {row.status}
                            </span>
                          </td>

                          <td>
                            {formatAttendanceTime(
                              row.metric
                                ?.clock_in_at
                            )}
                          </td>

                          <td>
                            {formatAttendanceTime(
                              row.metric
                                ?.clock_out_at
                            )}
                          </td>

                          <td>
                            {minutesToDuration(
                              row.metric
                                ?.net_worked_minutes
                            )}
                          </td>

                          <td>
                            {minutesToDuration(
                              row.metric
                                ?.late_minutes
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          }

          {view==='week' &&
            <SummaryTable
              title="This Week"
              subtitle={
                `${displayDate(
                  week.start
                )} – ${displayDate(
                  week.end
                )}`
              }
              rows={weekRows}
            />
          }

          {view==='month' &&
            <SummaryTable
              title="This Month"
              subtitle={
                `${displayDate(
                  month.start
                )} – ${displayDate(
                  month.end
                )}`
              }
              rows={monthRows}
            />
          }

          {view==='corrections' &&
            <div className="attendanceAdminView">
              <div className="attendanceCorrectionsHeader">
                <div>
                  <span className="eyebrow">
                    REVIEW QUEUE
                  </span>
                  <h3>
                    Attendance corrections
                    &amp; overtime
                  </h3>
                  <p>
                    Original attendance values remain
                    preserved. Approved changes and
                    review decisions are auditable.
                  </p>
                </div>

                <span className="attendanceQueueCount">
                  {corrections.length+
                    overtime.length}
                  {' '}pending
                </span>
              </div>

              <div className="attendanceReviewGrid">
                {corrections.map(row=>
                  <CorrectionReview
                    key={row.id}
                    row={row}
                    name={
                      employeeMap.get(
                        row.employee_id
                      )
                        ? employeeName(
                            employeeMap.get(
                              row.employee_id
                            )!
                          )
                        : row.employee_id
                    }
                    busy={reviewBusy}
                    onReviewed={
                      reviewAndReload
                    }
                  />
                )}

                {overtime.map(row=>
                  <OvertimeReview
                    key={row.id}
                    row={row}
                    name={
                      employeeMap.get(
                        row.employee_id
                      )
                        ? employeeName(
                            employeeMap.get(
                              row.employee_id
                            )!
                          )
                        : row.employee_id
                    }
                    busy={reviewBusy}
                    onReviewed={
                      reviewAndReload
                    }
                  />
                )}
              </div>

              {!corrections.length &&
                !overtime.length &&
                <div className="glassCard attendanceAdminEmpty">
                  <CheckCircle2 size={24}/>
                  <strong>
                    Review queue is clear
                  </strong>
                  <span>
                    No pending attendance correction
                    or overtime requests.
                  </span>
                </div>
              }
            </div>
          }

          {view==='reports' &&
            <ReportsView rows={monthRows}/>
          }
        </>
      )}
    </section>
  )
}

function SummaryTable({
  title,
  subtitle,
  rows,
}:{
  title:string
  subtitle:string
  rows:SummaryRow[]
}){
  const companyExpected=
    rows.reduce(
      (total,row)=>
        total+row.expectedDays,
      0
    )

  const companyPresent=
    rows.reduce(
      (total,row)=>
        total+row.presentDays,
      0
    )

  const companyScheduled=
    rows.reduce(
      (total,row)=>
        total+row.scheduledMinutes,
      0
    )

  const companyWorked=
    rows.reduce(
      (total,row)=>
        total+row.workedMinutes,
      0
    )

  return (
    <div className="attendanceAdminView">
      <div className="attendanceAdminMetrics four">
        <article className="glassCard">
          <span>Attendance rate</span>
          <strong>
            {percentLabel(
              percent(
                companyPresent,
                companyExpected
              )
            )}
          </strong>
          <small>
            {companyPresent}/{companyExpected}
            {' '}scheduled days
          </small>
        </article>

        <article className="glassCard">
          <span>Scheduled hours</span>
          <strong>
            {minutesToDuration(
              companyScheduled
            )}
          </strong>
          <small>
            Expected workforce time
          </small>
        </article>

        <article className="glassCard">
          <span>Recorded hours</span>
          <strong>
            {minutesToDuration(
              companyWorked
            )}
          </strong>
          <small>
            Net of recorded breaks
          </small>
        </article>

        <article className="glassCard">
          <span>Variance</span>
          <strong>
            {minutesToDuration(
              Math.abs(
                companyWorked-
                companyScheduled
              )
            )}
          </strong>
          <small>
            {companyWorked>=companyScheduled
              ? 'Above scheduled'
              : 'Below scheduled'}
          </small>
        </article>
      </div>

      <div className="glassCard attendanceAdminTableCard">
        <div className="attendanceTableHeading">
          <div>
            <span className="eyebrow">
              PERIOD SUMMARY
            </span>
            <h3>{title}</h3>
          </div>

          <span>{subtitle}</span>
        </div>

        <div className="attendanceTableWrap">
          <table className="attendanceAdminTable wide">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Expected</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Attendance</th>
                <th>On-time</th>
                <th>Scheduled</th>
                <th>Worked</th>
                <th>Late</th>
                <th>Early</th>
                <th>Overtime</th>
                <th>Incomplete</th>
              </tr>
            </thead>

            <tbody>
              {rows.map(row=>
                <tr key={row.employee.id}>
                  <td>
                    <strong>
                      {employeeName(
                        row.employee
                      )}
                    </strong>
                    <small>
                      {row.employee.department ||
                        row.employee.role}
                    </small>
                  </td>

                  <td>{row.expectedDays}</td>
                  <td>{row.presentDays}</td>
                  <td>{row.absentDays}</td>

                  <td>
                    <strong>
                      {percentLabel(
                        row.attendanceRate
                      )}
                    </strong>
                  </td>

                  <td>
                    {percentLabel(
                      row.onTimeRate
                    )}
                  </td>

                  <td>
                    {minutesToDuration(
                      row.scheduledMinutes
                    )}
                  </td>

                  <td>
                    {minutesToDuration(
                      row.workedMinutes
                    )}
                  </td>

                  <td>
                    {minutesToDuration(
                      row.lateMinutes
                    )}
                  </td>

                  <td>
                    {minutesToDuration(
                      row.earlyMinutes
                    )}
                  </td>

                  <td>
                    {minutesToDuration(
                      row.overtimeMinutes
                    )}
                  </td>

                  <td>{row.incomplete}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ReportsView({
  rows,
}:{
  rows:SummaryRow[]
}){
  const exceptions=
    rows
      .filter(row=>
        row.absentDays>0 ||
        row.lateMinutes>0 ||
        row.earlyMinutes>0 ||
        row.incomplete>0
      )
      .sort(
        (a,b)=>
          b.absentDays-a.absentDays ||
          b.lateMinutes-a.lateMinutes
      )

  const approvedOvertime=
    rows.reduce(
      (total,row)=>
        total+row.overtimeMinutes,
      0
    )

  const absences=
    rows.reduce(
      (total,row)=>
        total+row.absentDays,
      0
    )

  const incomplete=
    rows.reduce(
      (total,row)=>
        total+row.incomplete,
      0
    )

  return (
    <div className="attendanceAdminView">
      <div className="attendanceAdminMetrics">
        <article className="glassCard">
          <AlertTriangle size={18}/>
          <span>Absence days</span>
          <strong>{absences}</strong>
          <small>
            Approved leave excluded
          </small>
        </article>

        <article className="glassCard">
          <Clock3 size={18}/>
          <span>Approved overtime</span>
          <strong>
            {minutesToDuration(
              approvedOvertime
            )}
          </strong>
          <small>
            Approved separately
          </small>
        </article>

        <article className="glassCard">
          <TimerReset size={18}/>
          <span>Incomplete sessions</span>
          <strong>{incomplete}</strong>
          <small>
            Open without clock-out
          </small>
        </article>

        <article className="glassCard">
          <FileCheck2 size={18}/>
          <span>Exceptions</span>
          <strong>
            {exceptions.length}
          </strong>
          <small>
            Employees needing review
          </small>
        </article>
      </div>

      <div className="glassCard attendanceExceptions">
        <div className="attendanceTableHeading">
          <div>
            <span className="eyebrow">
              MANAGEMENT REPORT
            </span>
            <h3>
              Attendance exceptions
            </h3>
          </div>

          <span>
            Current month · Africa/Lagos
          </span>
        </div>

        {exceptions.map(row=>
          <article
            key={row.employee.id}
            className="attendanceExceptionRow"
          >
            <div>
              <strong>
                {employeeName(
                  row.employee
                )}
              </strong>
              <span>
                {row.employee.department ||
                  row.employee.role}
              </span>
            </div>

            <div className="attendanceExceptionTags">
              {row.absentDays>0 &&
                <span className="danger">
                  {row.absentDays}
                  {' '}absence
                  {row.absentDays===1
                    ? ''
                    : 's'}
                </span>
              }

              {row.lateMinutes>0 &&
                <span className="warning">
                  {minutesToDuration(
                    row.lateMinutes
                  )} late
                </span>
              }

              {row.earlyMinutes>0 &&
                <span>
                  {minutesToDuration(
                    row.earlyMinutes
                  )} early departure
                </span>
              }

              {row.incomplete>0 &&
                <span className="danger">
                  {row.incomplete}
                  {' '}incomplete
                </span>
              }
            </div>
          </article>
        )}

        {!exceptions.length &&
          <div className="attendanceAdminEmpty">
            <CheckCircle2 size={24}/>
            <strong>
              No attendance exceptions
            </strong>
            <span>
              Nothing currently requires
              management attention.
            </span>
          </div>
        }
      </div>
    </div>
  )
}
