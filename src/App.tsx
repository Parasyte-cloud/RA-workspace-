import {
  Suspense } from 'react'
import { useEffect,
  useMemo,
  useState } from 'react'
import type { FormEvent,
  ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity,
  AppWindow,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Code2,
  ContactRound,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Gauge,
  Headphones,
  Home,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LockKeyhole,
  Mail,
  MonitorCog,
  Network,
  PackageCheck,
  Route,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TicketCheck,
  UserCog,
  UserPlus,
  Users,
  Wrench,
  Images,
  Globe2
} from 'lucide-react'
import { supabase,
  supabaseConfigured } from './lib/supabase'
import { resolveEmployeeAvatarUrl } from './lib/employeeAvatar'






import { NotificationCenter } from './components/NotificationCenter'
import { useIdleSignOut } from './lib/useIdleSignOut'

import { HeaderAvatar } from './components/HeaderAvatar'


import { WorkspaceClock } from './components/WorkspaceClock'



import { applyStoredAppearance } from './lib/appearance'

import { PARASYTE_OPEN_EVENT } from './lib/parasyte'
import type { ParasyteOpenDetail } from './lib/parasyte'
import {
  MarketingTeamWorkspace,
  BrandLibrary,
  ParasyteBrowser,
  SupportTeamWorkspace,
  OperationsTeamWorkspace,
  PeopleTeamWorkspace,
  EngineeringTeamWorkspace,
  FinanceTeamWorkspace,
  PartnershipsTeamWorkspace,
  LegalTeamWorkspace,
  SupportModule,
  PeopleModule,
  OperationsModule,
  FinanceModule,
  PartnershipsModule,
  LegalModule,
  MailModule,
  CRMModule,
  AdminModule,
  SocialModule,
  ProfileModule,
  ApplicationsHub,
  WorkDesk,
  AnnouncementsModule,
  CalendarModule,
  KnowledgeBaseModule,
  CompanyFilesModule,
  OverviewMetrics,
  HeadshotGallery,
  AppearanceSettings
} from './lazy-routes'

applyStoredAppearance()

type Section = 'profile'|'gallery'|'overview'|'social'|'mail'|'announcements'|'calendar'|'tasks'|'files'|'brand'|'knowledge'|'crm'|'support'|'engineering'|'people'|'operations'|'finance'|'marketing'|'partnerships'|'legal'|'admin'|'apps'|'parasyte'|'settings'|'workspace'
type Role = 'employee'|'support'|'engineer'|'cto'|'manager'|'hr'|'legal'|'operations'|'finance'|'marketing'|'partnerships'|'admin'
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

const allWorkspaceRoles:Role[]=[
  'employee',
  'support',
  'engineer',
  'manager',
  'hr',
  'legal',
  'operations',
  'finance',
  'marketing',
  'partnerships',
  'admin'
]

/*
 * Workspace access is DEFAULT DENY.
 *
 * Shared employee services:
 * overview, profile, social, mail, calendar,
 * tasks, announcements, files, knowledge,
 * applications.
 *
 * Department workstations:
 * only the department role plus Manager/Admin.
 *
 * Admin:
 * Admin only.
 */
const sectionAccess:Record<Section,Role[]>={
  overview:allWorkspaceRoles,
  profile:allWorkspaceRoles,
  gallery:allWorkspaceRoles,
  social:allWorkspaceRoles,
  mail:allWorkspaceRoles,
  announcements:allWorkspaceRoles,
  calendar:allWorkspaceRoles,
  tasks:allWorkspaceRoles,
  files:allWorkspaceRoles,
  brand:allWorkspaceRoles,
  knowledge:allWorkspaceRoles,
  apps:allWorkspaceRoles,
  parasyte:allWorkspaceRoles,
  workspace:allWorkspaceRoles,

  /*
   * CRM currently has no dedicated CRM role.
   * Until one exists, it is management-only rather
   * than leaking CRM records across departments.
   */
  crm:[
    'manager',
    'admin'
  ],

  support:[
    'support',
    'manager',
    'admin'
  ],

  engineering:[
    'engineer',
    'manager',
    'admin'
  ],

  people:[
    'hr',
    'manager',
    'admin'
  ],

  operations:[
    'operations',
    'manager',
    'admin'
  ],

  finance:[
    'finance',
    'manager',
    'admin'
  ],

  marketing:[
    'marketing',
    'manager',
    'admin'
  ],

  partnerships:[
    'partnerships',
    'manager',
    'admin'
  ],

  legal:[
    'legal',
    'manager',
    'admin'
  ],

  admin:[
    'admin'
  ],
  settings:[
    'employee',
    'support',
    'engineer',
    'cto',
    'manager',
    'hr',
    'legal',
    'operations',
    'finance',
    'marketing',
    'partnerships',
    'admin'
  ]
}

