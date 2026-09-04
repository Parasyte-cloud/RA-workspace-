import { SupportModule } from './CoreModules'
import { SupportTeamWorkspace } from './DepartmentTeamWorkspace'
import SupportAssistedBookingPanel from './SupportAssistedBookingPanel'

export default function SupportWorkspaceRoute({
  onNavigate,
}:{
  onNavigate?:(target:string)=>void
}){
  return (
    <SupportTeamWorkspace
      execution={<SupportModule/>}
      workstationContent={
        <SupportAssistedBookingPanel/>
      }
      onNavigate={onNavigate}
    />
  )
}
