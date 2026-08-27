import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity, AppWindow, BadgeCheck, BarChart3, Bell, BookOpen, BriefcaseBusiness, Building2,
  CalendarDays, ChevronRight, CircleDollarSign, ClipboardCheck, Code2, ContactRound, Copy,
  Download, ExternalLink, FileCheck2, FileText, Gauge, Headphones, Home, KeyRound,
  LayoutDashboard, LifeBuoy, ListChecks, LockKeyhole, Mail, MonitorCog, Network, PackageCheck,
  Route, Scale, Search, Settings, ShieldAlert, ShieldCheck, Smartphone, Sparkles, TicketCheck,
  UserCog, UserPlus, Users, Wrench
} from 'lucide-react'
import { supabase, supabaseConfigured } from './lib/supabase'
import { FinanceModule, MarketingModule, PartnershipsModule } from './modules/BusinessModules'
import { AdminModule, CRMModule, LegalModule, OperationsModule, PeopleModule, SupportModule } from './modules/CoreModules'
import { SocialModule } from './modules/SocialModule'
import { MailModule } from './modules/MailModule'
import { ProfileModule } from './modules/ProfileModule'
import ApplicationsHub from './modules/ApplicationsHub'
import {
  AnnouncementsModule,
  CalendarModule,
  TasksModule,
  KnowledgeBaseModule,
  CompanyFilesModule,
} from './modules/Phase2Modules'

type Section = 'profile'|'overview'|'social'|'mail'|'announcements'|'calendar'|'tasks'|'files'|'knowledge'|'crm'|'support'|'engineering'|'people'|'operations'|'finance'|'marketing'|'partnerships'|'legal'|'admin'|'apps'|'workspace'
type Role = 'employee'|'support'|'engineer'|'manager'|'hr'|'legal'|'operations'|'finance'|'marketing'|'partnerships'|'admin'
type Workspace = { title:string; url:string; note?:string }
type Profile = {
  id:string
  full_name:string
  email:string
  role:Role
  department:string
  job_title:string
  phone?:string|null
  whatsapp?:string|null
  avatar_path?:string|null
  avatar_url?:string|null
  office_address?:string|null
  website?:string|null
  linkedin_url?:string|null
  x_url?:string|null
  instagram_url?:string|null
  bio?:string|null
  working_hours?:string|null
  virtual_card_enabled?:boolean|null
  public_card_enabled?:boolean|null
}

const allowedDomains = (import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS || 'ridearrivo.com')
  .toLowerCase().split(',').map((v:string)=>v.trim()).filter(Boolean)

const sectionAccess:Partial<Record<Section,Role[]>>={
  profile:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  overview:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  social:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  mail:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  crm:['support','operations','marketing','partnerships','manager','admin'],
  support:['support','operations','manager','admin'],
  engineering:['engineer','manager','admin'],
  people:['hr','manager','admin'],
  operations:['operations','support','manager','admin'],
  finance:['finance','manager','admin'],
  marketing:['marketing','partnerships','manager','admin'],
  partnerships:['partnerships','marketing','operations','finance','legal','manager','admin'],
  legal:['legal','manager','admin'],
  announcements:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  calendar:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  tasks:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  files:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  knowledge:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  apps:['employee','support','engineer','hr','operations','finance','marketing','partnerships','legal','manager','admin'],
  admin:['admin']
}
const canAccess=(role:Role,section:Section)=>!sectionAccess[section]||sectionAccess[section]!.includes(role)

const crmRows = [
  {name:'Amina Bello', type:'Traveller', status:'Active', value:'₦185,000', last:'Airport pickup · 2 days ago'},
  {name:'Vista Hotels Lagos', type:'Corporate', status:'Opportunity', value:'₦2.4m', last:'Proposal sent · Today'},
  {name:'Daniel Okafor', type:'Rider', status:'Follow-up', value:'₦96,000', last:'Support recovery · Yesterday'},
  {name:'Northpoint Travel', type:'Partner', status:'Negotiation', value:'₦3.1m', last:'Corporate rate review · Today'},
]