const canAccess=(
  role:Role,
  section:Section
)=>
  sectionAccess[section]
    ?.includes(role) === true


const crmRows: {
  name:string
  type:string
  status:string
  value:string
  last:string
}[] = []

const supportQueue: {
  id:string
  rider:string
  route:string
  state:string
  priority:string
}[] = []

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
      src="/ridearrivo-wordmark-workspace.png"
      alt="RideArrivo"
      className={`brandLogo ${className}`}
      draggable={false}
    />
  )
}

function App(){
  const [session,setSession]=useState<Session|null>(null)


  useIdleSignOut(
    supabase,
    session
  )

  type AccessState =
    | 'loading'
    | 'approved'
    | 'pending'
    | 'error'

  const [accessState,setAccessState]=
    useState<AccessState>('loading')

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

  const [parasyteUrl,setParasyteUrl]=
    useState('')

  // ridearrivo-parasyte-listener
  useEffect(()=>{

    const handler=(event:Event)=>{

      const detail=
        (
          event as CustomEvent<
            ParasyteOpenDetail
          >
        ).detail

      if(!detail?.url){
        return
      }

      setParasyteUrl(
        detail.url
      )

      setSection(
        'parasyte'
      )

    }

    window.addEventListener(
      PARASYTE_OPEN_EVENT,
      handler
    )

    return ()=>{

      window.removeEventListener(
        PARASYTE_OPEN_EVENT,
        handler
      )

    }

  },[])




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

    supabase.auth
      .getSession()
      .then(({data,error})=>{
        if(error){
          console.error(
            '[RideArrivo Auth] initial session error',
            error
          )
        }

        setSession(
          data.session ?? null
        )

        setAuthReady(true)
      })
      .catch(error=>{
        console.error(
          '[RideArrivo Auth] initial session failure',
          error
        )

        setAuthReady(true)
      })

    const {data} =
      supabase.auth.onAuthStateChange(
        (event,next)=>{
          console.info(
            '[RideArrivo Auth]',
            event,
            next?.user?.email ||
            'no session'
          )

          if(next){
            setSession(next)
          }else if(
            event==='SIGNED_OUT'
          ){
            setSession(null)
          }

          setAuthReady(true)
        }
      )

    return()=>{
      data.subscription.unsubscribe()
      window.removeEventListener('beforeinstallprompt',before)
      window.removeEventListener('online',connectivity)
      window.removeEventListener('offline',connectivity)
    }
  },[])

  const loadProfile=async()=>{
    const client=supabase
    const user=session?.user

    if(!client || !user){
      setAccessState('loading')
      return
    }

    setAccessState('loading')

    const {
      data,
      error,
    }=await client
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
        active
      `)
      .eq('id',user.id)
      .maybeSingle()

    if(error){
      console.error(
        'Employee profile load failed',
        error
      )

      setAccessState('error')
      return
    }

    if(!data){
      setAccessState('pending')
      return
    }

    if(data.active!==true){
      setAccessState('pending')
      return
    }

    const avatar_url =
      await resolveEmployeeAvatarUrl(
        data.avatar_path
      )

    setProfile({
      ...(data as Profile),
      avatar_url,
    })

    setAccessState('approved')
  }

  useEffect(()=>{
    void loadProfile()
  },[
    session?.user?.id
  ])


  const [profileMenuOpen,setProfileMenuOpen]=useState(false)

  useEffect(()=>{
    if(!profileMenuOpen){
      return
    }

    const closeOutside=(event:PointerEvent)=>{
      const target=event.target as HTMLElement | null

      if(
        target &&
        !target.closest('.profileMenuWrap')
      ){
        setProfileMenuOpen(false)
      }
    }

    const closeEscape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        setProfileMenuOpen(false)
      }
    }

    document.addEventListener(
      'pointerdown',
      closeOutside
    )

    document.addEventListener(
      'keydown',
      closeEscape
    )

    return()=>{
      document.removeEventListener(
        'pointerdown',
        closeOutside
      )

      document.removeEventListener(
        'keydown',
        closeEscape
      )
    }
  },[profileMenuOpen])

  const nav = useMemo(()=>{
    const items = [
      ['overview','Overview',Home],['profile','My Profile',UserCog],['gallery','Headshots',Images],['social','Pulse',Bell],['mail','Mail',Mail],['calendar','Calendar',CalendarDays],['tasks','Tasks',ListChecks],['announcements','Announcements',Bell],['files','Company Files',FileText],['brand','Brand Library',Images],['knowledge','Knowledge Base',BookOpen],['crm','CRM',ContactRound],['support','Support',Headphones],['engineering','Engineering',Code2],['people','People & HR',Users],['operations','Operations',BriefcaseBusiness],['finance','Finance',CircleDollarSign],['marketing','Marketing',BarChart3],['partnerships','Partnerships',Building2],['legal','Legal',Scale],['parasyte','PArAsYtE',Globe2],['apps','Applications',AppWindow],['settings','Settings',Settings],['admin','Admin',Settings]
    ] as const
    return items.filter(([id])=>canAccess(profile.role,id))
  },[profile.role])

  const openWorkspace=(title:string,url:string,note?:string)=>{setWorkspace({title,url,note});setSection('workspace')}
  const install=async()=>{if(!deferredPrompt)return;await deferredPrompt.prompt();setDeferredPrompt(null)}
  const signOut=()=>{
    window.localStorage.removeItem(
      'ridearrivo-last-activity'
    )

    return supabase?.auth.signOut()
  }

  if(!authReady) return <div className="splash"><BrandLogo className="splashLogo"/><div className="spinner"/></div>
  if(!supabaseConfigured) return <SetupRequired/>
  if(!session) return <AuthGate/>

  if(accessState==='loading'){
    return (
      <div className="splash">
        <BrandLogo className="splashLogo"/>
        <div className="spinner"/>
      </div>
    )
  }

  if(accessState==='error'){
    return (
      <div className="authPage">
        <div className="setupCard">
          <BrandLogo className="authLogo"/>

          <span className="eyebrow">
            WORKSPACE ACCESS
          </span>

          <h1>
            We could not verify your access
          </h1>

          <p>
            Your session is still active.
            The workspace could not verify your
            employee profile right now.
          </p>

          <button
            className="primaryButton"
            onClick={()=>{
              setAccessState('loading')
              void loadProfile()
            }}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if(accessState==='pending'){
    return (
      <div className="authPage">
        <div className="setupCard">
          <BrandLogo className="authLogo"/>

          <span className="eyebrow">
            EMPLOYEE ACCESS
          </span>

          <h1>
            Awaiting administrator approval
          </h1>

          <p>
            Your RideArrivo account exists,
            but workspace access has not yet
            been approved.
          </p>

          <div className="pendingApprovalEmail">
            {session.user.email}
          </div>

          <button
            className="glassButton"
            onClick={()=>{
              setAccessState('loading')
              void loadProfile()
            }}
          >
            Check again
          </button>

          <button
            className="glassButton"
            onClick={()=>
              void supabase?.auth.signOut()
            }
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return <div className="appBackground"><div className="shell glassFrame">
    <aside className="sidebar glassPanel">
      <div className="brand"><BrandLogo className="sidebarLogo"/><span>Internal Workspace</span></div>
      <nav>{nav.map(([id,label,Icon])=><button key={id} className={section===id?'active':''} onClick={()=>{setSection(id);setWorkspace(null)}}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="sidebarFooter"><div className="status"><span className={online?'dot ok':'dot'}></span>{online?'Online':'Offline'}</div><small>{profile.department}</small></div>
    </aside>
    <main>
        {/* ridearrivo-route-suspense */}
        <Suspense
          fallback={
            <div className="routeLoading glassCard">
              <span className="routeLoadingSpinner"/>
              <strong>Opening workspace...</strong>
              <small>Loading only the tools required for this section.</small>
            </div>
          }
        >

      <header className="topbar glassPanel"><div><h1>{section==='workspace'&&workspace?workspace.title:nav.find(n=>n[0]===section)?.[1]||'Workspace'}</h1><p>One secure workplace for RideArrivo teams.</p></div><div className="headerActions"><WorkspaceClock/><button className="iconButton"><Search size={17}/></button><NotificationCenter
  onOpenWork={()=>{
    setSection('tasks')
  }}
/>{deferredPrompt&&<button className="glassButton" onClick={install}><Download size={16}/>Install</button>}<div className="profileMenuWrap">
  <button
    type="button"
    className="profileButton"
    aria-haspopup="menu"
    aria-expanded={profileMenuOpen}
    onClick={()=>setProfileMenuOpen(
      current=>!current
    )}
  >
    <HeaderAvatar userId={session.user.id} name={profile.full_name}/>

    <span>
      <strong>{profile.full_name}</strong>
      <small>{profile.role}</small>
    </span>
  </button>

  {profileMenuOpen&&
    <div
      className="profileMenu"
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        onClick={()=>{
          setProfileMenuOpen(false)
          setWorkspace(null)
          setSection('profile')
        }}
      >
        My Profile
      </button>

      <div className="profileMenuDivider"/>

      <button
        type="button"
        role="menuitem"
        className="profileMenuDanger"
        onClick={async()=>{
          setProfileMenuOpen(false)

          window.localStorage.removeItem(
            'ridearrivo-last-activity'
          )

          const {error} =
            await supabase?.auth.signOut() ?? {}

          if(error){
            console.error(
              '[RideArrivo Auth] sign out failed',
              error
            )
          }
        }}
      >
        Sign out
      </button>
    </div>
  }
</div></div></header>
      <div className="content">
        {section==='overview'&&<Overview setSection={setSection} role={profile.role}/>}
        {section==='profile'&&
          <ProfileModule
            profile={profile}
            onProfileUpdated={loadProfile}
          />
        } 
        {section==='gallery'&&<HeadshotGallery/>}
        {section==='mail'&&<MailModule/>}
        {section==='calendar'&&<CalendarModule/>}
        {section==='tasks'&&<WorkDesk/>}
        {section==='announcements'&&<AnnouncementsModule/>}
        {section==='files'&&<CompanyFilesModule/>}
        {section==='brand'&&<BrandLibrary/>}
        {section==='knowledge'&&<KnowledgeBaseModule/>}
        {section==='social'&&<SocialModule/>}
        {section==='crm'&&<CRMModule/>}
        {section==='support'&&<SupportTeamWorkspace execution={<SupportModule/>}/>}
        {section==='engineering'&&<EngineeringTeamWorkspace execution={<Engineering openWorkspace={openWorkspace}/>}/>} 
        {section==='people'&&<PeopleTeamWorkspace execution={<PeopleModule/>}/>}
        {section==='operations'&&<OperationsTeamWorkspace execution={<OperationsModule/>}/>}
        {section==='finance'&&<FinanceTeamWorkspace execution={<FinanceModule/>}/>}
        {section==='marketing'&&<MarketingTeamWorkspace/>}
        {section==='partnerships'&&<PartnershipsTeamWorkspace execution={<PartnershipsModule/>}/>}
        {section==='legal'&&<LegalTeamWorkspace execution={<LegalModule/>}/>}
        {section==='settings'&&<AppearanceSettings/>}
        {section==='admin'&&<AdminModule/>}
        {section==='parasyte'&&<ParasyteBrowser initialUrl={parasyteUrl}/>}
        {section==='apps'&&<ApplicationsHub/>} 
        {section==='workspace'&&workspace&&<WorkspaceView workspace={workspace}/>} 
      </div>
    
        </Suspense>
</main>
  </div></div>
}


function SetupRequired(){
  return <div className="authPage">
    <div className="setupCard">
      <BrandLogo className="setupWordmark"/>
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
          <BrandLogo className="authLogo"/>
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
  const launchers=[
    ['support','Support Station','Bookings, riders, drivers, live trips, safety and escalations.',Headphones],
    ['engineering','Engineering Station','Repos, deployments, mobile tooling, device bootstrap and APIs.',Code2],
    ['crm','CRM','Leads, riders, corporate accounts and opportunities.',ContactRound],
    ['finance','Finance','Accounting, receivables, payables, budgets, tax and close.',CircleDollarSign],
    ['marketing','Marketing','Campaigns, content, attribution, experiments and assets.',BarChart3],
    ['partnerships','Partnerships','Partners, agreements, pipeline, referrals and onboarding.',Building2]
  ] as const
  return <><section className="hero glassHero"><div><span className="eyebrow">RIDEARRIVO CONTROL PLANE</span><h2>Every team. Every workflow. One workspace.</h2><p>Operate bookings, customers, engineering, people, finance, marketing, partnerships, compliance and internal applications without leaving the RideArrivo workspace.</p><div className="heroActions">{canAccess(role,'support')&&<button className="primaryButton" onClick={()=>setSection('support')}>Open Support Station</button>}<button className="glassButton" onClick={()=>setSection('apps')}>Applications</button></div></div><img src="/ridearrivo-mark.png"/></section><OverviewMetrics role={role}/><section><SectionTitle eyebrow="WORKSTATIONS" title="Team command centres" subtitle="Only workstations permitted for your role are shown."/><div className="grid3">{launchers.filter(([id])=>canAccess(role,id)).map(([id,title,text,Icon])=><Launch key={id} title={title} text={text} icon={<Icon/>} onClick={()=>setSection(id)}/>)}</div></section></>
}
function CRM(){
  return <section>
    <SectionTitle
      eyebrow="CUSTOMER RELATIONSHIPS"
      title="CRM"
      subtitle="A single view of travellers, riders, corporate accounts, partners, opportunities and every customer touchpoint."
      actions={
        <button className="primaryButton">
          <UserPlus size={16}/>
          New lead
        </button>
      }
    />

    <div className="stats">
      <Metric
        icon={<Users/>}
        label="Contacts"
        value="0"
        hint="Awaiting live CRM connection"
      />
      <Metric
        icon={<Building2/>}
        label="Corporate accounts"
        value="0"
        hint="Awaiting live CRM connection"
      />
      <Metric
        icon={<CircleDollarSign/>}
        label="Open pipeline"
        value="₦0"
        hint="Awaiting live CRM connection"
      />
      <Metric
        icon={<CalendarDays/>}
        label="Follow-ups due"
        value="0"
        hint="Awaiting live CRM connection"
      />
    </div>

    <div className="glassCard tableCard">
      <div className="tableToolbar">
        <div>
          <h3>Relationship pipeline</h3>
          <p>
            Live CRM records will appear here once the
            production data source is connected.
          </p>
        </div>

        <button className="glassButton">
          <ListChecks size={16}/>
          Activities
        </button>
      </div>

      <div className="dataTable">
        <div className="tr th">
          <span>Name / Account</span>
          <span>Type</span>
          <span>Status</span>
          <span>Value</span>
          <span>Last activity</span>
        </div>

        {crmRows.map(r=>
          <div className="tr" key={r.name}>
            <span>
              <strong>{r.name}</strong>
            </span>
            <span>{r.type}</span>
            <span>
              <StatusPill value={r.status}/>
            </span>
            <span>{r.value}</span>
            <span>{r.last}</span>
          </div>
        )}
      </div>

      {!crmRows.length&&
        <div className="emptyDataState">
          No live CRM records connected yet.
        </div>
      }
    </div>

    <div className="grid3">
      <Feature
        icon={<TicketCheck/>}
        title="Customer 360"
        text="Bookings, support cases, notes, payments and communications tied to one profile."
      />
      <Feature
        icon={<CircleDollarSign/>}
        title="Corporate sales"
        text="Track hotel, corporate and travel-agent opportunities from lead to signed account."
      />
      <Feature
        icon={<Activity/>}
        title="Activity timeline"
        text="Calls, emails, tasks, meetings and ownership changes with a clear audit history."
      />
    </div>
  </section>
}

function Support(){
  return <section>
    <SectionTitle
      eyebrow="SUPPORT CONTROL"
      title="Support Station"
      subtitle="Booking intake, assignment, live-trip support, safety and post-trip resolution."
    />

    <div className="stats">
      <Metric
        icon={<LifeBuoy/>}
        label="Unassigned orders"
        value="0"
        hint="Awaiting live Support connection"
      />
      <Metric
        icon={<Activity/>}
        label="Active rides"
        value="0"
        hint="Awaiting live Operations connection"
      />
      <Metric
        icon={<ShieldAlert/>}
        label="Panic alerts"
        value="0"
        hint="Awaiting live safety feed"
      />
      <Metric
        icon={<Gauge/>}
        label="Avg response"
        value="0m"
        hint="Awaiting live Support metrics"
      />
    </div>

    <div className="grid2">
      <div className="glassCard">
        <h3>Priority booking queue</h3>
        <p>
          Live Support and booking records will appear here
          when the production backend is connected.
        </p>

        <div className="compactList">
          {supportQueue.map(q=>
            <div key={q.id}>
              <span>
                <strong>{q.id}</strong>
                <small>
                  {q.rider} · {q.route}
                </small>
              </span>

              <span>
                <StatusPill value={q.state}/>
                <small>{q.priority}</small>
              </span>
            </div>
          )}
        </div>

        {!supportQueue.length&&
          <div className="emptyDataState">
            No live Support queue connected yet.
          </div>
        }
      </div>

      <div className="glassCard">
        <h3>Support toolkit</h3>

        <div className="toolGrid">
          <Feature
            icon={<TicketCheck/>}
            title="Cases & disputes"
            text="Refunds, complaints and incident-linked support cases."
          />
          <Feature
            icon={<Users/>}
            title="Rider & driver context"
            text="Profiles, trip history, verification and support notes."
          />
          <Feature
            icon={<ShieldCheck/>}
            title="Safety escalation"
            text="Panic alerts, escalation owners and resolution trail."
          />
          <Feature
            icon={<BarChart3/>}
            title="Service KPIs"
            text="First response, resolution time, CSAT and backlog."
          />
        </div>
      </div>
    </div>
  </section>
}

function Engineering({openWorkspace}:{openWorkspace:(t:string,u:string,n?:string)=>void}){
  const copy=(text:string)=>navigator.clipboard?.writeText(text)
  return <section><SectionTitle eyebrow="ENGINEERING WORKSTATION" title="Software & Mobile Engineering" subtitle="A central workstation for source control, APIs, environments, releases, native tooling and device setup." actions={<div className="buttonRow"><a className="glassButton" href="/bootstrap/macos.sh" download><Download size={16}/>macOS setup</a><a className="glassButton" href="/bootstrap/windows.ps1" download><Download size={16}/>Windows setup</a></div>}/><div className="callout glassCard"><Wrench/><div><strong>Managed setup, not silent browser installation</strong><p>Browsers cannot install VS Code, Docker, Xcode or Android Studio silently. Use the provided bootstrap scripts now; move to Intune/Jamf later for controlled company device provisioning.</p></div></div><div className="grid2"><div className="glassCard"><div className="cardHeader"><h3>Engineering tools</h3><span className="pill">Device kit</span></div><div className="compactList tools">{engineers.map(t=><div key={t.name}><span><strong>{t.name}</strong><small>{t.purpose}</small></span><button className="copyBtn" onClick={()=>copy(t.mac)} title="Copy macOS command"><Copy size={14}/></button></div>)}</div></div><div className="glassCard"><div className="cardHeader"><h3>Delivery control</h3><span className="pill">In workspace</span></div><div className="toolGrid"><Launch title="GitHub Engineering" text="Repositories, pull requests, Actions and releases." icon={<Code2/>} onClick={()=>openWorkspace('GitHub Engineering','https://github.com/Parasyte-cloud','GitHub may block iframe embedding. The production version should use the GitHub API for native PR, Actions and repository views.')}/><Feature icon={<Network/>} title="API Centre" text="OpenAPI docs, environment endpoints, Postman collections and health checks."/><Feature icon={<PackageCheck/>} title="Release Centre" text="Web deployments, mobile builds, versions and release approvals."/><Feature icon={<MonitorCog/>} title="Browser IDE" text="Integrate code-server or GitHub Codespaces for in-workspace code editing."/></div></div></div></section>}

function People(){
  return <section>
    <SectionTitle
      eyebrow="PEOPLE & HR"
      title="People operations"
      subtitle="Employee directory, leave, onboarding, performance, policies and HR service delivery."
    />

    <div className="stats">
      <Metric
        icon={<Users/>}
        label="Employees"
        value="0"
        hint="Awaiting live HR data"
      />
      <Metric
        icon={<CalendarDays/>}
        label="Leave requests"
        value="0"
        hint="Awaiting live HR data"
      />
      <Metric
        icon={<ClipboardCheck/>}
        label="Onboarding"
        value="0%"
        hint="Awaiting live HR data"
      />
      <Metric
        icon={<LifeBuoy/>}
        label="HR requests"
        value="0"
        hint="Awaiting live HR data"
      />
    </div>

    <div className="grid3">
      <Feature
        icon={<Users/>}
        title="Directory & org chart"
        text="Roles, departments, managers, locations and company contact information."
      />
      <Feature
        icon={<CalendarDays/>}
        title="Leave & attendance"
        text="Balances, requests, approvals, holidays and employee availability."
      />
      <Feature
        icon={<ClipboardCheck/>}
        title="Onboarding & offboarding"
        text="IT setup, policy acknowledgement, probation and access removal."
      />
      <Feature
        icon={<Gauge/>}
        title="Performance"
        text="Goals, reviews, manager feedback and development plans."
      />
      <Feature
        icon={<BookOpen/>}
        title="Policies & handbook"
        text="Versioned policies with acknowledgement and controlled access."
      />
      <Feature
        icon={<LifeBuoy/>}
        title="HR service desk"
        text="Employment letters, data changes, welfare and internal requests."
      />
    </div>
  </section>
}

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
