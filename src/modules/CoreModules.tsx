import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { BadgeCheck, CalendarDays, FileCheck2, Headphones, MessageCircle, Phone, Route, ShieldAlert, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { DataWorkbench } from './DataWorkbench'
import SupportOperationsPanel from './SupportOperationsPanel'
import AdminAccessManager from './AdminAccessManager'
import AdminDownloadAccessManager from './AdminDownloadAccessManager'

function Title({eyebrow,title,subtitle}:{eyebrow:string;title:string;subtitle:string}){return <div className="sectionTitle"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></div></div>}

export function CRMModule(){return <section><Title eyebrow="CUSTOMER RELATIONSHIPS" title="CRM" subtitle="Live commercial pipeline and account management backed by Supabase."/><div className="grid2"><DataWorkbench table="crm_leads" title="Lead pipeline" description="Create and manage qualified demand." createLabel="New lead" fields={[{key:'name',label:'Name',required:true},{key:'company',label:'Company'},{key:'email',label:'Email'},{key:'phone',label:'Phone'},{key:'source',label:'Source'},{key:'stage',label:'Stage',type:'select',options:['new','qualified','proposal','negotiation','won','lost'],required:true},{key:'estimated_value',label:'Estimated value (NGN)',type:'number'}]} columns={[{key:'name',label:'Lead'},{key:'company',label:'Company'},{key:'source',label:'Source'},{key:'stage',label:'Stage'},{key:'estimated_value',label:'Value'}]}/><DataWorkbench table="crm_accounts" title="Accounts" description="Riders, corporate, hotel and travel relationships." createLabel="New account" fields={[{key:'name',label:'Account name',required:true},{key:'account_type',label:'Type',type:'select',options:['individual','corporate','hotel','travel_partner','other'],required:true},{key:'lifecycle_stage',label:'Lifecycle',required:true},{key:'estimated_value',label:'Estimated value (NGN)',type:'number'},{key:'status',label:'Status',required:true}]} columns={[{key:'name',label:'Account'},{key:'account_type',label:'Type'},{key:'lifecycle_stage',label:'Lifecycle'},{key:'estimated_value',label:'Value'},{key:'status',label:'Status'}]}/></div></section>}

export function SupportModule(){
  const whatsappNumber='2348162706078'
  const openWhatsApp=()=>{const message=encodeURIComponent('Hello RideArrivo Support, I need assistance.');window.location.href=`https://wa.me/${whatsappNumber}?text=${message}`}
  const callSupport=()=>{window.location.href='tel:+2348162706078'}
  return <section>
    <Title eyebrow="SUPPORT CONTROL" title="Support Station" subtitle="Omnichannel service, SLA control, booking context, handovers, reusable responses and quality review."/>
    <SupportOperationsPanel/>
    <div className="supportActions glassCard"><div><h3>RideArrivo Support Communications</h3><p>Contact customers and manage approved support communications directly from the Support Station.</p></div><div className="buttonRow"><button className="whatsappButton" onClick={openWhatsApp}><MessageCircle size={17}/>WhatsApp</button><button className="glassButton" onClick={callSupport}><Phone size={17}/>Call</button></div></div>
    <div className="grid2">
      <DataWorkbench table="support_cases" title="Support cases" orderBy="opened_at" description="Customer and booking issues from intake through closure." createLabel="New case" fields={[{key:'reference',label:'Reference',required:true},{key:'subject',label:'Subject',required:true},{key:'category',label:'Category',required:true},{key:'priority',label:'Priority',type:'select',options:['low','normal','high','critical'],required:true},{key:'status',label:'Status',type:'select',options:['open','in_progress','waiting','resolved','closed'],required:true},{key:'booking_reference',label:'Booking reference'}]} columns={[{key:'reference',label:'Reference'},{key:'subject',label:'Subject'},{key:'category',label:'Category'},{key:'priority',label:'Priority'},{key:'status',label:'Status'}]}/>
      <DataWorkbench table="support_handovers" title="Shift handovers" description="Open customer issues and operational context that must survive a shift change." createLabel="New handover" fields={[{key:'shift_label',label:'Shift / handover',required:true},{key:'summary',label:'Summary',type:'textarea',required:true},{key:'open_items',label:'Open items',type:'textarea'},{key:'priority',label:'Priority',type:'select',options:['low','normal','high','critical'],required:true},{key:'status',label:'Status',type:'select',options:['open','acknowledged','closed'],required:true},{key:'owner_id',label:'Owner',type:'employee'}]} columns={[{key:'shift_label',label:'Shift'},{key:'summary',label:'Summary'},{key:'priority',label:'Priority'},{key:'status',label:'Status'}]}/>
      <DataWorkbench table="support_macros" title="Approved response library" description="Reusable customer-service responses and troubleshooting guidance." createLabel="Add response" fields={[{key:'title',label:'Title',required:true},{key:'category',label:'Category',required:true},{key:'response_text',label:'Approved response',type:'textarea',required:true}]} columns={[{key:'title',label:'Response'},{key:'category',label:'Category'},{key:'response_text',label:'Content'}]}/>
      <DataWorkbench table="support_quality_reviews" title="Service quality reviews" description="Review support interactions for quality, coaching and repeat-contact patterns." createLabel="Add review" fields={[{key:'case_reference',label:'Case reference',required:true},{key:'score',label:'Score (1-5)',type:'number'},{key:'review_notes',label:'Review notes',type:'textarea'},{key:'reviewed_by',label:'Reviewer',type:'employee'}]} columns={[{key:'case_reference',label:'Case'},{key:'score',label:'Score'},{key:'review_notes',label:'Review notes'}]}/>
      <div className="glassCard feature"><Headphones/><h3>Support operating standard</h3><p>Every case has a reference, priority and owner. Critical safety events are escalated into Operations and preserved in the incident trail.</p><div className="miniChecklist"><span><BadgeCheck size={15}/>Identity and booking verified</span><span><Route size={15}/>Trip context captured</span><span><ShieldAlert size={15}/>Safety escalation linked when required</span></div></div>
    </div>
  </section>
}

export function OperationsModule(){
  return <section>
    <Title eyebrow="OPERATIONS" title="Ride Operations" subtitle="Dispatch readiness, shifts, fleet maintenance, inspections, flight monitoring and incident control."/>
    <div className="grid2">
      <DataWorkbench table="incidents" title="Incident register" orderBy="occurred_at" description="Safety, service and operational exceptions." createLabel="New incident" fields={[{key:'reference',label:'Reference',required:true},{key:'severity',label:'Severity',type:'select',options:['low','medium','high','critical'],required:true},{key:'category',label:'Category',required:true},{key:'summary',label:'Summary',type:'textarea',required:true},{key:'status',label:'Status',required:true}]} columns={[{key:'reference',label:'Reference'},{key:'severity',label:'Severity'},{key:'category',label:'Category'},{key:'summary',label:'Summary'},{key:'status',label:'Status'}]}/>
      <DataWorkbench table="operations_driver_shifts" title="Driver shifts" orderBy="shift_date" description="Driver coverage, vehicle assignment and shift readiness." createLabel="Plan shift" fields={[{key:'driver_name',label:'Driver',required:true},{key:'shift_date',label:'Shift date',type:'date',required:true},{key:'start_time',label:'Start time',type:'time'},{key:'end_time',label:'End time',type:'time'},{key:'vehicle_reference',label:'Vehicle reference'},{key:'status',label:'Status',type:'select',options:['planned','confirmed','active','completed','cancelled'],required:true},{key:'notes',label:'Notes',type:'textarea'}]} columns={[{key:'shift_date',label:'Date'},{key:'driver_name',label:'Driver'},{key:'vehicle_reference',label:'Vehicle'},{key:'status',label:'Status'}]}/>
      <DataWorkbench table="operations_fleet_maintenance" title="Fleet maintenance" description="Preventive maintenance, due work, vendors and cost control." createLabel="Schedule maintenance" fields={[{key:'vehicle_reference',label:'Vehicle',required:true},{key:'maintenance_type',label:'Maintenance type',required:true},{key:'due_date',label:'Due date',type:'date'},{key:'odometer_due',label:'Odometer due',type:'number'},{key:'status',label:'Status',type:'select',options:['scheduled','due','in_service','complete','overdue'],required:true},{key:'vendor',label:'Vendor'},{key:'cost',label:'Cost (NGN)',type:'number'},{key:'notes',label:'Notes',type:'textarea'}]} columns={[{key:'vehicle_reference',label:'Vehicle'},{key:'maintenance_type',label:'Maintenance'},{key:'due_date',label:'Due'},{key:'status',label:'Status'},{key:'cost',label:'Cost'}]}/>
      <DataWorkbench table="operations_vehicle_inspections" title="Vehicle inspections" orderBy="inspection_date" description="Readiness inspections, defects and follow-up control." createLabel="Record inspection" fields={[{key:'vehicle_reference',label:'Vehicle',required:true},{key:'inspection_date',label:'Inspection date',type:'date',required:true},{key:'inspector',label:'Inspector',required:true},{key:'overall_status',label:'Result',type:'select',options:['pass','attention','fail'],required:true},{key:'defects',label:'Defects / observations',type:'textarea'},{key:'follow_up_due',label:'Follow-up due',type:'date'}]} columns={[{key:'inspection_date',label:'Date'},{key:'vehicle_reference',label:'Vehicle'},{key:'inspector',label:'Inspector'},{key:'overall_status',label:'Result'},{key:'follow_up_due',label:'Follow-up'}]}/>
      <DataWorkbench table="operations_flight_watch" title="Airport flight watch" description="Flight arrival monitoring tied to airport-pickup execution." createLabel="Watch flight" fields={[{key:'booking_reference',label:'Booking reference'},{key:'flight_number',label:'Flight number',required:true},{key:'airline',label:'Airline'},{key:'scheduled_arrival',label:'Scheduled arrival',type:'datetime-local'},{key:'terminal',label:'Terminal'},{key:'status',label:'Status',required:true},{key:'notes',label:'Notes',type:'textarea'}]} columns={[{key:'flight_number',label:'Flight'},{key:'booking_reference',label:'Booking'},{key:'airline',label:'Airline'},{key:'scheduled_arrival',label:'Arrival'},{key:'status',label:'Status'}]}/>
      <div className="glassCard feature"><Route/><h3>Live dispatch integration</h3><p>Live booking, vehicle and driver-position data remains sourced from RideArrivo operational APIs; these records add readiness, maintenance, airport and exception control without creating a second dispatch system.</p></div>
    </div>
  </section>
}

export function LegalModule(){
  return <section>
    <Title eyebrow="LEGAL & COMPLIANCE" title="Legal & Compliance" subtitle="Contract lifecycle, legal intake, privacy requests, regulatory filings, evidence and renewal control."/>
    <div className="grid2">
      <DataWorkbench table="legal_contracts" title="Contract register" description="Counterparties, status and renewal dates." createLabel="New contract" fields={[{key:'title',label:'Contract title',required:true},{key:'counterparty',label:'Counterparty',required:true},{key:'status',label:'Status',required:true},{key:'effective_date',label:'Effective date',type:'date'},{key:'renewal_date',label:'Renewal date',type:'date'},{key:'document_path',label:'Document path / URL'}]} columns={[{key:'title',label:'Contract'},{key:'counterparty',label:'Counterparty'},{key:'status',label:'Status'},{key:'effective_date',label:'Effective'},{key:'renewal_date',label:'Renewal'}]}/>
      <DataWorkbench table="legal_requests" title="Legal request intake" description="Internal legal requests with priority, due date and review status." createLabel="New request" fields={[{key:'title',label:'Request title',required:true},{key:'request_type',label:'Request type',required:true},{key:'priority',label:'Priority',type:'select',options:['low','normal','high','critical'],required:true},{key:'status',label:'Status',type:'select',options:['open','triage','in_review','waiting','complete','closed'],required:true},{key:'requester_id',label:'Requester',type:'employee'},{key:'owner_id',label:'Legal owner',type:'employee'},{key:'due_date',label:'Due date',type:'date'},{key:'summary',label:'Summary',type:'textarea'}]} columns={[{key:'title',label:'Request'},{key:'request_type',label:'Type'},{key:'priority',label:'Priority'},{key:'status',label:'Status'},{key:'due_date',label:'Due'}]}/>
      <DataWorkbench table="privacy_requests" title="Privacy rights requests" orderBy="received_at" description="Data-subject requests, identity verification, statutory due dates and resolution evidence." createLabel="Log privacy request" fields={[{key:'request_type',label:'Request type',required:true},{key:'data_subject_reference',label:'Data subject reference',required:true},{key:'status',label:'Status',type:'select',options:['received','identity_verification','in_progress','extended','complete','rejected'],required:true},{key:'owner_id',label:'Owner',type:'employee'},{key:'due_date',label:'Due date',type:'date'},{key:'resolution_notes',label:'Resolution notes',type:'textarea'}]} columns={[{key:'data_subject_reference',label:'Subject'},{key:'request_type',label:'Type'},{key:'status',label:'Status'},{key:'due_date',label:'Due'}]}/>
      <DataWorkbench table="regulatory_filings" title="Regulatory filings" description="CAC, privacy, tax and other regulatory filings with due-date and evidence control." createLabel="Add filing" fields={[{key:'regulator',label:'Regulator',required:true},{key:'filing_name',label:'Filing',required:true},{key:'period_label',label:'Period'},{key:'due_date',label:'Due date',type:'date',required:true},{key:'status',label:'Status',type:'select',options:['open','preparing','review','filed','accepted','overdue'],required:true},{key:'owner_id',label:'Owner',type:'employee'},{key:'evidence_path',label:'Evidence path / URL'}]} columns={[{key:'regulator',label:'Regulator'},{key:'filing_name',label:'Filing'},{key:'period_label',label:'Period'},{key:'due_date',label:'Due'},{key:'status',label:'Status'}]}/>
      <DataWorkbench table="compliance_items" title="Compliance register" description="Obligations, evidence and due dates." createLabel="Add compliance item" fields={[{key:'title',label:'Obligation',required:true},{key:'due_date',label:'Due date',type:'date'},{key:'status',label:'Status',required:true},{key:'evidence_path',label:'Evidence path / URL'}]} columns={[{key:'title',label:'Obligation'},{key:'due_date',label:'Due date'},{key:'status',label:'Status'},{key:'evidence_path',label:'Evidence'}]}/>
    </div>
  </section>
}

export function PeopleModule(){
  const [employees,setEmployees]=useState<Record<string,unknown>[]>([])
  const [leave,setLeave]=useState({leave_type:'Annual',start_date:'',end_date:'',reason:''})
  const [message,setMessage]=useState('')
  useEffect(()=>{if(!supabase)return;void supabase.from('employee_profiles').select('id,full_name,email,department,job_title,role').order('full_name').then(({data})=>setEmployees((data||[]) as Record<string,unknown>[]))},[])
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!supabase)return;const {data:{user}}=await supabase.auth.getUser();if(!user){setMessage('Session expired.');return}const {error}=await supabase.from('leave_requests').insert({employee_id:user.id,...leave});setMessage(error?error.message:'Leave request submitted.');if(!error)setLeave({leave_type:'Annual',start_date:'',end_date:'',reason:''})}
  return <section>
    <Title eyebrow="PEOPLE & HR" title="People Operations" subtitle="Employee records, recruitment, onboarding, leave, performance and learning under role-based controls."/>
    <div className="grid2">
      <div className="glassCard workbench"><div className="workbenchHead"><div><h3>Employee directory</h3><p>Live company directory. Private employee headshots are not exposed here.</p></div><Users/></div><div className="moduleTableWrap"><table className="moduleTable"><thead><tr><th>Name</th><th>Department</th><th>Job title</th><th>Role</th></tr></thead><tbody>{employees.map(e=><tr key={String(e.id)}><td>{String(e.full_name||e.email)}</td><td>{String(e.department||'—')}</td><td>{String(e.job_title||'—')}</td><td>{String(e.role||'employee')}</td></tr>)}</tbody></table></div></div>
      <div className="glassCard workbench"><div className="workbenchHead"><div><h3>Request leave</h3><p>Employee self-service protected by RLS.</p></div><CalendarDays/></div><form className="quickForm" onSubmit={submit}><div className="quickFormGrid"><label>Leave type<select value={leave.leave_type} onChange={e=>setLeave({...leave,leave_type:e.target.value})}><option>Annual</option><option>Sick</option><option>Compassionate</option><option>Study</option><option>Unpaid</option></select></label><label>Start date<input type="date" required value={leave.start_date} onChange={e=>setLeave({...leave,start_date:e.target.value})}/></label><label>End date<input type="date" required value={leave.end_date} onChange={e=>setLeave({...leave,end_date:e.target.value})}/></label><label>Reason<textarea value={leave.reason} onChange={e=>setLeave({...leave,reason:e.target.value})}/></label></div>{message&&<div className="moduleNotice">{message}</div>}<button className="primaryButton">Submit request</button></form></div>
      <DataWorkbench table="people_candidates" title="Recruitment pipeline" description="Candidates from application through interview, offer and hire." createLabel="Add candidate" fields={[{key:'full_name',label:'Candidate name',required:true},{key:'email',label:'Email'},{key:'phone',label:'Phone'},{key:'role_title',label:'Role',required:true},{key:'stage',label:'Stage',type:'select',options:['applied','screening','interview','assessment','offer','hired','rejected','withdrawn'],required:true},{key:'source',label:'Source'},{key:'interview_date',label:'Interview date',type:'datetime-local'},{key:'owner_id',label:'Recruiter / owner',type:'employee'},{key:'notes',label:'Notes',type:'textarea'}]} columns={[{key:'full_name',label:'Candidate'},{key:'role_title',label:'Role'},{key:'stage',label:'Stage'},{key:'source',label:'Source'},{key:'interview_date',label:'Interview'}]}/>
      <DataWorkbench table="people_performance_reviews" title="Performance reviews" description="Review cycles, goals, manager assessment and completion status." createLabel="Start review" fields={[{key:'employee_id',label:'Employee',type:'employee',required:true},{key:'review_period',label:'Review period',required:true},{key:'rating',label:'Rating',type:'number'},{key:'status',label:'Status',type:'select',options:['draft','employee_input','manager_review','calibration','complete'],required:true},{key:'goals',label:'Goals / outcomes',type:'textarea'},{key:'manager_notes',label:'Manager notes',type:'textarea'},{key:'review_date',label:'Review date',type:'date'}]} columns={[{key:'review_period',label:'Period'},{key:'rating',label:'Rating'},{key:'status',label:'Status'},{key:'review_date',label:'Review date'}]}/>
      <DataWorkbench table="people_training_records" title="Learning & compliance training" description="Assigned learning, due dates, completion and certificate references." createLabel="Assign training" fields={[{key:'employee_id',label:'Employee',type:'employee',required:true},{key:'training_name',label:'Training',required:true},{key:'provider',label:'Provider'},{key:'status',label:'Status',type:'select',options:['assigned','in_progress','completed','expired'],required:true},{key:'due_date',label:'Due date',type:'date'},{key:'completed_at',label:'Completed at',type:'datetime-local'},{key:'certificate_path',label:'Certificate path / URL'}]} columns={[{key:'training_name',label:'Training'},{key:'provider',label:'Provider'},{key:'status',label:'Status'},{key:'due_date',label:'Due'}]}/>
    </div>
  </section>
}