const supportQueue = [
  {id:'RA-20491', rider:'M. Chen', route:'LOS → Ikoyi', state:'Awaiting driver', priority:'High'},
  {id:'RA-20488', rider:'T. Adeyemi', route:'VI → LOS', state:'Driver assigned', priority:'Normal'},
  {id:'RA-20485', rider:'A. Johnson', route:'LOS → Lekki', state:'Flight delayed', priority:'Normal'},
]

const engineers = [
  {name:'VS Code', purpose:'Primary source-code editor', mac:'brew install --cask visual-studio-code', windows:'winget install Microsoft.VisualStudioCode'},
  {name:'Git + GitHub CLI', purpose:'Version control, PR and issue workflows', mac:'brew install git gh', windows:'winget install Git.Git; winget install GitHub.cli'},
  {name:'Node.js LTS', purpose:'Web, backend and build tooling', mac:'brew install node', windows:'winget install OpenJS.NodeJS.LTS'},
  {name:'Docker Desktop', purpose:'Containers and local services', mac:'brew install --cask docker', windows:'winget install Docker.DockerDesktop'},
  {name:'Postman', purpose:'API testing and collections', mac:'brew install --cask postman', windows:'winget install Postman.Postman'},
  {name:'Android Studio', purpose:'Android SDK, emulator and native debugging', mac:'brew install --cask android-studio', windows:'winget install Google.AndroidStudio'},
  {name:'Expo / EAS', purpose:'Mobile builds, signing and releases', mac:'npm install -g eas-cli', windows:'npm install -g eas-cli'},
]


function BrandLogo({className=''}:{className?:string}){
  return (
    <img
      src="/ridearrivo-wordmark-transparent.png"
      alt="RideArrivo"
      className={`brandLogo ${className}`}
    />
  )
}

