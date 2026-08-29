import {
  Suspense } from 'react'
import { useEffect,
  useMemo,
  useRef,
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
  Crown,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderKanban,
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
  TerminalSquare,
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
import ControlledDownloadButton from './components/ControlledDownloadButton'
import PersonalDashboard from './modules/PersonalDashboard'
import DevicePresence from './components/DevicePresence'


import { WorkspaceClock } from './components/WorkspaceClock'



import { applyStoredAppearance } from './lib/appearance'

import { PARASYTE_OPEN_EVENT } from './lib/parasyte'
import type { ParasyteOpenDetail } from './lib/parasyte'
import {
  MarketingTeamWorkspace,
  BrandLibrary,
  ParasyteLinux,
  ParasyteBrowser,
  SupportTeamWorkspace,
  OperationsTeamWorkspace,
  PeopleTeamWorkspace,
  EngineeringTeamWorkspace,
  ExecutiveTeamWorkspace,
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
  ProjectManagementModule,
  AnnouncementsModule,
  CalendarModule,
  KnowledgeBaseModule,
  CompanyFilesModule,
  OverviewMetrics,
  HeadshotGallery,
  AppearanceSettings,
  SharedWorkspacesHub
} from './lazy-routes'

applyStoredAppearance()

type Section = 'profile'|'gallery'|'overview'|'social'|'mail'|'announcements'|'calendar'|'tasks'|'projects'|'shared'|'files'|'brand'|'knowledge'|'crm'|'support'|'engineering'|'linux'|'people'|'operations'|'finance'|'marketing'|'partnerships'|'legal'|'executive'|'admin'|'apps'|'parasyte'|'settings'|'workspace'
type Role = 'employee'|'support'|'engineer'|'cto'|'manager'|'hr'|'legal'|'operations'|'finance'|'marketing'|'partnerships'|'admin'
type Workspace = { title:string; url:string; note?:string }
type WorkstationAssignment = { workstation:string; is_primary:boolean; active:boolean }
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
  projects:allWorkspaceRoles,
  shared:allWorkspaceRoles,
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
    'cto',
    'manager',
    'admin'
  ],

  linux:[
    'engineer',
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

  executive:[
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

const workstationForSection:Partial<Record<Section,string>>={
  support:'support',
  operations:'operations',
  people:'people',
  engineering:'engineering',
  linux:'engineering',
  finance:'finance',
  marketing:'marketing',
  partnerships:'partnerships',
  legal:'legal',
  executive:'executive',
  admin:'administration',
}

const canAccess=(role:Role,section:Section,assignments:WorkstationAssignment[]=[])=>{
  if(sectionAccess[section]?.includes(role)===true) return true
  const workstation=workstationForSection[section]
  return Boolean(workstation && assignments.some(item=>item.active && item.workstation===workstation))
}


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
  const [passwordRecovery,setPasswordRecovery]=useState(false)


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
  const [workstationAssignments,setWorkstationAssignments]=useState<WorkstationAssignment[]>([])
  const [section,setSection]=useState<Section>('overview')
  const [openNavGroup,setOpenNavGroup]=useState<string|null>(null)
  const contentRef=useRef<HTMLDivElement|null>(null)

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

          if(event==='PASSWORD_RECOVERY'){
            setPasswordRecovery(true)
          }

          if(next){
            setSession(next)
          }else if(
            event==='SIGNED_OUT'
          ){
            setSession(null)
            setPasswordRecovery(false)
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

  useEffect(()=>{
    const client=supabase
    if(!client || accessState!=='approved' || !profile.id){
      setWorkstationAssignments([])
      return
    }

    void client
      .from('workspace_workstation_assignments')
      .select('workstation,is_primary,active')
      .eq('employee_id',profile.id)
      .eq('active',true)
      .then(({data,error})=>{
        if(error){
          console.error('[RideArrivo Workstation] assignment load failed',error)
          setWorkstationAssignments([])
          return
        }
        setWorkstationAssignments((data || []) as WorkstationAssignment[])
      })
  },[accessState,profile.id])


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
      ['overview','Dashboard',Home],['profile','My Profile',UserCog],['gallery','My Headshots',Images],['social','Pulse',Bell],['mail','Mail',Mail],['calendar','Calendar',CalendarDays],['tasks','Tasks',ListChecks],['projects','Projects',FolderKanban],['announcements','Announcements',Bell],['files','Company Files',FileText],['brand','Brand Library',Images],['knowledge','Knowledge Base',BookOpen],['crm','CRM',ContactRound],['executive','CEO / Management',Crown],['support','Support',Headphones],['operations','Operations',BriefcaseBusiness],['people','People & HR',Users],['engineering','Engineering',Code2],['linux','ParAsYtE Linux',TerminalSquare],['finance','Finance',CircleDollarSign],['marketing','Marketing',BarChart3],['partnerships','Partnerships',Building2],['legal','Legal',Scale],['parasyte','PArAsYtE',Globe2],['apps','Applications',AppWindow],['settings','Settings',Settings],['admin','Administration',Settings]
    ] as const
    return items.filter(([id])=>canAccess(profile.role,id,workstationAssignments))
  },[profile.role,workstationAssignments])

  const groupedNav=useMemo(()=>{
    const byId=new Map<Section,typeof nav[number]>()
    nav.forEach(item=>byId.set(item[0] as Section,item))
    const pick=(ids:readonly Section[])=>ids.map(id=>byId.get(id)).filter(Boolean) as (typeof nav[number])[]

    return {
      primary:pick(['overview','tasks','projects']),
      groups:[
        {id:'communication',label:'Communication',items:pick(['social','mail','calendar','announcements'])},
        {id:'resources',label:'Company',items:pick(['profile','gallery','files','brand','knowledge','crm','parasyte','apps'])},
        {id:'workstations',label:'Workstations',items:pick(['executive','support','operations','people','engineering','linux','finance','marketing','partnerships','legal'])}
      ].filter(group=>group.items.length>0),
      system:pick(['settings','admin'])
    }
  },[nav])

  useEffect(()=>{
    const activeGroup=groupedNav.groups.find(group=>group.items.some(([id])=>id===section))
    if(activeGroup){
      setOpenNavGroup(activeGroup.id)
    }
  },[section,groupedNav])

  useEffect(()=>{
    contentRef.current?.scrollTo({top:0,left:0,behavior:'auto'})
  },[section,workspace?.url])

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
  if(passwordRecovery) return <PasswordRecoveryGate onDone={()=>setPasswordRecovery(false)}/>

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
      <div className="brand"><BrandLogo className="sidebarLogo"/><span>RideArrivo Internal</span></div>
      <nav className="sidebarNav" aria-label="Workspace navigation">
        <div className="sidebarNavPrimary">
          {groupedNav.primary.map(([id,label,Icon])=><button type="button" key={id} className={`sidebarNavItem ${section===id?'active':''}`} aria-current={section===id?'page':undefined} onClick={()=>{setSection(id);setWorkspace(null)}}><Icon size={18}/><span>{label}</span></button>)}
        </div>
        <div className="sidebarNavGroups">
          {groupedNav.groups.map(group=>{
            const isOpen=openNavGroup===group.id
            return <div key={group.id} className={`sidebarNavGroup ${isOpen?'open':''}`}>
              <button type="button" className="sidebarNavGroupToggle" aria-expanded={isOpen} onClick={()=>setOpenNavGroup(current=>current===group.id?null:group.id)}>
                <span>{group.label}</span><ChevronRight size={14}/>
              </button>
              <div className="sidebarNavGroupItems">
                {group.items.map(([id,label,Icon])=><button type="button" key={id} className={`sidebarNavItem ${section===id?'active':''}`} aria-current={section===id?'page':undefined} onClick={()=>{setSection(id);setWorkspace(null)}}><Icon size={18}/><span>{label}</span></button>)}
              </div>
            </div>
          })}
        </div>
        <div className="sidebarNavSystem">
          {groupedNav.system.map(([id,label,Icon])=><button type="button" key={id} className={`sidebarNavItem ${section===id?'active':''}`} aria-current={section===id?'page':undefined} onClick={()=>{setSection(id);setWorkspace(null)}}><Icon size={18}/><span>{label}</span></button>)}
        </div>
      </nav>
      <div className="sidebarFooter"><div className="status"><span className={online?'dot ok':'dot'}></span>{online?'Online':'Offline'}</div><small>{profile.department}</small><DevicePresence profileId={profile.id}/></div>
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
      <div className="content" ref={contentRef}>
        {section==='overview'&&<Overview setSection={setSection} role={profile.role} profile={profile} assignments={workstationAssignments}/>}
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
        {section==='projects'&&<ProjectManagementModule onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='shared'&&<SharedWorkspacesHub onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='announcements'&&<AnnouncementsModule/>}
        {section==='files'&&<CompanyFilesModule/>}
        {section==='brand'&&<BrandLibrary/>}
        {section==='knowledge'&&<KnowledgeBaseModule/>}
        {section==='social'&&<SocialModule/>}
        {section==='crm'&&<CRMModule/>}
        {section==='executive'&&<ExecutiveTeamWorkspace onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='support'&&<SupportTeamWorkspace execution={<SupportModule/>} onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='engineering'&&<EngineeringTeamWorkspace execution={<Engineering/>} onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='linux'&&<ParasyteLinux/>}
        {section==='people'&&<PeopleTeamWorkspace execution={<PeopleModule/>} onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='operations'&&<OperationsTeamWorkspace execution={<OperationsModule/>} onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='finance'&&<FinanceTeamWorkspace execution={<FinanceModule/>} onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='marketing'&&<MarketingTeamWorkspace onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='partnerships'&&<PartnershipsTeamWorkspace execution={<PartnershipsModule/>} onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
        {section==='legal'&&<LegalTeamWorkspace execution={<LegalModule/>} onNavigate={(target)=>{setWorkspace(null);setSection(target as Section)}}/>}
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

function PasswordRecoveryGate({onDone}:{onDone:()=>void}){
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)

  const updatePassword=async(event:FormEvent)=>{
    event.preventDefault()
    setMessage('')

    if(!supabase){
      setMessage('Authentication service is unavailable.')
      return
    }

    if(password.length<12){
      setMessage('Use a password with at least 12 characters.')
      return
    }

    if(password!==confirm){
      setMessage('The two passwords do not match.')
      return
    }

    setBusy(true)

    try{
      const {error}=await supabase.auth.updateUser({password})
      if(error) throw error
      setMessage('Password updated. Returning to sign in...')
      await supabase.auth.signOut()
      onDone()
    }catch(error){
      setMessage(error instanceof Error ? error.message : 'Unable to update password.')
    }finally{
      setBusy(false)
    }
  }

  return <div className="authPage">
    <div className="authGlass glassPanel">
      <div className="authBrand">
        <BrandLogo className="authLogo"/>
        <span>RideArrivo Internal Workspace</span>
      </div>
      <div className="authCopy">
        <span className="eyebrow">PASSWORD RECOVERY</span>
        <h1>Choose a new password.</h1>
        <p>This recovery session can only be used to update the password for the account that opened the reset link.</p>
      </div>
      <form onSubmit={updatePassword}>
        <label>
          New password
          <input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" required/>
        </label>
        <label>
          Confirm new password
          <input type="password" value={confirm} onChange={event=>setConfirm(event.target.value)} autoComplete="new-password" required/>
        </label>
        {message&&<div className="authMessage">{message}</div>}
        <button className="primaryButton" disabled={busy}>{busy?'Updating...':'Update password'}</button>
      </form>
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

  const sendPasswordReset=async()=>{
    setMessage('')

    if(!supabase){
      setMessage('Authentication service is unavailable.')
      return
    }

    if(!cleanEmail || !validDomain(cleanEmail)){
      setMessage('Enter your approved RideArrivo work email first.')
      return
    }

    setBusy(true)

    try{
      const {error}=await supabase.auth.resetPasswordForEmail(
        cleanEmail,
        {redirectTo:`${window.location.origin}/`}
      )

      if(error) throw error

      setMessage('If this account exists, a password reset link has been sent to the work email address.')
    }catch(error){
      setMessage(error instanceof Error ? error.message : 'Unable to send password reset email.')
    }finally{
      setBusy(false)
    }
  }

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
            {busy?'Please wait...':'Sign in'}
          </button>

          <button
            type="button"
            className="authRecoveryButton"
            disabled={busy}
            onClick={()=>void sendPasswordReset()}
          >
            <KeyRound size={18}/>
            <span>
              <strong>Forgot / Reset Password</strong>
              <small>Send one secure recovery link to your work email</small>
            </span>
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

function Engineering(){
  const copy=(value:string)=>navigator.clipboard.writeText(value)
  const downloadBootstrap=async(key:string)=>{
    if(!supabase) return
    const {data,error}=await supabase.rpc('get_controlled_text_asset',{p_asset_key:key})
    if(error) throw error
    const row=Array.isArray(data)?data[0]:data
    if(!row) throw new Error('Engineering setup asset not found.')
    const blob=new Blob([String(row.content||'')],{type:String(row.mime_type||'text/plain')})
    const url=URL.createObjectURL(blob)
    const anchor=document.createElement('a')
    anchor.href=url
    anchor.download=String(row.file_name||'ridearrivo-setup.txt')
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  }

  return <section>
    <SectionTitle
      eyebrow="ENGINEERING EXECUTION"
      title="Engineering Delivery"
      subtitle="Source control, release execution, APIs, observability and controlled device setup."
      actions={<div className="buttonRow">
        <ControlledDownloadButton resource={{resourceType:'engineering_asset',resourceKey:'macos-bootstrap',resourceName:'RideArrivo macOS engineering setup'}} onGranted={()=>downloadBootstrap('macos-bootstrap')} label="macOS setup"/>
        <ControlledDownloadButton resource={{resourceType:'engineering_asset',resourceKey:'windows-bootstrap',resourceName:'RideArrivo Windows engineering setup'}} onGranted={()=>downloadBootstrap('windows-bootstrap')} label="Windows setup"/>
      </div>}
    />
    <div className="callout glassCard"><Wrench/><div><strong>Managed engineering setup</strong><p>Engineering setup packages remain protected assets. Use the embedded Engineering workbench for VS Code, GitHub and app preview once the Linux gateway is deployed.</p></div></div>
    <div className="grid2">
      <div className="glassCard"><div className="cardHeader"><h3>Engineering tools</h3><span className="pill">Device kit</span></div><div className="compactList tools">{engineers.map(tool=><div key={tool.name}><span><strong>{tool.name}</strong><small>{tool.purpose}</small></span><button className="copyBtn" onClick={()=>copy(tool.mac)} title="Copy macOS command"><Copy size={14}/></button></div>)}</div></div>
      <div className="glassCard"><div className="cardHeader"><h3>Delivery control</h3><span className="pill">In workspace</span></div><div className="toolGrid"><Feature icon={<Code2/>} title="GitHub Engineering" text="Repositories, pull requests and Actions are available through the secure Engineering gateway."/><Feature icon={<Network/>} title="API Centre" text="API contracts, environment endpoints and service health."/><Feature icon={<PackageCheck/>} title="Release Centre" text="Builds, deployments, versions and release approvals."/><Feature icon={<MonitorCog/>} title="Observability" text="Errors, performance, logs and production health."/></div></div>
    </div>
  </section>
}

function WorkspaceView({workspace}:{workspace:Workspace}){
  return <section className="workspace glassCard"><div className="workspaceBar"><div><strong>{workspace.title}</strong><span>{workspace.url}</span></div><span className="pill">Embedded workspace</span></div>{workspace.note&&<div className="embedNote">{workspace.note}</div>}<iframe title={workspace.title} src={workspace.url} sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" referrerPolicy="strict-origin-when-cross-origin"/></section>
}

function SectionTitle({eyebrow,title,subtitle,actions}:{eyebrow:string;title:string;subtitle:string;actions?:ReactNode}){
  return <div className="sectionTitle"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></div>{actions}</div>
}

function Overview({setSection,role,profile,assignments}:{setSection:(s:Section)=>void;role:Role;profile:Profile;assignments:WorkstationAssignment[]}){
  const launchers=[
    ['executive','CEO / Management','Company-wide decisions, approvals, performance, risk and cross-functional control.',Crown],
    ['support','Support','Bookings, riders, live-trip support, safety and service recovery.',Headphones],
    ['operations','Operations','Dispatch, drivers, fleet readiness, airport execution and incidents.',BriefcaseBusiness],
    ['people','People & HR','Recruitment, onboarding, leave, performance and employee operations.',Users],
    ['engineering','Engineering','Source control, releases, environments, observability and secure development.',Code2],
    ['finance','Finance','Accounting, banking, Paystack, Flutterwave, budgets and close.',CircleDollarSign],
    ['marketing','Marketing','Campaigns, content, growth analytics, brand and acquisition.',BarChart3],
    ['partnerships','Partnerships','Partner CRM, pipeline, agreements, referrals and performance.',Building2],
    ['legal','Legal','Contracts, privacy, compliance, regulation and evidence.',Scale],
    ['admin','Administration','Identity, workstation assignment, KPI oversight, files and security controls.',Settings],
  ] as const

  return <>
    <PersonalDashboard
      profile={profile}
      assignments={assignments}
      onNavigate={target=>setSection(target as Section)}
    />
    <OverviewMetrics role={role}/>
    <section>
      <SectionTitle eyebrow="WORKSPACE OVERVIEW" title="Your authorised command centres" subtitle="Open the departments and control surfaces assigned to your role or primary workstation."/>
      <div className="grid3">
        {launchers.filter(([id])=>canAccess(role,id,assignments)).map(([id,title,text,Icon])=><Launch key={id} title={title} text={text} icon={<Icon/>} onClick={()=>setSection(id)}/>)}
      </div>
    </section>
  </>
}

function Metric({icon,label,value,hint}:{icon:ReactNode;label:string;value:string;hint:string}){return <div className="metric glassCard"><div className="metricIcon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></div>}
function Feature({icon,title,text}:{icon:ReactNode;title:string;text:string}){return <div className="glassCard feature"><div className="iconBox">{icon}</div><h3>{title}</h3><p>{text}</p></div>}
function Launch({title,text,icon,onClick}:{title:string;text:string;icon:ReactNode;onClick:()=>void}){return <button className="launch glassCard" onClick={onClick}><div className="iconBox">{icon}</div><div><strong>{title}</strong><p>{text}</p></div><ChevronRight/></button>}
function StatusPill({value}:{value:string}){return <span className={`statusPill ${value.toLowerCase().replace(/\s+/g,'-')}`}>{value}</span>}
function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(v=>v[0]?.toUpperCase()).join('') || 'RA'}

export default App
