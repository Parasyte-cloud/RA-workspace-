import { useCallback, useEffect, useMemo, useState } from 'react'
import { Award, Eye, Gift, RefreshCw, RotateCcw, ShieldCheck, Sparkles, UserRoundCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { CeremonyPresentation } from '../celebrations/types'
import DepartmentTrophyScene from '../components/celebrations/DepartmentTrophyScene'
import PersonalAwardScene from '../components/celebrations/PersonalAwardScene'
import CompanyMilestoneScene from '../components/celebrations/CompanyMilestoneScene'
import '../recognition-admin.css'

type HealthRow={
  source_kind:string
  state:string
  delivery_count:number|string
  oldest_eligible_at:string|null
  newest_updated_at:string|null
}
type DirectoryRow={employee_id:string;full_name:string;department:string;job_title:string}
type AuditRow={event_id:number|string;action:string;entity_type:string;entity_id:string;actor_id:string;actor_name:string|null;target_employee_id:string|null;target_name:string|null;reason:string;metadata:Record<string,unknown>;created_at:string}
type AdminView='health'|'issue'|'govern'|'audit'|'preview'
type PreviewTheme='department_trophy'|'personal_award'|'company_recognition'|'company_milestone'
type PreviewDevice='desktop'|'tablet'|'mobile'

const CATEGORY_OPTIONS=[
  ['customer_commendation','Customer commendation'],
  ['team_commendation','Team commendation'],
  ['major_project_contribution','Major project contribution'],
  ['clean_overdue_record','Clean overdue record'],
  ['golden_of_week','Golden of the Week'],
  ['service_anniversary','Service anniversary'],
  ['training_compliance','Training / compliance'],
  ['identity_compliance_milestone','Identity compliance milestone'],
  ['other','Other recognition'],
] as const

function when(value:string|null){
  if(!value)return 'Not set'
  const parsed=new Date(value)
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString()
}
function requestId(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID()
  const bytes=new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  bytes[6]=(bytes[6]&0x0f)|0x40
  bytes[8]=(bytes[8]&0x3f)|0x80
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export default function RecognitionCelebrationsAdmin(){
  const [view,setView]=useState<AdminView>('health')
  const [authorized,setAuthorized]=useState<boolean|null>(null)
  const [health,setHealth]=useState<HealthRow[]>([])
  const [directory,setDirectory]=useState<DirectoryRow[]>([])
  const [audit,setAudit]=useState<AuditRow[]>([])
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [employeeId,setEmployeeId]=useState('')
  const [category,setCategory]=useState('customer_commendation')
  const [awardTitle,setAwardTitle]=useState('')
  const [awardDescription,setAwardDescription]=useState('')
  const [issueReason,setIssueReason]=useState('')
  const [companyTitle,setCompanyTitle]=useState('')
  const [companyMessage,setCompanyMessage]=useState('')
  const [deliveryId,setDeliveryId]=useState('')
  const [reissueReason,setReissueReason]=useState('')
  const [awardId,setAwardId]=useState('')
  const [visibility,setVisibility]=useState<'private'|'company_recognition'>('company_recognition')
  const [governReason,setGovernReason]=useState('')
  const [previewTheme,setPreviewTheme]=useState<PreviewTheme>('department_trophy')
  const [previewDevice,setPreviewDevice]=useState<PreviewDevice>('desktop')
  const [reducedMotion,setReducedMotion]=useState(false)
  const [previewTitle,setPreviewTitle]=useState('A moment worth celebrating')
  const [previewMessage,setPreviewMessage]=useState('Thank you for raising the standard at RideArrivo.')
  const [preview,setPreview]=useState<CeremonyPresentation|null>(null)

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){setAuthorized(false);setLoading(false);return}
    setLoading(true);setNotice('')
    try{
      const authority=await client.rpc('can_govern_recognition')
      if(authority.error)throw authority.error
      const allowed=authority.data===true
      setAuthorized(allowed)
      if(!allowed){setHealth([]);setDirectory([]);setAudit([]);return}
      const [healthResult,directoryResult,auditResult]=await Promise.all([
        client.rpc('list_recognition_delivery_health',{p_from:null,p_to:null}),
        client.rpc('list_recognition_award_candidates'),
        client.rpc('list_recognition_governance_audit',{p_limit:100}),
      ])
      if(healthResult.error)throw healthResult.error
      if(directoryResult.error)throw directoryResult.error
      if(auditResult.error)throw auditResult.error
      setHealth((healthResult.data||[]) as HealthRow[])
      const people=(directoryResult.data||[]) as DirectoryRow[]
      setDirectory(people)
      setAudit((auditResult.data||[]) as AuditRow[])
      setEmployeeId(current=>current||people[0]?.employee_id||'')
    }catch(error:any){setNotice(error?.message||'Unable to load recognition governance.');setAuthorized(false)}
    finally{setLoading(false)}
  },[])

  useEffect(()=>{void load()},[load])

  const totalPending=useMemo(()=>health.filter(row=>row.state==='pending').reduce((sum,row)=>sum+Number(row.delivery_count||0),0),[health])
  const totalPresented=useMemo(()=>health.filter(row=>row.state==='presented'||row.state==='dismissed').reduce((sum,row)=>sum+Number(row.delivery_count||0),0),[health])

  async function issueAward(){
    const client=supabase
    if(!client||!employeeId||awardTitle.trim().length<3||issueReason.trim().length<8)return
    setBusy(true);setNotice('')
    try{
      const result=await client.rpc('issue_employee_award',{p_payload:{employee_id:employeeId,award_category:category,title:awardTitle.trim(),description:awardDescription.trim()||null,badge_code:category,badge_label:awardTitle.trim(),issue_reason:issueReason.trim(),company_title:companyTitle.trim()||null,company_message:companyMessage.trim()||null},p_request_id:requestId()})
      if(result.error)throw result.error
      setNotice('Award issued privately and queued for the employee.')
      setAwardId(String(result.data||''));setAwardTitle('');setAwardDescription('');setIssueReason('')
      await load()
    }catch(error:any){setNotice(error?.message||'Unable to issue this award.')}
    finally{setBusy(false)}
  }

  async function reissue(){
    const client=supabase
    if(!client||!deliveryId.trim()||reissueReason.trim().length<8)return
    setBusy(true);setNotice('')
    try{const result=await client.rpc('reissue_recognition_ceremony',{p_delivery_id:deliveryId.trim(),p_reason:reissueReason.trim(),p_request_id:requestId()});if(result.error)throw result.error;setNotice('Ceremony reissued with a new delivery revision.');setReissueReason('');await load()}
    catch(error:any){setNotice(error?.message||'Unable to reissue this ceremony.')}
    finally{setBusy(false)}
  }

  async function changeVisibility(){
    const client=supabase
    if(!client||!awardId.trim()||governReason.trim().length<8)return
    setBusy(true);setNotice('')
    try{const result=await client.rpc('change_employee_award_visibility',{p_award_id:awardId.trim(),p_visibility:visibility,p_reason:governReason.trim(),p_request_id:requestId()});if(result.error)throw result.error;setNotice(visibility==='private'?'Award returned to private visibility.':'Sanitized company recognition published.');setGovernReason('');await load()}
    catch(error:any){setNotice(error?.message||'Unable to change award visibility.')}
    finally{setBusy(false)}
  }

  async function revokeAward(){
    const client=supabase
    if(!client||!awardId.trim()||governReason.trim().length<8)return
    if(!window.confirm('Revoke this award? Presented history and audit evidence will remain.'))return
    setBusy(true);setNotice('')
    try{const result=await client.rpc('revoke_employee_award',{p_award_id:awardId.trim(),p_reason:governReason.trim(),p_request_id:requestId()});if(result.error)throw result.error;setNotice('Award revoked. Pending deliveries were stopped.');setGovernReason('');await load()}
    catch(error:any){setNotice(error?.message||'Unable to revoke this award.')}
    finally{setBusy(false)}
  }

  async function runPreview(){
    const client=supabase
    if(!client)return
    setBusy(true);setNotice('')
    try{const result=await client.rpc('preview_recognition_ceremony',{p_theme:previewTheme,p_payload:{title:previewTitle.trim(),message:previewMessage.trim(),department:'Operations',detail:'Administration preview - no recognition record is written.'}});if(result.error)throw result.error;setPreview(result.data as CeremonyPresentation)}
    catch(error:any){setNotice(error?.message||'Unable to prepare this preview.')}
    finally{setBusy(false)}
  }

  if(loading)return <section className="recognitionAdminPanel"><div className="recognitionAdminLoading"><Sparkles size={22}/>Loading recognition governance…</div></section>
  if(authorized===false)return <section className="recognitionAdminPanel"><div className="recognitionAdminDenied"><ShieldCheck size={30}/><h3>Recognition governance is restricted</h3><p>Only active People, Administration, or workspace administrators may use this control centre.</p></div></section>

  return <section className="recognitionAdminPanel">
    <header className="recognitionAdminHero">
      <div><span className="eyebrow">RECOGNITION GOVERNANCE</span><h3>Recognition & Celebrations</h3><p>Issue private awards, govern company recognition, monitor delivery health, and preview the exact employee experience without writing ceremony state.</p></div>
      <button type="button" className="glassButton" onClick={()=>void load()} disabled={busy}><RefreshCw size={15}/>Refresh</button>
    </header>

    <div className="recognitionAdminMetrics">
      <article><Gift size={19}/><span>Pending delivery</span><strong>{totalPending}</strong></article>
      <article><UserRoundCheck size={19}/><span>Presented / dismissed</span><strong>{totalPresented}</strong></article>
      <article><Sparkles size={19}/><span>Delivery groups</span><strong>{health.length}</strong></article>
    </div>

    <nav className="recognitionAdminNav" aria-label="Recognition administration">
      {([['health','Delivery health',ShieldCheck],['issue','Issue award',Award],['govern','Govern awards',RotateCcw],['audit','Audit history',ShieldCheck],['preview','Preview ceremonies',Eye]] as const).map(([id,label,Icon])=><button type="button" key={id} className={view===id?'active':''} onClick={()=>setView(id)}><Icon size={15}/>{label}</button>)}
    </nav>
    {notice&&<div className="moduleNotice" role="status">{notice}</div>}

    {view==='health'&&<div className="recognitionAdminHealth">
      <div className="recognitionAdminSectionTitle"><div><span className="eyebrow">DELIVERY LEDGER</span><h4>Aggregate ceremony health</h4></div><small>No private award payloads are exposed here.</small></div>
      {health.length===0?<div className="recognitionAdminEmpty">No recognition deliveries have been recorded yet.</div>:<div className="recognitionAdminTableWrap"><table><thead><tr><th>Source</th><th>State</th><th>Deliveries</th><th>Oldest eligible</th><th>Updated</th></tr></thead><tbody>{health.map(row=><tr key={`${row.source_kind}:${row.state}`}><td>{row.source_kind.replace(/_/g,' ')}</td><td><span className={`recognitionState recognitionState-${row.state}`}>{row.state}</span></td><td>{Number(row.delivery_count||0)}</td><td>{when(row.oldest_eligible_at)}</td><td>{when(row.newest_updated_at)}</td></tr>)}</tbody></table></div>}
    </div>}

    {view==='issue'&&<div className="recognitionAdminGrid">
      <article className="recognitionAdminCard"><div className="recognitionAdminSectionTitle"><div><span className="eyebrow">PRIVATE BY DEFAULT</span><h4>Issue an employee award</h4></div><Award size={22}/></div>
        <label><span>Employee</span><select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}>{directory.map(row=><option key={row.employee_id} value={row.employee_id}>{row.full_name} · {row.department||'No department'}</option>)}</select></label>
        <label><span>Category</span><select value={category} onChange={event=>setCategory(event.target.value)}>{CATEGORY_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Award title</span><input value={awardTitle} maxLength={180} onChange={event=>setAwardTitle(event.target.value)} placeholder="Outstanding customer care"/></label>
        <label><span>Private description</span><textarea value={awardDescription} maxLength={2000} onChange={event=>setAwardDescription(event.target.value)} placeholder="Describe the verified contribution."/></label>
        <label><span>Issue reason · audited</span><textarea value={issueReason} maxLength={500} onChange={event=>setIssueReason(event.target.value)} placeholder="Why this award is being issued"/></label>
        <details><summary>Optional company-recognition copy</summary><label><span>Public internal title</span><input value={companyTitle} maxLength={180} onChange={event=>setCompanyTitle(event.target.value)}/></label><label><span>Public internal message</span><textarea value={companyMessage} maxLength={1000} onChange={event=>setCompanyMessage(event.target.value)}/></label></details>
        <button type="button" className="primaryBtn" disabled={busy||!employeeId||awardTitle.trim().length<3||issueReason.trim().length<8} onClick={()=>void issueAward()}><Award size={16}/>Issue private award</button>
      </article>
    </div>}

    {view==='govern'&&<div className="recognitionAdminGrid recognitionAdminGridTwo">
      <article className="recognitionAdminCard"><div className="recognitionAdminSectionTitle"><div><span className="eyebrow">DELIVERY RECOVERY</span><h4>Reissue a ceremony</h4></div><RotateCcw size={22}/></div><label><span>Delivery ID</span><input value={deliveryId} onChange={event=>setDeliveryId(event.target.value)} placeholder="UUID"/></label><label><span>Reason · audited</span><textarea value={reissueReason} onChange={event=>setReissueReason(event.target.value)} placeholder="Why the delivery must be reissued"/></label><button type="button" className="glassButton" disabled={busy||!deliveryId.trim()||reissueReason.trim().length<8} onClick={()=>void reissue()}><RotateCcw size={15}/>Reissue delivery</button></article>
      <article className="recognitionAdminCard"><div className="recognitionAdminSectionTitle"><div><span className="eyebrow">AWARD GOVERNANCE</span><h4>Visibility or revocation</h4></div><ShieldCheck size={22}/></div><label><span>Award ID</span><input value={awardId} onChange={event=>setAwardId(event.target.value)} placeholder="UUID"/></label><label><span>Visibility</span><select value={visibility} onChange={event=>setVisibility(event.target.value as typeof visibility)}><option value="company_recognition">Company recognition</option><option value="private">Private</option></select></label><label><span>Reason · audited</span><textarea value={governReason} onChange={event=>setGovernReason(event.target.value)} placeholder="Reason for this governed change"/></label><div className="recognitionAdminActions"><button type="button" className="glassButton" disabled={busy||!awardId.trim()||governReason.trim().length<8} onClick={()=>void changeVisibility()}>Apply visibility</button><button type="button" className="dangerButton" disabled={busy||!awardId.trim()||governReason.trim().length<8} onClick={()=>void revokeAward()}>Revoke award</button></div></article>
    </div>}


    {view==='audit'&&<div className="recognitionAdminHealth">
      <div className="recognitionAdminSectionTitle"><div><span className="eyebrow">AUDIT EVIDENCE</span><h4>Audit history</h4></div><small>Governed recognition changes with actor, target, reason, and timestamp.</small></div>
      {audit.length===0?<div className="recognitionAdminEmpty">No governed recognition changes have been recorded yet.</div>:<div className="recognitionAdminTableWrap"><table><thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>Reason</th><th>When</th></tr></thead><tbody>{audit.map(row=><tr key={row.event_id}><td>{row.action.replace(/_/g,' ')}</td><td>{row.actor_name||'Former employee'}</td><td>{row.target_name||'Not set'}</td><td>{row.reason}</td><td>{when(row.created_at)}</td></tr>)}</tbody></table></div>}
    </div>}

    {view==='preview'&&<div className="recognitionAdminPreviewConfig">
      <article className="recognitionAdminCard"><div className="recognitionAdminSectionTitle"><div><span className="eyebrow">NO-WRITE PREVIEW</span><h4>Preview the production ceremony</h4></div><Eye size={22}/></div><label><span>Theme</span><select value={previewTheme} onChange={event=>setPreviewTheme(event.target.value as PreviewTheme)}><option value="department_trophy">Department trophy</option><option value="personal_award">Personal award</option><option value="company_recognition">Company recognition</option><option value="company_milestone">Company milestone</option></select></label><label><span>Title</span><input value={previewTitle} onChange={event=>setPreviewTitle(event.target.value)}/></label><label><span>Message</span><textarea value={previewMessage} onChange={event=>setPreviewMessage(event.target.value)}/></label><div className="recognitionAdminDeviceSwitch">{(['desktop','tablet','mobile'] as PreviewDevice[]).map(mode=><button type="button" key={mode} className={previewDevice===mode?'active':''} onClick={()=>setPreviewDevice(mode)}>{mode}</button>)}</div><label className="recognitionAdminCheck"><input type="checkbox" checked={reducedMotion} onChange={event=>setReducedMotion(event.target.checked)}/><span>Preview reduced motion</span></label><button type="button" className="primaryBtn" disabled={busy||previewTitle.trim().length<3} onClick={()=>void runPreview()}><Sparkles size={16}/>Launch preview</button></article>
    </div>}

    {preview&&<div className={`recognitionAdminPreviewViewport recognitionAdminPreview${previewDevice[0].toUpperCase()+previewDevice.slice(1)}${reducedMotion?' recognitionPreviewReduced':''}`}>
      {preview.sourceKind==='department_achievement'?<DepartmentTrophyScene presentation={preview} onPresented={()=>{}} onClose={()=>setPreview(null)}/>:preview.sourceKind==='personal_award'?<PersonalAwardScene presentation={preview} onPresented={()=>{}} onClose={()=>setPreview(null)}/>:<CompanyMilestoneScene presentation={preview} onPresented={()=>{}} onClose={()=>setPreview(null)}/>}
    </div>}
  </section>
}