function App(){
  const [session,setSession]=useState<Session|null>(null)
  const [profile,setProfile]=useState<Profile>({
    id:'',
    full_name:'',
    email:'',
    role:'employee',
    department:'',
    job_title:''
  })
  const [authReady,setAuthReady]=useState(false)
  const [section,setSection]=useState<Section>('overview')
  const [workspace,setWorkspace]=useState<Workspace|null>(null)
  const [deferredPrompt,setDeferredPrompt]=useState<any>(null)
  const [online,setOnline]=useState(navigator.onLine)

  useEffect(()=>{
    const before=(e:any)=>{e.preventDefault();setDeferredPrompt(e)}
    const connectivity=()=>setOnline(navigator.onLine)
    window.addEventListener('beforeinstallprompt',before)
    window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity)
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{})
    if(!supabase){
      setAuthReady(true)
      return()=>{
        window.removeEventListener('beforeinstallprompt',before)
        window.removeEventListener('online',connectivity)
        window.removeEventListener('offline',connectivity)
      }
    }

    supabase.auth.getSession().then(({data})=>{
      setSession(data.session)
      setAuthReady(true)
    })

    const {data} = supabase.auth.onAuthStateChange((_event,next)=>{
      setSession(next)
      setAuthReady(true)
    })

    return()=>{
      data.subscription.unsubscribe()
      window.removeEventListener('beforeinstallprompt',before)
      window.removeEventListener('online',connectivity)
      window.removeEventListener('offline',connectivity)
    }
  },[])

  const loadProfile=async()=>{
    if(!supabase || !session?.user) return

    const {data,error}=await supabase
      .from('employee_profiles')
      .select(`
        id,
        full_name,
        email,
        role,
        department,
        job_title,
        phone,
        whatsapp,
        avatar_path,
        office_address,
        website,
        linkedin_url,
        x_url,
        instagram_url,
        bio,
        working_hours,
        virtual_card_enabled,
        public_card_enabled
      `)
      .eq('id',session.user.id)
      .maybeSingle()

    if(error){
      console.error('Unable to load employee profile',error)
      return
    }

    if(!data){
      setProfile({
        id:session.user.id,
        full_name:
          session.user.user_metadata?.full_name ||
          session.user.email?.split('@')[0] ||
          'Employee',
        email:session.user.email || '',
        role:'employee',
        department:'Unassigned',
        job_title:''
      })
      return
    }

    let avatar_url:string|null=null

    if(data.avatar_path){
      const {data:signed}=await supabase.storage
        .from('employee-headshots')
        .createSignedUrl(data.avatar_path,3600)

      avatar_url=signed?.signedUrl || null
    }

    setProfile({
      ...(data as Profile),
      avatar_url
    })
  }

  useEffect(()=>{
    void loadProfile()
  },[session])

  const nav = useMemo(()=>{
    const items = [
      ['overview','Overview',Home],['profile','My Profile',UserCog],['social','Pulse',Bell],['mail','Mail',Mail],['calendar','Calendar',CalendarDays],['tasks','Tasks',ListChecks],['announcements','Announcements',Bell],['files','Company Files',FileText],['knowledge','Knowledge Base',BookOpen],['crm','CRM',ContactRound],['support','Support',Headphones],['engineering','Engineering',Code2],['people','People & HR',Users],['operations','Operations',BriefcaseBusiness],['finance','Finance',CircleDollarSign],['marketing','Marketing',BarChart3],['partnerships','Partnerships',Building2],['legal','Legal',Scale],['apps','Applications',AppWindow],['admin','Admin',Settings]
    ] as const
    return items.filter(([id])=>canAccess(profile.role,id))
  },[profile.role])

  const openWorkspace=(title:string,url:string,note?:string)=>{setWorkspace({title,url,note});setSection('workspace')}
  const install=async()=>{if(!deferredPrompt)return;await deferredPrompt.prompt();setDeferredPrompt(null)}
  const signOut=()=>supabase?.auth.signOut()

  if(!authReady) return <div className="splash"><BrandLogo className="splashLogo"/><div className="spinner"/></div>
  if(!supabaseConfigured) return <SetupRequired/>
  if(!session) return <AuthGate/>

  return <div className="appBackground"><div className="shell glassFrame">
    <aside className="sidebar glassPanel">
      <div className="brand"><BrandLogo className="sidebarLogo"/><span>Internal Workspace</span></div>
      <nav>{nav.map(([id,label,Icon])=><button key={id} className={section===id?'active':''} onClick={()=>{setSection(id);setWorkspace(null)}}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="sidebarFooter"><div className="status"><span className={online?'dot ok':'dot'}></span>{online?'Online':'Offline'}</div><small>{profile.department}</small></div>
    </aside>
    <main>
      <header className="topbar glassPanel"><div><h1>{section==='workspace'&&workspace?workspace.title:nav.find(n=>n[0]===section)?.[1]||'Workspace'}</h1><p>One secure workplace for RideArrivo teams.</p></div><div className="headerActions"><button className="iconButton"><Search size={17}/></button><button className="iconButton"><Bell size={17}/></button>{deferredPrompt&&<button className="glassButton" onClick={install}><Download size={16}/>Install</button>}<button
  className="profileButton"
  onClick={()=>setSection('profile')}
>
  <div className="avatar">
    {profile.avatar_url
      ? <img
          src={profile.avatar_url}
          alt=""
          style={{
            width:'100%',
            height:'100%',
            objectFit:'cover',
            borderRadius:'50%'
          }}
        />
      : initials(profile.full_name)
    }
  </div>
  <span>
    <strong>{profile.full_name}</strong>
    <small>{profile.role}</small>
  </span>
</button></div></header>
      <div className="content">
        {section==='overview'&&<Overview setSection={setSection} role={profile.role}/>}
        {section==='profile'&&
          <ProfileModule
            profile={profile}
            onProfileUpdated={loadProfile}
          />
        } 
        {section==='mail'&&<MailModule/>}
        {section==='calendar'&&<CalendarModule/>}
        {section==='tasks'&&<TasksModule/>}
        {section==='announcements'&&<AnnouncementsModule/>}
        {section==='files'&&<CompanyFilesModule/>}
        {section==='knowledge'&&<KnowledgeBaseModule/>}
        {section==='social'&&<SocialModule/>}
        {section==='crm'&&<CRMModule/>}
        {section==='support'&&<SupportModule/>}
        {section==='engineering'&&<Engineering openWorkspace={openWorkspace}/>} 
        {section==='people'&&<PeopleModule/>}
        {section==='operations'&&<OperationsModule/>}
        {section==='finance'&&<FinanceModule/>}
        {section==='marketing'&&<MarketingModule/>}
        {section==='partnerships'&&<PartnershipsModule/>}
        {section==='legal'&&<LegalModule/>}
        {section==='admin'&&<AdminModule/>}
        {section==='apps'&&<ApplicationsHub/>} 
        {section==='workspace'&&workspace&&<WorkspaceView workspace={workspace}/>} 
      </div>
    </main>
  </div></div>
}


function SetupRequired(){
  return <div className="authPage">
    <div className="setupCard">
      <div className="brandWordmark setupWordmark">
        <span className="rideText">Ride</span><span className="arrivoText">Arrivo</span>
      </div>
      <span className="eyebrow">INTERNAL WORKSPACE</span>
      <h1>Workspace authentication is not configured.</h1>
      <p>
        Connect the RideArrivo Supabase project before employees can access this workspace.
      </p>
      <div className="setupVariables">
        <code>VITE_SUPABASE_URL</code>
        <code>VITE_SUPABASE_ANON_KEY</code>
        <code>VITE_ALLOWED_EMAIL_DOMAINS=ridearrivo.com</code>
      </div>
    </div>
  </div>
}

function AuthGate(){

  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)

  const cleanEmail=email.trim().toLowerCase()

  const validDomain=(value:string)=>
    allowedDomains.some((d:string)=>
      value.endsWith(`@${d}`)
    )

  const submit=async(e:FormEvent)=>{
    e.preventDefault()
    setMessage('')

    if(!supabase){
      setMessage('Authentication service is unavailable.')
      return
    }

    if(!cleanEmail){
      setMessage('Enter your RideArrivo work email.')
      return
    }

    if(!validDomain(cleanEmail)){
      setMessage(
        `Use an authorised RideArrivo email (${allowedDomains
          .map((d:string)=>`@${d}`)
          .join(', ')}).`
      )
      return
    }

    if(!password){
      setMessage('Enter your password.')
      return
    }

    setBusy(true)

    try{
      const {error}=await supabase.auth.signInWithPassword({
        email:cleanEmail,
        password
      })

      if(error){
        setMessage(
          error.message === 'Invalid login credentials'
            ? 'Invalid email or password, or this account is not authorised.'
            : error.message
        )
      }
    }catch(error){
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to sign in.'
      )
    }finally{
      setBusy(false)
    }
  }

  return (
    <div className="authPage">
      <div className="authGlass glassPanel">

        <div className="authBrand">
          <BrandLogo/>
          <span>RideArrivo Internal Workspace</span>
        </div>

        <div className="authCopy">
          <span className="eyebrow">
            SECURE COMPANY WORKSPACE
          </span>

          <h1>
            Everything your RideArrivo team needs, in one place.
          </h1>

          <p>
            Sign in with your approved RideArrivo employee account.
          </p>

          <div className="trustRow">
            Access is restricted to approved RideArrivo employees.
          </div>
        </div>

        <form onSubmit={submit}>

          <div className="authTabs">
            <button
              type="button"
              className="active"
              disabled
            >
              Employee sign in
            </button>
          </div>

          <label>
            Work email
            <input
              type="email"
              value={email}
              onChange={e=>setEmail(e.target.value)}
              placeholder="name@ridearrivo.com"
              autoComplete="email"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={e=>setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </label>

          {message&&
            <div className="authMessage">
              {message}
            </div>
          }

          <button
            className="primaryButton"
            disabled={busy}
          >
            {busy?'Signing in...':'Sign in'}
          </button>

          <p
            style={{
              marginTop:'16px',
              fontSize:'11px',
              textAlign:'center'
            }}
          >
            Need access? Contact RideArrivo Administration.
          </p>

        </form>

      </div>
    </div>
  )
}

