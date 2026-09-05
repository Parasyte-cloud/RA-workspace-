import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AppWindow,
  Award,
  BarChart3,
  BriefcaseBusiness,
  CreditCard,
  DatabaseBackup,
  FileText,
  Gauge,
  KeyRound,
  Laptop,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { invokeWorkspaceAdmin } from '../lib/workspaceAdmin'
import AdminAccessManager from './AdminAccessManager'
import AdminDownloadAccessManager from './AdminDownloadAccessManager'
import WorkstationAssignmentManager from './WorkstationAssignmentManager'
import KpiManagementPanel from './KpiManagementPanel'
import DeviceAssetCenter from './DeviceAssetCenter'
import FinancePaymentsPanel from './FinancePaymentsPanel'
import ProvidusBankingPanel from './ProvidusBankingPanel'
import DepartmentFinanceRequestPanel from './DepartmentFinanceRequestPanel'
import { DataWorkbench } from './DataWorkbench'
import OperationsControlPanel from './OperationsControlPanel'
import AdminBackupsPanel from './AdminBackupsPanel'
import Room7MinutesPanel from './Room7MinutesPanel'
import '../admin-control-plane.css'

import AttendanceAdminPanel from './AttendanceAdminPanel'
type AdminTab=
  | 'overview'
  | 'people'
  
  | 'attendance'| 'access'
  | 'workstations'
  | 'performance'
  | 'assets'
  | 'downloads'
  | 'applications'
  | 'backups'
  | 'room-minutes'
  | 'audit'  | 'payments'

  | 'operations'

type AuthUser={
  id:string
  email:string
  full_name:string
  role:string
  department:string
  job_title:string
  manager_id:string|null
  active:boolean
  created_at:string
  last_sign_in_at:string|null
  email_confirmed:boolean
}

type PresenceSummary={
  employee_id:string
  full_name:string
  email:string
  department:string
  job_title:string
  role:string
  active:boolean
  manager_id:string|null
  workstation:string|null
  rolling_score:number|null
  rolling_status:string|null
  annual_score:number|null
  annual_status:string|null
  current_badge:string|null
  device_count:number
  browser_device_count:number
  last_seen_at:string|null
  browser_name:string|null
  operating_system:string|null
  timezone:string|null
  source_ip:string|null
  address_full:string|null
  city:string|null
  state:string|null
  country:string|null
  location_accuracy_m:number|null
  location_consent:boolean
  location_sharing_active:boolean
  geocoding_provider:string|null
  geocoding_attribution:string|null
}

type PresenceHistory={
  id:string
  session_key:string
  browser_device_id:string
  browser_name:string|null
  operating_system:string|null
  platform:string|null
  source_ip:string|null
  timezone:string|null
  latitude:number|null
  longitude:number|null
  location_accuracy_m:number|null
  location_consent:boolean
  location_sharing_active:boolean
  address_full:string|null
  city:string|null
  state:string|null
  postcode:string|null
  country:string|null
  country_code:string|null
  first_seen_at:string
  last_seen_at:string
  location_captured_at:string|null
  geocoding_provider:string|null
  geocoding_attribution:string|null
}

type CompanyDevice={
  id:string
  asset_tag:string
  device_type:string
  manufacturer:string|null
  model:string|null
  serial_number:string|null
  imei:string|null
  operating_system:string|null
  status:string
}

type AuditRow={
  id:string
  actor_id:string|null
  target_employee_id:string|null
  action:string
  entity_type:string
  entity_id:string|null
  source:string
  metadata:Record<string,unknown>|null
  created_at:string
}

const tabs:Array<[AdminTab,string,typeof Users]>=[
  ['overview','Command',Gauge],
  ['people','People',Users],
  ['attendance','Time & Attendance',Activity],
  ['access','Access',KeyRound],
  ['workstations','Workstations',Workflow],
  ['performance','Performance',BarChart3],
  ['assets','Assets & Support',Laptop],
  ['downloads','Downloads',ShieldCheck],
  ['applications','Applications',AppWindow],
  ['payments','Payments',CreditCard],
  ['backups','Backups',DatabaseBackup],
  ['room-minutes','ROOM 7 Minutes',FileText],
  ['audit','Audit',Activity],
  ['operations','Operations',BriefcaseBusiness],
]

