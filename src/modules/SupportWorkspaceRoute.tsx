import { SupportModule } from './CoreModules'
import { SupportTeamWorkspace } from './DepartmentTeamWorkspace'
import SupportAssistedBookingPanel from './SupportAssistedBookingPanel'
import SupportWhatsAppPanel from './SupportWhatsAppPanel'

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
          <SupportWhatsAppPanel/>
          <SupportAssistedBookingPanel/>
        </div>
      }
      onNavigate={onNavigate}
    />
  )
}
