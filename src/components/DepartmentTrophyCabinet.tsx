import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Trophy } from 'lucide-react'
import { supabase as maybeSupabase } from '../lib/supabase'
import type { DepartmentAchievement } from './DepartmentAchievementCeremony'
import '../department-achievements.css'

const supabase = maybeSupabase as NonNullable<typeof maybeSupabase>

type Props = {
  department: string
  enabled: boolean
}

function prettyDepartment(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ')
}

function earnedDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(date)
}

export default function DepartmentTrophyCabinet({ department, enabled }: Props) {
  const [achievements, setAchievements] = useState<DepartmentAchievement[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestSequenceRef = useRef(0)

  const load = useCallback(async (showLoading = false) => {
    const requestSequence = ++requestSequenceRef.current
    if (!enabled || !department.trim() || !maybeSupabase) {
      requestSequenceRef.current += 1
      setAchievements([])
      setLoading(false)
      setError('')
      return
    }

    if (showLoading) setLoading(true)
    setError('')

    const { data, error: requestError } = await supabase
      .rpc('department_achievement_history', { p_department: department })

    if (requestSequence !== requestSequenceRef.current) return

    if (requestError) {
      setError('Trophy cabinet is temporarily unavailable.')
      if (showLoading) setAchievements([])
    } else {
      setAchievements((data || []) as DepartmentAchievement[])
    }

    if (showLoading) setLoading(false)
  }, [department, enabled])

  useEffect(() => {
    if (!enabled || !department.trim() || !maybeSupabase) {
      setAchievements([])
      setLoading(false)
      setError('')
      return
    }

    setLoading(true)
    void load(true)
    return () => { requestSequenceRef.current += 1 }
  }, [department, enabled, load])

  useEffect(() => {
    if (!enabled || !department.trim() || !maybeSupabase) return
    let timer: number | null = null
    const channel = supabase
      .channel(`department-trophy-cabinet-${department.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'department_achievements' }, () => {
        if (timer) window.clearTimeout(timer)
        timer = window.setTimeout(() => { void load(false) }, 450)
      })
      .subscribe()

    return () => {
      if (timer) window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [department, enabled, load])

  const featured = achievements[0] || null
  const history = useMemo(() => achievements.slice(1), [achievements])

  if (!enabled || !department.trim()) return null

  if (loading) {
    return (
      <section className="departmentTrophyCabinet glassCard" aria-label="Department Trophy Cabinet">
        <div className="departmentTrophyCabinetLoading">Loading department trophies…</div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="departmentTrophyCabinet glassCard" aria-label="Department Trophy Cabinet">
        <div className="departmentTrophyCabinetHead">
          <Trophy size={20} />
          <div><span className="eyebrow">ACHIEVEMENTS</span><h3>Department Trophy Cabinet</h3></div>
        </div>
        <p className="departmentTrophyCabinetError">{error}</p>
      </section>
    )
  }

  if (!featured) {
    return (
      <section className="departmentTrophyCabinet departmentTrophyCabinetEmpty glassCard" aria-label="Department Trophy Cabinet">
        <div className="departmentTrophyCabinetHead">
          <span className="departmentTrophyMiniIcon"><Trophy size={22} /></span>
          <div><span className="eyebrow">ACHIEVEMENTS</span><h3>Department Trophy Cabinet</h3></div>
        </div>
        <p>{prettyDepartment(department)} has room for its first trophy. Clear overdue work or complete a qualifying project to earn one.</p>
      </section>
    )
  }

  return (
    <section className="departmentTrophyCabinet glassCard" aria-label="Department Trophy Cabinet">
      <div className="departmentTrophyCabinetHead">
        <span className="departmentTrophyMiniIcon"><Trophy size={22} /></span>
        <div>
          <span className="eyebrow">ACHIEVEMENTS</span>
          <h3>Department Trophy Cabinet</h3>
        </div>
        <span className="departmentTrophyCount">{achievements.length}</span>
      </div>

      <article className="departmentTrophyFeatured">
        <div className="departmentTrophyMedallion" aria-hidden="true"><Trophy size={42} /></div>
        <div className="departmentTrophyFeaturedCopy">
          <span className="departmentTrophyTier">{featured.tier.toUpperCase()} ACHIEVEMENT</span>
          <small>{prettyDepartment(featured.department)}</small>
          <h4>{featured.title}</h4>
          <p>{featured.description}</p>
          <time dateTime={featured.earned_at}>{earnedDate(featured.earned_at)}</time>
        </div>
      </article>

      {history.length > 0 && (
        <details className="departmentTrophyHistory">
          <summary>View achievement history <ChevronDown size={16} /></summary>
          <div className="departmentTrophyHistoryGrid">
            {history.map(item => (
              <article key={item.id} className="departmentTrophyHistoryItem">
                <span><Trophy size={17} /></span>
                <div>
                  <small>{item.tier.toUpperCase()} · {earnedDate(item.earned_at)}</small>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