function when(value:string|null|undefined){
  if(!value) return 'Never'
  const date=new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function score(value:number|null|undefined){
  return value===null || value===undefined ? '—' : `${Number(value).toFixed(1)}%`
}

function online(lastSeen:string|null|undefined){
  if(!lastSeen) return false
  return Date.now()-new Date(lastSeen).getTime()<10*60*1000
}

function AdminPeopleIntelligence({onOpenTab}:{onOpenTab:(tab:AdminTab)=>void}){
  const [authUsers,setAuthUsers]=useState<AuthUser[]>([])
  const [rows,setRows]=useState<PresenceSummary[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [history,setHistory]=useState<PresenceHistory[]>([])
  const [devices,setDevices]=useState<CompanyDevice[]>([])
  const [search,setSearch]=useState('')
  const [loading,setLoading]=useState(true)
  const [detailLoading,setDetailLoading]=useState(false)
  const [message,setMessage]=useState('')
  const detailRequestRef=useRef(0)

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){setLoading(false);return}
    setLoading(true)
    setMessage('')
    try{
      const [authResult,presenceResult]=await Promise.all([
        invokeWorkspaceAdmin({action:'list'}),
        client.rpc('admin_employee_presence_summary'),
      ])
      const nextAuth=Array.isArray(authResult?.users)?authResult.users as AuthUser[]:[]
      if(presenceResult.error) throw presenceResult.error
      const nextRows=(presenceResult.data || []) as PresenceSummary[]
      setAuthUsers(nextAuth)
      setRows(nextRows)
      setSelectedId(current=>current || nextRows[0]?.employee_id || '')
    }catch(error:any){
      setMessage(error?.message || 'Unable to load Administration people intelligence.')
    }finally{
      setLoading(false)
    }
  },[])

  useEffect(()=>{void load()},[load])

  const loadDetail=useCallback(async(employeeId:string)=>{
    const client=supabase
    const requestId=++detailRequestRef.current
    if(!client || !employeeId){setHistory([]);setDevices([]);return}
    setDetailLoading(true)
    setMessage('')
    try{
      const [historyResult,deviceResult]=await Promise.all([
        client.rpc('admin_employee_presence_history',{p_employee_id:employeeId,p_limit:25}),
        client.from('company_devices')
          .select('id,asset_tag,device_type,manufacturer,model,serial_number,imei,operating_system,status')
          .eq('assigned_employee_id',employeeId)
          .order('asset_tag'),
      ])
      if(historyResult.error) throw historyResult.error
      if(deviceResult.error) throw deviceResult.error
      if(requestId!==detailRequestRef.current) return
      setHistory((historyResult.data || []) as PresenceHistory[])
      setDevices((deviceResult.data || []) as CompanyDevice[])
      void client.rpc('record_admin_audit',{
        p_action:'employee.security_profile_viewed',
        p_entity_type:'employee_profiles',
        p_entity_id:employeeId,
        p_target_employee_id:employeeId,
        p_metadata:{view:'people_intelligence'},
        p_source:'administration-control-plane',
      }).then(({error})=>{if(error) console.warn('[Admin audit] unable to record sensitive profile view',error.message)})
    }catch(error:any){
      if(requestId===detailRequestRef.current){
        setMessage(error?.message || 'Unable to load employee detail.')
      }
    }finally{
      if(requestId===detailRequestRef.current) setDetailLoading(false)
    }
  },[])

  useEffect(()=>{void loadDetail(selectedId)},[selectedId,loadDetail])

  const authById=useMemo(()=>new Map(authUsers.map(user=>[user.id,user])),[authUsers])
  const peopleById=useMemo(()=>new Map(rows.map(row=>[row.employee_id,row])),[rows])
  const selected=peopleById.get(selectedId) || null
  const selectedAuth=selected ? authById.get(selected.employee_id) : undefined

  const visible=useMemo(()=>{
    const q=search.trim().toLowerCase()
    if(!q) return rows
    return rows.filter(row=>[
      row.full_name,row.email,row.department,row.job_title,row.role,row.workstation,row.address_full,row.city,row.state,row.country
    ].some(value=>String(value || '').toLowerCase().includes(q)))
  },[rows,search])

  const activeCount=rows.filter(row=>row.active).length
  const onlineCount=rows.filter(row=>row.active && online(row.last_seen_at)).length
  const locatedCount=rows.filter(row=>row.address_full).length
  const unmanagedCount=rows.filter(row=>row.active && !row.workstation).length

  return <div className="adminPeopleIntelligence">
    <div className="adminCommandMetrics">
      <div className="glassCard adminMetric"><Users size={18}/><span>Active employees</span><strong>{activeCount}</strong></div>
      <div className="glassCard adminMetric"><Activity size={18}/><span>Online now</span><strong>{onlineCount}</strong></div>
      <div className="glassCard adminMetric"><MapPin size={18}/><span>Browser address available</span><strong>{locatedCount}</strong></div>
      <div className="glassCard adminMetric"><Workflow size={18}/><span>Without workstation</span><strong>{unmanagedCount}</strong></div>
    </div>

    <div className="adminPeopleToolbar glassCard">
      <div><span className="eyebrow">PEOPLE INTELLIGENCE</span><h3>Employee command view</h3><p>Identity, access state, workstation, performance, equipment and transparent sign-in security telemetry in one place.</p></div>
      <div className="buttonRow"><input className="adminSearch" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search employee, role, address..."/><button className="glassButton" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>Refresh</button></div>
    </div>

    {message&&<div className="moduleNotice">{message}</div>}

    <div className="adminPeopleSplit">
      <div className="glassCard adminPeopleTableWrap">
        <table className="adminPeopleTable">
          <thead><tr><th>Employee</th><th>Access</th><th>Workstation</th><th>KPI</th><th>Presence</th><th>Browser sign-in address</th></tr></thead>
          <tbody>
            {visible.map(row=>{
              const auth=authById.get(row.employee_id)
              return <tr key={row.employee_id} className={selectedId===row.employee_id?'selected':''} onClick={()=>setSelectedId(row.employee_id)}>
                <td><strong>{row.full_name || row.email}</strong><small>{row.job_title || row.department || row.role}</small></td>
                <td><span className={`adminState ${row.active?'ok':'off'}`}>{row.active?'Active':'Revoked'}</span><small>{auth?.email_confirmed?'Email verified':'Email unverified'}</small></td>
                <td>{row.workstation || 'Unassigned'}</td>
                <td><strong>{score(row.rolling_score)}</strong><small>{row.current_badge || row.rolling_status || 'No KPI data'}</small></td>
                <td><span className={`adminState ${online(row.last_seen_at)?'ok':'idle'}`}>{online(row.last_seen_at)?'Online':'Offline'}</span><small>{when(row.last_seen_at)}</small></td>
                <td className="adminAddressCell">{row.address_full || (row.location_consent?'Address service not configured':'Not shared')}<small>{row.source_ip?`Network: ${row.source_ip}`:''}</small></td>
              </tr>
            })}
          </tbody>
        </table>
        {!loading&&!visible.length&&<div className="adminEmpty">No employees match this view.</div>}
      </div>

      <aside className="glassCard adminEmployeeDetail">
        {!selected ? <div className="adminEmpty">Select an employee to inspect their control profile.</div> : <>
          <div className="adminDetailHeader">
            <div><span className="eyebrow">CONTROL PROFILE</span><h3>{selected.full_name || selected.email}</h3><p>{selected.email}</p></div>
            {selected.current_badge&&<span className="adminReward"><Award size={14}/>{selected.current_badge}</span>}
          </div>

          <div className="adminDetailGrid">
            <div><span>Role</span><strong>{selected.role}</strong></div>
            <div><span>Department</span><strong>{selected.department || 'Unassigned'}</strong></div>
            <div><span>Reports to</span><strong>{selected.manager_id ? (authById.get(selected.manager_id)?.full_name || authById.get(selected.manager_id)?.email || 'Assigned manager') : 'No manager assigned'}</strong></div>
            <div><span>Workstation</span><strong>{selected.workstation || 'Unassigned'}</strong></div>
            <div><span>Last auth sign-in</span><strong>{when(selectedAuth?.last_sign_in_at)}</strong></div>
            <div><span>30-day KPI</span><strong>{score(selected.rolling_score)}</strong></div>
            <div><span>Annual KPI</span><strong>{score(selected.annual_score)}</strong></div>
          </div>

          <div className="adminLocationCard">
            <div className="adminLocationTitle"><MapPin size={16}/><strong>Last browser-reported sign-in location</strong></div>
            <p>{selected.address_full || 'No precise browser-reported address has been recorded for this employee.'}</p>
            <div className="adminLocationMeta">
              <span>{selected.location_sharing_active?'Precise sharing enabled':selected.location_consent?'Precise location shared for this sign-in':'Precise location not shared'}</span>
              {selected.location_accuracy_m!==null&&<span>Accuracy ±{selected.location_accuracy_m} m</span>}
              {selected.source_ip&&<span>Network address {selected.source_ip}</span>}
              {selected.timezone&&<span>{selected.timezone}</span>}
            </div>
            {selected.geocoding_provider==='geoapify'&&<a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Address data powered by Geoapify / OpenStreetMap</a>}
          </div>

          <div className="adminDetailActions">
            <button className="glassButton" onClick={()=>onOpenTab('access')}>Manage access</button>
            <button className="glassButton" onClick={()=>onOpenTab('workstations')}>Assign workstation</button>
            <button className="glassButton" onClick={()=>onOpenTab('performance')}>Performance</button>
            <button className="glassButton" onClick={()=>onOpenTab('assets')}>Assets</button>
          </div>

          <div className="adminDetailSection">
            <strong>Assigned company equipment</strong>
            {detailLoading ? <small>Loading equipment...</small> : devices.length ? devices.map(device=><div className="adminDeviceMini" key={device.id}><Laptop size={14}/><span><b>{device.asset_tag}</b> · {[device.manufacturer,device.model].filter(Boolean).join(' ') || device.device_type}<small>{device.serial_number?`Serial ${device.serial_number}`:'Serial not recorded'}{device.imei?` · IMEI ${device.imei}`:''}</small></span></div>) : <small>No assigned company equipment.</small>}
          </div>

          <div className="adminDetailSection">
            <strong>Recent sign-in sessions</strong>
            {detailLoading ? <small>Loading sign-in history...</small> : history.length ? history.map(item=><div className="adminHistoryRow" key={item.id}><div><b>{item.address_full || item.city || item.timezone || 'Location not shared'}</b><small>{item.browser_name || 'Browser'} · {item.operating_system || item.platform || 'Device'} · {when(item.first_seen_at)}</small></div><span>{item.source_ip || 'network n/a'}</span></div>) : <small>No sign-in telemetry has been recorded yet.</small>}
          </div>
        </>}
      </aside>
    </div>
  </div>
}

