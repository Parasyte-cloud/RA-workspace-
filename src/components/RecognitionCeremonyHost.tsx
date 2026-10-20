import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Award } from 'lucide-react'
import { useRecognitionCeremonyQueue } from '../celebrations/useRecognitionCeremonyQueue'
import type { CeremonyPresentation } from '../celebrations/types'
import PremiumCelebrationStage from './PremiumCelebrationStage'
import DepartmentTrophyScene from './celebrations/DepartmentTrophyScene'
import PersonalAwardScene from './celebrations/PersonalAwardScene'
import CompanyMilestoneScene from './celebrations/CompanyMilestoneScene'

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
  if (!current) return error ? <div className="recognitionCeremonyFallback" role="status">{error}</div> : null
  if (blocked) return null

  let scene: ReactNode
  if (current.sourceKind === 'department_achievement') scene = <DepartmentTrophyScene presentation={current} onPresented={markPresented} onClose={dismiss}/>
  else if (current.sourceKind === 'personal_award') scene = <PersonalAwardScene presentation={current} onPresented={markPresented} onClose={dismiss}/>
  else scene = <CompanyMilestoneScene presentation={current} onPresented={markPresented} onClose={dismiss}/>

  return <CeremonySceneBoundary key={`${current.deliveryId}:${current.revision}`} presentation={current} onPresented={markPresented} onClose={dismiss}>{scene}</CeremonySceneBoundary>
}
