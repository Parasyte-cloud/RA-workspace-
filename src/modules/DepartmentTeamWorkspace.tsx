import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import type {
  ReactNode
} from 'react'

import {
  ExternalLink,
  FolderKanban,
  Layers3,
  RefreshCw,
  UsersRound,
  Wrench
} from 'lucide-react'

import {
  supabase
} from '../lib/supabase'
import { openInParasyte } from '../lib/parasyte'
import SharedWorkspacesHub from './SharedWorkspacesHub'
import { DataWorkbench } from './DataWorkbench'
import EngineeringWorkbench from './EngineeringWorkbench'

import '../department-workspace.css'


type Employee={
  id:string
  full_name:string
  email:string
  role:string
  department:string|null
  job_title:string|null
}

type Tool={
  name:string
  purpose:string
  url?:string
  type?:
    | 'internal'
    | 'external'
}

type Capability={
  title:string
  description:string
}

type WorkspaceLink={
  name:string
  purpose:string
  target:string
}

const sharedWorkspaceLinks:WorkspaceLink[]=[
  {name:'My Tasks & Approvals',purpose:'Assignments, deadlines, approvals and progress.',target:'tasks'},
  {name:'Mail',purpose:'RideArrivo company email and team communication.',target:'mail'},
  {name:'Calendar',purpose:'Meetings, deadlines and scheduled work.',target:'calendar'},
  {name:'Company Files',purpose:'Controlled documents and shared department records.',target:'files'},
  {name:'Knowledge Base',purpose:'Policies, procedures, playbooks and reusable guidance.',target:'knowledge'}
]

type Props={
  eyebrow:string
  title:string
  subtitle:string

  departmentAliases:string[]
  roleAliases:string[]

  workstationTitle:string
  workstationDescription:string

  capabilities:Capability[]
  tools:Tool[]
  workspaceLinks?:WorkspaceLink[]
  workstationContent?:ReactNode
  onNavigate?:(target:string)=>void

  execution:ReactNode
}


function normalise(value:string|null|undefined){

  return String(value || '')
    .trim()
    .toLowerCase()

}


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


