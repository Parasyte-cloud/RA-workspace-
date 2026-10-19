import { SupportModule } from './CoreModules'
import { SupportTeamWorkspace } from './DepartmentTeamWorkspace'
import SupportAssistedBookingPanel from './SupportAssistedBookingPanel'
import SupportWhatsAppPanel from './SupportWhatsAppPanel'
import InvestorEnquiriesPanel from './InvestorEnquiriesPanel'
import IntakeSubmissionInbox from './IntakeSubmissionInbox'
import OperationsExportsCard from '../components/OperationsExportsCard'
import SupportCommandCentre from './SupportCommandCentre'

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
          <SupportCommandCentre/>
          <InvestorEnquiriesPanel/>
          <IntakeSubmissionInbox
            workstation="support"
            title="Support Form Submissions"
            description="Customer support, complaints and other forms routed to Support appear here automatically."
          />
          <SupportWhatsAppPanel/>
          <SupportAssistedBookingPanel/>
          <OperationsExportsCard/>
        </div>
      }
      onNavigate={onNavigate}
    />
  )
}
