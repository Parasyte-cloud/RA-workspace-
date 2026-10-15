import {
  Suspense } from 'react'
import { useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from 'react'
import type { FormEvent,
  ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Archive,
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
  MessagesSquare,
  MonitorCog,
  Network,
  PackageCheck,
  Route,
  Scale,
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
  Video,
  Wrench,
  Images,
  FileSignature,
  Globe2,
  Star,
  Menu as MenuIcon,
  X as CloseIcon
} from 'lucide-react'
import PhoneNav from './modules/PhoneNav'
import { NotificationSettings } from './modules/NotificationSettings'
import { supabase,
  supabaseConfigured,
  initialAuthLink } from './lib/supabase'
import { describeSignInError, trimmedRetry } from './lib/authLink'
import { resolveEmployeeAvatarUrl } from './lib/employeeAvatar'






import { NotificationCenter } from './components/NotificationCenter'
import CallRinger from './modules/CallRinger'
import CallModule from './modules/CallModule'
import EventReminders from './modules/EventReminders'
import BirthdayCelebration from './modules/BirthdayCelebration'
import { NotificationsProvider } from './context/NotificationsContext'
import { GlobalSearch } from './components/GlobalSearch'
import {
  buildSidebar,
  DEFAULT_FAVOURITES,
  favouritesKey,
  MAX_FAVOURITES,
  MAX_RECENT,
  pushRecent,
  readList,
  recentKey,
  sanitizeIds,
  toggleFavourite,
  writeList,
} from './lib/workspaceNav'
import { useIdleSignOut } from './lib/useIdleSignOut'

import { HeaderAvatar } from './components/HeaderAvatar'
import ControlledDownloadButton from './components/ControlledDownloadButton'
import PersonalDashboard from './modules/PersonalDashboard'
import DevicePresence from './components/DevicePresence'
import RouteErrorBoundary from './components/RouteErrorBoundary'


import { WorkspaceClock } from './components/WorkspaceClock'



import { applyStoredAppearance } from './lib/appearance'
import { LETTERHEAD_ROLES } from './lib/letterheadAccess'

import { PARASYTE_OPEN_EVENT } from './lib/parasyte'
import type { ParasyteOpenDetail } from './lib/parasyte'
import {
  MarketingTeamWorkspace,
  BrandLibrary,
  LetterheadStudio,
  ParasyteLinux,
  ParasyteBrowser,
  SupportWorkspaceRoute,
  OperationsTeamWorkspace,
  PeopleTeamWorkspace,
  EngineeringTeamWorkspace,
  ExecutiveTeamWorkspace,
  FinanceTeamWorkspace,
  PartnershipsTeamWorkspace,
  LegalTeamWorkspace,
  PeopleModule,
  OperationsModule,
  FinanceModule,
  PartnershipsModule,
  LegalModule,
  MailModule,
  ChatModule,
  RoomModule,
  ArchiveModule,
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
  VendorsPanel,
  OverviewMetrics,
  HeadshotGallery,
  AppearanceSettings,
  SharedWorkspacesHub,
  DepartmentAdminView,
  BlogStudio
} from './lazy-routes'

applyStoredAppearance()

type Section = 'profile'|'gallery'|'overview'|'social'|'chat'|'room'|'mail'|'announcements'|'calendar'|'tasks'|'projects'|'shared'|'files'|'archive'|'brand'|'knowledge'|'crm'|'support'|'engineering'|'linux'|'people'|'operations'|'finance'|'marketing'|'partnerships'|'legal'|'executive'|'admin'|'apps'|'parasyte'|'settings'|'workspace'|'vendors'|'letterhead'|'deptadmin'|'blog'
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
  room:allWorkspaceRoles,
  mail:allWorkspaceRoles,
  announcements:allWorkspaceRoles,
  calendar:allWorkspaceRoles,
  tasks:allWorkspaceRoles,
  projects:allWorkspaceRoles,
  shared:allWorkspaceRoles,
  files:allWorkspaceRoles,
  archive:allWorkspaceRoles,
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
    'operations',
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

  letterhead:[...LETTERHEAD_ROLES],
  blog:['admin'],

  // Department heads reach it through a grant; People & HR see everyone.
  deptadmin:['hr'],

  vendors:[
    'operations',
    'finance',
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
  chat:[
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
  vendors:'operations',
  people:'people',
  engineering:'engineering',
  linux:'engineering',
  finance:'finance',
  marketing:'marketing',
  partnerships:'partnerships',
  legal:'legal',
  executive:'executive',
  admin:'administration',
  letterhead:'letterhead',
  blog:'blog',
  deptadmin:'deptadmin',
}

const canAccess=(role:Role,section:Section,assignments:WorkstationAssignment[]=[])=>{
  if(sectionAccess[section]?.includes(role)===true) return true
  const workstation=workstationForSection[section]
  return Boolean(workstation && assignments.some(item=>item.active && item.workstation===workstation))
}

type WorkspaceHistoryState = {
  ridearrivoWorkspace?: boolean
  section?: Section
  workspace?: Workspace | null
}

const LAST_SECTION_KEY='ridearrivo-last-section'

const isSection=(value:unknown):value is Section=>
  typeof value==='string' &&
  Object.prototype.hasOwnProperty.call(sectionAccess,value)

const workspaceFromHistory=(value:unknown):Workspace|null=>{
  if(!value || typeof value!=='object') return null
  const state=value as WorkspaceHistoryState
  const candidate=state.workspace
  if(!candidate || typeof candidate!=='object') return null
  if(typeof candidate.title!=='string' || typeof candidate.url!=='string'){
    return null
  }
  if(candidate.note!==undefined && typeof candidate.note!=='string'){
    return null
  }
  try{
    const parsed=new URL(candidate.url,window.location.origin)
    if(parsed.protocol!=='http:' && parsed.protocol!=='https:') return null
  }catch{
    return null
  }
  return candidate
}

const initialSection=():Section=>{
  const requested=
    new URLSearchParams(window.location.search).get('section')
  let candidate:unknown=requested
  if(!isSection(candidate)){
    try{
      candidate=window.localStorage.getItem(LAST_SECTION_KEY)
    }catch{
      candidate=null
    }
  }
  if(!isSection(candidate)) return 'overview'
  if(candidate==='workspace'&&!workspaceFromHistory(window.history.state)){
    return 'overview'
  }
  return candidate
}

const sectionUrl=(section:Section)=>{
  const url=new URL(window.location.href)
  url.searchParams.set('section',section)
  if(section!=='room'){
    url.searchParams.delete('room')
  }
  url.hash=''
  return `${url.pathname}${url.search}`
}

const routeKey=(section:Section,workspace:Workspace|null)=>
  section==='workspace'
    ? `workspace:${workspace?.title||''}:${workspace?.url||''}`
    : section


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
  // Arriving from an invite or reset email means a password must be chosen.
  const [passwordRecovery,setPasswordRecovery]=useState(initialAuthLink.kind==='invite' || initialAuthLink.kind==='recovery')
  const [passwordMode,setPasswordMode]=useState<'recovery'|'invite'>(initialAuthLink.kind==='invite' ? 'invite' : 'recovery')
  const [confirmLink,setConfirmLink]=useState(initialAuthLink.kind==='confirm' ? initialAuthLink : null)
  const [passwordSaved,setPasswordSaved]=useState(false)


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
  const [assignmentsReady,setAssignmentsReady]=useState(false)
  const [section,setSection]=useState<Section>(initialSection)
  const [workspace,setWorkspace]=useState<Workspace|null>(()=>{
    return initialSection()==='workspace'
      ? workspaceFromHistory(window.history.state)
      : null
  })
  const [openNavGroup,setOpenNavGroup]=useState<string|null>(null)
  const [phoneMenuOpen,setPhoneMenuOpen]=useState(false)
  const [mediumNavExpanded,setMediumNavExpanded]=useState(false)
  const contentRef=useRef<HTMLDivElement|null>(null)
  const roomReturnSectionRef=useRef<Section>('overview')
  const historyReadyRef=useRef(false)
  const lastRouteKeyRef=useRef('')

  useEffect(()=>{
    if(section!=='room'&&section!=='workspace'){
      roomReturnSectionRef.current=section
    }
  },[section])

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




  const navigateToSection=useCallback((target:string)=>{
    setWorkspace(null)
    setSection(target as Section)
  },[])
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
            setPasswordMode('recovery')
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
        date_of_birth,
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

  // A person invited by email gets signed in by the link but is never asked
  // for a password. Ask now, so they can sign in tomorrow without a reset.
  useEffect(()=>{
    const client=supabase
    const userId=session?.user?.id
    if(!client || !userId || passwordRecovery)return
    let cancelled=false
    void client.rpc('my_account_has_password').then(({data,error})=>{
      if(cancelled || error)return
      if(data===false){
        setPasswordMode('invite')
        setPasswordRecovery(true)
      }
    })
    return()=>{cancelled=true}
  },[session?.user?.id])

  useEffect(()=>{
    void loadProfile()
  },[
    session?.user?.id
  ])

  useEffect(()=>{
    const client=supabase
    if(!client || accessState!=='approved' || !profile.id){
      setWorkstationAssignments([])
      setAssignmentsReady(false)
      return
    }

    let cancelled=false
    setAssignmentsReady(false)

    // A letterhead grant (set by an administrator) is carried as a
    // pseudo assignment so canAccess treats it like any other workstation.
    // A missing table or failed lookup simply means no extra access.
    void Promise.all([
      client
        .from('workspace_workstation_assignments')
        .select('workstation,is_primary,active')
        .eq('employee_id',profile.id)
        .eq('active',true),
      client
        .from('workspace_letterhead_access')
        .select('employee_id')
        .eq('employee_id',profile.id)
        .maybeSingle(),
      // Kept as its own query on purpose: if the head-of-department column is
      // not there yet, only this lookup fails and every other workstation
      // still loads.
      client
        .from('workspace_workstation_assignments')
        .select('is_head')
        .eq('employee_id',profile.id)
        .eq('active',true)
        .eq('is_head',true),
      // Individual blog permissions, never inferred from a department role.
      client.rpc('workspace_blog_identity'),
    ]).then(([{data,error},grant,heads,blogIdentity])=>{
        if(cancelled) return
        const blogGrant:WorkstationAssignment[]=!blogIdentity.error && blogIdentity.data?.active===true && (['writer','editor','blog_admin'].includes(blogIdentity.data?.role) || blogIdentity.data?.can_manage_access===true)
          ? [{workstation:'blog',is_primary:false,active:true}] : []
        const letterheadGrant:WorkstationAssignment[]=grant.data
          ? [{workstation:'letterhead',is_primary:false,active:true}]
          : []
        if(error){
          console.error('[RideArrivo Workstation] assignment load failed',error)
          setWorkstationAssignments([...letterheadGrant,...blogGrant])
          setAssignmentsReady(true)
          return
        }

        // A head of department also gets the scoped Department Admin view.
        const headGrant:WorkstationAssignment[]=!heads.error && (heads.data || []).length>0
          ? [{workstation:'deptadmin',is_primary:false,active:true}]
          : []
        setWorkstationAssignments([...((data || []) as WorkstationAssignment[]),...letterheadGrant,...headGrant,...blogGrant])
        setAssignmentsReady(true)
      })

    return ()=>{
      cancelled=true
    }
  },[accessState,profile.id])


  useEffect(()=>{
    if(accessState!=='approved'||!assignmentsReady){
      historyReadyRef.current=false
      return
    }

    let target=section
    let nextWorkspace=workspace

    if(target==='workspace'&&!nextWorkspace){
      target='overview'
    }

    if(!canAccess(profile.role,target,workstationAssignments)){
      target='overview'
      nextWorkspace=null
    }

    historyReadyRef.current=true
    lastRouteKeyRef.current=routeKey(target,nextWorkspace)

    try{
      window.localStorage.setItem(LAST_SECTION_KEY,target)
    }catch{
      // URL history remains authoritative when storage is unavailable.
    }

    window.history.replaceState(
      {
        ridearrivoWorkspace:true,
        section:target,
        workspace:nextWorkspace
      } satisfies WorkspaceHistoryState,
      '',
      sectionUrl(target)
    )

    if(target!==section) setSection(target)
    if(nextWorkspace!==workspace) setWorkspace(nextWorkspace)
  },[
    accessState,
    assignmentsReady,
    profile.role,
    workstationAssignments
  ])

  useEffect(()=>{
    if(
      accessState!=='approved' ||
      !assignmentsReady ||
      !historyReadyRef.current
    ){
      return
    }

    if(!canAccess(profile.role,section,workstationAssignments)){
      lastRouteKeyRef.current=routeKey('overview',null)
      window.history.replaceState(
        {
          ridearrivoWorkspace:true,
          section:'overview',
          workspace:null
        } satisfies WorkspaceHistoryState,
        '',
        sectionUrl('overview')
      )
      setWorkspace(null)
      setSection('overview')
      return
    }

    if(section==='workspace'&&!workspace){
      lastRouteKeyRef.current=routeKey('overview',null)
      window.history.replaceState(
        {
          ridearrivoWorkspace:true,
          section:'overview',
          workspace:null
        } satisfies WorkspaceHistoryState,
        '',
        sectionUrl('overview')
      )
      setSection('overview')
      return
    }

    const key=routeKey(section,workspace)
    if(lastRouteKeyRef.current===key) return

    lastRouteKeyRef.current=key
    try{
      window.localStorage.setItem(LAST_SECTION_KEY,section)
    }catch{
      // URL history remains authoritative when storage is unavailable.
    }

    window.history.pushState(
      {
        ridearrivoWorkspace:true,
        section,
        workspace
      } satisfies WorkspaceHistoryState,
      '',
      sectionUrl(section)
    )
  },[
    section,
    workspace,
    accessState,
    assignmentsReady,
    profile.role,
    workstationAssignments
  ])

  useEffect(()=>{
    if(accessState!=='approved'||!assignmentsReady) return

    const onPopState=(event:PopStateEvent)=>{
      const state=
        event.state && typeof event.state==='object'
          ? event.state as WorkspaceHistoryState
          : null
      const fromUrl=
        new URLSearchParams(window.location.search).get('section')

      let target:Section=
        isSection(state?.section)
          ? state.section
          : isSection(fromUrl)
            ? fromUrl
            : 'overview'

      let nextWorkspace=
        target==='workspace'
          ? workspaceFromHistory(state)
          : null

      if(target==='workspace'&&!nextWorkspace){
        target='overview'
      }

      if(!canAccess(profile.role,target,workstationAssignments)){
        target='overview'
        nextWorkspace=null
      }

      lastRouteKeyRef.current=routeKey(target,nextWorkspace)
      try{
        window.localStorage.setItem(LAST_SECTION_KEY,target)
      }catch{
        // Back/forward still works without local storage.
      }

      setWorkspace(nextWorkspace)
      setSection(target)

      if(
        state?.ridearrivoWorkspace!==true ||
        state.section!==target
      ){
        window.history.replaceState(
          {
            ridearrivoWorkspace:true,
            section:target,
            workspace:nextWorkspace
          } satisfies WorkspaceHistoryState,
          '',
          sectionUrl(target)
        )
      }
    }

    window.addEventListener('popstate',onPopState)
    return ()=>window.removeEventListener('popstate',onPopState)
  },[
    accessState,
    assignmentsReady,
    profile.role,
    workstationAssignments
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
      ['overview','Dashboard',Home],['profile','My Profile',UserCog],['gallery','My Headshots',Images],['chat','Chat',MessagesSquare],['room','ROOM 7',Video],['social','Pulse',Bell],['mail','Mail',Mail],['calendar','Calendar',CalendarDays],['tasks','Tasks',ListChecks],['projects','Projects',FolderKanban],['announcements','Announcements',Bell],['files','Company Files',FileText],['archive','Archive',Archive],['brand','Brand Library',Images],['letterhead','Letterhead',FileSignature],['blog','Blog Studio',BookOpen],['knowledge','Knowledge Base',BookOpen],['crm','CRM',ContactRound],['executive','CEO / Management',Crown],['support','Support',Headphones],['operations','Operations',BriefcaseBusiness],['people','People & HR',Users],['engineering','Engineering',Code2],['linux','ParAsYtE Linux',TerminalSquare],['finance','Finance',CircleDollarSign],['vendors','Vendors',PackageCheck],['marketing','Marketing',BarChart3],['deptadmin','Department Admin',Users],['partnerships','Partnerships',Building2],['legal','Legal',Scale],['parasyte','PArAsYtE',Globe2],['apps','Applications',AppWindow],['settings','Settings',Settings],['admin','Administration',Settings]
    ] as const
    return items.filter(([id])=>canAccess(profile.role,id,workstationAssignments))
  },[profile.role,workstationAssignments])

  const validNavIds=useMemo(()=>new Set<string>(nav.map(item=>item[0])),[nav])

  const primarySection=useMemo(()=>{
    const primary=workstationAssignments.find(item=>item.active&&item.is_primary)
    if(!primary) return null
    const entry=Object.entries(workstationForSection).find(([,workstation])=>workstation===primary.workstation)
    return entry?entry[0]:null
  },[workstationAssignments])

  const userId=session?.user?.id||''
  const [favouriteIds,setFavouriteIds]=useState<string[]>([...DEFAULT_FAVOURITES])
  const [recentIds,setRecentIds]=useState<string[]>([])

  useEffect(()=>{
    if(!userId) return
    const stored=readList(favouritesKey(userId))
    setFavouriteIds(stored===null?[...DEFAULT_FAVOURITES]:stored)
    setRecentIds(readList(recentKey(userId))||[])
  },[userId])

  const favourites=useMemo(()=>sanitizeIds(favouriteIds,validNavIds,MAX_FAVOURITES),[favouriteIds,validNavIds])
  const recentSections=useMemo(()=>sanitizeIds(recentIds,validNavIds,MAX_RECENT),[recentIds,validNavIds])

  const toggleNavFavourite=(id:string)=>{
    const next=toggleFavourite(favourites,id,validNavIds)
    setFavouriteIds(next)
    if(userId) writeList(favouritesKey(userId),next)
  }

  useEffect(()=>{
    if(!userId||section==='workspace'||!validNavIds.has(section)) return
    setRecentIds(current=>{
      const next=pushRecent(current,section)
      writeList(recentKey(userId),next)
      return next
    })
  },[section,userId,validNavIds])

  const groupedNav=useMemo(
    ()=>buildSidebar(nav,{primarySection,favourites}),
    [nav,primarySection,favourites]
  )

  const activeGroupId=useMemo(
    ()=>groupedNav.groups.find(group=>group.items.some(([id])=>id===section))?.id||null,
    [section,groupedNav]
  )

  useEffect(()=>{
    if(activeGroupId){
      setOpenNavGroup(activeGroupId)
    }
  },[section,activeGroupId])

  useEffect(()=>{setPhoneMenuOpen(false)},[section])

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
  if(confirmLink) return <ConfirmLinkGate link={confirmLink} onDone={()=>setConfirmLink(null)}/>
  if(!session) return <AuthGate
    notice={passwordSaved ? 'Password saved. Sign in with your work email and the new password.' : ''}
    linkProblem={initialAuthLink.kind==='error' ? initialAuthLink.message : ''}
  />
  if(passwordRecovery) return <PasswordRecoveryGate
    mode={passwordMode}
    onDone={()=>{setPasswordRecovery(false);setPasswordSaved(true)}}
  />

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

  if(accessState==='approved'&&!assignmentsReady){
    return <div className="splash"><BrandLogo className="splashLogo"/><div className="spinner"/></div>
  }

  const renderNavRow=([id,label,Icon]:typeof nav[number])=>{
    const starred=favourites.includes(id)
    return <div key={id} className={`sidebarNavRow${starred?' starred':''}`}>
      <button type="button" className={`sidebarNavItem uiFocusRing ${section===id?'active':''}`} aria-current={section===id?'page':undefined} title={label} onClick={()=>{setSection(id);setWorkspace(null);setMediumNavExpanded(false)}}><Icon size={18}/><span>{label}</span></button>
      <button
        type="button"
        className="sidebarNavStar uiFocusRing"
        aria-pressed={starred}
        aria-label={starred?`Remove ${label} from favourites`:`Add ${label} to favourites`}
        title={starred?'Remove from favourites':'Add to favourites'}
        onClick={()=>toggleNavFavourite(id)}
      ><Star size={12}/></button>
    </div>
  }

  return <NotificationsProvider><div className="appBackground"><div className={`shell glassFrame glassSurface${mediumNavExpanded?' mediumNavExpanded':''}`}>
    <aside className="sidebar glassPanel glassNav">
      <div className="brand"><BrandLogo className="sidebarLogo"/><span>RideArrivo Internal</span></div>
      <nav className="sidebarNav" aria-label="Workspace navigation">
        <div className="sidebarNavPrimary">
          {groupedNav.pinned.map(renderNavRow)}
        </div>
        {groupedNav.favourites.length>0&&<div className="sidebarNavPrimary sidebarNavSection" aria-label="Favourites">
          <span className="sidebarNavLabel">Favourites</span>
          {groupedNav.favourites.map(renderNavRow)}
        </div>}
        {groupedNav.mine.length>0&&<div className="sidebarNavPrimary sidebarNavSection" aria-label="My workstation">
          <span className="sidebarNavLabel">My workstation</span>
          {groupedNav.mine.map(renderNavRow)}
        </div>}
        <div className="sidebarNavGroups">
          {groupedNav.groups.map(group=>{
            const isOpen=openNavGroup===group.id
            return <div key={group.id} className={`sidebarNavGroup ${isOpen?'open':''}`}>
              <button type="button" className="sidebarNavGroupToggle uiFocusRing" aria-label={`${isOpen?'Collapse':'Expand'} ${group.label}`} title={group.label} aria-expanded={isOpen} onClick={()=>setOpenNavGroup(current=>current===group.id?null:group.id)}>
                <span>{group.label}</span><ChevronRight size={14}/>
              </button>
              <div className="sidebarNavGroupItems">
                {group.items.map(renderNavRow)}
              </div>
            </div>
          })}
        </div>
        <div className="sidebarNavSystem">
          {groupedNav.system.map(renderNavRow)}
        </div>
      </nav>
      <div className="sidebarFooter"><div className="status"><span className={online?'dot ok':'dot'}></span>{online?'Online':'Offline'}</div><small>{profile.department}</small><DevicePresence profileId={profile.id}/></div>
    </aside>
    <PhoneNav
      nav={nav}
      groups={groupedNav}
      section={section}
      open={phoneMenuOpen}
      onOpenChange={setPhoneMenuOpen}
      onPick={id=>{setSection(id as Section);setWorkspace(null);setPhoneMenuOpen(false)}}
      onSignOut={()=>{setPhoneMenuOpen(false);void signOut()}}
    />
    <main className="workspaceMain">
      <header className="topbar glassPanel glassSurface">
        <button
          type="button"
          className="mediumNavToggle iconButton uiFocusRing"
          aria-label={mediumNavExpanded ? 'Collapse navigation' : 'Expand navigation'}
          aria-expanded={mediumNavExpanded}
          onClick={()=>setMediumNavExpanded(current=>!current)}
        >
          {mediumNavExpanded?<CloseIcon size={18}/>:<MenuIcon size={18}/>}
        </button>
        <div className="topbarTitle"><h1>{section==='workspace'&&workspace?workspace.title:nav.find(n=>n[0]===section)?.[1]||'Workspace'}</h1></div><div className="headerActions"><WorkspaceClock/><GlobalSearch sections={nav.map(([id,label])=>({id,label}))} recent={recentSections} onNavigate={target=>{setSection(target as Section);setWorkspace(null)}}/><NotificationCenter
  onOpenWork={()=>{
    setSection('tasks')
  }}
  onOpenSection={target=>{
    setSection(target as Section)
    setWorkspace(null)
  }}
/>{deferredPrompt&&<button className="glassButton" onClick={install}><Download size={16}/>Install</button>}<div className="profileMenuWrap">
  <button
    type="button"
    className="profileButton uiFocusRing"
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
      {groupedNav.menu.map(([id,label])=><button
        key={id}
        type="button"
        role="menuitem"
        onClick={()=>{
          setProfileMenuOpen(false)
          setWorkspace(null)
          setSection(id)
        }}
      >
        {label}
      </button>)}

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
      <div className="content workspaceContent" ref={contentRef}>
      {/* ROOM 7 sits outside the per-section loading and error boundaries.
          Inside them, loading another section could hide the call and a
          crash in any section would tear it down, ending the meeting. */}
      <CallRinger/>
      <RouteErrorBoundary resetKey="calls">
        <CallModule/>
      </RouteErrorBoundary>
      <EventReminders/>
      <BirthdayCelebration/>
      <RouteErrorBoundary resetKey="room7">
        <Suspense fallback={null}>
          <RoomModule
            active={section==='room'}
            onOpen={()=>{setSection('room');setWorkspace(null)}}
            onMinimize={()=>{setSection(roomReturnSectionRef.current);setWorkspace(null)}}
          />
        </Suspense>
      </RouteErrorBoundary>
      <RouteErrorBoundary resetKey={`${section}:${workspace?.url || ''}`}>
        <Suspense
          fallback={
            <div className="routeLoading glassCard">
              <span className="routeLoadingSpinner"/>
              <strong>Opening workspace...</strong>
              <small>Loading only the tools required for this section.</small>
            </div>
          }
        >
        {section==='overview'&&<Overview setSection={setSection} role={profile.role} profile={profile} assignments={workstationAssignments}/>}
        {section==='profile'&&
          <ProfileModule
            profile={profile}
            onProfileUpdated={loadProfile}
          />
        }
        {section==='gallery'&&<HeadshotGallery/>}
        {section==='chat'&&<ChatModule/>}
        {section==='mail'&&<MailModule/>}
        {section==='calendar'&&<CalendarModule/>}
        {section==='tasks'&&<WorkDesk/>}
        {section==='projects'&&<ProjectManagementModule onNavigate={navigateToSection}/>}
        {section==='shared'&&<SharedWorkspacesHub onNavigate={navigateToSection}/>}
        {section==='announcements'&&<AnnouncementsModule/>}
        {section==='files'&&<CompanyFilesModule/>}
        {section==='archive'&&<ArchiveModule/>}
        {section==='brand'&&<BrandLibrary/>}
        {section==='letterhead'&&<LetterheadStudio role={profile.role} fullName={profile.full_name} jobTitle={profile.job_title} email={profile.email} granted={workstationAssignments.some(item=>item.active && item.workstation==='letterhead')}/>}
        {section==='blog'&&<BlogStudio/>}
        {section==='knowledge'&&<KnowledgeBaseModule/>}
        {section==='social'&&<SocialModule/>}
        {section==='crm'&&<CRMModule/>}
        {section==='executive'&&<ExecutiveTeamWorkspace onNavigate={navigateToSection}/>}
        {section==='support'&&<SupportWorkspaceRoute onNavigate={navigateToSection}/>}
        {section==='engineering'&&<EngineeringTeamWorkspace execution={<Engineering/>} onNavigate={navigateToSection}/>}
        {section==='linux'&&<ParasyteLinux/>}
        {section==='people'&&<PeopleTeamWorkspace execution={<PeopleModule accessMode={profile.role==='operations'?'operations':'full'}/>} onNavigate={navigateToSection}/>}
        {section==='operations'&&<OperationsTeamWorkspace execution={<OperationsModule/>} onNavigate={navigateToSection}/>}
        {section==='vendors'&&<VendorsPanel/>}
        {section==='finance'&&<FinanceTeamWorkspace execution={<FinanceModule/>} onNavigate={navigateToSection}/>}
        {section==='marketing'&&<MarketingTeamWorkspace onNavigate={navigateToSection}/>}
        {section==='partnerships'&&<PartnershipsTeamWorkspace execution={<PartnershipsModule/>} onNavigate={navigateToSection}/>}
        {section==='legal'&&<LegalTeamWorkspace execution={<LegalModule/>} onNavigate={navigateToSection}/>}
        {section==='settings'&&<><AppearanceSettings/><NotificationSettings onSignOut={()=>void signOut()}/></>}
        {section==='admin'&&<AdminModule/>}
        {section==='deptadmin'&&<DepartmentAdminView onNavigate={navigateToSection}/>}
        {section==='parasyte'&&<ParasyteBrowser initialUrl={parasyteUrl}/>}
        {section==='apps'&&<ApplicationsHub/>}
        {section==='workspace'&&workspace&&<WorkspaceView workspace={workspace}/>}
        </Suspense>
      </RouteErrorBoundary>
      </div>
</main>
  </div></div></NotificationsProvider>
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

function PasswordRecoveryGate({onDone,mode}:{onDone:()=>void;mode:'recovery'|'invite'}){
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [reveal,setReveal]=useState(false)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const invite=mode==='invite'

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
      setMessage('Password saved. Taking you to sign in...')
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
        <span className="eyebrow">{invite?'WELCOME TO RIDEARRIVO':'PASSWORD RECOVERY'}</span>
        <h1>{invite?'Create your password.':'Choose a new password.'}</h1>
        <p>{invite
          ? 'Your invitation signed you in, but your account has no password yet. Choose one now so you can sign in any time.'
          : 'This recovery session can only be used to update the password for the account that opened the reset link.'}</p>
      </div>
      <form onSubmit={updatePassword}>
        <label>
          New password
          <input type={reveal?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} required/>
        </label>
        <label>
          Confirm new password
          <input type={reveal?'text':'password'} value={confirm} onChange={event=>setConfirm(event.target.value)} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} required/>
        </label>
        <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px'}}>
          <input type="checkbox" checked={reveal} onChange={event=>setReveal(event.target.checked)} style={{width:'auto'}}/>
          Show the password so I can check what I typed
        </label>
        <small>At least 12 characters. A few random words joined together works well.</small>
        {message&&<div className="authMessage">{message}</div>}
        <button className="primaryButton" disabled={busy}>{busy?'Saving...':(invite?'Save password':'Update password')}</button>
      </form>
    </div>
  </div>
}