export function DepartmentTeamWorkspace({
  eyebrow,
  title,
  subtitle,
  departmentAliases,
  roleAliases,
  workstationTitle,
  workstationDescription,
  capabilities,
  tools,
  workspaceLinks=[],
  workstationContent,
  onNavigate,
  execution
}:Props){

  const [profile,setProfile]=
    useState<Employee|null>(null)

  const [directory,setDirectory]=
    useState<Employee[]>([])

  const [view,setView]=
    useState<
      'team'
      | 'workstation'
      | 'shared'
      | 'execution'
    >('workstation')

  const [loading,setLoading]=
    useState(true)

  const [message,setMessage]=
    useState('')


  const load=
    useCallback(async()=>{

      const client=supabase

      if(!client){
        setLoading(false)
        return
      }

      setLoading(true)
      setMessage('')

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
              'id,full_name,email,role,department,job_title'
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

        const current=
          profileRow as Employee

        setProfile(current)


        const {
          data:employeeRows,
          error:directoryError
        }=
          await client
            .from('employee_profiles')
            .select(
              'id,full_name,email,role,department,job_title'
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

        setDirectory(
          (employeeRows || []) as Employee[]
        )


        const currentDepartment=
          normalise(
            current.department
          )

        const belongsHere=
          departmentAliases.some(
            alias=>
              currentDepartment.includes(
                normalise(alias)
              )
          )
          ||
          roleAliases.includes(
            normalise(
              current.role
            )
          )

        /*
         * Only an employee actually belonging to this
         * department should initialise/synchronise its
         * automatic department collaboration space.
         *
         * Manager/Admin may view a department workstation
         * without being inserted into that department team.
         */
        if(belongsHere){

          const {
            error:spaceError
          }=
            await client.rpc(
              'ensure_department_space'
            )

          if(spaceError){

            console.warn(
              `${title} department space:`,
              spaceError.message
            )

          }

        }

      }catch(error){

        console.error(
          `${title} workspace load failed:`,
          error
        )

        setMessage(
          error instanceof Error
            ? error.message
            : 'Unable to load team workspace.'
        )

      }finally{

        setLoading(false)

      }

    },[
      departmentAliases,
      roleAliases,
      title
    ])


  useEffect(()=>{

    void load()

  },[
    load
  ])


  const team=
    useMemo(()=>{

      return directory.filter(
        employee=>{

          const department=
            normalise(
              employee.department
            )

          const role=
            normalise(
              employee.role
            )

          return (
            departmentAliases.some(
              alias=>
                department.includes(
                  normalise(alias)
                )
            )
            ||
            roleAliases.includes(role)
          )

        }
      )

    },[
      directory,
      departmentAliases,
      roleAliases
    ])


  const workstationLinks=
    useMemo(()=>{
      const combined=[...sharedWorkspaceLinks,...workspaceLinks]
      const seen=new Set<string>()
      return combined.filter(link=>{
        if(seen.has(link.target)) return false
        seen.add(link.target)
        return true
      })
    },[workspaceLinks])

  const openTool=(tool:Tool)=>{

    if(!tool.url){
      return
    }

    openInParasyte(
      tool.url,
      tool.name
    )

  }


  if(loading){

    return (
      <section className="departmentWorkspace">

        <div className="glassCard departmentLoading">
          Loading {title}...
        </div>

      </section>
    )

  }


  return (
    <section className="departmentWorkspace">

      <div className="departmentHero">

        <div>

          <span className="eyebrow">
            {eyebrow}
          </span>

          <h2>
            {title}
          </h2>

          <p>
            {subtitle}
          </p>

        </div>


        <div className="departmentHeroStat">

          <span>
            TEAM
          </span>

          <strong>
            {team.length}
          </strong>

          <small>
            Active team members
          </small>

          {profile?.job_title &&
            <em>
              {profile.job_title}
            </em>
          }

        </div>

      </div>


      {message &&
        <div className="moduleNotice">
          {message}
        </div>
      }


      <div className="departmentTabs">
        <button type="button" className={view==='workstation'?'active':''} onClick={()=>setView('workstation')}><Wrench size={16}/>Workspace</button>
        <button type="button" className={view==='shared'?'active':''} onClick={()=>setView('shared')}><FolderKanban size={16}/>Collaboration</button>
        <button type="button" className={view==='execution'?'active':''} onClick={()=>setView('execution')}><Layers3 size={16}/>Operations</button>
        <button type="button" className={view==='team'?'active':''} onClick={()=>setView('team')}><UsersRound size={16}/>Team</button>
      </div>

      {view==='shared' &&
        <SharedWorkspacesHub
          embedded
          onNavigate={onNavigate}
        />
      }


      {view==='team' &&
        <div className="departmentTeam">

          <div className="departmentSectionHeader">

            <div>

              <span className="eyebrow">
                PEOPLE
              </span>

              <h3>
                Team workspace
              </h3>

              <p>
                Every active employee assigned to this
                department shares the same secured
                department environment.
              </p>

            </div>

            <button
              type="button"
              className="glassButton"
              onClick={()=>{
                void load()
              }}
            >
              <RefreshCw size={15}/>
              Refresh
            </button>

          </div>


          <div className="departmentPeopleGrid">

            {team.map(employee=>(

              <article
                key={employee.id}
                className="departmentPerson glassCard"
              >

                <div className="departmentAvatar">

                  {initials(
                    employee.full_name
                  )}

                </div>

                <div>

                  <strong>
                    {employee.full_name}
                  </strong>

                  <span>
                    {employee.job_title ||
                      employee.department ||
                      employee.role}
                  </span>

                  <small>
                    {employee.email}
                  </small>

                </div>

              </article>

            ))}

            {team.length===0 &&
              <div className="glassCard departmentEmpty">
                No active employees are currently assigned
                to this department.
              </div>
            }

          </div>

        </div>
      }


      {view==='workstation' &&
        <div className="departmentStation">

          <div className="departmentStationIntro">

            <span className="eyebrow">
              DEPARTMENT WORKSPACE
            </span>

            <h3>
              {workstationTitle}
            </h3>

            <p>
              {workstationDescription}
            </p>

          </div>


          <div className="departmentCapabilities">

            {capabilities.map(
              capability=>(

                <article
                  key={capability.title}
                  className="glassCard"
                >

                  <strong>
                    {capability.title}
                  </strong>

                  <p>
                    {capability.description}
                  </p>

                </article>

              )
            )}

          </div>

          {workstationContent}

          {onNavigate && workstationLinks.length>0 && <>
            <div className="departmentSectionHeader"><div>
              <span className="eyebrow">WORKSPACE ESSENTIALS</span>
              <h3>Daily operating stack</h3>
              <p>Core RideArrivo tools stay one click away so the department can execute without leaving its workstation flow.</p>
            </div></div>
            <div className="departmentTools">
              {workstationLinks.map(link=><button key={link.target} type="button" onClick={()=>onNavigate(link.target)}>
                <span><strong>{link.name}</strong><small>{link.purpose}</small></span><Layers3 size={17}/>
              </button>)}
            </div>
          </>}

          <div className="departmentSectionHeader">

            <div>

              <span className="eyebrow">
                CONNECTED SERVICES
              </span>

              <h3>
                Specialist & regulatory tools
              </h3>

              <p>
                Core work is handled natively in RideArrivo. Specialist and regulatory consoles open through PArAsYtE or their secured provider when browser policy requires it.
              </p>

            </div>

          </div>


          <div className="departmentTools">

            {tools.map(tool=>(

              <button
                key={tool.name}
                type="button"
                className="departmentTool"
                disabled={!tool.url}
                onClick={()=>{
                  openTool(tool)
                }}
              >

                <ExternalLink size={16}/>

                <span>

                  <strong>
                    {tool.name}
                  </strong>

                  <small>
                    {tool.purpose}
                  </small>

                </span>

              </button>

            ))}

          </div>

        </div>
      }


      {view==='execution' &&
        <div className="departmentExecution">
          {execution}
        </div>
      }

    </section>
  )
}


