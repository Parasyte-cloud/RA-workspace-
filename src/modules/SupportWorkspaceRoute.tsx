import { SupportModule } from './CoreModules'
import { SupportTeamWorkspace } from './DepartmentTeamWorkspace'
import SupportWorkspaceHub from './SupportWorkspaceHub'

export default function SupportWorkspaceRoute({
  onNavigate,
}:{
  onNavigate?:(target:string)=>void
}){
  return (
    <SupportTeamWorkspace
      execution={<SupportModule/>}
      workstationContent={<SupportWorkspaceHub/>}
      onNavigate={onNavigate}
    />
  )
}