function Overview({setSection,role}:{setSection:(s:Section)=>void;role:Role}){
  const stats=[['Open bookings','24','Support queue',Headphones],['Active rides','8','Live operations',Route],['CRM pipeline','₦5.5m','Open opportunities',CircleDollarSign],['Open HR requests','3','People operations',Users]] as const
  const launchers=[
    ['support','Support Station','Bookings, riders, drivers, live trips, safety and escalations.',Headphones],
    ['engineering','Engineering Station','Repos, deployments, mobile tooling, device bootstrap and APIs.',Code2],
    ['crm','CRM','Leads, riders, corporate accounts and opportunities.',ContactRound],
    ['finance','Finance','Accounting, receivables, payables, budgets, tax and close.',CircleDollarSign],
    ['marketing','Marketing','Campaigns, content, attribution, experiments and assets.',BarChart3],
    ['partnerships','Partnerships','Partners, agreements, pipeline, referrals and onboarding.',Building2]
  ] as const
  return <><section className="hero glassHero"><div><span className="eyebrow">RIDEARRIVO CONTROL PLANE</span><h2>Every team. Every workflow. One workspace.</h2><p>Operate bookings, customers, engineering, people, finance, marketing, partnerships, compliance and internal applications without leaving the RideArrivo workspace.</p><div className="heroActions">{canAccess(role,'support')&&<button className="primaryButton" onClick={()=>setSection('support')}>Open Support Station</button>}<button className="glassButton" onClick={()=>setSection('apps')}>Applications</button></div></div><img src="/ridearrivo-mark.png"/></section><div className="stats">{stats.map(([a,b,c,Icon])=><Metric key={a} icon={<Icon/>} label={a} value={b} hint={c}/>)}</div><section><SectionTitle eyebrow="WORKSTATIONS" title="Team command centres" subtitle="Only workstations permitted for your role are shown."/><div className="grid3">{launchers.filter(([id])=>canAccess(role,id)).map(([id,title,text,Icon])=><Launch key={id} title={title} text={text} icon={<Icon/>} onClick={()=>setSection(id)}/>)}</div></section></>
}
function CRM(){return <section><SectionTitle eyebrow="CUSTOMER RELATIONSHIPS" title="CRM" subtitle="A single view of travellers, riders, corporate accounts, partners, opportunities and every customer touchpoint." actions={<button className="primaryButton"><UserPlus size={16}/>New lead</button>}/><div className="stats"><Metric icon={<Users/>} label="Contacts" value="2,184" hint="Riders and stakeholders"/><Metric icon={<Building2/>} label="Corporate accounts" value="38" hint="Hotels, travel and companies"/><Metric icon={<CircleDollarSign/>} label="Open pipeline" value="₦5.5m" hint="14 opportunities"/><Metric icon={<CalendarDays/>} label="Follow-ups due" value="12" hint="Today"/></div><div className="glassCard tableCard"><div className="tableToolbar"><div><h3>Relationship pipeline</h3><p>Sales, partnership and recovery work in one queue.</p></div><button className="glassButton"><ListChecks size={16}/>Activities</button></div><div className="dataTable"><div className="tr th"><span>Name / Account</span><span>Type</span><span>Status</span><span>Value</span><span>Last activity</span></div>{crmRows.map(r=><div className="tr" key={r.name}><span><strong>{r.name}</strong></span><span>{r.type}</span><span><StatusPill value={r.status}/></span><span>{r.value}</span><span>{r.last}</span></div>)}</div></div><div className="grid3"><Feature icon={<TicketCheck/>} title="Customer 360" text="Bookings, support cases, notes, payments and communications tied to one profile."/><Feature icon={<CircleDollarSign/>} title="Corporate sales" text="Track hotel, corporate and travel-agent opportunities from lead to signed account."/><Feature icon={<Activity/>} title="Activity timeline" text="Calls, emails, tasks, meetings and ownership changes with a clear audit history."/></div></section>}

