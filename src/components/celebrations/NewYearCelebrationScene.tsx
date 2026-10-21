import { Sparkles } from 'lucide-react'
import PremiumCelebrationStage from '../PremiumCelebrationStage'
import type { CeremonyPresentation } from '../../celebrations/types'
import SeasonalParticleField from './SeasonalParticleField'
import SeasonalStaticFallback from './SeasonalStaticFallback'
import type { CelebrationMotionProfile } from './useCelebrationMotionProfile'
import '../../seasonal-celebrations.css'

const NEW_YEAR_PALETTE = ['#d7b65d', '#f8fafc', '#cbd5e1', '#f7d778', '#94a3b8'] as const
const NEW_YEAR_SYMBOLS = ['✦', '✧', '◆', '●'] as const

export default function NewYearCelebrationScene({ presentation, profile, onReady, onClose }: {
  presentation: CeremonyPresentation
  profile: CelebrationMotionProfile
  onReady: () => void
  onClose: () => void
}) {
  const live = presentation.variant === 'live_midnight'
  const year = presentation.campaignYear || 2027
  const title = live ? (presentation.title || `Happy New Year ${year}`) : `Welcome to ${year}`
  if (profile === 'static') return <SeasonalStaticFallback presentation={{...presentation,title}} holdMs={11000} onReady={onReady} onClose={onClose}/>
  const reduced = profile === 'reduced'
  return <PremiumCelebrationStage open staticVisuals={reduced} intensity="seasonal_max" kicker="A new RideArrivo chapter" title={title}
    message={presentation.message || 'Here is to a year of bold ideas, safe journeys and shared wins.'}
    detail="Thank you for building the future with us." icon={<Sparkles size={86}/>} introMs={reduced ? 0 : 1500} holdMs={11000} onPresented={onReady} onClose={onClose}>
    <div className={`newYearScene ${reduced ? 'isReduced' : ''}`}>
      {live && !reduced && <div className="newYearCountdown" aria-label="New Year countdown">3 · 2 · 1</div>}
      {!live && <div className="newYearWelcome">Welcome to <strong>{year}</strong></div>}
      {!reduced && <div className="newYearFireworks" aria-hidden="true"><i/><i/><i/><i/></div>}
      <SeasonalParticleField profile={profile} fullCount={200} balancedCount={128} palette={NEW_YEAR_PALETTE} symbols={NEW_YEAR_SYMBOLS}/>
    </div>
  </PremiumCelebrationStage>
}