export function AdminModule(){
  const adminUrl = 'https://admin.ridearrivo.com'

  return (
    <section>
      <Title
        eyebrow="ADMINISTRATION"
        title="RideArrivo Admin"
        subtitle="Operational admin console, workspace applications and security controls."
      />

      <AdminAccessManager/>
      <AdminDownloadAccessManager/>

      <div className="adminConsoleCard glassCard">
        <div className="adminConsoleHeader">
          <div>
            <span className="eyebrow">OPERATIONS CONSOLE</span>
            <h3>RideArrivo Admin Console</h3>
            <p>
              Manage riders, drivers, trips, bookings, safety and operational
              controls from the RideArrivo Admin Console.
            </p>
          </div>

          <button
            className="primaryButton"
            onClick={() => {
              window.location.href = adminUrl
            }}
          >
            Open Full Admin Console
          </button>
        </div>

        <div className="adminConsoleFrameWrap">
          <iframe
            src={adminUrl}
            title="RideArrivo Admin Console"
            className="adminConsoleFrame"
            allow="clipboard-read; clipboard-write"
          />
        </div>

        <div className="adminConsoleHint">
          If the console does not load inside this panel, the Admin Console
          security policy is blocking iframe embedding. Use the full console
          button above while we connect the Admin API natively.
        </div>
      </div>

      <div className="grid2">
        <DataWorkbench
          table="workspace_apps"
          title="Application registry"
          description="Native, API and embedded workspace applications."
          createLabel="Register app"
          fields={[
            {key:'name',label:'Name',required:true},
            {key:'slug',label:'Slug',required:true},
            {key:'url',label:'URL'},
            {
              key:'mode',
              label:'Mode',
              type:'select',
              options:['native','embed','api','download'],
              required:true
            }
          ]}
          columns={[
            {key:'name',label:'Application'},
            {key:'slug',label:'Slug'},
            {key:'mode',label:'Mode'},
            {key:'url',label:'URL'}
          ]}
        />

        <div className="glassCard feature">
          <FileCheck2/>
          <h3>Security posture</h3>
          <p>
            Role access is enforced at Supabase RLS. Service-role keys must
            never be exposed in Vite or Cloudflare frontend variables.
          </p>

          <div className="miniChecklist">
            <span>
              <BadgeCheck size={15}/>
              RideArrivo-only email authentication
            </span>
            <span>
              <BadgeCheck size={15}/>
              RLS on business tables
            </span>
            <span>
              <BadgeCheck size={15}/>
              Anon table access revoked
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