// Links opened by mail scanners use up one-time tokens. This page makes the
// person press a button, so only a real click spends the link.
function ConfirmLinkGate({link,onDone}:{link:{tokenHash:string;type:'recovery'|'invite'|'signup'|'email'};onDone:()=>void}){
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const invite=link.type==='invite' || link.type==='signup'

  const proceed=async()=>{
    if(!supabase){
      setMessage('Authentication service is unavailable.')
      return
    }
    setBusy(true)
    setMessage('')
    const {error}=await supabase.auth.verifyOtp({token_hash:link.tokenHash,type:link.type})
    setBusy(false)
    if(error){
      setMessage('That link has expired or was already used. Go back to sign in and press Forgot / Reset Password for a fresh one.')
      return
    }
    // Remove the token from the address bar so a refresh does not reuse it.
    window.history.replaceState(null,'',window.location.pathname)
    onDone()
  }

  return <div className="authPage">
    <div className="authGlass glassPanel">
      <div className="authBrand">
        <BrandLogo className="authLogo"/>
        <span>RideArrivo Internal Workspace</span>
      </div>
      <div className="authCopy">
        <span className="eyebrow">{invite?'WELCOME TO RIDEARRIVO':'PASSWORD RECOVERY'}</span>
        <h1>{invite?'Accept your invitation.':'Ready to reset your password?'}</h1>
        <p>Press the button to continue. You will choose your password on the next screen.</p>
      </div>
      <div>
        {message&&<div className="authMessage">{message}</div>}
        <button className="primaryButton" disabled={busy} onClick={()=>void proceed()}>{busy?'Please wait...':'Continue'}</button>
        <button type="button" className="authRecoveryButton" onClick={()=>{window.history.replaceState(null,'',window.location.pathname);onDone()}}>
          <span><strong>Back to sign in</strong></span>
        </button>
      </div>
    </div>
  </div>
}