function ExecutiveExecution({onNavigate}:{onNavigate?:(target:string)=>void}){
  const controls:WorkspaceLink[]=[
    {name:'Company CRM',purpose:'Customer, corporate account and opportunity visibility.',target:'crm'},
    {name:'Finance Control',purpose:'Cash, receivables, payables, budgets and statutory control.',target:'finance'},
    {name:'Operations Control',purpose:'Dispatch, fleet, drivers, live service and incidents.',target:'operations'},
    {name:'Growth & Marketing',purpose:'Acquisition, campaigns, content and commercial growth.',target:'marketing'},
    {name:'Partnerships',purpose:'Commercial pipeline, agreements, onboarding and renewals.',target:'partnerships'},
    {name:'People & HR',purpose:'Headcount, onboarding, performance and employee operations.',target:'people'},
    {name:'Legal & Compliance',purpose:'Contracts, privacy, regulatory obligations and risk.',target:'legal'},
    {name:'Engineering',purpose:'Product delivery, infrastructure, security and releases.',target:'engineering'}
  ]
  return <div className="departmentExecutiveExecution">
    <div className="departmentStationIntro"><span className="eyebrow">EXECUTIVE EXECUTION</span><h3>CEO cross-functional control</h3><p>Run priorities, decisions and enterprise risks directly here, then drill into the authorised department control centres for evidence and execution.</p></div>
    <div className="grid2">
      <DataWorkbench table="executive_priorities" title="Company priorities" description="Strategic objectives, accountable owners, deadlines and progress." createLabel="Add priority" fields={[{key:'title',label:'Priority',required:true},{key:'objective',label:'Objective',type:'textarea'},{key:'owner',label:'Owner'},{key:'quarter',label:'Quarter / period'},{key:'due_date',label:'Due date',type:'date'},{key:'status',label:'Status',type:'select',options:['on_track','at_risk','blocked','complete'],required:true},{key:'progress',label:'Progress %',type:'number',required:true}]} columns={[{key:'title',label:'Priority'},{key:'owner',label:'Owner'},{key:'quarter',label:'Period'},{key:'status',label:'Status'},{key:'progress',label:'Progress %'}]}/>
      <DataWorkbench table="executive_decisions" title="Decision log" description="Material leadership decisions, rationale, owners and review dates." createLabel="Record decision" fields={[{key:'title',label:'Decision title',required:true},{key:'decision',label:'Decision',type:'textarea',required:true},{key:'rationale',label:'Rationale',type:'textarea'},{key:'owner',label:'Owner'},{key:'decision_date',label:'Decision date',type:'date',required:true},{key:'review_date',label:'Review date',type:'date'}]} columns={[{key:'title',label:'Decision'},{key:'owner',label:'Owner'},{key:'decision_date',label:'Date'},{key:'review_date',label:'Review'}]}/>
      <DataWorkbench table="enterprise_risks" title="Enterprise risk register" description="Material business, operational, legal, financial and technology risks." createLabel="Add risk" fields={[{key:'risk_title',label:'Risk',required:true},{key:'category',label:'Category',required:true},{key:'likelihood',label:'Likelihood',required:true},{key:'impact',label:'Impact',required:true},{key:'owner',label:'Owner'},{key:'mitigation',label:'Mitigation',type:'textarea'},{key:'status',label:'Status',type:'select',options:['open','mitigating','accepted','closed'],required:true},{key:'review_date',label:'Review date',type:'date'}]} columns={[{key:'risk_title',label:'Risk'},{key:'category',label:'Category'},{key:'likelihood',label:'Likelihood'},{key:'impact',label:'Impact'},{key:'status',label:'Status'}]}/>
    </div>
    <div className="departmentSectionHeader"><div><span className="eyebrow">CROSS-FUNCTIONAL CONTROL</span><h3>Open department control centres</h3><p>Use the departmental systems for the underlying live records, approvals and operational evidence.</p></div></div>
    <div className="departmentTools">{controls.map(control=><button key={control.target} type="button" disabled={!onNavigate} onClick={()=>onNavigate?.(control.target)}><span><strong>{control.name}</strong><small>{control.purpose}</small></span><Layers3 size={17}/></button>)}</div>
  </div>
}

