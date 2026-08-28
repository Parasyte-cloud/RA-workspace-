import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  FolderKanban,
  LineChart,
  Link2,
  Mail,
  Megaphone,
  MessageSquareText,
  PenTool,
  Plus,
  RefreshCw,
  Search,
  Send,
  Target,
  Telescope,
  UserPlus,
  UsersRound,
  X
} from 'lucide-react'

import { supabase } from '../lib/supabase'

import {
  MarketingModule
} from './BusinessModules'

import '../marketing-workspace.css'


type Profile={
  id:string
  full_name:string
  email:string
  role:string
  department:string|null
  job_title:string|null
  avatar_url:string|null
}

type Space={
  id:string
  name:string
  description:string|null
  space_type:
    | 'department'
    | 'project'
    | 'cross_department'
  home_department:string|null
  created_by:string
  created_at:string
}

type Invite={
  id:string
  space_id:string
  inviter_id:string
  invitee_id:string
  message:string|null
  status:string
  created_at:string
}

type Message={
  id:string
  space_id:string
  author_id:string
  body:string
  created_at:string
  updated_at:string
}

type View=
  | 'team'
  | 'projects'
  | 'discussion'
  | 'digital'
  | 'strategy'
  | 'execution'

const digitalTools=[
  {
    name:'Google Ads',
    category:'Paid acquisition',
    url:'https://ads.google.com/',
    note:'Search, display and campaign acquisition.'
  },
  {
    name:'Google Analytics',
    category:'Analytics',
    url:'https://analytics.google.com/',
    note:'Traffic, events, funnels and conversion analysis.'
  },
  {
    name:'Search Console',
    category:'SEO',
    url:'https://search.google.com/search-console/',
    note:'Organic search performance and indexing.'
  },
  {
    name:'Meta Business Suite',
    category:'Social',
    url:'https://business.facebook.com/',
    note:'Facebook and Instagram publishing and performance.'
  },
  {
    name:'Google Trends',
    category:'Research',
    url:'https://trends.google.com/',
    note:'Demand signals, seasonality and topic discovery.'
  },
  {
    name:'PageSpeed Insights',
    category:'Landing pages',
    url:'https://pagespeed.web.dev/',
    note:'Landing-page performance and Core Web Vitals.'
  },
  {
    name:'Canva',
    category:'Creative',
    url:'https://www.canva.com/',
    note:'Social, campaign and presentation creative.'
  }
]

const strategyTools=[
  {
    name:'Google Trends',
    category:'Market intelligence',
    url:'https://trends.google.com/',
    note:'Audience demand, seasonality and category movement.'
  },
  {
    name:'Meta Ad Library',
    category:'Competitor research',
    url:'https://www.facebook.com/ads/library/',
    note:'Review active competitor and category advertising.'
  },
  {
    name:'Think with Google',
    category:'Consumer insight',
    url:'https://www.thinkwithgoogle.com/',
    note:'Research, behaviour and strategic marketing insight.'
  },
  {
    name:'Search Console',
    category:'Search strategy',
    url:'https://search.google.com/search-console/',
    note:'Identify search demand and content opportunity.'
  },
  {
    name:'Google Analytics',
    category:'Performance strategy',
    url:'https://analytics.google.com/',
    note:'Validate channel, content and funnel strategy.'
  },
  {
    name:'Canva',
    category:'Creative planning',
    url:'https://www.canva.com/',
    note:'Campaign concepts, moodboards and creative briefs.'
  }
]


function initials(name:string){

  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0,2)
    .map(
      part=>
        part[0]?.toUpperCase() || ''
    )
    .join('') || 'RA'

}


function formatDate(value:string){

  return new Intl.DateTimeFormat(
    undefined,
    {
      day:'numeric',
      month:'short',
      year:'numeric'
    }
  ).format(
    new Date(value)
  )

}


