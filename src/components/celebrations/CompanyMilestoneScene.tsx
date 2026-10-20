import { Sparkles } from 'lucide-react'
import PremiumCelebrationStage from '../PremiumCelebrationStage'
import type { CeremonyPresentation } from '../../celebrations/types'

export default function CompanyMilestoneScene({ presentation, onPresented, onClose }: { presentation: CeremonyPresentation; onPresented: () => void; onClose: () => void }) {
  return <PremiumCelebrationStage open intensity="major" kicker="RideArrivo celebrates" title={presentation.title} message={presentation.message || undefined} detail={presentation.detail || 'A company recognition moment'} icon={<Sparkles size={88} strokeWidth={1.45}/>} introMs={1600} holdMs={7000} onPresented={onPresented} onClose={onClose}/>
}