function Support(){return <section><SectionTitle eyebrow="SUPPORT CONTROL" title="Support Station" subtitle="Booking intake, assignment, live-trip support, safety and post-trip resolution."/><div className="stats"><Metric icon={<LifeBuoy/>} label="Unassigned orders" value="7" hint="Needs dispatch"/><Metric icon={<Activity/>} label="Active rides" value="8" hint="Live tracking"/><Metric icon={<ShieldAlert/>} label="Panic alerts" value="0" hint="Safety queue"/><Metric icon={<Gauge/>} label="Avg response" value="2m" hint="Today"/></div><div className="grid2"><div className="glassCard"><h3>Priority booking queue</h3><p>Support owns intake until a driver is assigned.</p><div className="compactList">{supportQueue.map(q=><div key={q.id}><span><strong>{q.id}</strong><small>{q.rider} · {q.route}</small></span><span><StatusPill value={q.state}/><small>{q.priority}</small></span></div>)}</div></div><div className="glassCard"><h3>Support toolkit</h3><div className="toolGrid"><Feature icon={<TicketCheck/>} title="Cases & disputes" text="Refunds, complaints and incident-linked support cases."/><Feature icon={<Users/>} title="Rider & driver context" text="Profiles, trip history, verification and support notes."/><Feature icon={<ShieldCheck/>} title="Safety escalation" text="Panic alerts, escalation owners and resolution trail."/><Feature icon={<BarChart3/>} title="Service KPIs" text="First response, resolution time, CSAT and backlog."/></div></div></div></section>}