function AdminAuditPanel(){
  const [rows,setRows]=useState<AuditRow[]>([])
  const [names,setNames]=useState<Map<string,string>>(new Map())
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){setLoading(false);return}
    setLoading(true);setMessage('')
    try{
      const {data,error}=await client.from('admin_audit_log').select('id,actor_id,target_employee_id,action,entity_type,entity_id,source,metadata,created_at').order('created_at',{ascending:false}).limit(250)
      if(error) throw error
      const next=(data || []) as AuditRow[]
      setRows(next)
      const ids=[...new Set(next.flatMap(row=>[row.actor_id,row.target_employee_id]).filter(Boolean))] as string[]
      if(ids.length){
        const people=await client.from('employee_profiles').select('id,full_name,email').in('id',ids)
        if(!people.error){
          setNames(new Map((people.data || []).map((person:any)=>[person.id,person.full_name || person.email || person.id])))
        }
      }
    }catch(error:any){setMessage(error?.message || 'Unable to load administrator audit history.')}
    finally{setLoading(false)}
  },[])

  useEffect(()=>{void load()},[load])

  return <section className="glassCard adminAuditPanel">
    <div className="adminAuditHeader"><div><span className="eyebrow">SECURITY & ACCOUNTABILITY</span><h3>Administrator audit trail</h3><p>Privileged identity, workstation, equipment and controlled-download changes are recorded here. Audit history is read-only in the workspace.</p></div><button className="glassButton" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>Refresh</button></div>
    {message&&<div className="moduleNotice">{message}</div>}
    <div className="adminAuditList">
      {rows.map(row=><article key={row.id} className="adminAuditRow"><div><strong>{row.action}</strong><span>{row.entity_type}{row.entity_id?` · ${row.entity_id}`:''}</span><small>{when(row.created_at)} · Actor: {row.actor_id?names.get(row.actor_id)||row.actor_id:'server'}{row.target_employee_id?` · Target: ${names.get(row.target_employee_id)||row.target_employee_id}`:''}</small></div><code>{JSON.stringify(row.metadata || {})}</code></article>)}
      {!loading&&!rows.length&&<div className="adminEmpty">No privileged audit entries yet.</div>}
    </div>
  </section>
}

