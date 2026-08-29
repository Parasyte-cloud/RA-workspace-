import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  FolderKanban,
  Plus,
  RefreshCw,
  ShieldAlert,
  UsersRound,
  XCircle
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../project-management.css'

type Project={
  id:string
  name:string
  description:string|null
  space_type:'project'|'cross_department'
  created_by:string
  created_at:string
}

type Member={
  user_id:string
  member_role:'owner'|'admin'|'member'|'viewer'
  profile:{
    id:string
    full_name:string
    email:string
    department:string|null
    job_title:string|null
  }|null
}

type WorkItem={
  id:string
  title:string
  description:string
  status:'draft'|'assigned'|'in_progress'|'blocked'|'review'|'completed'|'cancelled'
  priority:'low'|'normal'|'high'|'urgent'
  due_at:string|null
  completed_at:string|null
  created_at:string
  kanban_rank:number
  project_space_id:string|null
  work_item_assignees?:{
    assignee_id:string
    assignee:{
      id:string
      full_name:string
      email:string
    }|null
  }[]
}

type ColumnKey='backlog'|'in_progress'|'blocked'|'review'|'completed'

const columns:{key:ColumnKey;title:string;subtitle:string;statuses:WorkItem['status'][]}[]=[
  {key:'backlog',title:'To do',subtitle:'Planned and assigned work',statuses:['draft','assigned']},
  {key:'in_progress',title:'In progress',subtitle:'Work actively being delivered',statuses:['in_progress']},
  {key:'blocked',title:'Blocked',subtitle:'Needs help or a dependency',statuses:['blocked']},
  {key:'review',title:'Review',subtitle:'Awaiting validation or approval',statuses:['review']},
  {key:'completed',title:'Done',subtitle:'Completed project outcomes',statuses:['completed']},
]

const moveStatuses:WorkItem['status'][]=['assigned','in_progress','blocked','review','completed']

function dueLabel(value:string|null){
  if(!value) return 'No due date'
  const date=new Date(value)
  if(Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})
}

function memberLabel(member:Member){
  return member.profile?.full_name || member.profile?.email || member.user_id
}