function Engineering({openWorkspace}:{openWorkspace:(t:string,u:string,n?:string)=>void}){
  const copy=(text:string)=>navigator.clipboard?.writeText(text)
  return <section><SectionTitle eyebrow="ENGINEERING WORKSTATION" title="Software & Mobile Engineering" subtitle="A central workstation for source control, APIs, environments, releases, native tooling and device setup." actions={<div className="buttonRow"><a className="glassButton" href="/bootstrap/macos.sh" download><Download size={16}/>macOS setup</a><a className="glassButton" href="/bootstrap/windows.ps1" download><Download size={16}/>Windows setup</a></div>}/><div className="callout glassCard"><Wrench/><div><strong>Managed setup, not silent browser installation</strong><p>Browsers cannot install VS Code, Docker, Xcode or Android Studio silently. Use the provided bootstrap scripts now; move to Intune/Jamf later for controlled company device provisioning.</p></div></div><div className="grid2"><div className="glassCard"><div className="cardHeader"><h3>Engineering tools</h3><span className="pill">Device kit</span></div><div className="compactList tools">{engineers.map(t=><div key={t.name}><span><strong>{t.name}</strong><small>{t.purpose}</small></span><button className="copyBtn" onClick={()=>copy(t.mac)} title="Copy macOS command"><Copy size={14}/></button></div>)}</div></div><div className="glassCard"><div className="cardHeader"><h3>Delivery control</h3><span className="pill">In workspace</span></div><div className="toolGrid"><Launch title="GitHub Engineering" text="Repositories, pull requests, Actions and releases." icon={<Code2/>} onClick={()=>openWorkspace('GitHub Engineering','https://github.com/Parasyte-cloud','GitHub may block iframe embedding. The production version should use the GitHub API for native PR, Actions and repository views.')}/><Feature icon={<Network/>} title="API Centre" text="OpenAPI docs, environment endpoints, Postman collections and health checks."/><Feature icon={<PackageCheck/>} title="Release Centre" text="Web deployments, mobile builds, versions and release approvals."/><Feature icon={<MonitorCog/>} title="Browser IDE" text="Integrate code-server or GitHub Codespaces for in-workspace code editing."/></div></div></div></section>}

function People(){return <section><SectionTitle eyebrow="PEOPLE & HR" title="People operations" subtitle="Employee directory, leave, onboarding, performance, policies and HR service delivery."/><div className="stats"><Metric icon={<Users/>} label="Employees" value="24" hint="Active headcount"/><Metric icon={<CalendarDays/>} label="Leave requests" value="4" hint="2 awaiting approval"/><Metric icon={<ClipboardCheck/>} label="Onboarding" value="92%" hint="Current cohort"/><Metric icon={<LifeBuoy/>} label="HR requests" value="3" hint="Open"/></div><div className="grid3"><Feature icon={<Users/>} title="Directory & org chart" text="Roles, departments, managers, locations and company contact information."/><Feature icon={<CalendarDays/>} title="Leave & attendance" text="Balances, requests, approvals, holidays and employee availability."/><Feature icon={<ClipboardCheck/>} title="Onboarding & offboarding" text="IT setup, policy acknowledgement, probation and access removal."/><Feature icon={<Gauge/>} title="Performance" text="Goals, reviews, manager feedback and development plans."/><Feature icon={<BookOpen/>} title="Policies & handbook" text="Versioned policies with acknowledgement and controlled access."/><Feature icon={<LifeBuoy/>} title="HR service desk" text="Employment letters, data changes, welfare and internal requests."/></div></section>}