function AdminOverview({onOpenTab}:{onOpenTab:(tab:AdminTab)=>void}){
  const [rows,setRows]=useState<PresenceSummary[]>([])
  const [pendingDownloads,setPendingDownloads]=useState(0)
  const [loading,setLoading]=useState(true)

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){setLoading(false);return}
    const [people,downloads]=await Promise.all([
      client.rpc('admin_employee_presence_summary'),
      client.from('workspace_download_requests').select('id',{count:'exact',head:true}).eq('status','pending'),
    ])
    if(!people.error) setRows((people.data || []) as PresenceSummary[])
    if(!downloads.error) setPendingDownloads(downloads.count || 0)
    setLoading(false)
  },[])

  useEffect(()=>{void load()},[load])

  const active=rows.filter(row=>row.active).length
  const onlineNow=rows.filter(row=>row.active && online(row.last_seen_at)).length
  const noStation=rows.filter(row=>row.active && !row.workstation).length
  const locationShared=rows.filter(row=>row.location_sharing_active).length

  return <div className="adminOverview">
    <div className="adminControlHero glassCard">
      <div><span className="eyebrow">ADMINISTRATION COMMAND</span><h2>Company control plane</h2><p>One audited control surface for people access, workstation ownership, performance, assets, sign-in security, downloads, applications and operations.</p></div>
      <button className="glassButton" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>Refresh command view</button>
    </div>

    <div className="adminCommandMetrics">
      <button className="glassCard adminMetric" onClick={()=>onOpenTab('people')}><Users size={18}/><span>Active employees</span><strong>{active}</strong></button>
      <button className="glassCard adminMetric" onClick={()=>onOpenTab('people')}><Activity size={18}/><span>Online now</span><strong>{onlineNow}</strong></button>
      <button className="glassCard adminMetric" onClick={()=>onOpenTab('workstations')}><Workflow size={18}/><span>Unassigned workstations</span><strong>{noStation}</strong></button>
      <button className="glassCard adminMetric" onClick={()=>onOpenTab('downloads')}><ShieldCheck size={18}/><span>Pending downloads</span><strong>{pendingDownloads}</strong></button>
      <button className="glassCard adminMetric" onClick={()=>onOpenTab('people')}><MapPin size={18}/><span>Location sharing</span><strong>{locationShared}/{active || 0}</strong></button>
    </div>

    <div className="adminControlGrid">
      <button className="glassCard adminControlCard" onClick={()=>onOpenTab('people')}><Users/><strong>People intelligence</strong><span>Employee identity, sign-in address, presence, devices, KPI and recognition.</span></button>
      <button className="glassCard adminControlCard" onClick={()=>onOpenTab('access')}><KeyRound/><strong>Identity & access</strong><span>Approve, edit, revoke, assign department, role, job title and reporting manager.</span></button>
      <button className="glassCard adminControlCard" onClick={()=>onOpenTab('workstations')}><Workflow/><strong>Workstation control</strong><span>Assign and reassign each employee's primary operational workstation.</span></button>
      <button className="glassCard adminControlCard" onClick={()=>onOpenTab('performance')}><BarChart3/><strong>KPI governance</strong><span>Rolling and annual performance evidence plus current recognition.</span></button>
      <button className="glassCard adminControlCard" onClick={()=>onOpenTab('assets')}><Laptop/><strong>IT assets & support</strong><span>Company equipment, serials, IMEI, browser devices and approved support commands.</span></button>
      <button className="glassCard adminControlCard" onClick={()=>onOpenTab('audit')}><Activity/><strong>Audit & security</strong><span>Immutable workspace history for privileged administrative changes.</span></button>
      <button className="glassCard adminControlCard" onClick={()=>onOpenTab('room-minutes')}><FileText/><strong>ROOM 7 minutes</strong><span>R7 AI meeting summaries, decisions, attendance and action items delivered automatically.</span></button>
    </div>
  </div>
}