export function ExecutiveTeamWorkspace({onNavigate}:{onNavigate?:(target:string)=>void}){
  return <DepartmentTeamWorkspace
    eyebrow="EXECUTIVE LEADERSHIP"
    title="CEO & Management Workspace"
    subtitle="Company-wide leadership, approvals, risk, operating performance and cross-functional decision control."
    departmentAliases={['executive','management','leadership','office of the ceo']}
    roleAliases={['manager']}
    workstationTitle="CEO Executive Workstation"
    workstationDescription="A focused leadership environment for company priorities, decisions, approvals, financial stewardship, service performance, growth, people and governance."
    capabilities={[
      {title:'Executive Scorecard',description:'Company KPIs, trends and exceptions across finance, service, growth and people.'},
      {title:'Strategy & Priorities',description:'Company objectives, owners, milestones and cross-functional follow-through.'},
      {title:'Approvals & Decisions',description:'Executive approval queue, decision log, blockers and accountable outcomes.'},
      {title:'Financial Stewardship',description:'Revenue, cash, budgets, obligations, runway and financial controls.'},
      {title:'Service & Operations',description:'Bookings, service quality, fleet, safety and operational performance.'},
      {title:'Growth & Commercial',description:'CRM, acquisition, marketing ROI, partnerships and commercial pipeline.'},
      {title:'People & Organisation',description:'Headcount, leadership accountability, performance, succession and organisation health.'},
      {title:'Enterprise Risk',description:'Legal, privacy, compliance, security and material operational risks.'},
      {title:'Board & Governance',description:'Board packs, statutory actions, resolutions and executive reporting.'},
      {title:'Technology & Delivery',description:'Product roadmap, reliability, security posture and release readiness.'}
    ]}
    tools={[
      {name:'Power BI',purpose:'Executive dashboards and governed cross-functional analytics.',url:'https://app.powerbi.com/'},
      {name:'ProvidusBank',purpose:'Authorised corporate banking access.',url:'https://ibank.providusbank.com/provipay#/login'},
      {name:'HubSpot',purpose:'Executive CRM, commercial pipeline and customer visibility when connected.',url:'https://app.hubspot.com/'},
      {name:'Google Drive',purpose:'Executive documents and controlled collaboration.',url:'https://drive.google.com/'},
      {name:'Google Meet',purpose:'Leadership, partner and stakeholder meetings.',url:'https://meet.google.com/'},
      {name:'LinkedIn',purpose:'Executive network, partnerships and market intelligence.',url:'https://www.linkedin.com/'}
    ]}
    workspaceLinks={[
      {name:'Company CRM',purpose:'Customer, corporate account and opportunity control.',target:'crm'},
      {name:'Applications',purpose:'Approved internal and managed company applications.',target:'apps'}
    ]}
    onNavigate={onNavigate}
    execution={<ExecutiveExecution onNavigate={onNavigate}/>}
  />
}

