import { Award } from 'lucide-react'
import PremiumCelebrationStage from '../PremiumCelebrationStage'
import type { CeremonyPresentation } from '../../celebrations/types'

export default function PersonalAwardScene({ presentation, onPresented, onClose }: { presentation: CeremonyPresentation; onPresented: () => void; onClose: () => void }) {
  return <PremiumCelebrationStage open intensity="major" kicker="A personal achievement" title={presentation.title} message={presentation.message || undefined} detail={presentation.detail || 'Saved permanently in My Awards'} icon={<Award size={88} strokeWidth={1.45}/>} introMs={1600} holdMs={7000} onPresented={onPresented} onClose={onClose}/>
}
