import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BadgeCheck, CalendarCheck2, CalendarRange, CheckCircle2, Clock3, Gauge, Laptop, Smartphone, Target, Trophy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import WorkstationGuideCard from '../components/WorkstationGuideCard'
import MyWorkspaceSessionsPanel from './MyWorkspaceSessionsPanel'
import DashboardNotificationsTeaser from '../components/DashboardNotificationsTeaser'
import '../personal-dashboard.css'

type Profile={
  id:string
  full_name:string
  email:string
  role:string
  department:string
  job_title:string
}

type WorkstationAssignment={
  workstation:string
  is_primary:boolean
  active:boolean
}

type Snapshot={
  snapshot_date:string
  period_start:string
  period_end:string
  total_assigned:number
  total_completed:number
  completed_with_due_date:number
  completed_on_time:number
  acknowledged:number
  overdue_open:number
  completion_rate:number|null
  on_time_rate:number|null
  acknowledgement_rate:number|null
  score:number|null
  status:'insufficient_data'|'excellent'|'strong'|'on_track'|'needs_focus'
  calculated_at:string
}

type AnnualSnapshot={
  evaluation_year:number
  period_start:string
  period_end:string
  total_assigned:number
  total_completed:number
  completed_with_due_date:number
  completed_on_time:number
  acknowledged:number
  overdue_open:number
  completion_rate:number|null
  on_time_rate:number|null
  acknowledgement_rate:number|null
  score:number|null
  status:'insufficient_data'|'excellent'|'strong'|'on_track'|'needs_focus'
  calculated_at:string
}

type Recognition={
  badge_label:string
  score:number
  performance_month:string
  awarded_at:string
  active:boolean
}

type CompanyDevice={
  id:string
  asset_tag:string
  device_type:string
  manufacturer:string|null
  model:string|null
  serial_number:string|null
  imei:string|null
  color:string|null
  memory_label:string|null
  storage_label:string|null
  operating_system:string|null
  hostname:string|null
  location_label:string|null
  status:string
  issued_at:string|null
}

const workstationLabels:Record<string,string>={
  support:'Support',operations:'Operations',people:'People & HR',engineering:'Engineering',finance:'Finance',marketing:'Marketing',partnerships:'Partnerships',legal:'Legal & Compliance',executive:'CEO / Management',administration:'Administration',
}

const workstationSection:Record<string,string>={
  support:'support',operations:'operations',people:'people',engineering:'engineering',finance:'finance',marketing:'marketing',partnerships:'partnerships',legal:'legal',executive:'executive',administration:'admin',
}

const encouragements=[
  'Start with the outcome that matters most today, then make the next action clear.',
  'Consistent delivery compounds. Protect your focus and close the important work.',
  'Good work is visible in clear ownership, timely updates and completed outcomes.',
  'Keep the team informed, raise blockers early and finish what moves RideArrivo forward.',
  'Make today measurable: one important result, clear evidence and a clean handoff.',
  'Progress is strongest when priorities are clear. Focus, communicate and complete.',
  'Use the workspace to keep your work accountable, collaborative and easy to follow.',
]

function firstName(name:string,email:string){
  const clean=name.trim()
  if(clean) return clean.split(/\s+/)[0]
  return email.split('@')[0] || 'there'
}

function greeting(){
  const hour=new Date().getHours()
  if(hour<12) return 'Good morning'
  if(hour<17) return 'Good afternoon'
  return 'Good evening'
}

function pct(value:number|null){
  return value===null ? 'n/a' : `${Math.round(value)}%`
}

function monthLabel(value:string){
  const date=new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined,{month:'long',year:'numeric'})
}