function Operations(){return <section><SectionTitle eyebrow="OPERATIONS" title="Ride Operations" subtitle="Dispatch, driver readiness, fleet, airport pickup execution, incidents and operating performance."/><div className="grid3"><Feature icon={<Route/>} title="Dispatch Board" text="Unassigned bookings, driver matching, trip state and operational ownership."/><Feature icon={<BadgeCheck/>} title="Driver readiness" text="Verification, availability, documentation and compliance status."/><Feature icon={<PackageCheck/>} title="Fleet readiness" text="Vehicles, maintenance, papers, inspections and capacity."/><Feature icon={<Activity/>} title="Live operations" text="Active trips, location health, delayed flights and exceptions."/><Feature icon={<ShieldAlert/>} title="Incident management" text="Safety, service incidents, owners, severity and corrective actions."/><Feature icon={<BarChart3/>} title="Operations KPIs" text="Assignment time, completion, cancellation, utilisation and service quality."/></div></section>}

function Legal(){return <section><SectionTitle eyebrow="LEGAL & COMPLIANCE" title="Legal workspace" subtitle="Contracts, policies, privacy, renewals, approvals and controlled corporate records."/><div className="grid3"><Feature icon={<Scale/>} title="Contract Register" text="Counterparties, owners, status, renewal dates and approved versions."/><Feature icon={<FileCheck2/>} title="Policy Library" text="Privacy, terms, refunds, employment and operating policies."/><Feature icon={<ShieldCheck/>} title="Compliance Register" text="Obligations, evidence, due dates, owners and status."/><Feature icon={<Users/>} title="Driver & owner agreements" text="Executed agreements tied to verified people and vehicles."/><Feature icon={<CalendarDays/>} title="Renewal calendar" text="Contracts, licences, insurance and statutory deadlines."/><Feature icon={<FileText/>} title="Legal requests" text="Review queue for contracts, incidents, claims and internal advice."/></div></section>}

function Admin(){return <section><SectionTitle eyebrow="ADMINISTRATION" title="Workspace administration" subtitle="Identity, roles, applications, integrations, devices, audit and security configuration."/><div className="grid3"><Feature icon={<UserCog/>} title="Identity & access" text="Employee activation, role grants, departments and offboarding."/><Feature icon={<AppWindow/>} title="Application registry" text="Native modules, embedded apps, API integrations and availability."/><Feature icon={<KeyRound/>} title="SSO & authentication" text="RideArrivo email enforcement, session policy and identity integration."/><Feature icon={<Smartphone/>} title="Device management" text="Bootstrap scripts now, MDM policy and compliance later."/><Feature icon={<ShieldCheck/>} title="Audit & security" text="Privileged actions, login history, policy changes and incident review."/><Feature icon={<Settings/>} title="Workspace settings" text="Branding, environment configuration, notifications and feature controls."/></div></section>}

function WorkspaceView({workspace}:{workspace:Workspace}){return <section className="workspace glassCard"><div className="workspaceBar"><div><strong>{workspace.title}</strong><span>{workspace.url}</span></div><span className="pill">Embedded workspace</span></div>{workspace.note&&<div className="embedNote">{workspace.note}</div>}<iframe title={workspace.title} src={workspace.url} sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads" referrerPolicy="strict-origin-when-cross-origin"/></section>}

function SectionTitle({eyebrow,title,subtitle,actions}:{eyebrow:string;title:string;subtitle:string;actions?:ReactNode}){return <div className="sectionTitle"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></div>{actions}</div>}
function Metric({icon,label,value,hint}:{icon:ReactNode;label:string;value:string;hint:string}){return <div className="metric glassCard"><div className="metricIcon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></div>}
function Feature({icon,title,text}:{icon:ReactNode;title:string;text:string}){return <div className="glassCard feature"><div className="iconBox">{icon}</div><h3>{title}</h3><p>{text}</p></div>}
function Launch({title,text,icon,onClick}:{title:string;text:string;icon:ReactNode;onClick:()=>void}){return <button className="launch glassCard" onClick={onClick}><div className="iconBox">{icon}</div><div><strong>{title}</strong><p>{text}</p></div><ChevronRight/></button>}
function StatusPill({value}:{value:string}){return <span className={`statusPill ${value.toLowerCase().replace(/\s+/g,'-')}`}>{value}</span>}
function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(v=>v[0]?.toUpperCase()).join('') || 'RA'}

export default App
