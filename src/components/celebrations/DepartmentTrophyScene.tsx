import { Trophy } from 'lucide-react'
import PremiumCelebrationStage from '../PremiumCelebrationStage'
import type { CeremonyPresentation } from '../../celebrations/types'

function label(value: string | null | undefined) {
  return (value || 'Department').split(/\s+/).map(part => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ')
}

export default function DepartmentTrophyScene({ presentation, onPresented, onClose }: { presentation: CeremonyPresentation; onPresented: () => void; onClose: () => void }) {
  return <PremiumCelebrationStage open intensity="trophy" kicker={`${(presentation.tier || 'gold').toUpperCase()} · ${label(presentation.department)}`} title={presentation.title} message={presentation.message || undefined} detail="Added to your department trophy cabinet" icon={<Trophy size={92} strokeWidth={1.45}/>} introMs={1600} holdMs={7000} onPresented={onPresented} onClose={onClose}/>
}
