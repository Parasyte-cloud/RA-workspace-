import { Sparkles } from 'lucide-react'
import PremiumCelebrationStage from '../PremiumCelebrationStage'
import type { CeremonyPresentation } from '../../celebrations/types'

export default function SeasonalStaticFallback({ presentation, onReady, onClose, holdMs }: { presentation: CeremonyPresentation; onReady: () => void; onClose: () => void; holdMs: number }) {
  return <div role="status" aria-live="polite">
    <PremiumCelebrationStage open staticVisuals intensity="seasonal_max" kicker="RideArrivo celebration" title={presentation.title} message={presentation.message || undefined} detail={presentation.detail || undefined} icon={<Sparkles size={86}/>} introMs={0} holdMs={holdMs} onPresented={onReady} onClose={onClose}/>
  </div>
}