export function SupportTeamWorkspace({
  execution,
  onNavigate
}:{
  execution:ReactNode
  onNavigate?:(target:string)=>void
}){

  return (
    <DepartmentTeamWorkspace
      eyebrow="SUPPORT TEAM"
      title="Support Team Workspace"
      subtitle="Customer assistance, booking context, trip support, escalation and service recovery."
      departmentAliases={[
        'support',
        'customer support'
      ]}
      roleAliases={[
        'support'
      ]}
      workstationTitle="Customer Support Workstation"
      workstationDescription="Everything required to resolve rider and booking issues while maintaining service context and escalation history."
      capabilities={[
        {title:'Omnichannel Queue',description:'Email, WhatsApp and other support requests consolidated into one prioritised queue.'},
        {title:'Ticketing & SLA',description:'Ownership, priority, routing, first-response targets, resolution clocks and escalations.'},
        {title:'Customer 360',description:'Rider profile, bookings, payments, communication history and prior support context.'},
        {title:'Live Ride Context',description:'Bookings, rides, drivers and operational exceptions from the RideArrivo backend.'},
        {title:'Refund & Dispute Handoff',description:'Structured handoff to Finance for refunds, payment disputes and evidence.'},
        {title:'Safety Escalation',description:'Panic/safety incidents routed to Operations with severity and audit trail.'},
        {title:'Knowledge & Macros',description:'Approved responses, procedures, troubleshooting and reusable service guidance.'},
        {title:'CSAT & Quality',description:'Customer feedback, resolution quality, repeat-contact patterns and coaching signals.'},
        {title:'Capacity & Scheduling',description:'Agent availability, workload, handovers and queue coverage.'}
    ]}
    tools={[
        {name:'HubSpot Help Desk',purpose:'Omnichannel ticketing, SLA, routing and customer context when connected.',url:'https://app.hubspot.com/'},
        {name:'Zoho Mail',purpose:'RideArrivo company email and case communication.',url:'https://mail.zoho.com/'},
        {name:'WhatsApp Web',purpose:'Approved customer support communication.',url:'https://web.whatsapp.com/'},
        {name:'Google Maps',purpose:'Route, pickup and service-location context.',url:'https://maps.google.com/'}
      ]}
      onNavigate={onNavigate}
      execution={execution}
    />
  )
}


export function OperationsTeamWorkspace({
  execution,
  onNavigate
}:{
  execution:ReactNode
  onNavigate?:(target:string)=>void
}){

  return (
    <DepartmentTeamWorkspace
      eyebrow="OPERATIONS"
      title="Operations Team Workspace"
      subtitle="Dispatch, trip execution, fleet readiness, drivers, incidents and operating control."
      departmentAliases={[
        'operations'
      ]}
      roleAliases={[
        'operations'
      ]}
      workstationTitle="Mobility Operations Workstation"
      workstationDescription="Coordinate the physical RideArrivo service from booking readiness through trip completion and incident resolution."
      capabilities={[
        {title:'Dispatch Board',description:'Booking allocation, driver matching, assignment ownership and exception handling.'},
        {title:'Live Trips & GPS',description:'Active journey state, location health, ETAs and operational exceptions.'},
        {title:'Driver Assignment',description:'Availability, shift/vehicle assignment, readiness and accountability.'},
        {title:'Fleet Maintenance',description:'Preventive maintenance, work orders, defects, downtime and service history.'},
        {title:'Inspections & Documents',description:'Vehicle inspections, papers, insurance, permits and expiry control.'},
        {title:'Airport Operations',description:'Flight status, arrival alerts, pickup staging and delay/cancellation handling.'},
        {title:'Safety & Incidents',description:'Incident capture, severity, evidence, response, investigation and corrective action.'},
        {title:'Fuel & Utilisation',description:'Vehicle utilisation, fuel/energy cost signals, idle time and capacity planning.'},
        {title:'Shift & Handover',description:'Operational rosters, coverage, handover notes and unresolved exceptions.'},
        {title:'Operations Analytics',description:'Assignment time, completion, cancellations, utilisation and service-quality KPIs.'}
    ]}
    tools={[
        {name:'RideArrivo Admin',purpose:'Operational backend console for bookings, riders, drivers and trips.',url:'https://admin.ridearrivo.com'},
        {name:'Google Maps',purpose:'Routing, pickup points, geocoding and traffic context.',url:'https://maps.google.com/'},
        {name:'FlightAware',purpose:'Flight status and alert context for airport pickup operations.',url:'https://www.flightaware.com/'},
        {name:'FlightRadar24',purpose:'Live flight movement cross-check for airport operations.',url:'https://www.flightradar24.com/'}
      ]}
      onNavigate={onNavigate}
      execution={execution}
    />
  )
}


