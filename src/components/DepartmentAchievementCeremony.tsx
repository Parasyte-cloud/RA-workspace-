import { Trophy } from 'lucide-react'
import PremiumCelebrationStage from './PremiumCelebrationStage'

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
}

function displayDepartment(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ')
}

export function DepartmentAchievementCeremony({ achievement, onClose }: Props) {
  return (
    <PremiumCelebrationStage
      open
      intensity="trophy"
      kicker={`${achievement.tier.toUpperCase()} · ${displayDepartment(achievement.department)}`}
      title={achievement.title}
      message={achievement.description}
      detail="Added to your department trophy cabinet"
      icon={<Trophy size={92} strokeWidth={1.45} />}
      introMs={1600}
      holdMs={7000}
      onClose={onClose}
    />
  )
}

export default DepartmentAchievementCeremony
