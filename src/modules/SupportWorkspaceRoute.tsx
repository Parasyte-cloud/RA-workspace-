import { SupportModule } from './CoreModules'
import { SupportTeamWorkspace } from './DepartmentTeamWorkspace'

export default function SupportWorkspaceRoute({
  onNavigate,
}:{
  onNavigate?:(target:string)=>void
}){
  return (
    <SupportTeamWorkspace
      execution={<SupportModule/>}
      onNavigate={onNavigate}
    />
  )
}