export function PeopleTeamWorkspace({
  execution,
  onNavigate
}:{
  execution:ReactNode
  onNavigate?:(target:string)=>void
}){

  return (
    <DepartmentTeamWorkspace
      eyebrow="PEOPLE & HR"
      title="People Team Workspace"
      subtitle="Recruitment, employee lifecycle, onboarding, leave, performance and people operations."
      departmentAliases={[
        'people',
        'hr',
        'human resources'
      ]}
      roleAliases={[
        'hr'
      ]}
      workstationTitle="People Operations Workstation"
      workstationDescription="Run the complete employee lifecycle while keeping confidential people information inside HR controls."
      capabilities={[
        {title:'Employee Records',description:'Secure employee system of record, organisation structure and self-service updates.'},
        {title:'Recruitment & ATS',description:'Candidates, roles, interviews, scorecards, offers and hiring pipeline.'},
        {title:'Onboarding & Offboarding',description:'Role-based checklists, documents, accounts, equipment, handover and access removal.'},
        {title:'Time, Leave & Attendance',description:'Leave balances, requests, approvals, schedules and attendance controls.'},
        {title:'Performance & Goals',description:'Objectives, reviews, feedback, development plans and manager accountability.'},
        {title:'Payroll & Compensation Inputs',description:'Approved salary changes, allowances, payroll inputs and compensation planning.'},
        {title:'Benefits & Pension',description:'Benefits administration, pension compliance and employee enrolment records.'},
        {title:'Learning & Compliance',description:'Training assignments, policy acknowledgement and mandatory compliance records.'},
        {title:'Employee Relations',description:'HR requests, welfare, grievances, letters and confidential case handling.'}
    ]}
    tools={[
        {name:'LinkedIn',purpose:'Recruitment, sourcing and employer-brand research.',url:'https://www.linkedin.com/'},
        {name:'Google Meet',purpose:'Interviews, 1:1s and employee meetings.',url:'https://meet.google.com/'},
        {name:'Google Docs',purpose:'Controlled HR letters, policies and collaborative people documents.',url:'https://docs.google.com/'},
        {name:'PenCom Employer Hub',purpose:'Nigeria employer pension compliance and clearance workflows.',url:'https://ehub.pencom.gov.ng/'},
        {name:'LIRS eTax',purpose:'Lagos PAYE and employer tax administration.',url:'https://etax.lirs.net/'}
      ]}
      onNavigate={onNavigate}
      execution={execution}
    />
  )
}


export function EngineeringTeamWorkspace({
  execution,
  onNavigate
}:{
  execution:ReactNode
  onNavigate?:(target:string)=>void
}){

  return (
    <DepartmentTeamWorkspace
      eyebrow="ENGINEERING"
      title="Engineering Team Workspace"
      subtitle="Software delivery, infrastructure, mobile, releases, security and technical operations."
      departmentAliases={[
        'engineering',
        'technology'
      ]}
      roleAliases={[
        'engineer',
        'cto'
      ]}
      workstationTitle="Engineering & CTO Workstation"
      workstationDescription="Build, deploy, secure and operate RideArrivo software while preserving controlled engineering ownership."
      capabilities={[
        {title:'Source Control & Review',description:'Repositories, issues, pull requests, branch protection and review workflows.'},
        {title:'Planning & Delivery',description:'Backlog, milestones, technical tasks, release scope and engineering ownership.'},
        {title:'CI/CD & Releases',description:'Builds, tests, deployments, approvals, release notes and rollback readiness.'},
        {title:'Infrastructure',description:'Supabase, Render, Cloudflare, environments, DNS and production services.'},
        {title:'Observability',description:'Errors, tracing, performance, logs, uptime and production diagnostics.'},
        {title:'Product Analytics',description:'Feature adoption, funnels, session replay, experiments and feature flags.'},
        {title:'API & Integration Centre',description:'OpenAPI, Postman collections, webhooks, health checks and third-party integrations.'},
        {title:'Security & DevSecOps',description:'Secrets, dependencies, access, code scanning, audit and incident hardening.'},
        {title:'Mobile Delivery',description:'Android/iOS builds, signing, store releases and device testing.'},
        {title:'Design & Architecture',description:'Figma, system design, ADRs, schemas and technical roadmap.'}
    ]}
    tools={[
        {name:'Supabase',purpose:'Database, authentication, storage, realtime and Edge Functions.',url:'https://supabase.com/dashboard'},
        {name:'Render',purpose:'Backend services, deployment and runtime logs.',url:'https://dashboard.render.com/'},
        {name:'Cloudflare',purpose:'DNS, edge delivery, security and Pages deployments.',url:'https://dash.cloudflare.com/'},
        {name:'Sentry',purpose:'Application errors, tracing, performance and production diagnostics.',url:'https://sentry.io/'},
        {name:'PostHog',purpose:'Product analytics, session replay, experiments and feature flags.',url:'https://app.posthog.com/'},
        {name:'Figma',purpose:'Product design, prototypes and design-system collaboration.',url:'https://www.figma.com/'},
        {name:'Postman',purpose:'API collections, testing and integration diagnostics.',url:'https://www.postman.com/'}
      ]}
      workspaceLinks={[
        {name:'ParAsYtE Linux',purpose:'Secure engineering terminal and persistent project workspace.',target:'linux'},
        {name:'PArAsYtE Browser',purpose:'Open approved engineering web consoles inside the workspace.',target:'parasyte'},
        {name:'Applications',purpose:'Approved internal and managed engineering applications.',target:'apps'}
      ]}
      workstationContent={<EngineeringWorkbench/>}
      onNavigate={onNavigate}
      execution={execution}
    />
  )
}


