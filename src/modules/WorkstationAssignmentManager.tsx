import { useCallback, useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, RefreshCw, ShieldCheck, UserCog } from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../workstation-assignment.css'

type Employee={
  id:string
  full_name:string
  email:string
  role:string
  department:string|null
  job_title:string|null
  active:boolean
}

type Assignment={
  employee_id:string
  workstation:string
  is_primary:boolean
  active:boolean
}

const workstations=[
  ['support','Support'],
  ['operations','Operations'],
  ['people','People & HR'],
  ['engineering','Engineering'],
  ['finance','Finance'],
  ['marketing','Marketing'],
  ['partnerships','Partnerships'],
  ['legal','Legal & Compliance'],
  ['executive','CEO / Management'],
  ['administration','Administration'],
] as const

export default function WorkstationAssignmentManager(){
  const [employees,setEmployees]=useState<Employee[]>([])
  const [assignments,setAssignments]=useState<Assignment[]>([])
  const [drafts,setDrafts]=useState<Record<string,string>>({})
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState('')
  const [message,setMessage]=useState('')

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){
      setLoading(false)
      return
    }

    setLoading(true)
    setMessage('')

    const [peopleResult,assignmentResult]=await Promise.all([
      client
        .from('employee_profiles')
        .select('id,full_name,email,role,department,job_title,active')
        .eq('active',true)
        .order('full_name'),
      client
        .from('workspace_workstation_assignments')
        .select('employee_id,workstation,is_primary,active')
        .eq('active',true)
        .eq('is_primary',true),
    ])

    if(peopleResult.error){
      setMessage(peopleResult.error.message)
      setLoading(false)
      return
    }

    if(assignmentResult.error){
      setMessage(assignmentResult.error.message)
      setLoading(false)
      return
    }

    const nextPeople=(peopleResult.data || []) as Employee[]
    const nextAssignments=(assignmentResult.data || []) as Assignment[]
    const assignmentMap=new Map(nextAssignments.map(row=>[row.employee_id,row.workstation]))

    setEmployees(nextPeople)
    setAssignments(nextAssignments)
    setDrafts(Object.fromEntries(nextPeople.map(person=>[person.id,assignmentMap.get(person.id) || ''])))
    setLoading(false)
  },[])

  useEffect(()=>{ void load() },[load])

  const currentByEmployee=useMemo(
    ()=>new Map(assignments.map(row=>[row.employee_id,row.workstation])),
    [assignments]
  )

  const save=async(person:Employee)=>{
    const client=supabase
    if(!client) return

    const workstation=drafts[person.id] || ''
    setSaving(person.id)
    setMessage('')

    try{
      if(!workstation){
        const {error}=await client.rpc('remove_primary_workstation',{target_user:person.id})
        if(error) throw error
      }else{
        const {error}=await client.rpc('assign_primary_workstation',{
          target_user:person.id,
          new_workstation:workstation,
        })
        if(error) throw error
      }

      setMessage(`${person.full_name || person.email} workstation updated.`)
      await load()
    }catch(error){
      setMessage(error instanceof Error ? error.message : 'Unable to update workstation.')
    }finally{
      setSaving('')
    }
  }

  return (
    <section className="glassCard workstationAssignmentCard">
      <div className="workstationAssignmentHeader">
        <div>
          <span className="eyebrow">WORKSTATION CONTROL</span>
          <h3>Assign or reassign employee workstations</h3>
          <p>
            A workstation assignment grants the corresponding secured department environment.
            Employment role and job title remain separate. Administration and Executive stations
            remain restricted to Admin and Manager/Admin roles.
          </p>
        </div>
        <button type="button" className="glassButton" onClick={()=>void load()} disabled={loading}>
          <RefreshCw size={15}/>Refresh
        </button>
      </div>

      {message&&<div className="moduleNotice">{message}</div>}

      {loading ? (
        <div className="workstationAssignmentEmpty">Loading workstation assignments...</div>
      ) : (
        <div className="workstationAssignmentList">
          {employees.map(person=>{
            const current=currentByEmployee.get(person.id) || ''
            const selected=drafts[person.id] || ''
            const changed=current!==selected

            return (
              <article key={person.id} className="workstationAssignmentRow">
                <div className="workstationAssignmentPerson">
                  <div className="workstationAssignmentIcon"><UserCog size={17}/></div>
                  <div>
                    <strong>{person.full_name || person.email}</strong>
                    <span>{person.job_title || person.department || person.role}</span>
                    <small>{person.email} · role: {person.role}</small>
                  </div>
                </div>

                <label>
                  Primary workstation
                  <select
                    value={selected}
                    onChange={event=>setDrafts(currentDrafts=>({
                      ...currentDrafts,
                      [person.id]:event.target.value,
                    }))}
                  >
                    <option value="">Unassigned</option>
                    {workstations.map(([value,label])=>(
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>

                <div className="workstationAssignmentStatus">
                  {current ? (
                    <><ShieldCheck size={15}/><span>{workstations.find(([value])=>value===current)?.[1] || current}</span></>
                  ) : (
                    <><BriefcaseBusiness size={15}/><span>No workstation</span></>
                  )}
                </div>

                <button
                  type="button"
                  className={changed?'primaryButton':'glassButton'}
                  disabled={!changed || saving===person.id}
                  onClick={()=>void save(person)}
                >
                  {saving===person.id?'Saving...':current?'Reassign':'Assign'}
                </button>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