function ToolLauncher({
  tools
}:{
  tools:typeof digitalTools
}){

  const openTool=(url:string)=>{

    window.open(
      url,
      '_blank',
      'noopener,noreferrer'
    )

  }

  return (
    <div className="marketingToolGrid">

      {tools.map(tool=>(

        <button
          key={tool.name}
          type="button"
          className="marketingToolCard"
          onClick={()=>{
            openTool(tool.url)
          }}
        >

          <span className="marketingToolIcon">
            <ExternalLink size={17}/>
          </span>

          <span>

            <small>
              {tool.category}
            </small>

            <strong>
              {tool.name}
            </strong>

            <p>
              {tool.note}
            </p>

          </span>

        </button>

      ))}

    </div>
  )

}


function UTMBuilder(){

  const [base,setBase]=
    useState('https://ridearrivo.com')

  const [source,setSource]=
    useState('')

  const [medium,setMedium]=
    useState('')

  const [campaign,setCampaign]=
    useState('')

  const [content,setContent]=
    useState('')

  const [message,setMessage]=
    useState('')


  const output=
    useMemo(()=>{

      try{

        const url=
          new URL(
            base || 'https://ridearrivo.com'
          )

        if(source){
          url.searchParams.set(
            'utm_source',
            source.trim()
          )
        }

        if(medium){
          url.searchParams.set(
            'utm_medium',
            medium.trim()
          )
        }

        if(campaign){
          url.searchParams.set(
            'utm_campaign',
            campaign.trim()
          )
        }

        if(content){
          url.searchParams.set(
            'utm_content',
            content.trim()
          )
        }

        return url.toString()

      }catch{

        return ''

      }

    },[
      base,
      source,
      medium,
      campaign,
      content
    ])


  const copy=async()=>{

    if(!output){
      setMessage(
        'Enter a valid destination URL.'
      )
      return
    }

    await navigator.clipboard.writeText(
      output
    )

    setMessage(
      'Campaign URL copied.'
    )

  }


  return (
    <div className="marketingUtility glassCard">

      <div className="marketingUtilityHeader">

        <div>

          <span className="eyebrow">
            INTERNAL TOOL
          </span>

          <h3>
            UTM Campaign Builder
          </h3>

          <p>
            Build trackable RideArrivo campaign URLs
            without leaving the workspace.
          </p>

        </div>

        <Link2 size={23}/>

      </div>


      <div className="marketingFormGrid">

        <label>
          Destination URL
          <input
            value={base}
            onChange={event=>{
              setBase(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Source
          <input
            placeholder="google, instagram, partner"
            value={source}
            onChange={event=>{
              setSource(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Medium
          <input
            placeholder="cpc, social, referral"
            value={medium}
            onChange={event=>{
              setMedium(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Campaign
          <input
            placeholder="airport-arrival"
            value={campaign}
            onChange={event=>{
              setCampaign(
                event.target.value
              )
            }}
          />
        </label>

        <label>
          Content
          <input
            placeholder="video-a"
            value={content}
            onChange={event=>{
              setContent(
                event.target.value
              )
            }}
          />
        </label>

      </div>


      <div className="marketingGeneratedUrl">

        <span>
          {output ||
            'Enter a valid destination URL.'}
        </span>

        <button
          type="button"
          onClick={()=>{
            void copy()
          }}
        >
          <Copy size={15}/>
          Copy
        </button>

      </div>

      {message &&
        <small className="marketingUtilityMessage">
          {message}
        </small>
      }

    </div>
  )

}


function DigitalMarketerWorkstation(){

  return (
    <div className="marketingPersonalStation">

      <div className="marketingStationHero">

        <div>

          <span className="eyebrow">
            DIGITAL MARKETER WORKSTATION
          </span>

          <h2>
            Acquisition, content and conversion
          </h2>

          <p>
            Plan campaigns, publish content, optimise
            search and paid acquisition, build tracking
            links and measure every conversion path.
          </p>

        </div>

        <Megaphone size={34}/>

      </div>


      <div className="marketingCapabilityGrid">

        <article>
          <Target size={20}/>
          <strong>Campaign Planning</strong>
          <span>
            Objectives, audiences, channels,
            budgets and conversion goals.
          </span>
        </article>

        <article>
          <Search size={20}/>
          <strong>SEO & Search</strong>
          <span>
            Keywords, search performance,
            landing pages and content opportunity.
          </span>
        </article>

        <article>
          <PenTool size={20}/>
          <strong>Creative Production</strong>
          <span>
            Social assets, campaign creative,
            copy and brand materials.
          </span>
        </article>

        <article>
          <CalendarDays size={20}/>
          <strong>Publishing</strong>
          <span>
            Content calendar, approvals,
            scheduling and campaign cadence.
          </span>
        </article>

        <article>
          <Mail size={20}/>
          <strong>Lifecycle Marketing</strong>
          <span>
            Email, CRM journeys, rebooking and
            opted-in customer communication.
          </span>
        </article>

        <article>
          <LineChart size={20}/>
          <strong>Measurement</strong>
          <span>
            Attribution, CAC, conversion,
            experiments and campaign learning.
          </span>
        </article>

      </div>


      <UTMBuilder/>


      <section className="marketingToolSection">

        <div className="marketingSectionHeading">

          <div>

            <span className="eyebrow">
              TOOLKIT
            </span>

            <h3>
              Digital marketing tools
            </h3>

          </div>

          <span>
            PArAsYtE integration next
          </span>

        </div>

        <ToolLauncher
          tools={digitalTools}
        />

      </section>

    </div>
  )

}


function StrategyContentWorkstation(){

  return (
    <div className="marketingPersonalStation">

      <div className="marketingStationHero strategy">

        <div>

          <span className="eyebrow">
            MARKETING STRATEGY & CONTENT
          </span>

          <h2>
            Research, positioning and content strategy
          </h2>

          <p>
            Build the narrative behind RideArrivo
            growth: audiences, positioning, market
            intelligence, campaign briefs, content
            pillars and performance learning.
          </p>

        </div>

        <Telescope size={34}/>

      </div>


      <div className="marketingCapabilityGrid">

        <article>
          <Telescope size={20}/>
          <strong>Market Intelligence</strong>
          <span>
            Market movement, customer insight,
            trends and competitor monitoring.
          </span>
        </article>

        <article>
          <UsersRound size={20}/>
          <strong>Audience Strategy</strong>
          <span>
            ICPs, traveller personas, corporate
            audiences and behavioural needs.
          </span>
        </article>

        <article>
          <Target size={20}/>
          <strong>Positioning</strong>
          <span>
            Value proposition, campaign messaging,
            differentiation and offer strategy.
          </span>
        </article>

        <article>
          <BookOpen size={20}/>
          <strong>Content Strategy</strong>
          <span>
            Content pillars, briefs, editorial
            calendar and channel narrative.
          </span>
        </article>

        <article>
          <Megaphone size={20}/>
          <strong>Campaign Briefs</strong>
          <span>
            Objectives, audience, insight,
            proposition, channels and deliverables.
          </span>
        </article>

        <article>
          <BarChart3 size={20}/>
          <strong>Strategic Review</strong>
          <span>
            Analyse performance and turn
            campaign results into future direction.
          </span>
        </article>

      </div>


      <div className="marketingStrategyCanvas glassCard">

        <span className="eyebrow">
          STRATEGY CANVAS
        </span>

        <h3>
          Campaign planning framework
        </h3>

        <div className="marketingStrategySteps">

          <div>
            <strong>01 · Business objective</strong>
            <span>
              What must change for RideArrivo?
            </span>
          </div>

          <div>
            <strong>02 · Audience</strong>
            <span>
              Who are we trying to move?
            </span>
          </div>

          <div>
            <strong>03 · Insight</strong>
            <span>
              What customer truth creates leverage?
            </span>
          </div>

          <div>
            <strong>04 · Proposition</strong>
            <span>
              What should RideArrivo promise?
            </span>
          </div>

          <div>
            <strong>05 · Channels</strong>
            <span>
              Where will this audience act?
            </span>
          </div>

          <div>
            <strong>06 · Measurement</strong>
            <span>
              Which outcome proves the strategy?
            </span>
          </div>

        </div>

      </div>


      <section className="marketingToolSection">

        <div className="marketingSectionHeading">

          <div>

            <span className="eyebrow">
              RESEARCH TOOLKIT
            </span>

            <h3>
              Strategy and content tools
            </h3>

          </div>

          <span>
            PArAsYtE integration next
          </span>

        </div>

        <ToolLauncher
          tools={strategyTools}
        />

      </section>

    </div>
  )

}


export function MarketingTeamWorkspace(){

  const [profile,setProfile]=
    useState<Profile|null>(null)

  const [team,setTeam]=
    useState<Profile[]>([])

  const [people,setPeople]=
    useState<Profile[]>([])

  const [spaces,setSpaces]=
    useState<Space[]>([])

  const [invites,setInvites]=
    useState<Invite[]>([])

  const [messages,setMessages]=
    useState<Message[]>([])

  const [view,setView]=
    useState<View>('team')

  const [
    selectedSpaceId,
    setSelectedSpaceId
  ]=
    useState('')

  const [messageText,setMessageText]=
    useState('')

  const [newProjectName,setNewProjectName]=
    useState('')

  const [
    newProjectDescription,
    setNewProjectDescription
  ]=
    useState('')

  const [inviteeId,setInviteeId]=
    useState('')

  const [inviteMessage,setInviteMessage]=
    useState('')

  const [notice,setNotice]=
    useState('')

  const [loading,setLoading]=
    useState(true)


  const loadBase=
    useCallback(async()=>{

      const client=supabase

      if(!client){
        setLoading(false)
        return
      }

      setLoading(true)

      try{

        const {
          data:{
            user
          },
          error:userError
        }=
          await client.auth.getUser()

        if(userError){
          throw userError
        }

        if(!user){
          throw new Error(
            'Your workspace session has expired.'
          )
        }


        const {
          data:profileRow,
          error:profileError
        }=
          await client
            .from('employee_profiles')
            .select(
              'id,full_name,email,role,department,job_title,avatar_url'
            )
            .eq(
              'id',
              user.id
            )
            .maybeSingle()

        if(profileError){
          throw profileError
        }

        if(!profileRow){
          throw new Error(
            'Employee profile not found.'
          )
        }

        const currentProfile=
          profileRow as Profile

        setProfile(
          currentProfile
        )


        const {
          data:directoryRows,
          error:directoryError
        }=
          await client
            .from('employee_profiles')
            .select(
              'id,full_name,email,role,department,job_title,avatar_url'
            )
            .eq(
              'active',
              true
            )
            .order(
              'full_name'
            )

        if(directoryError){
          throw directoryError
        }

        const directory=
          (directoryRows || []) as Profile[]

        setPeople(
          directory
        )

        setTeam(
          directory.filter(employee=>{

            const department=
              String(
                employee.department || ''
              ).toLowerCase()

            return (
              employee.role==='marketing'
              || department.includes(
                'marketing'
              )
            )

          })
        )


        const currentDepartment=
          String(
            currentProfile.department || ''
          ).toLowerCase()

        if(
          currentProfile.role==='marketing'
          || currentDepartment.includes(
            'marketing'
          )
        ){

          const {
            error:ensureError
          }=
            await client.rpc(
              'ensure_department_space'
            )

          if(ensureError){
            console.warn(
              'Marketing department space:',
              ensureError.message
            )
          }

        }


        const {
          data:spaceRows,
          error:spaceError
        }=
          await client
            .from('collaboration_spaces')
            .select(
              'id,name,description,space_type,home_department,created_by,created_at'
            )
            .is(
              'archived_at',
              null
            )
            .order(
              'created_at',
              {
                ascending:true
              }
            )

        if(spaceError){
          throw spaceError
        }

        const availableSpaces=
          (spaceRows || []) as Space[]

        setSpaces(
          availableSpaces
        )


        const marketingDepartmentSpace=
          availableSpaces.find(space=>
            space.space_type==='department'
            &&
            String(
              space.home_department || ''
            )
              .toLowerCase()
              .includes('marketing')
          )

        const firstProject=
          availableSpaces.find(space=>
            space.space_type!=='department'
          )

        setSelectedSpaceId(current=>
          current
          || marketingDepartmentSpace?.id
          || firstProject?.id
          || ''
        )


        const {
          data:inviteRows,
          error:inviteError
        }=
          await client
            .from('collaboration_invites')
            .select(
              'id,space_id,inviter_id,invitee_id,message,status,created_at'
            )
            .eq(
              'invitee_id',
              user.id
            )
            .eq(
              'status',
              'pending'
            )
            .order(
              'created_at',
              {
                ascending:false
              }
            )

        if(inviteError){
          throw inviteError
        }

        setInvites(
          (inviteRows || []) as Invite[]
        )

        setNotice('')

      }catch(error){

        console.error(
          'Marketing workspace load failed:',
          error
        )

        setNotice(
          error instanceof Error
            ? error.message
            : 'Unable to load Marketing workspace.'
        )

      }finally{

        setLoading(false)

      }

    },[])


  const loadMessages=
    useCallback(async()=>{

      const client=supabase

      if(
        !client
        || !selectedSpaceId
      ){
        setMessages([])
        return
      }

      const {
        data,
        error
      }=
        await client
          .from('collaboration_messages')
          .select(
            'id,space_id,author_id,body,created_at,updated_at'
          )
          .eq(
            'space_id',
            selectedSpaceId
          )
          .order(
            'created_at',
            {
              ascending:true
            }
          )
          .limit(150)

      if(error){
        setNotice(
          error.message
        )
        return
      }

      setMessages(
        (data || []) as Message[]
      )

    },[
      selectedSpaceId
    ])


  useEffect(()=>{

    void loadBase()

  },[
    loadBase
  ])


  useEffect(()=>{

    void loadMessages()

    const client=supabase

    if(
      !client
      || !selectedSpaceId
    ){
      return
    }

    const channel=
      client
        .channel(
          `marketing-space-${selectedSpaceId}`
        )
        .on(
          'postgres_changes',
          {
            event:'*',
            schema:'public',
            table:'collaboration_messages',
            filter:
              `space_id=eq.${selectedSpaceId}`
          },
          ()=>{
            void loadMessages()
          }
        )
        .subscribe()

    return ()=>{

      void client.removeChannel(
        channel
      )

    }

  },[
    selectedSpaceId,
    loadMessages
  ])


  const createProject=
    async()=>{

      const client=supabase

      if(
        !client
        || !newProjectName.trim()
      ){
        return
      }

      setNotice('')

      const {
        error
      }=
        await client.rpc(
          'create_collaboration_space',
          {
            p_name:
              newProjectName.trim(),

            p_description:
              newProjectDescription.trim()
              || null,

            p_space_type:
              'cross_department'
          }
        )

      if(error){

        setNotice(
          error.message
        )

        return

      }

      setNewProjectName('')
      setNewProjectDescription('')

      setNotice(
        'Shared project created.'
      )

      await loadBase()

      setView('projects')

    }


  const inviteCollaborator=
    async()=>{

      const client=supabase

      if(
        !client
        || !selectedSpaceId
        || !inviteeId
      ){
        return
      }

      const selected=
        spaces.find(
          space=>
            space.id===selectedSpaceId
        )

      if(
        selected?.space_type==='department'
      ){

        setNotice(
          'Cross-department collaborators must be invited to a project space, not the entire Marketing department workspace.'
        )

        return

      }

      const {
        error
      }=
        await client.rpc(
          'invite_to_collaboration_space',
          {
            p_space_id:
              selectedSpaceId,

            p_invitee_id:
              inviteeId,

            p_message:
              inviteMessage.trim()
              || null
          }
        )

      if(error){

        setNotice(
          error.message
        )

        return

      }

      setInviteeId('')
      setInviteMessage('')

      setNotice(
        'Collaboration invitation sent.'
      )

    }


  const respondToInvite=
    async(
      inviteId:string,
      decision:
        | 'accepted'
        | 'declined'
    )=>{

      const client=supabase

      if(!client){
        return
      }

      const {
        error
      }=
        await client.rpc(
          'respond_to_collaboration_invite',
          {
            p_invite_id:
              inviteId,

            p_decision:
              decision
          }
        )

      if(error){

        setNotice(
          error.message
        )

        return

      }

      setNotice(
        decision==='accepted'
          ? 'Workspace invitation accepted.'
          : 'Workspace invitation declined.'
      )

      await loadBase()

    }


  const sendMessage=
    async()=>{

      const client=supabase

      if(
        !client
        || !profile
        || !selectedSpaceId
        || !messageText.trim()
      ){
        return
      }

      const {
        error
      }=
        await client
          .from('collaboration_messages')
          .insert({
            space_id:
              selectedSpaceId,

            author_id:
              profile.id,

            body:
              messageText.trim()
          })

      if(error){

        setNotice(
          error.message
        )

        return

      }

      setMessageText('')

      await loadMessages()

    }


  const selectedSpace=
    spaces.find(
      space=>
        space.id===selectedSpaceId
    ) || null


  const peopleMap=
    useMemo(
      ()=>
        new Map(
          people.map(
            employee=>[
              employee.id,
              employee
            ]
          )
        ),
      [
        people
      ]
    )


  const suggestedView=
    useMemo(()=>{

      const title=
        String(
          profile?.job_title || ''
        ).toLowerCase()

      if(
        title.includes('strateg')
        || title.includes('content')
      ){
        return 'strategy'
      }

      return 'digital'

    },[
      profile?.job_title
    ])


  useEffect(()=>{

    if(
      profile
      && view==='team'
      && (
        String(
          profile.job_title || ''
        )
          .toLowerCase()
          .includes('strateg')
        ||
        String(
          profile.job_title || ''
        )
          .toLowerCase()
          .includes('content')
      )
    ){

      // Keep Team as the landing page.
      // Personal station suggestion appears in the header.
    }

  },[
    profile,
    view
  ])


  if(loading){

    return (
      <section className="marketingWorkspace">
        <div className="glassCard marketingLoading">
          Loading Marketing Team Workspace...
        </div>
      </section>
    )

  }


  return (
    <section className="marketingWorkspace">

      <div className="marketingWorkspaceHero">

        <div>

          <span className="eyebrow">
            MARKETING TEAM WORKSPACE
          </span>

          <h2>
            One team. Shared work. Specialist workstations.
          </h2>

          <p>
            Campaign execution, content, strategy,
            team collaboration and cross-functional
            project work in one secured Marketing
            environment.
          </p>

        </div>


        <div className="marketingWorkspaceIdentity">

          <span>
            {profile?.job_title ||
              'Marketing'}
          </span>

          <strong>
            {team.length}
          </strong>

          <small>
            Marketing team members
          </small>

          <button
            type="button"
            onClick={()=>{
              setView(
                suggestedView
              )
            }}
          >
            Open my workstation
          </button>

        </div>

      </div>


      {notice &&
        <div className="moduleNotice">
          {notice}
        </div>
      }


      {invites.length>0 &&
        <div className="marketingInviteStack">

          {invites.map(invite=>(

            <article
              key={invite.id}
              className="marketingInvite glassCard"
            >

              <div>

                <strong>
                  Collaboration invitation
                </strong>

                <span>
                  {invite.message ||
                    'You have been invited to a shared project workspace.'}
                </span>

              </div>

              <div>

                <button
                  type="button"
                  className="accept"
                  onClick={()=>{
                    void respondToInvite(
                      invite.id,
                      'accepted'
                    )
                  }}
                >
                  <Check size={15}/>
                  Accept
                </button>

                <button
                  type="button"
                  onClick={()=>{
                    void respondToInvite(
                      invite.id,
                      'declined'
                    )
                  }}
                >
                  <X size={15}/>
                  Decline
                </button>

              </div>

            </article>

          ))}

        </div>
      }


      <div className="marketingWorkspaceTabs">

        <button
          className={
            view==='team'
              ? 'active'
              : ''
          }
          onClick={()=>{
            setView('team')
          }}
        >
          <UsersRound size={16}/>
          Team
        </button>

        <button
          className={
            view==='projects'
              ? 'active'
              : ''
          }
          onClick={()=>{
            setView('projects')
          }}
        >
          <FolderKanban size={16}/>
          Projects
        </button>

        <button
          className={
            view==='discussion'
              ? 'active'
              : ''
          }
          onClick={()=>{
            setView('discussion')
          }}
        >
          <MessageSquareText size={16}/>
          Discussion
        </button>

        <button
          className={
            view==='digital'
              ? 'active'
              : ''
          }
          onClick={()=>{
            setView('digital')
          }}
        >
          <Megaphone size={16}/>
          Digital Marketer
        </button>

        <button
          className={
            view==='strategy'
              ? 'active'
              : ''
          }
          onClick={()=>{
            setView('strategy')
          }}
        >
          <Telescope size={16}/>
          Strategy & Content
        </button>

        <button
          className={
            view==='execution'
              ? 'active'
              : ''
          }
          onClick={()=>{
            setView('execution')
          }}
        >
          <BarChart3 size={16}/>
          Execution
        </button>

      </div>


      {view==='team' &&
        <div className="marketingTeamView">

          <div className="marketingSectionHeading">

            <div>

              <span className="eyebrow">
                TEAM
              </span>

              <h3>
                Marketing people
              </h3>

            </div>

            <button
              type="button"
              className="glassButton"
              onClick={()=>{
                void loadBase()
              }}
            >
              <RefreshCw size={15}/>
              Refresh
            </button>

          </div>


          <div className="marketingPeopleGrid">

            {team.map(employee=>(

              <article
                key={employee.id}
                className="marketingPerson glassCard"
              >

                <div className="marketingPersonAvatar">

                  {employee.avatar_url
                    ? (
                      <img
                        src={employee.avatar_url}
                        alt=""
                      />
                    )
                    : initials(
                        employee.full_name
                      )
                  }

                </div>

                <div>

                  <strong>
                    {employee.full_name}
                  </strong>

                  <span>
                    {employee.job_title ||
                      'Marketing'}
                  </span>

                  <small>
                    {employee.email}
                  </small>

                </div>

              </article>

            ))}

            {team.length===0 &&
              <div className="marketingEmpty glassCard">
                No active Marketing employees found.
              </div>
            }

          </div>

        </div>
      }


      {view==='projects' &&
        <div className="marketingProjects">

          <div className="marketingProjectCreator glassCard">

            <span className="eyebrow">
              NEW SHARED PROJECT
            </span>

            <h3>
              Create a collaboration room
            </h3>

            <p>
              Use project rooms whenever Marketing
              needs to work with HR, Operations,
              Legal, Finance or another team.
            </p>

            <label>
              Project name
              <input
                value={newProjectName}
                onChange={event=>{
                  setNewProjectName(
                    event.target.value
                  )
                }}
                placeholder="Airport Arrival Campaign"
              />
            </label>

            <label>
              Description
              <textarea
                value={
                  newProjectDescription
                }
                onChange={event=>{
                  setNewProjectDescription(
                    event.target.value
                  )
                }}
                placeholder="What is this project trying to achieve?"
              />
            </label>

            <button
              type="button"
              className="primaryButton"
              disabled={
                !newProjectName.trim()
              }
              onClick={()=>{
                void createProject()
              }}
            >
              <Plus size={16}/>
              Create project
            </button>

          </div>


          <div className="marketingProjectList">

            {spaces.map(space=>(

              <button
                key={space.id}
                type="button"
                className={
                  selectedSpaceId===space.id
                    ? 'marketingProjectCard active'
                    : 'marketingProjectCard'
                }
                onClick={()=>{
                  setSelectedSpaceId(
                    space.id
                  )
                }}
              >

                <span>
                  {space.space_type}
                </span>

                <strong>
                  {space.name}
                </strong>

                <p>
                  {space.description ||
                    'Shared RideArrivo workspace.'}
                </p>

                <small>
                  Created {formatDate(space.created_at)}
                </small>

              </button>

            ))}

          </div>


          {selectedSpace &&
            selectedSpace.space_type!=='department' &&
            <div className="marketingCollaborator glassCard">

              <div>

                <span className="eyebrow">
                  INVITE COLLABORATOR
                </span>

                <h3>
                  {selectedSpace.name}
                </h3>

                <p>
                  Invite another active employee.
                  They receive a workspace notification
                  and must accept before joining.
                </p>

              </div>

              <select
                value={inviteeId}
                onChange={event=>{
                  setInviteeId(
                    event.target.value
                  )
                }}
              >
                <option value="">
                  Select employee
                </option>

                {people
                  .filter(employee=>
                    employee.id!==profile?.id
                  )
                  .map(employee=>(

                    <option
                      key={employee.id}
                      value={employee.id}
                    >
                      {employee.full_name}
                      {' · '}
                      {employee.department ||
                        employee.role}
                    </option>

                  ))
                }

              </select>

              <input
                value={inviteMessage}
                onChange={event=>{
                  setInviteMessage(
                    event.target.value
                  )
                }}
                placeholder="Optional invitation message"
              />

              <button
                type="button"
                className="primaryButton"
                disabled={!inviteeId}
                onClick={()=>{
                  void inviteCollaborator()
                }}
              >
                <UserPlus size={16}/>
                Invite collaborator
              </button>

            </div>
          }

        </div>
      }


      {view==='discussion' &&
        <div className="marketingDiscussion glassCard">

          <div className="marketingDiscussionHeader">

            <div>

              <span className="eyebrow">
                REALTIME DISCUSSION
              </span>

              <h3>
                {selectedSpace?.name ||
                  'Select a workspace'}
              </h3>

            </div>

            <select
              value={selectedSpaceId}
              onChange={event=>{
                setSelectedSpaceId(
                  event.target.value
                )
              }}
            >

              <option value="">
                Select workspace
              </option>

              {spaces.map(space=>(

                <option
                  key={space.id}
                  value={space.id}
                >
                  {space.name}
                </option>

              ))}

            </select>

          </div>


          <div className="marketingMessages">

            {messages.map(message=>{

              const author=
                peopleMap.get(
                  message.author_id
                )

              return (
                <article
                  key={message.id}
                  className={
                    message.author_id===profile?.id
                      ? 'marketingMessage mine'
                      : 'marketingMessage'
                  }
                >

                  <div>

                    <strong>
                      {author?.full_name ||
                        'RideArrivo employee'}
                    </strong>

                    <small>
                      {new Intl.DateTimeFormat(
                        undefined,
                        {
                          hour:'2-digit',
                          minute:'2-digit',
                          day:'2-digit',
                          month:'short'
                        }
                      ).format(
                        new Date(
                          message.created_at
                        )
                      )}
                    </small>

                  </div>

                  <p>
                    {message.body}
                  </p>

                </article>
              )

            })}


            {selectedSpaceId &&
              messages.length===0 &&
              <div className="marketingEmpty">
                No messages yet. Start the project discussion.
              </div>
            }

          </div>


          <div className="marketingComposer">

            <textarea
              value={messageText}
              disabled={!selectedSpaceId}
              placeholder={
                selectedSpaceId
                  ? 'Write to the team...'
                  : 'Select a workspace first'
              }
              onChange={event=>{
                setMessageText(
                  event.target.value
                )
              }}
            />

            <button
              type="button"
              disabled={
                !selectedSpaceId
                || !messageText.trim()
              }
              onClick={()=>{
                void sendMessage()
              }}
            >
              <Send size={17}/>
            </button>

          </div>

        </div>
      }


      {view==='digital' &&
        <DigitalMarketerWorkstation/>
      }


      {view==='strategy' &&
        <StrategyContentWorkstation/>
      }


      {view==='execution' &&
        <MarketingModule/>
      }

    </section>
  )
}
