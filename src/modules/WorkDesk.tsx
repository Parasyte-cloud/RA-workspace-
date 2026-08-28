import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import {
  CheckCircle2,
  CircleDot,
  Clock3,
  Plus,
  RefreshCw,
  UserRound,
  UsersRound,
  X
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { WorkItemDetail } from './WorkItemDetail'


type WorkItem = {
  id:string
  title:string
  description:string
  status:
    | 'draft'
    | 'assigned'
    | 'in_progress'
    | 'blocked'
    | 'review'
    | 'completed'
    | 'cancelled'
  priority:
    | 'low'
    | 'normal'
    | 'high'
    | 'urgent'
  department:string|null
  created_by:string
  due_at:string|null
  completed_at:string|null
  created_at:string
  work_item_assignees?:{
    assignee_id:string
    assigned_by:string
    assignee?:{
      id:string
      full_name:string
      email:string
      department:string
      job_title:string
    }|null
  }[]
}


type Employee = {
  id:string
  full_name:string
  email:string
  department:string
  job_title:string
  role:string
}


type Profile = {
  id:string
  role:string
  department:string
}


type View =
  | 'my'
  | 'assigned'
  | 'all'


const emptyForm = {
  title:'',
  description:'',
  assignee:'',
  priority:'normal',
  due_at:''
}


export function WorkDesk(){
  const [profile,setProfile]=useState<Profile|null>(null)
  const [items,setItems]=useState<WorkItem[]>([])
  const [people,setPeople]=useState<Employee[]>([])

  const [view,setView]=useState<View>('my')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)

  const [message,setMessage]=useState('')
  const [createOpen,setCreateOpen]=useState(false)

  const [selectedWork,setSelectedWork]=
    useState<WorkItem|null>(null)

  const [form,setForm]=useState(emptyForm)


  const loadProfile=useCallback(async()=>{
    if(!supabase){
      return null
    }

    const {
      data:{
        user
      }
    }=await supabase.auth.getUser()

    if(!user){
      return null
    }

    const {data,error}=await supabase
      .from('employee_profiles')
      .select('id,role,department')
      .eq('id',user.id)
      .single()

    if(error){
      throw error
    }

    const next=data as Profile
    setProfile(next)

    return next
  },[])


  const loadPeople=useCallback(async(
    current:Profile|null
  )=>{
    if(!supabase || !current){
      return
    }

    const canAssignCompanyWide=
      current.role==='admin' ||
      current.role==='manager'

    if(!canAssignCompanyWide){
      const {data,error}=await supabase
        .from('employee_profiles')
        .select(
          'id,full_name,email,department,job_title,role'
        )
        .eq('id',current.id)
        .eq('active',true)

      if(error){
        throw error
      }

      setPeople((data || []) as Employee[])
      return
    }

    const {data,error}=await supabase
      .from('employee_profiles')
      .select(
        'id,full_name,email,department,job_title,role'
      )
      .eq('active',true)
      .order('full_name')

    if(error){
      throw error
    }

    setPeople((data || []) as Employee[])
  },[])


  const loadWork=useCallback(async()=>{
    if(!supabase){
      return
    }

    setLoading(true)
    setMessage('')

    try{
      const {data,error}=await supabase
        .from('work_items')
        .select(`
          id,
          title,
          description,
          status,
          priority,
          department,
          created_by,
          due_at,
          completed_at,
          created_at,
          work_item_assignees(
            assignee_id,
            assigned_by,
            assignee:employee_profiles!work_item_assignees_assignee_id_fkey(
              id,
              full_name,
              email,
              department,
              job_title
            )
          )
        `)
        .order('created_at',{
          ascending:false
        })

      if(error){
        throw error
      }

      setItems((data || []) as unknown as WorkItem[])
    }catch(error:any){
      console.error(
        '[RideArrivo Work]',
        error
      )

      setMessage(
        error?.message ||
        'Unable to load work.'
      )
    }finally{
      setLoading(false)
    }
  },[])


  const initialise=useCallback(async()=>{
    try{
      const current=await loadProfile()

      await Promise.all([
        loadPeople(current),
        loadWork()
      ])
    }catch(error:any){
      console.error(
        '[RideArrivo Work]',
        error
      )

      setMessage(
        error?.message ||
        'Unable to initialise Work Desk.'
      )

      setLoading(false)
    }
  },[
    loadPeople,
    loadProfile,
    loadWork
  ])


  useEffect(()=>{
    void initialise()
  },[initialise])


  useEffect(()=>{
    if(
      !supabase ||
      !profile?.id
    ){
      return
    }

    const client = supabase

    const channel=client
      .channel(
        `ridearrivo-work-${profile.id}`
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'work_items'
        },
        ()=>{
          void loadWork()
        }
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'work_item_assignees'
        },
        ()=>{
          void loadWork()
        }
      )
      .subscribe()

    return()=>{
      void client.removeChannel(channel)
    }
  },[
    profile?.id,
    loadWork
  ])


  const canAssignCompanyWide=
    profile?.role==='admin' ||
    profile?.role==='manager'

  const canDelegate=
    canAssignCompanyWide ||
    profile?.role==='cto' ||
    profile?.role==='operations'


  const filtered=useMemo(()=>{
    if(!profile){
      return []
    }

    if(view==='assigned'){
      return items.filter(
        item=>item.created_by===profile.id
      )
    }

    if(
      view==='all' &&
      canAssignCompanyWide
    ){
      return items
    }

    return items.filter(
      item=>
        item.work_item_assignees
          ?.some(
            assignment=>
              assignment.assignee_id===profile.id
          )
    )
  },[
    items,
    profile,
    view,
    canAssignCompanyWide
  ])


  const createWork=async()=>{
    if(
      !supabase ||
      !profile ||
      !form.title.trim()
    ){
      return
    }

    const assignee=
      form.assignee ||
      profile.id

    setSaving(true)
    setMessage('')

    try{
      const {error}=await supabase.rpc(
        'create_work_assignment',
        {
          task_title:
            form.title.trim(),

          task_description:
            form.description.trim(),

          target_user:
            assignee,

          task_priority:
            form.priority,

          task_due_at:
            form.due_at
              ? new Date(
                  form.due_at
                ).toISOString()
              : null,

          task_department:
            null
        }
      )

      if(error){
        throw error
      }

      setForm(emptyForm)
      setCreateOpen(false)

      await loadWork()
    }catch(error:any){
      console.error(
        '[RideArrivo Work] create',
        error
      )

      setMessage(
        error?.message ||
        'Unable to create work assignment.'
      )
    }finally{
      setSaving(false)
    }
  }


  const changeStatus=async(
    id:string,
    status:string
  )=>{
    if(!supabase){
      return
    }

    setMessage('')

    const {error}=await supabase.rpc(
      'update_work_status',
      {
        target_work_item:id,
        new_status:status
      }
    )

    if(error){
      setMessage(
        error.message
      )
      return
    }

    await loadWork()
  }


  const statusIcon=(status:string)=>{
    if(status==='completed'){
      return <CheckCircle2 size={17}/>
    }

    if(status==='in_progress'){
      return <CircleDot size={17}/>
    }

    return <Clock3 size={17}/>
  }


  return (
    <section className="workDesk">
      <div className="workDeskHeader">
        <div>
          <span className="eyebrow">
            WORK & DELEGATION
          </span>

          <h2>
            Work Desk
          </h2>

          <p>
            Assign, receive and track RideArrivo work
            with live status updates.
          </p>
        </div>

        <div className="buttonRow">
          <button
            type="button"
            className="glassButton"
            onClick={()=>
              void loadWork()
            }
          >
            <RefreshCw size={16}/>
            Refresh
          </button>

          <button
            type="button"
            className="primaryButton"
            onClick={()=>
              setCreateOpen(true)
            }
          >
            <Plus size={16}/>
            New work
          </button>
        </div>
      </div>


      {message&&
        <div className="moduleNotice">
          {message}
        </div>
      }


      <div className="workDeskTabs">
        <button
          className={
            view==='my'
              ? 'active'
              : ''
          }
          onClick={()=>
            setView('my')
          }
        >
          <UserRound size={16}/>
          My Work
        </button>

        {canDelegate&&
          <button
            className={
              view==='assigned'
                ? 'active'
                : ''
            }
            onClick={()=>
              setView('assigned')
            }
          >
            <UsersRound size={16}/>
            Assigned by Me
          </button>
        }

        {canAssignCompanyWide&&
          <button
            className={
              view==='all'
                ? 'active'
                : ''
            }
            onClick={()=>
              setView('all')
            }
          >
            <UsersRound size={16}/>
            Company Work
          </button>
        }
      </div>


      {loading?
        <div className="glassCard workEmpty">
          Loading work...
        </div>
        :
        <div className="workGrid">
          {filtered.map(item=>{
            const assignees=
              item.work_item_assignees || []

            return (
              <article
                className="glassCard workCard"
                key={item.id}
                onDoubleClick={()=>
                  setSelectedWork(item)
                }
              >
                <div className="workCardTop">
                  <div>
                    <span className="eyebrow">
                      {item.department ||
                        'WORKSPACE'}
                    </span>

                    <h3>
                      {item.title}
                    </h3>
                  </div>

                  <span
                    className={
                      `workPriority ${item.priority}`
                    }
                  >
                    {item.priority}
                  </span>
                </div>

                {item.description&&
                  <p className="workDescription">
                    {item.description}
                  </p>
                }

                <div className="workMeta">
                  <span>
                    {statusIcon(item.status)}
                    {item.status.replace(
                      /_/g,
                      ' '
                    )}
                  </span>

                  {item.due_at&&
                    <span>
                      <Clock3 size={15}/>
                      {new Date(
                        item.due_at
                      ).toLocaleString()}
                    </span>
                  }
                </div>

                <div className="workAssignees">
                  <strong>
                    Assigned to
                  </strong>

                  {assignees.map(a=>
                    <span key={a.assignee_id}>
                      {a.assignee?.full_name ||
                        a.assignee?.email ||
                        'Employee'}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="glassButton workDetailsButton"
                  onClick={()=>
                    setSelectedWork(item)
                  }
                >
                  Open details
                </button>

                <label className="workStatusControl">
                  Status

                  <select
                    value={item.status}
                    onChange={event=>
                      void changeStatus(
                        item.id,
                        event.target.value
                      )
                    }
                  >
                    <option value="assigned">
                      Assigned
                    </option>

                    <option value="in_progress">
                      In progress
                    </option>

                    <option value="blocked">
                      Blocked
                    </option>

                    <option value="review">
                      Review
                    </option>

                    <option value="completed">
                      Completed
                    </option>

                    <option value="cancelled">
                      Cancelled
                    </option>
                  </select>
                </label>
              </article>
            )
          })}

          {!filtered.length&&
            <div className="glassCard workEmpty">
              No work in this view.
            </div>
          }
        </div>
      }


      {selectedWork&&profile&&
        <WorkItemDetail
          item={selectedWork}
          people={people}
          currentUserId={profile.id}
          onClose={()=>
            setSelectedWork(null)
          }
          onChanged={async()=>{
            await loadWork()

            setSelectedWork(current=>{
              if(!current){
                return null
              }

              return items.find(
                item=>item.id===current.id
              ) || current
            })
          }}
        />
      }


      {createOpen&&
        <div
          className="workModalBackdrop"
          onMouseDown={event=>{
            if(
              event.target===
              event.currentTarget
            ){
              setCreateOpen(false)
            }
          }}
        >
          <div className="workModal glassCard">
            <div className="workModalHeader">
              <div>
                <span className="eyebrow">
                  DELEGATE WORK
                </span>

                <h3>
                  New work assignment
                </h3>
              </div>

              <button
                type="button"
                className="iconButton"
                onClick={()=>
                  setCreateOpen(false)
                }
              >
                <X size={18}/>
              </button>
            </div>

            <div className="workForm">
              <label>
                Title

                <input
                  value={form.title}
                  onChange={event=>
                    setForm({
                      ...form,
                      title:event.target.value
                    })
                  }
                  placeholder="What needs to be done?"
                />
              </label>

              <label>
                Description

                <textarea
                  value={form.description}
                  onChange={event=>
                    setForm({
                      ...form,
                      description:event.target.value
                    })
                  }
                  placeholder="Context, expected outcome and instructions"
                />
              </label>

              <div className="grid2">
                <label>
                  Assign to

                  <select
                    value={form.assignee}
                    onChange={event=>
                      setForm({
                        ...form,
                        assignee:event.target.value
                      })
                    }
                  >
                    <option value="">
                      Myself
                    </option>

                    {people
                      .filter(
                        person=>
                          person.id!==profile?.id
                      )
                      .map(person=>
                        <option
                          key={person.id}
                          value={person.id}
                        >
                          {person.full_name}
                          {' — '}
                          {person.department}
                        </option>
                      )
                    }
                  </select>
                </label>

                <label>
                  Priority

                  <select
                    value={form.priority}
                    onChange={event=>
                      setForm({
                        ...form,
                        priority:event.target.value
                      })
                    }
                  >
                    <option value="low">
                      Low
                    </option>

                    <option value="normal">
                      Normal
                    </option>

                    <option value="high">
                      High
                    </option>

                    <option value="urgent">
                      Urgent
                    </option>
                  </select>
                </label>
              </div>

              <label>
                Due date

                <input
                  type="datetime-local"
                  value={form.due_at}
                  onChange={event=>
                    setForm({
                      ...form,
                      due_at:event.target.value
                    })
                  }
                />
              </label>

              <div className="buttonRow">
                <button
                  type="button"
                  className="glassButton"
                  onClick={()=>
                    setCreateOpen(false)
                  }
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="primaryButton"
                  disabled={
                    saving ||
                    !form.title.trim()
                  }
                  onClick={()=>
                    void createWork()
                  }
                >
                  {saving
                    ? 'Assigning...'
                    : 'Assign work'
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </section>
  )
}