function ApplicationsPanel(){
  return <div className="adminApplicationsPanel">
    <DataWorkbench
      table="workspace_apps"
      title="Application registry"
      description="Native, API and embedded workspace applications. Keep secrets out of browser configuration."
      createLabel="Register app"
      fields={[
        {key:'name',label:'Name',required:true},
        {key:'slug',label:'Slug',required:true},
        {key:'url',label:'URL'},
        {key:'mode',label:'Mode',type:'select',options:['native','embed','api','download'],required:true},
      ]}
      columns={[
        {key:'name',label:'Application'},
        {key:'slug',label:'Slug'},
        {key:'mode',label:'Mode'},
        {key:'url',label:'URL'},
      ]}
    />
    <div className="glassCard adminSecurityPosture"><ShieldCheck/><div><strong>Security posture</strong><p>Role and workstation access remain enforced by Supabase RLS and server-side authorization. Service-role keys, payment secrets, GitHub App keys and geocoding keys never belong in Vite or browser storage.</p></div></div>
  </div>
}

function OperationsPanel(){
  return <div className="adminNativeOperations">
    <div className="glassCard adminOperationsNativeHeader">
      <BriefcaseBusiness size={25}/>
      <div>
        <span className="eyebrow">RIDEARRIVO OPERATIONS</span>
        <h3>Operations Control Centre</h3>
        <p>
          Manage operational readiness, receipts, incidents, driver shifts,
          fleet maintenance, inspections and airport flight monitoring directly
          inside the Administration workspace.
        </p>
      </div>
      <span className="adminNativeBadge">
        Native workspace
      </span>
    </div>

    <OperationsControlPanel/>
  </div>
}

