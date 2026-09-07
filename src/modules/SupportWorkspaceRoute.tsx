import { SupportModule } from './CoreModules'
import { SupportTeamWorkspace } from './DepartmentTeamWorkspace'
import SupportAssistedBookingPanel from './SupportAssistedBookingPanel'
import SupportWhatsAppPanel from './SupportWhatsAppPanel'
import IntakeSubmissionInbox from './IntakeSubmissionInbox'

export default function SupportWorkspaceRoute({
  onNavigate,
}:{
  onNavigate?:(target:string)=>void
}){
  return (
    <SupportTeamWorkspace
      execution={<SupportModule/>}
      workstationContent={
        <div className="supportWorkstationStack">
          <IntakeSubmissionInbox
            workstation="support"
            title="Support Form Submissions"
            description="Customer support, complaints and other forms routed to Support appear here automatically."
          />
          <SupportWhatsAppPanel/>
          <SupportAssistedBookingPanel/>
        </div>
      }
      onNavigate={onNavigate}
    />
  )
}