export function FinanceTeamWorkspace({
  execution,
  onNavigate
}:{
  execution:ReactNode
  onNavigate?:(target:string)=>void
}){

  return (
    <DepartmentTeamWorkspace
      eyebrow="FINANCE"
      title="Finance Team Workspace"
      subtitle="Accounting, cash control, receivables, payables, budgeting, assets, tax and financial close."
      departmentAliases={[
        'finance',
        'accounting'
      ]}
      roleAliases={[
        'finance'
      ]}
      workstationTitle="Finance & Accounting Workstation"
      workstationDescription="Maintain financial control, reconciliation and planning without exposing finance data outside authorised roles."
      capabilities={[
        {title:'General Ledger & Reporting',description:'Chart of accounts, journals, trial balance, P&L, balance sheet and cash flow.'},
        {title:'Receivables',description:'Invoices, corporate balances, collections, ageing and follow-up.'},
        {title:'Payables',description:'Bills, vendors, approvals, obligations and payment readiness.'},
        {title:'Cash & Banking',description:'Providus balances, statements, transaction categorisation and reconciliation.'},
        {title:'Payments & Settlements',description:'Paystack/Flutterwave collections, settlements, refunds, transfers and disputes.'},
        {title:'Budget & Forecast',description:'Department budgets, scenario planning, variance and cash runway.'},
        {title:'Expenses & Payroll',description:'Expense control, reimbursements, payroll journals and approved payment inputs.'},
        {title:'Tax & Statutory',description:'FIRS, LIRS, pension and statutory obligation calendar with evidence.'},
        {title:'Assets',description:'Fixed assets, useful life, custody, disposals and accountability.'},
        {title:'Close & Audit',description:'Month-end/year-end close, reconciliations, evidence and audit trail.'}
    ]}
    tools={[
        {name:'ProvidusBank',purpose:'RideArrivo corporate banking and statement access.',url:'https://ibank.providusbank.com/provipay#/login'},
        {name:'Paystack',purpose:'Transactions, settlements, refunds, transfers and disputes.',url:'https://dashboard.paystack.com/'},
        {name:'Flutterwave',purpose:'Payment collections, settlements and payment operations.',url:'https://app.flutterwave.com/'},
        {name:'FIRS TaxPro MAX',purpose:'Federal tax filing and compliance administration.',url:'https://taxpromax.firs.gov.ng/'},
        {name:'LIRS eTax',purpose:'Lagos PAYE and state tax administration.',url:'https://etax.lirs.net/'},
        {name:'PenCom Employer Hub',purpose:'Pension employer compliance and clearance.',url:'https://ehub.pencom.gov.ng/'},
        {name:'Google Sheets',purpose:'Controlled finance modelling and reconciliations.',url:'https://sheets.google.com/'}
      ]}
      onNavigate={onNavigate}
      execution={execution}
    />
  )
}


