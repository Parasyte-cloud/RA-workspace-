import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, ShieldAlert, Trophy } from 'lucide-react'
import { supabase as maybeSupabase } from '../lib/supabase'
import '../department-achievements.css'

const supabase = maybeSupabase as NonNullable<typeof maybeSupabase>

type Props = { department: string }

type TrophyContext = {
  authorized: boolean
  department: string | null
  relationship: 'department_member' | 'workstation_assignee' | 'department_head' | 'delegated_leadership' | 'workspace_admin' | null
  achievement_count: number
}

type TrophyAchievement = {
  id: string
  department: string
  kind: string
  title: string
  description: string
  tier: string
  earned_at: string
}

function prettyDepartment(value: string) {
  return value.trim().split(/\s+/).map(part => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ')
}

function earnedDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function CabinetHeader({ count }: { count?: number }) {
  return (
    <div className="departmentTrophyCabinetHead">
      <span className="departmentTrophyMiniIcon"><Trophy size={22} /></span>
      <div><span className="eyebrow">ACHIEVEMENTS</span><h3>Department Trophy Cabinet</h3></div>
      {typeof count === 'number' && <span className="departmentTrophyCount" aria-label={`${count} department trophies`}>{count}</span>}
    </div>
  )
}

export default function DepartmentTrophyCabinet({ department }: Props) {
  const [context, setContext] = useState<TrophyContext | null>(null)
  const [achievements, setAchievements] = useState<TrophyAchievement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestSequenceRef = useRef(0)

  const load = useCallback(async (showLoading = false) => {
    const requestSequence = ++requestSequenceRef.current
    const requestedDepartment = department.trim()
    if (!requestedDepartment || !maybeSupabase) {
      setContext(null)
      setAchievements([])
      setLoading(false)
      setError('')
      return
    }

    if (showLoading) setLoading(true)
    setError('')

    const contextResult = await supabase.rpc('get_authorized_department_trophy_context', {
      p_department: requestedDepartment,
    })
    if (requestSequence !== requestSequenceRef.current) return

    if (contextResult.error) {
      setContext(null)
      setAchievements([])
      setError('Trophy cabinet is temporarily unavailable.')
      setLoading(false)
      return
    }

    const nextContext = (contextResult.data || null) as TrophyContext | null
    setContext(nextContext)
    if (!nextContext?.authorized) {
      setAchievements([])
      setLoading(false)
      return
    }

    const historyResult = await supabase.rpc('list_department_trophy_history', {
      p_department: nextContext.department || requestedDepartment,
      p_limit: 50,
    })
    if (requestSequence !== requestSequenceRef.current) return

    if (historyResult.error) {
      setAchievements([])
      setError('Trophy history could not be loaded.')
    } else {
      setAchievements((historyResult.data || []) as TrophyAchievement[])
    }
    setLoading(false)
  }, [department])

  useEffect(() => {
    setLoading(true)
    void load(true)
    return () => { requestSequenceRef.current += 1 }
  }, [load])

  useEffect(() => {
    if (!context?.authorized || !department.trim() || !maybeSupabase) return
    let timer: number | null = null
    const refetchWhenVisible = () => {
      if (document.visibilityState === 'visible') void load(false)
    }
    const interval = window.setInterval(refetchWhenVisible, 60_000)
    window.addEventListener('focus', refetchWhenVisible)
    document.addEventListener('visibilitychange', refetchWhenVisible)
    const channel = supabase
      .channel(`department-trophy-cabinet-${department.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'department_achievements' }, () => {
        if (timer) window.clearTimeout(timer)
        timer = window.setTimeout(() => { void load(false) }, 450)
      })
      .subscribe()

    return () => {
      if (timer) window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener('focus', refetchWhenVisible)
      document.removeEventListener('visibilitychange', refetchWhenVisible)
      void supabase.removeChannel(channel)
    }
  }, [context?.authorized, department, load])

  const featured = achievements[0] || null
  const history = useMemo(() => achievements.slice(1), [achievements])
  const displayDepartment = prettyDepartment(context?.department || department)

  if (!department.trim()) return null

  return (
    <section className="departmentTrophyCabinet glassCard" aria-label="Department Trophy Cabinet" aria-busy={loading}>
      <CabinetHeader count={context?.authorized ? achievements.length : undefined} />

      {loading && <div className="departmentTrophyCabinetLoading">Loading department trophies…</div>}

      {!loading && error && (
        <div className="departmentTrophyCabinetState">
          <p className="departmentTrophyCabinetError">{error}</p>
          <button type="button" className="glassButton" onClick={() => void load(true)}><RefreshCw size={15} />Retry</button>
        </div>
      )}

      {!loading && !error && context && !context.authorized && (
        <div className="departmentTrophyCabinetDenied" role="status">
          <ShieldAlert size={20} />
          <p>You do not have access to this department trophy cabinet.</p>
        </div>
      )}

      {!loading && !error && context?.authorized && !featured && (
        <div className="departmentTrophyCabinetEmpty">
          <div className="departmentTrophyEmptyShelf" aria-hidden="true"><span /><span /><span /></div>
          <strong>This department has room for its first trophy.</strong>
          <p>Complete a qualifying achievement to begin the collection.</p>
        </div>
      )}

      {!loading && !error && context?.authorized && featured && (
        <>
          <article className="departmentTrophyFeatured">
            <div className="departmentTrophyMedallion" aria-hidden="true"><Trophy size={42} /></div>
            <div className="departmentTrophyFeaturedCopy">
              <span className="departmentTrophyTier">{featured.tier.toUpperCase()} ACHIEVEMENT</span>
              <small>{displayDepartment}</small>
              <h4>{featured.title}</h4>
              <p>{featured.description}</p>
              <time dateTime={featured.earned_at}>{earnedDate(featured.earned_at)}</time>
            </div>
          </article>

          <div className="departmentTrophyShelf" aria-label="Department trophy shelf">
            {achievements.map(item => (
              <article key={item.id} className="departmentTrophyShelfItem">
                <span className="departmentTrophyShelfMedal" aria-hidden="true"><Trophy size={22} /></span>
                <small>{item.tier.toUpperCase()}</small>
                <strong>{item.title}</strong>
                <time dateTime={item.earned_at}>{earnedDate(item.earned_at)}</time>
              </article>
            ))}
          </div>

          {history.length > 0 && (
            <details className="departmentTrophyHistory">
              <summary>View achievement history</summary>
              <div className="departmentTrophyHistoryGrid">
                {history.map(item => (
                  <article key={item.id} className="departmentTrophyHistoryItem">
                    <span><Trophy size={17} /></span>
                    <div><small>{item.tier.toUpperCase()} · {earnedDate(item.earned_at)}</small><strong>{item.title}</strong><p>{item.description}</p></div>
                  </article>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  )
}