export default function AdministrationControlPlane(){
  const [tab,setTab]=useState<AdminTab>('overview')

  return <section className="administrationControlPlane">
    <div className="adminControlTitle"><div><span className="eyebrow">ADMINISTRATION</span><h2>Administration Workstation</h2><p>Authoritative, audited control of RideArrivo identity, people, security, workstations, performance, equipment and access.</p></div><span className="adminAuthorityBadge"><ShieldCheck size={14}/>Admin-only</span></div>

    <nav className="adminControlTabs" aria-label="Administration sections">
      {tabs.map(([id,label,Icon])=><button key={id} type="button" className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon size={15}/><span>{label}</span></button>)}
    </nav>

    <div className="adminControlBody">
      {tab==='overview'&&<AdminOverview onOpenTab={setTab}/>}
      {tab==='people'&&<AdminPeopleIntelligence onOpenTab={setTab}/>}
      {tab==='attendance'&&<AttendanceAdminPanel/>}
      {tab==='access'&&<AdminAccessManager/>}
      {tab==='workstations'&&<WorkstationAssignmentManager/>}
      {tab==='performance'&&<KpiManagementPanel/>}
      {tab==='assets'&&<DeviceAssetCenter/>}
      {tab==='downloads'&&<AdminDownloadAccessManager/>}
      {tab==='applications'&&<ApplicationsPanel/>}
      {tab==='payments'&&
        <div className="adminPaymentsStack">
          <ProvidusBankingPanel context="admin"/>
          <FinancePaymentsPanel context="admin"/>
          <DepartmentFinanceRequestPanel context="executive"/>
        </div>
      }
      {tab==='backups'&&<AdminBackupsPanel/>}
      {tab==='room-minutes'&&<Room7MinutesPanel/>}
      {tab==='audit'&&<AdminAuditPanel/>}
      {tab==='operations'&&<OperationsPanel/>}
    </div>
  </section>
}