export default function ProjectManagementModule({onNavigate}:{onNavigate?:(target:string)=>void}){
  const [projects,setProjects]=useState<Project[]>([])
  const [selectedProjectId,setSelectedProjectId]=useState('')
  const [members,setMembers]=useState<Member[]>([])
  const [items,setItems]=useState<WorkItem[]>([])
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [message,setMessage]=useState('')
  const [newProjectOpen,setNewProjectOpen]=useState(false)
  const [newTaskOpen,setNewTaskOpen]=useState(false)
  const [projectForm,setProjectForm]=useState({name:'',description:''})
  const [taskForm,setTaskForm]=useState({title:'',description:'',assignee_id:'',priority:'normal',due_at:''})
  const projectListRequestRef=useRef(0)
  const projectDataRequestRef=useRef(0)

  const selectedProject=useMemo(
    ()=>projects.find(project=>project.id===selectedProjectId) || null,
    [projects,selectedProjectId]
  )

  const loadProjects=useCallback(async()=>{
    const client=supabase
    if(!client) return

    const requestSequence=++projectListRequestRef.current
    const {data,error}=await client
      .from('collaboration_spaces')
      .select('id,name,description,space_type,created_by,created_at')
      .in('space_type',['project','cross_department'])
      .is('archived_at',null)
      .order('updated_at',{ascending:false})

    if(requestSequence!==projectListRequestRef.current) return
    if(error) throw error

    const next=(data || []) as Project[]
    setProjects(next)
    setSelectedProjectId(current=>
      current && next.some(project=>project.id===current)
        ? current
        : (next[0]?.id || '')
    )
  },[])

  const loadProjectData=useCallback(async(projectId:string)=>{
    const client=supabase
    const requestSequence=++projectDataRequestRef.current

    if(!client || !projectId){
      setMembers([])
      setItems([])
      return
    }

    const [memberResult,itemResult]=await Promise.all([
      client.from('collaboration_space_members').select('user_id,member_role,profile:employee_profiles!collaboration_space_members_user_id_fkey(id,full_name,email,department,job_title)').eq('space_id',projectId).order('joined_at'),
      client.from('work_items').select('id,title,description,status,priority,due_at,completed_at,created_at,kanban_rank,project_space_id,work_item_assignees(assignee_id,assignee:employee_profiles!work_item_assignees_assignee_id_fkey(id,full_name,email))').eq('project_space_id',projectId).neq('status','cancelled').order('kanban_rank',{ascending:true}).order('created_at',{ascending:true})
    ])

    if(requestSequence!==projectDataRequestRef.current) return
    if(memberResult.error) throw memberResult.error
    if(itemResult.error) throw itemResult.error

    setMembers((memberResult.data || []) as unknown as Member[])
    setItems((itemResult.data || []) as unknown as WorkItem[])
  },[])

  const refresh=useCallback(async()=>{
    setLoading(true)
    setMessage('')
    try{
      await loadProjects()
    }catch(error:any){
      setMessage(error?.message || 'Unable to load projects.')
    }finally{
      setLoading(false)
    }
  },[loadProjects])

  useEffect(()=>{
    void refresh()
    return()=>{
      projectListRequestRef.current+=1
    }
  },[refresh])

  useEffect(()=>{
    if(!selectedProjectId){
      projectDataRequestRef.current+=1
      setMembers([])
      setItems([])
      return
    }

    let active=true
    setLoading(true)
    setMessage('')

    void loadProjectData(selectedProjectId)
      .catch((error:any)=>{
        if(active){
          setMessage(error?.message || 'Unable to load project board.')
        }
      })
      .finally(()=>{
        if(active){
          setLoading(false)
        }
      })

    return()=>{
      active=false
      projectDataRequestRef.current+=1
    }
  },[selectedProjectId,loadProjectData])

  const createProject=async()=>{
    const client=supabase
    if(!client || !projectForm.name.trim()) return
    setSaving(true);setMessage('')
    try{
      const {data,error}=await client.rpc('create_collaboration_space',{
        p_name:projectForm.name.trim(),
        p_description:projectForm.description.trim() || null,
        p_space_type:'project'
      })
      if(error) throw error
      setProjectForm({name:'',description:''})
      setNewProjectOpen(false)
      await loadProjects()
      if(data) setSelectedProjectId(String(data))
      setMessage('Project created. Invite collaborators from Shared Workspaces when cross-team access is needed.')
    }catch(error:any){
      setMessage(error?.message || 'Unable to create project.')
    }finally{setSaving(false)}
  }

  const createTask=async()=>{
    const client=supabase
    if(!client || !selectedProjectId || !taskForm.title.trim()) return
    setSaving(true);setMessage('')
    try{
      const {error}=await client.rpc('create_project_work_item',{
        p_space_id:selectedProjectId,
        p_title:taskForm.title.trim(),
        p_description:taskForm.description.trim(),
        p_assignee_id:taskForm.assignee_id || null,
        p_priority:taskForm.priority,
        p_due_at:taskForm.due_at ? new Date(taskForm.due_at).toISOString() : null
      })
      if(error) throw error
      setTaskForm({title:'',description:'',assignee_id:'',priority:'normal',due_at:''})
      setNewTaskOpen(false)
      await loadProjectData(selectedProjectId)
      setMessage('Project task created.')
    }catch(error:any){
      setMessage(error?.message || 'Unable to create project task.')
    }finally{setSaving(false)}
  }

  const moveTask=async(item:WorkItem,status:WorkItem['status'])=>{
    const client=supabase
    if(!client || item.status===status) return
    setSaving(true);setMessage('')
    try{
      const {error}=await client.rpc('set_project_work_status',{
        p_work_item:item.id,
        p_status:status,
        p_rank:Date.now()
      })
      if(error) throw error
      setItems(current=>current.map(row=>row.id===item.id ? {...row,status,kanban_rank:Date.now()} : row))
    }catch(error:any){
      setMessage(error?.message || 'Unable to move task.')
    }finally{setSaving(false)}
  }

  const grouped=useMemo(()=>{
    const result:Record<ColumnKey,WorkItem[]>={backlog:[],in_progress:[],blocked:[],review:[],completed:[]}
    for(const item of items){
      const column=columns.find(entry=>entry.statuses.includes(item.status))
      if(column) result[column.key].push(item)
    }
    return result
  },[items])

  const progress=items.length ? Math.round((grouped.completed.length/items.length)*100) : 0

  return <section className="projectManagement">
    <div className="projectHeader">
      <div>
        <span className="eyebrow">PROJECT DELIVERY</span>
        <h2>Projects & Kanban</h2>
        <p>Plan shared outcomes, assign accountable work and follow delivery from backlog to completion without leaving RideArrivo.</p>
      </div>
      <div className="buttonRow">
        <button className="glassButton" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16}/>Refresh</button>
        <button className="glassButton" onClick={()=>onNavigate?.('shared')}><UsersRound size={16}/>Collaborators</button>
        <button className="primaryButton" onClick={()=>setNewProjectOpen(value=>!value)}><Plus size={16}/>New project</button>
      </div>
    </div>

    {message&&<div className="moduleNotice">{message}</div>}

    {newProjectOpen&&<div className="glassCard projectCreatePanel">
      <div><strong>Create shared project</strong><p>Every project is backed by the existing secure Shared Workspace membership model.</p></div>
      <label>Project name<input value={projectForm.name} onChange={event=>setProjectForm({...projectForm,name:event.target.value})} placeholder="e.g. Airport corporate launch"/></label>
      <label>Description<textarea value={projectForm.description} onChange={event=>setProjectForm({...projectForm,description:event.target.value})} placeholder="Outcome, scope and success criteria"/></label>
      <div className="buttonRow"><button className="primaryButton" disabled={saving || !projectForm.name.trim()} onClick={()=>void createProject()}>Create project</button><button className="glassButton" onClick={()=>setNewProjectOpen(false)}>Cancel</button></div>
    </div>}

    {!projects.length && !loading ? <div className="glassCard projectEmpty"><FolderKanban size={32}/><h3>No project board yet</h3><p>Create the first project. Invite collaborators from Shared Workspaces, then add accountable cards to its Kanban board.</p><button className="primaryButton" onClick={()=>setNewProjectOpen(true)}><Plus size={16}/>Create project</button></div> : null}

    {projects.length>0&&<>
      <div className="projectControlRow glassCard">
        <label>Project<select value={selectedProjectId} onChange={event=>setSelectedProjectId(event.target.value)}>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <div className="projectSummary"><span><FolderKanban size={16}/>{items.length} cards</span><span><CheckCircle2 size={16}/>{progress}% done</span><span><UsersRound size={16}/>{members.length} members</span></div>
        <button className="primaryButton" disabled={!selectedProjectId} onClick={()=>setNewTaskOpen(value=>!value)}><Plus size={16}/>Add card</button>
      </div>

      {selectedProject&&<div className="projectDescriptor"><strong>{selectedProject.name}</strong><span>{selectedProject.description || 'No project description yet.'}</span></div>}

      {newTaskOpen&&<div className="glassCard projectCreatePanel taskCreator">
        <label>Card title<input value={taskForm.title} onChange={event=>setTaskForm({...taskForm,title:event.target.value})} placeholder="Specific deliverable"/></label>
        <label>Description<textarea value={taskForm.description} onChange={event=>setTaskForm({...taskForm,description:event.target.value})} placeholder="Definition of done and context"/></label>
        <div className="projectFormGrid">
          <label>Assignee<select value={taskForm.assignee_id} onChange={event=>setTaskForm({...taskForm,assignee_id:event.target.value})}><option value="">Unassigned</option>{members.filter(member=>member.member_role!=='viewer').map(member=><option key={member.user_id} value={member.user_id}>{memberLabel(member)}</option>)}</select></label>
          <label>Priority<select value={taskForm.priority} onChange={event=>setTaskForm({...taskForm,priority:event.target.value})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
          <label>Due date<input type="datetime-local" value={taskForm.due_at} onChange={event=>setTaskForm({...taskForm,due_at:event.target.value})}/></label>
        </div>
        <div className="buttonRow"><button className="primaryButton" disabled={saving || !taskForm.title.trim()} onClick={()=>void createTask()}>Create card</button><button className="glassButton" onClick={()=>setNewTaskOpen(false)}>Cancel</button></div>
      </div>}

      <div className="kanbanBoard" aria-label="Project Kanban board">
        {columns.map((column,columnIndex)=><div className="kanbanColumn" key={column.key}>
          <div className="kanbanColumnHeader"><div><strong>{column.title}</strong><span>{column.subtitle}</span></div><b>{grouped[column.key].length}</b></div>
          <div className="kanbanCards">
            {grouped[column.key].map(item=>{
              const assignee=item.work_item_assignees?.[0]?.assignee
              const currentMoveIndex=moveStatuses.includes(item.status) ? moveStatuses.indexOf(item.status) : 0
              const previous=moveStatuses[Math.max(0,currentMoveIndex-1)]
              const next=moveStatuses[Math.min(moveStatuses.length-1,currentMoveIndex+1)]
              return <article className={`kanbanCard priority-${item.priority}`} key={item.id}>
                <div className="kanbanCardTop"><span className="priorityPill">{item.priority}</span>{item.status==='blocked'?<ShieldAlert size={16}/>:item.status==='completed'?<CheckCircle2 size={16}/>:<CircleDot size={16}/>}</div>
                <strong>{item.title}</strong>
                {item.description&&<p>{item.description}</p>}
                <div className="kanbanMeta"><span><UsersRound size={13}/>{assignee?.full_name || assignee?.email || 'Unassigned'}</span><span><CalendarClock size={13}/>{dueLabel(item.due_at)}</span></div>
                <div className="kanbanMoveRow">
                  <button className="kanbanMove" disabled={saving || columnIndex===0} onClick={()=>void moveTask(item,previous)} title="Move one stage left"><ArrowLeft size={14}/></button>
                  <select aria-label={`Move ${item.title}`} value={item.status==='draft'?'assigned':item.status} disabled={saving} onChange={event=>void moveTask(item,event.target.value as WorkItem['status'])}>
                    <option value="assigned">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">Review</option><option value="completed">Done</option><option value="cancelled">Cancelled</option>
                  </select>
                  <button className="kanbanMove" disabled={saving || columnIndex===columns.length-1} onClick={()=>void moveTask(item,next)} title="Move one stage right"><ArrowRight size={14}/></button>
                </div>
              </article>
            })}
            {!grouped[column.key].length&&<div className="kanbanEmpty">No cards</div>}
          </div>
        </div>)}
      </div>

      <div className="projectGovernance glassCard"><XCircle size={18}/><div><strong>Project governance</strong><p>Project membership comes from Shared Workspaces. Viewer members can observe the board; owners/admins manage collaborators. Task changes are verified server-side and written into the existing work activity trail.</p></div></div>
    </>}
  </section>
}
