import { useEffect, useState } from 'react'
import { Award, Sparkles, Trophy, X } from 'lucide-react'
import '../department-achievements.css'

export type DepartmentAchievement = {
  id: string
  department: string
  kind: 'dept_overdue_clear' | 'project_complete' | string
  title: string
  description: string
  tier: 'bronze' | 'silver' | 'gold' | 'platinum' | string
  project_id: string | null
  earned_at: string
}

type Props = {
  achievement: DepartmentAchievement
  onClose: () => void
  holdMs?: number
}

type CeremonyPhase = 'ribbon' | 'trophy'
const RIBBON_POP_MS = 950

function displayDepartment(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ')
}

export function DepartmentAchievementCeremony({
  achievement,
  onClose,
  holdMs = 4500,
}: Props) {
  const [reducedMotion, setReducedMotion] = useState(false)
  const [phase, setPhase] = useState<CeremonyPhase>('ribbon')

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(Boolean(media?.matches))
    sync()
    media?.addEventListener?.('change', sync)
    return () => media?.removeEventListener?.('change', sync)
  }, [])

  useEffect(() => {
    setPhase(reducedMotion ? 'trophy' : 'ribbon')
    if (reducedMotion) return
    const ribbonTimer = window.setTimeout(() => setPhase('trophy'), RIBBON_POP_MS)
    return () => window.clearTimeout(ribbonTimer)
  }, [achievement.id, reducedMotion])

  useEffect(() => {
    const timer = window.setTimeout(onClose, holdMs)
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', keydown)
    }
  }, [achievement.id, holdMs, onClose])

  return (
    <div
      className={`departmentAchievementOverlay${reducedMotion ? ' reducedMotion' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${displayDepartment(achievement.department)} achievement`}
      onMouseDown={event => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section className={`departmentAchievementStage ${phase}`}>
        <button
          type="button"
          className="departmentAchievementClose"
          aria-label="Close achievement ceremony"
          onClick={onClose}
        >
          <X size={18} />
        </button>

        {phase === 'ribbon' ? (
          <div className="departmentAchievementRibbonPop" aria-live="polite">
            <div className="departmentAchievementRibbonBurst" aria-hidden="true">
              <i /><i /><i /><i /><i /><i /><i /><i />
            </div>
            <div className="departmentAchievementRibbonMedal" aria-hidden="true">
              <Award size={70} strokeWidth={1.55} />
            </div>
            <span>Department achievement</span>
            <strong>{achievement.title}</strong>
          </div>
        ) : (
          <>
            <div className="departmentAchievementAura" aria-hidden="true" />
            <div className="departmentAchievementParticles" aria-hidden="true">
              <i /><i /><i /><i /><i /><i />
            </div>

            <div className="departmentAchievementTrophy" aria-hidden="true">
              <span className="departmentAchievementHalo"><Sparkles size={22} /></span>
              <Trophy size={92} strokeWidth={1.45} />
              <span className="departmentAchievementPedestal" />
            </div>

            <div className="departmentAchievementCopy">
              <span className="departmentAchievementTier">{achievement.tier.toUpperCase()} ACHIEVEMENT</span>
              <span className="departmentAchievementDepartment">{displayDepartment(achievement.department)}</span>
              <h2>{achievement.title}</h2>
              <p>{achievement.description}</p>
              <strong>Added to your department trophy cabinet</strong>
            </div>

            <button type="button" className="departmentAchievementDone" onClick={onClose}>
              View the dashboard
            </button>
          </>
        )}
      </section>
    </div>
  )
}

export default DepartmentAchievementCeremony
