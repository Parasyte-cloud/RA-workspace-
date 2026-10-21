import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react'
import { Award } from 'lucide-react'
import { useRecognitionCeremonyQueue } from '../celebrations/useRecognitionCeremonyQueue'
import type { CeremonyPresentation } from '../celebrations/types'
import PremiumCelebrationStage from './PremiumCelebrationStage'
import DepartmentTrophyScene from './celebrations/DepartmentTrophyScene'
import PersonalAwardScene from './celebrations/PersonalAwardScene'
import CompanyMilestoneScene from './celebrations/CompanyMilestoneScene'
import SeasonalStaticFallback from './celebrations/SeasonalStaticFallback'
import { useCelebrationMotionProfile } from './celebrations/useCelebrationMotionProfile'

const ChristmasCelebrationScene = lazy(() => import('./celebrations/ChristmasCelebrationScene'))
const NewYearCelebrationScene = lazy(() => import('./celebrations/NewYearCelebrationScene'))
const BirthdayCelebrationScene = lazy(() => import('./celebrations/BirthdayCelebrationScene'))

class CeremonySceneBoundary extends Component<{ children: ReactNode; presentation: CeremonyPresentation; onPresented: () => void; onClose: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[Recognition ceremony] scene fallback', error, info.componentStack) }
  render() {
    if (!this.state.failed) return this.props.children
    return <PremiumCelebrationStage open intensity="major" kicker="RideArrivo recognition" title={this.props.presentation.title || 'A special achievement'} message="Your recognition has been saved. The full visual could not be loaded on this device." icon={<Award size={82}/>} introMs={0} holdMs={7000} onPresented={this.props.onPresented} onClose={this.props.onClose}/>
  }
}

export default function RecognitionCeremonyHost() {
  const { current, markPresented, dismiss, blocked, error } = useRecognitionCeremonyQueue()
  const { profile } = useCelebrationMotionProfile()
  if (!current) return error ? <div className="recognitionCeremonyFallback" role="status">{error}</div> : null
  if (blocked) return null

  let scene: ReactNode
  if (current.sourceKind === 'department_achievement') scene = <DepartmentTrophyScene presentation={current} onPresented={markPresented} onClose={dismiss}/>
  else if (current.sourceKind === 'personal_award') scene = <PersonalAwardScene presentation={current} onPresented={markPresented} onClose={dismiss}/>
  else if (current.sourceKind === 'seasonal_campaign' && current.campaignType === 'christmas') scene = <Suspense fallback={<SeasonalStaticFallback presentation={current} holdMs={12000} onReady={markPresented} onClose={dismiss}/>}><ChristmasCelebrationScene presentation={current} profile={profile} onReady={markPresented} onClose={dismiss}/></Suspense>
  else if (current.sourceKind === 'seasonal_campaign' && current.campaignType === 'new_year') scene = <Suspense fallback={<SeasonalStaticFallback presentation={current} holdMs={11000} onReady={markPresented} onClose={dismiss}/>}><NewYearCelebrationScene presentation={current} profile={profile} onReady={markPresented} onClose={dismiss}/></Suspense>
  else if (current.sourceKind === 'birthday') scene = <Suspense fallback={<SeasonalStaticFallback presentation={current} holdMs={9000} onReady={markPresented} onClose={dismiss}/>}><BirthdayCelebrationScene presentation={current} profile={profile} onReady={markPresented} onClose={dismiss}/></Suspense>
  else scene = <CompanyMilestoneScene presentation={current} onPresented={markPresented} onClose={dismiss}/>

  return <CeremonySceneBoundary key={`${current.deliveryId}:${current.revision}`} presentation={current} onPresented={markPresented} onClose={dismiss}>{scene}</CeremonySceneBoundary>
}
