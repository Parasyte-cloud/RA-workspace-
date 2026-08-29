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
  {name:'Shared Workspaces',purpose:'Project rooms and cross-department collaboration.',target:'shared'},
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
        <button type="button" className={view==='workstation'?'active':''} onClick={()=>setView('workstation')}><Wrench size={16}/>Workstation</button>
        <button type="button" className={view==='shared'?'active':''} onClick={()=>setView('shared')}><FolderKanban size={16}/>Shared Workspaces</button>
        <button type="button" className={view==='execution'?'active':''} onClick={()=>setView('execution')}><Layers3 size={16}/>Execution</button>
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
              SPECIALIST WORKSTATION
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
                TOOLKIT
              </span>

              <h3>
                Work tools
              </h3>

              <p>
                Specialist external tools open through PArAsYtE so
                department work stays inside the controlled workspace.
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
    <div className="departmentStationIntro"><span className="eyebrow">EXECUTIVE EXECUTION</span><h3>CEO cross-functional control</h3><p>Open the live departmental control centres required for decisions, approvals, escalation and company-wide follow-through. No placeholder figures are shown here; each destination uses its live authorised workspace data.</p></div>
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
      {title:'Company Priorities',description:'Strategic objectives, ownership, deadlines and cross-functional follow-through.'},
      {title:'Approvals & Decisions',description:'Review work requiring executive approval, resolve blockers and record accountable decisions.'},
      {title:'Financial Stewardship',description:'Revenue, cash, budgets, obligations and financial control through the authorised finance workspace.'},
      {title:'Service Performance',description:'Support, operations, safety and service-quality visibility without bypassing departmental controls.'},
      {title:'Growth & Partnerships',description:'Marketing performance, commercial pipeline, strategic partners and expansion readiness.'},
      {title:'People & Organisation',description:'Headcount, leadership accountability, onboarding, performance and organisation health.'},
      {title:'Governance & Risk',description:'Legal, privacy, compliance, incidents and material business risks requiring leadership attention.'},
      {title:'Technology & Delivery',description:'Product delivery, reliability, security and release readiness through Engineering.'}
    ]}
    tools={[
      {name:'ProvidusBank',purpose:'Authorised corporate banking access.',url:'https://ibank.providusbank.com/provipay#/login'},
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
        {
          title:'Support Queue',
          description:
            'Case intake, prioritisation, assignment and resolution.'
        },
        {
          title:'Live Ride Context',
          description:
            'Bookings, rides, riders and drivers from the read-only RideArrivo backend gateway.'
        },
        {
          title:'Customer Communication',
          description:
            'Mail, WhatsApp and approved customer communication channels.'
        },
        {
          title:'Safety Escalation',
          description:
            'Incident and safety handoff with clear operational ownership.'
        },
        {
          title:'Knowledge & Macros',
          description:
            'Reusable answers, operating procedures and support guidance.'
        },
        {
          title:'Service Quality',
          description:
            'Backlog, resolution patterns and service improvement.'
        }
      ]}
      tools={[
        {
          name:'Zoho Mail',
          purpose:'RideArrivo company email.',
          url:'https://mail.zoho.com/'
        },
        {
          name:'WhatsApp Web',
          purpose:'Approved support communication.',
          url:'https://web.whatsapp.com/'
        },
        {
          name:'Google Maps',
          purpose:'Route and pickup context.',
          url:'https://maps.google.com/'
        }
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
        {
          title:'Dispatch',
          description:
            'Booking allocation, driver matching and trip ownership.'
        },
        {
          title:'Live Trips',
          description:
            'Active journey context and operational exceptions.'
        },
        {
          title:'Driver Readiness',
          description:
            'Availability, verification and operational readiness.'
        },
        {
          title:'Fleet Readiness',
          description:
            'Vehicle availability, documents, inspections and maintenance.'
        },
        {
          title:'Airport Operations',
          description:
            'Flight-linked pickups, arrival coordination and exceptions.'
        },
        {
          title:'Incident Control',
          description:
            'Safety and operational incidents with corrective action.'
        }
      ]}
      tools={[
        {
          name:'RideArrivo Admin',
          purpose:'Operational backend console.',
          url:'https://admin.ridearrivo.com'
        },
        {
          name:'Google Maps',
          purpose:'Routes, locations and pickup context.',
          url:'https://maps.google.com/'
        },
        {
          name:'FlightRadar24',
          purpose:'Operational flight-arrival context.',
          url:'https://www.flightradar24.com/'
        }
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
        {
          title:'Recruitment',
          description:
            'Candidates, interviews, offers and hiring coordination.'
        },
        {
          title:'Onboarding',
          description:
            'Accounts, equipment, documents and first-day readiness.'
        },
        {
          title:'Leave & Attendance',
          description:
            'Requests, approvals, absence and availability.'
        },
        {
          title:'Performance',
          description:
            'Objectives, reviews, development and feedback.'
        },
        {
          title:'Employee Services',
          description:
            'People requests, letters, records and internal support.'
        },
        {
          title:'Offboarding',
          description:
            'Access removal, handover and exit controls.'
        }
      ]}
      tools={[
        {
          name:'LinkedIn',
          purpose:'Recruitment and professional sourcing.',
          url:'https://www.linkedin.com/'
        },
        {
          name:'Google Meet',
          purpose:'Interviews and employee meetings.',
          url:'https://meet.google.com/'
        },
        {
          name:'Google Docs',
          purpose:'Collaborative people documents.',
          url:'https://docs.google.com/'
        }
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
        {
          title:'Source Control',
          description:
            'Repositories, pull requests, reviews and release branches.'
        },
        {
          title:'CI/CD',
          description:
            'Build, test, deployment and release health.'
        },
        {
          title:'Infrastructure',
          description:
            'Render, Supabase, Cloudflare and production services.'
        },
        {
          title:'Mobile Delivery',
          description:
            'Android/iOS builds, signing and release management.'
        },
        {
          title:'Security',
          description:
            'Secrets, dependencies, access, incidents and hardening.'
        },
        {
          title:'Architecture',
          description:
            'APIs, schemas, engineering decisions and technical roadmap.'
        }
      ]}
      tools={[
        {
          name:'GitHub',
          purpose:'Repositories, PRs, Actions and releases.',
          url:'https://github.com/Parasyte-cloud'
        },
        {
          name:'Supabase',
          purpose:'Database, authentication and Edge Functions.',
          url:'https://supabase.com/dashboard'
        },
        {
          name:'Render',
          purpose:'Backend services and deployment.',
          url:'https://dashboard.render.com/'
        },
        {
          name:'Cloudflare',
          purpose:'DNS, edge and workspace delivery.',
          url:'https://dash.cloudflare.com/'
        }
      ]}
      workspaceLinks={[
        {name:'ParAsYtE Linux',purpose:'Secure engineering terminal and persistent project workspace.',target:'linux'},
        {name:'PArAsYtE Browser',purpose:'Open approved engineering web consoles inside the workspace.',target:'parasyte'},
        {name:'Applications',purpose:'Approved internal and managed engineering applications.',target:'apps'}
      ]}
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
        {
          title:'Receivables',
          description:
            'Invoices, collections, balances and ageing.'
        },
        {
          title:'Payables',
          description:
            'Bills, approvals, obligations and payment readiness.'
        },
        {
          title:'Cash & Banking',
          description:
            'Banking controls and reconciliation.'
        },
        {
          title:'Budgeting',
          description:
            'Department budgets, variance and planning.'
        },
        {
          title:'Assets',
          description:
            'Fixed assets, lifecycle and accountability.'
        },
        {
          title:'Tax & Close',
          description:
            'Tax obligations and period-close controls.'
        }
      ]}
      tools={[
        {
          name:'ProvidusBank',
          purpose:'RideArrivo banking portal.',
          url:'https://ibank.providusbank.com/provipay#/login'
        },
        {
          name:'Google Sheets',
          purpose:'Controlled finance analysis and models.',
          url:'https://sheets.google.com/'
        }
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
        {
          title:'Partner CRM',
          description:
            'Relationship records, contacts and account context.'
        },
        {
          title:'Pipeline',
          description:
            'Opportunities, value, stage and next actions.'
        },
        {
          title:'Proposals',
          description:
            'Commercial proposals and negotiation support.'
        },
        {
          title:'Agreements',
          description:
            'Commercial handoff into Legal and approval.'
        },
        {
          title:'Onboarding',
          description:
            'Cross-functional partner launch readiness.'
        },
        {
          title:'Partner Health',
          description:
            'Activity, referrals, renewals and relationship quality.'
        }
      ]}
      tools={[
        {
          name:'LinkedIn',
          purpose:'Partner research and professional outreach.',
          url:'https://www.linkedin.com/'
        },
        {
          name:'Google Maps',
          purpose:'Hotels, organisations and geographic research.',
          url:'https://maps.google.com/'
        },
        {
          name:'Google Meet',
          purpose:'Partner meetings.',
          url:'https://meet.google.com/'
        }
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
        {
          title:'Contracts',
          description:
            'Drafting, review, status, counterparties and renewals.'
        },
        {
          title:'Compliance',
          description:
            'Obligations, evidence, deadlines and ownership.'
        },
        {
          title:'Privacy',
          description:
            'Data protection, requests, processing and governance.'
        },
        {
          title:'Corporate',
          description:
            'Board, CAC and corporate documentation.'
        },
        {
          title:'Legal Requests',
          description:
            'Internal legal review and advice workflow.'
        },
        {
          title:'Regulatory Calendar',
          description:
            'Renewals, filings and deadline visibility.'
        }
      ]}
      tools={[
        {
          name:'CAC Nigeria',
          purpose:'Corporate registration and filing services.',
          url:'https://www.cac.gov.ng/'
        },
        {
          name:'Google Docs',
          purpose:'Collaborative document review.',
          url:'https://docs.google.com/'
        }
      ]}
      onNavigate={onNavigate}
      execution={execution}
    />
  )
}