export default function PersonalDashboard({profile,assignments,onNavigate}:{profile:Profile;assignments:WorkstationAssignment[];onNavigate:(target:string)=>void}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null)
  const [annual,setAnnual]=useState<AnnualSnapshot|null>(null)
  const [recognition,setRecognition]=useState<Recognition|null>(null)
  const [devices,setDevices]=useState<CompanyDevice[]>([])
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')

  // The workstation guide opens by itself until it has been closed once.
  const guideKey=`ridearrivo-guide-seen:${profile.id}`
  const [guideSeenAtLoad]=useState(()=>{
    try{ return window.localStorage.getItem(guideKey)==='1' }catch{ return false }
  })
  const markGuideSeen=()=>{
    try{ window.localStorage.setItem(guideKey,'1') }catch{ /* storage blocked: it simply opens again next time */ }
  }

  const load=useCallback(async()=>{
    const client=supabase
    if(!client || !profile.id){ setLoading(false); return }
    setLoading(true)
    setMessage('')

    const [rollingResult,annualResult,recognitionResult,devicesResult]=await Promise.all([
      client.from('employee_kpi_snapshots').select('snapshot_date,period_start,period_end,total_assigned,total_completed,completed_with_due_date,completed_on_time,acknowledged,overdue_open,completion_rate,on_time_rate,acknowledgement_rate,score,status,calculated_at').eq('employee_id',profile.id).order('snapshot_date',{ascending:false}).limit(1).maybeSingle(),
      client.from('employee_annual_kpi_snapshots').select('evaluation_year,period_start,period_end,total_assigned,total_completed,completed_with_due_date,completed_on_time,acknowledged,overdue_open,completion_rate,on_time_rate,acknowledgement_rate,score,status,calculated_at').eq('employee_id',profile.id).eq('evaluation_year',new Date().getFullYear()).maybeSingle(),
      client.from('employee_recognition_awards').select('badge_label,score,performance_month,awarded_at,active').eq('employee_id',profile.id).eq('active',true).order('awarded_at',{ascending:false}).limit(1).maybeSingle(),
      client.from('company_devices').select('id,asset_tag,device_type,manufacturer,model,serial_number,imei,color,memory_label,storage_label,operating_system,hostname,location_label,status,issued_at').eq('assigned_employee_id',profile.id).neq('status','returned').neq('status','retired').order('asset_tag'),
    ])

    const errors=[rollingResult.error,annualResult.error,recognitionResult.error,devicesResult.error].filter(Boolean)
    if(errors.length) setMessage(errors.map(error=>error?.message).filter(Boolean).join(' · '))

    setSnapshot((rollingResult.data || null) as Snapshot|null)
    setAnnual((annualResult.data || null) as AnnualSnapshot|null)
    setRecognition((recognitionResult.data || null) as Recognition|null)
    setDevices((devicesResult.data || []) as CompanyDevice[])
    setLoading(false)
  },[profile.id])

  useEffect(()=>{ void load() },[load])

  const name=firstName(profile.full_name,profile.email)
  const primary=assignments.find(item=>item.active && item.is_primary)
  const primaryLabel=primary ? workstationLabels[primary.workstation] || primary.workstation : ''
  const primaryTarget=primary ? workstationSection[primary.workstation] : ''

  const morningNote=useMemo(()=>{
    const day=Math.floor(new Date().setHours(0,0,0,0)/86400000)
    return encouragements[Math.abs(day)%encouragements.length]
  },[])

  const performanceMessage=useMemo(()=>{
    if(!snapshot || snapshot.score===null) return `${name}, your KPI will populate as assigned work is recorded. No work history means no artificial zero score.`
    const value=Math.round(snapshot.score)
    if(snapshot.status==='excellent') return `Excellent work, ${name}. Your 30-day delivery score is ${value}%. Keep the quality and consistency high.`
    if(snapshot.status==='strong') return `Strong performance, ${name}. Your 30-day delivery score is ${value}%. Keep closing work cleanly and on time.`
    if(snapshot.status==='on_track') return `${name}, you are on track at ${value}%. Focus on completing assigned work and raising blockers early.`
    return `${name}, your current delivery score is ${value}%. Use your open work and overdue items to choose the next best improvement.`
  },[name,snapshot])

  const overdue=snapshot?.overdue_open ?? null

  return (
    <section className="personalDashboard todayView">
      <div className="personalHero todayHero glassHero">
        <div className="personalHeroCopy">
          <span className="eyebrow">TODAY</span>
          <h2>{greeting()}, {name}.</h2>
          <p>{profile.job_title || profile.department || 'RideArrivo team member'}</p>
        </div>
        <div className="personalHeroActions todayHeroActions">
          {primaryTarget&&<button className="primaryButton" onClick={()=>onNavigate(primaryTarget)}>Open {primaryLabel}</button>}
          {recognition&&<span className="recognitionChip" title="Current company recognition"><Trophy size={14}/>{recognition.badge_label} · {monthLabel(recognition.performance_month)}</span>}
        </div>
      </div>

      <DashboardNotificationsTeaser onOpenWork={()=>onNavigate('tasks')}/>

      <div className="todayRow">
        <article className="glassCard todayAttention">
          <span className="eyebrow">NEEDS YOUR ATTENTION</span>
          {loading
            ? <p>Checking your work...</p>
            : overdue!==null&&overdue>0
              ? <button type="button" className="todayAttentionItem" onClick={()=>onNavigate('tasks')}><Clock3 size={16}/><span><strong>{overdue} overdue {overdue===1?'item':'items'}</strong><small>Open Tasks to clear or update them</small></span></button>
              : <p>Nothing is overdue. Open Tasks to plan what comes next.</p>}
        </article>
        <article className="glassCard personalKpiCard emphasis todayKpi"><Gauge/><span>30-day delivery KPI</span><strong>{snapshot?.score===null || !snapshot ? 'n/a' : `${Math.round(snapshot.score)}%`}</strong><small>{snapshot?.status==='insufficient_data'?'Waiting for enough assigned work':String(snapshot?.status || 'Loading').replace('_',' ')}</small></article>
      </div>

      <Disclosure
        title="Workstation guide"
        hint="Daily workflow, key tools and security"
        defaultOpen={!guideSeenAtLoad}
        onToggleOpen={open=>{ if(!open) markGuideSeen() }}
      >
        <WorkstationGuideCard />
      </Disclosure>

      <div className="todayMore" aria-label="More about you">
        <Disclosure title="Performance details" hint="Score breakdown and how it is measured">
          <div className={`performanceBanner ${snapshot?.status || 'insufficient_data'}`}>
            <BadgeCheck size={19}/><div><strong>Performance update</strong><span>{loading?'Calculating your latest KPI...':performanceMessage}</span></div>
          </div>
          {message&&<div className="moduleNotice">KPI data: {message}</div>}
          <div className="personalKpiGrid todayKpiGrid">
            <article className="glassCard personalKpiCard annual"><CalendarRange/><span>{new Date().getFullYear()} overall KPI</span><strong>{annual?.score===null || !annual ? 'n/a' : `${Math.round(annual.score)}%`}</strong><small>{annual ? `Year-to-date · ${String(annual.status).replace('_',' ')}` : 'Waiting for annual KPI snapshot'}</small></article>
            <article className="glassCard personalKpiCard"><CheckCircle2/><span>Completion rate</span><strong>{pct(snapshot?.completion_rate ?? null)}</strong><small>{snapshot ? `${snapshot.total_completed} of ${snapshot.total_assigned} assigned items completed` : 'Loading'}</small></article>
            <article className="glassCard personalKpiCard"><CalendarCheck2/><span>On-time completion</span><strong>{pct(snapshot?.on_time_rate ?? null)}</strong><small>{snapshot ? `${snapshot.completed_on_time} of ${snapshot.completed_with_due_date} completed items with deadlines` : 'Loading'}</small></article>
            <article className="glassCard personalKpiCard"><Clock3/><span>Open overdue</span><strong>{snapshot?.overdue_open ?? 'n/a'}</strong><small>Assigned items currently past their due date</small></article>
          </div>
          <article className="glassCard dashboardContextCard"><Target size={20}/><div><strong>How your KPI is measured</strong><p>Transparent delivery evidence: 60% completion, 30% on-time completion when deadlines exist, and 10% acknowledgement. The annual evaluation uses the same method across the current year. If there is no assigned work, RideArrivo shows insufficient data instead of a zero.</p></div></article>
        </Disclosure>

        <Disclosure title="Company equipment" hint={devices.length?`${devices.length} assigned`:'None assigned'}>
          <p className="todayNote">Your registered RideArrivo laptops, phones and gadgets. Serial and IMEI values come from the controlled asset registry; a normal browser cannot discover them automatically.</p>
          <div className="myEquipmentGrid">
            {devices.map(device=><article key={device.id} className="myEquipmentItem">
              <div className="myEquipmentIcon">{device.device_type==='phone'?<Smartphone size={18}/>:<Laptop size={18}/>}</div>
              <div><span>{device.asset_tag}</span><strong>{[device.manufacturer,device.model].filter(Boolean).join(' ') || device.device_type}</strong><small>{[device.color,device.memory_label,device.storage_label,device.operating_system].filter(Boolean).join(' · ') || 'Registered company device'}</small><small>{device.serial_number?`Serial: ${device.serial_number}`:'Serial not recorded'}{device.imei?` · IMEI: ${device.imei}`:''}</small>{device.location_label&&<small>Issued location: {device.location_label}</small>}</div>
            </article>)}
            {!devices.length&&<div className="myEquipmentEmpty">No company equipment is assigned to your account yet.</div>}
          </div>
        </Disclosure>

        <Disclosure title="Sign-in sessions" hint="Where you are signed in">
          <MyWorkspaceSessionsPanel/>
        </Disclosure>

        <Disclosure title="Your workstation" hint={primaryLabel || 'Not assigned yet'}>
          <p className="todayNote">{primaryLabel ? `${primaryLabel} is your primary secured workstation. Administration can reassign it when your responsibilities change.` : 'Administration can assign your primary workstation without changing your name, title or employee identity.'}</p>
        </Disclosure>

        <Disclosure title="Daily note">
          <p className="todayNote">{morningNote}</p>
        </Disclosure>
      </div>
    </section>
  )
}

// A native <details> whose body is only built once it is opened, so closed
// sections cost no queries and no layout.
function Disclosure({title,hint,children,defaultOpen=false,onToggleOpen}:{title:string;hint?:string;children:ReactNode;defaultOpen?:boolean;onToggleOpen?:(open:boolean)=>void}){
  const [open,setOpen]=useState(defaultOpen)
  return (
    <details className="todayDisclosure" open={defaultOpen} onToggle={event=>{
      const next=(event.currentTarget as HTMLDetailsElement).open
      setOpen(next)
      onToggleOpen?.(next)
    }}>
      <summary><span>{title}</span>{hint&&<small>{hint}</small>}</summary>
      {open&&<div className="todayDisclosureBody">{children}</div>}
    </details>
  )
}
