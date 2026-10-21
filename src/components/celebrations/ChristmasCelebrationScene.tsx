import { Gift, Snowflake } from 'lucide-react'
import PremiumCelebrationStage from '../PremiumCelebrationStage'
import type { CeremonyPresentation } from '../../celebrations/types'
import { seasonalAssets } from '../../celebrations/seasonalAssets'
import SeasonalParticleField from './SeasonalParticleField'
import SeasonalStaticFallback from './SeasonalStaticFallback'
import type { CelebrationMotionProfile } from './useCelebrationMotionProfile'
import '../../seasonal-celebrations.css'

const CHRISTMAS_PALETTE = ['#d9232e', '#f3c34d', '#0f8c5c', '#f8fafc', '#b91c1c', '#166534'] as const
const CHRISTMAS_SYMBOLS = ['✦', '❄', '◆', '●', '✧'] as const

export default function ChristmasCelebrationScene({ presentation, profile, onReady, onClose }: {
  presentation: CeremonyPresentation
  profile: CelebrationMotionProfile
  onReady: () => void
  onClose: () => void
}) {
  if (profile === 'static') return <SeasonalStaticFallback presentation={presentation} holdMs={12000} onReady={onReady} onClose={onClose}/>
  const asset = profile === 'full' ? seasonalAssets.christmas.full : seasonalAssets.christmas.balanced
  const reduced = profile === 'reduced'
  return <PremiumCelebrationStage
    open
    staticVisuals={reduced}
    intensity="seasonal_max"
    kicker="A RideArrivo Christmas"
    title={presentation.title || 'Merry Christmas'}
    message={presentation.message || 'Wishing you warmth, joy and a beautiful festive season from everyone at RideArrivo.'}
    detail="Thank you for everything you brought to the journey this year."
    icon={<Gift size={86}/>} introMs={reduced ? 0 : 1800} holdMs={12000} onPresented={onReady} onClose={onClose}
  >
    <div className={`christmasScene ${reduced ? 'isReduced' : ''}`}>
      {!reduced && <div className="christmasSleighPass" aria-hidden="true"><img src={asset} alt="" onError={event=>{const image=event.currentTarget;if(image.getAttribute('src')===seasonalAssets.christmas.static){image.style.display='none';return}image.src=seasonalAssets.christmas.static}} /></div>}
      <div className="christmasGlow" aria-hidden="true" />
      <div className="christmasGreeting"><Snowflake size={18} aria-hidden="true"/><span>Celebrate the season. Share the joy.</span></div>
      <SeasonalParticleField profile={profile} fullCount={200} balancedCount={128} palette={CHRISTMAS_PALETTE} symbols={CHRISTMAS_SYMBOLS} className="christmasSnowRibbonField"/>
      {!reduced && <div className="christmasGiftBurst" aria-hidden="true"><span>🎁</span><span>✦</span><span>🎁</span><span>❄</span><span>✧</span></div>}
    </div>
  </PremiumCelebrationStage>
}
