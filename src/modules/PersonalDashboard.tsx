import { useCallback, useEffect, useMemo, useState } from 'react'
import { Award, BadgeCheck, CalendarCheck2, CalendarRange, CheckCircle2, ClipboardList, Clock3, FolderKanban, Gauge, Laptop, Smartphone, Sparkles, Target, Trophy } from 'lucide-react'
import { supabase } from '../lib/supabase'
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
  return value===null ? '—' : `${Math.round(value)}%`
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

  return (
    <section className="personalDashboard">
      <div className="personalHero glassHero">
        <div className="personalHeroCopy">
          <span className="eyebrow">YOUR RIDEARRIVO DASHBOARD</span>
          <h2>{greeting()}, {name}.</h2>
          <p>{profile.job_title || profile.department || 'RideArrivo team member'} · Your priorities, KPI, recognition and primary workstation in one place.</p>
          <div className="personalHeroActions">
            {primaryTarget&&<button className="primaryButton" onClick={()=>onNavigate(primaryTarget)}>Open {primaryLabel}</button>}
            <button type="button" className="glassButton personalHeroSecondaryAction" onClick={()=>onNavigate('tasks')}><ClipboardList size={16}/>My Tasks</button>
            <button type="button" className="glassButton personalHeroSecondaryAction" onClick={()=>onNavigate('projects')}><FolderKanban size={16}/>Projects</button>
          </div>
        </div>

        <div className="dailyNoteCard">
          <div className="dailyNoteIcon"><Sparkles size={19}/></div>
          <span>DAILY NOTE</span>
          <strong>{name}, make today count.</strong>
          <p>{morningNote}</p>
        </div>
      </div>

      {recognition&&(
        <div className="recognitionBanner">
          <div className="recognitionBadge"><Trophy size={22}/></div>
          <div>
            <span className="eyebrow">CURRENT RECOGNITION</span>
            <strong>{recognition.badge_label} · {monthLabel(recognition.performance_month)}</strong>
            <p>Congratulations, {name}. Your recorded delivery KPI of {Math.round(Number(recognition.score))}% earned the current company recognition badge. It remains active until the next monthly winner is generated.</p>
          </div>
          <Award size={28}/>
        </div>
      )}

      <div className={`performanceBanner ${snapshot?.status || 'insufficient_data'}`}>
        <BadgeCheck size={19}/><div><strong>Performance update</strong><span>{loading?'Calculating your latest KPI...':performanceMessage}</span></div>
      </div>

      {message&&<div className="moduleNotice">KPI data: {message}</div>}

      <div className="personalKpiGrid">
        <article className="glassCard personalKpiCard emphasis"><Gauge/><span>30-day delivery KPI</span><strong>{snapshot?.score===null || !snapshot ? '—' : `${Math.round(snapshot.score)}%`}</strong><small>{snapshot?.status==='insufficient_data'?'Waiting for enough assigned work':String(snapshot?.status || 'Loading').replace('_',' ')}</small></article>
        <article className="glassCard personalKpiCard annual"><CalendarRange/><span>{new Date().getFullYear()} overall KPI</span><strong>{annual?.score===null || !annual ? '—' : `${Math.round(annual.score)}%`}</strong><small>{annual ? `Year-to-date · ${String(annual.status).replace('_',' ')}` : 'Waiting for annual KPI snapshot'}</small></article>
        <article className="glassCard personalKpiCard"><CheckCircle2/><span>Completion rate</span><strong>{pct(snapshot?.completion_rate ?? null)}</strong><small>{snapshot ? `${snapshot.total_completed} of ${snapshot.total_assigned} assigned items completed` : 'Loading'}</small></article>
        <article className="glassCard personalKpiCard"><CalendarCheck2/><span>On-time completion</span><strong>{pct(snapshot?.on_time_rate ?? null)}</strong><small>{snapshot ? `${snapshot.completed_on_time} of ${snapshot.completed_with_due_date} completed items with deadlines` : 'Loading'}</small></article>
        <article className="glassCard personalKpiCard"><Clock3/><span>Open overdue</span><strong>{snapshot?.overdue_open ?? '—'}</strong><small>Assigned items currently past their due date</small></article>
      </div>

      <div className="myEquipment glassCard">
        <div className="myEquipmentHeader"><div><span className="eyebrow">MY COMPANY EQUIPMENT</span><strong>Assigned devices</strong><p>Your registered RideArrivo laptops, phones and gadgets. Hardware serial/IMEI values come from the controlled asset registry; a normal browser cannot discover them automatically.</p></div></div>
        <div className="myEquipmentGrid">
          {devices.map(device=><article key={device.id} className="myEquipmentItem">
            <div className="myEquipmentIcon">{device.device_type==='phone'?<Smartphone size={18}/>:<Laptop size={18}/>}</div>
            <div><span>{device.asset_tag}</span><strong>{[device.manufacturer,device.model].filter(Boolean).join(' ') || device.device_type}</strong><small>{[device.color,device.memory_label,device.storage_label,device.operating_system].filter(Boolean).join(' · ') || 'Registered company device'}</small><small>{device.serial_number?`Serial: ${device.serial_number}`:'Serial not recorded'}{device.imei?` · IMEI: ${device.imei}`:''}</small>{device.location_label&&<small>Issued location: {device.location_label}</small>}</div>
          </article>)}
          {!devices.length&&<div className="myEquipmentEmpty">No company equipment is assigned to your account yet.</div>}
        </div>
      </div>

      <div className="dashboardContextGrid">
        <article className="glassCard dashboardContextCard"><Target size={20}/><div><strong>How your KPI is measured</strong><p>Transparent delivery evidence: 60% completion, 30% on-time completion when deadlines exist, and 10% acknowledgement. The annual evaluation uses the same method across the current year. If there is no assigned work, RideArrivo shows insufficient data instead of a zero.</p></div></article>
        <article className="glassCard dashboardContextCard"><ClipboardList size={20}/><div><strong>{primaryLabel || 'Workstation not assigned yet'}</strong><p>{primaryLabel ? 'This is your primary secured workstation. Administration can reassign it when your responsibilities change.' : 'Administration can assign your primary workstation without changing your name, title or employee identity.'}</p></div></article>
      </div>
    </section>
  )
}