function AuthGate({notice='',linkProblem=''}:{notice?:string;linkProblem?:string}){

  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [message,setMessage]=useState(linkProblem)
  const [reveal,setReveal]=useState(false)
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
      let {error}=await supabase.auth.signInWithPassword({
        email:cleanEmail,
        password
      })

      // A pasted password often carries a trailing space or line break.
      const retryWith=error ? trimmedRetry(password) : null
      if(error && retryWith){
        const second=await supabase.auth.signInWithPassword({email:cleanEmail,password:retryWith})
        error=second.error
      }

      if(error){
        setMessage(describeSignInError(error))
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
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>

          <label>
            Password
            <input
              type={reveal?'text':'password'}
              value={password}
              onChange={e=>setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>

          <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12px',margin:'-4px 0 8px'}}>
            <input type="checkbox" checked={reveal} onChange={e=>setReveal(e.target.checked)} style={{width:'auto'}}/>
            Show password
          </label>

          {notice&&!message&&<div className="authMessage" role="status">{notice}</div>}

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
  return <>
    <PersonalDashboard
      profile={profile}
      assignments={assignments}
      onNavigate={target=>setSection(target as Section)}
    />
    <OverviewMetrics role={role}/>
  </>
}

function Metric({icon,label,value,hint}:{icon:ReactNode;label:string;value:string;hint:string}){return <div className="metric glassCard"><div className="metricIcon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></div>}
function Feature({icon,title,text}:{icon:ReactNode;title:string;text:string}){return <div className="glassCard feature"><div className="iconBox">{icon}</div><h3>{title}</h3><p>{text}</p></div>}
function StatusPill({value}:{value:string}){return <span className={`statusPill ${value.toLowerCase().replace(/\s+/g,'-')}`}>{value}</span>}
function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(v=>v[0]?.toUpperCase()).join('') || 'RA'}

export default App