export function PartnershipsTeamWorkspace({
  execution,
  onNavigate
}:{
  execution:ReactNode
  onNavigate?:(target:string)=>void
}){

  return (
    <DepartmentTeamWorkspace
      eyebrow="PARTNERSHIPS"
      title="Partnerships Team Workspace"
      subtitle="Commercial relationships, opportunities, agreements, referrals and partner launch."
      departmentAliases={[
        'partnerships',
        'business development'
      ]}
      roleAliases={[
        'partnerships'
      ]}
      workstationTitle="Partnerships & Business Development Workstation"
      workstationDescription="Move partner relationships from prospecting through agreement, launch, referrals and renewal."
      capabilities={[
        {title:'Partner CRM',description:'Accounts, stakeholders, contacts, relationship history and account ownership.'},
        {title:'Prospecting & Research',description:'Target organisations, qualification, stakeholder mapping and outreach preparation.'},
        {title:'Pipeline & Forecast',description:'Opportunities, stage, value, probability, next actions and expected close.'},
        {title:'Proposals & Commercials',description:'Proposal versions, pricing, commissions, business case and negotiation history.'},
        {title:'Agreements & Approvals',description:'Commercial terms, Legal handoff, approvals, signature and obligations.'},
        {title:'Partner Onboarding',description:'Commercial, legal, finance, operations, technology and marketing launch readiness.'},
        {title:'Referrals & Commission',description:'Booking attribution, partner earnings, settlement status and disputes.'},
        {title:'Partner Performance',description:'Revenue, referrals, service quality, activity and relationship health.'},
        {title:'Renewals & Expansion',description:'Renewal dates, expansion opportunities, QBRs and next-phase planning.'}
    ]}
    tools={[
        {name:'HubSpot CRM',purpose:'Partner accounts, contacts, activity history and pipeline when connected.',url:'https://app.hubspot.com/'},
        {name:'LinkedIn',purpose:'Partner research, stakeholder mapping and professional outreach.',url:'https://www.linkedin.com/'},
        {name:'Google Maps',purpose:'Hotels, institutions, travel businesses and geographic prospecting.',url:'https://maps.google.com/'},
        {name:'Google Meet',purpose:'Partner discovery, negotiation and review meetings.',url:'https://meet.google.com/'},
        {name:'DocuSign',purpose:'Proposal and agreement signature workflows.',url:'https://app.docusign.com/'}
      ]}
      onNavigate={onNavigate}
      execution={execution}
    />
  )
}


export function LegalTeamWorkspace({
  execution,
  onNavigate
}:{
  execution:ReactNode
  onNavigate?:(target:string)=>void
}){

  return (
    <DepartmentTeamWorkspace
      eyebrow="LEGAL & COMPLIANCE"
      title="Legal Team Workspace"
      subtitle="Contracts, regulatory obligations, privacy, evidence, renewals and legal service delivery."
      departmentAliases={[
        'legal',
        'compliance'
      ]}
      roleAliases={[
        'legal'
      ]}
      workstationTitle="Legal & Compliance Workstation"
      workstationDescription="Manage contracts and regulatory obligations with controlled evidence, deadlines and cross-functional review."
      capabilities={[
        {title:'Legal Intake',description:'Structured requests, requester, priority, owner, due date and legal-service status.'},
        {title:'Contract Lifecycle',description:'Drafting, review, negotiation, version control, approvals, signature and repository.'},
        {title:'Templates & Playbooks',description:'Approved clauses, fallback positions, standard agreements and negotiation guidance.'},
        {title:'Corporate & CAC',description:'Board/corporate records, annual returns, directors, address and post-incorporation actions.'},
        {title:'Privacy & NDPC',description:'Data-processing register, rights requests, incidents, DPCO/CAR evidence and privacy governance.'},
        {title:'Compliance Register',description:'Obligations, owners, evidence, due dates, filings and remediation.'},
        {title:'Regulatory Calendar',description:'Licence, filing, policy, contract and statutory renewal deadlines.'},
        {title:'Evidence & Investigations',description:'Legal holds, incident evidence, privileged notes and investigation records.'},
        {title:'E-signature & Audit',description:'Approvals, signatures, completion evidence and immutable agreement history.'}
    ]}
    tools={[
        {name:'CAC iCRP',purpose:'Corporate records, annual returns and post-incorporation filings.',url:'https://icrp.cac.gov.ng/'},
        {name:'NDPC',purpose:'Nigeria data-protection compliance, audit and regulatory guidance.',url:'https://ndpc.gov.ng/'},
        {name:'DocuSign',purpose:'Agreement approvals, signature and audit trails.',url:'https://app.docusign.com/'},
        {name:'Google Docs',purpose:'Controlled drafting, redlining and collaborative legal review.',url:'https://docs.google.com/'}
      ]}
      onNavigate={onNavigate}
      execution={execution}
    />
  )
}
