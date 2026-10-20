import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const {createClient}=require('@supabase/supabase-js')
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
function env(){assert.equal(readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1],'RA-workspace');const out=execFileSync('supabase',['status','-o','env'],{encoding:'utf8'}),v={};for(const line of out.split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(!m)continue;let x=m[2].trim();if(x.startsWith('"'))x=JSON.parse(x);else if(x.startsWith("'"))x=x.slice(1,-1);v[m[1]]=x}assert.ok(['127.0.0.1','localhost'].includes(new URL(v.API_URL).hostname));return{url:v.API_URL,anon:v.ANON_KEY,serviceKey:v.SERVICE_ROLE_KEY}}
async function must(label,p){const r=await p;if(r.error)throw new Error(`${label}: ${r.error.message}`);return r.data}

test('recognition governance is scoped audited idempotent and preview-only',async()=>{
  const e=env(),service=createClient(e.url,e.serviceKey,opts),tag=`recognition-gov-${Date.now()}-${crypto.randomUUID().slice(0,6)}`,users=[]
  async function make(key,{role='employee',active=true,workstation=null}={}){const email=`${tag}-${key}@ridearrivo.com`,password=`Local!${crypto.randomUUID()}Aa1`;const c=await service.auth.admin.createUser({email,password,email_confirm:true});if(c.error)throw c.error;users.push(c.data.user);await must('profile',service.from('employee_profiles').upsert({id:c.data.user.id,email,full_name:`Governance ${key}`,department:workstation==='people'?'People':'Operations',job_title:'Fixture',role,location:'Lagos',active},{onConflict:'id'}));if(workstation)await must('workstation',service.from('workspace_workstation_assignments').upsert({employee_id:c.data.user.id,workstation,is_primary:false,active:true},{onConflict:'employee_id,workstation'}));return{id:c.data.user.id,email,password,key}}
  async function login(u){const c=createClient(e.url,e.anon,opts);await must(`login ${u.key}`,c.auth.signInWithPassword({email:u.email,password:u.password}));return c}
  const people=await make('people',{workstation:'people'}),ordinary=await make('ordinary'),admin=await make('admin',{role:'admin'}),inactive=await make('inactive',{workstation:'administration',active:false}),recipient=await make('recipient')
  const peopleClient=await login(people),ordinaryClient=await login(ordinary),adminClient=await login(admin),inactiveClient=await login(inactive)
  const awardIds=[],deliveryIds=[]
  try{
    assert.equal(await must('people authority',peopleClient.rpc('can_govern_recognition')),true)
    assert.equal(await must('admin authority',adminClient.rpc('can_govern_recognition')),true)
    assert.equal(await must('ordinary authority',ordinaryClient.rpc('can_govern_recognition')),false)
    assert.equal(await must('inactive authority',inactiveClient.rpc('can_govern_recognition')),false)

    const candidates=await must('candidate directory',peopleClient.rpc('list_recognition_award_candidates'));assert.ok(candidates.some(row=>row.employee_id===recipient.id));assert.equal('email' in candidates[0],false)
    const requestId=crypto.randomUUID()
    const payload={employee_id:recipient.id,award_category:'customer_commendation',title:`${tag} award`,description:'Excellent customer care',badge_code:'customer_commendation',badge_label:'Customer Commendation',issue_reason:'Verified customer commendation',company_title:'Customer Service Star',company_message:'Recognised for verified customer care.',source_kind:'spoofed_automation',source_key:'spoofed:key'}
    const awardId=await must('issue',peopleClient.rpc('issue_employee_award',{p_payload:payload,p_request_id:requestId}));awardIds.push(awardId)
    const repeat=await must('repeat issue',peopleClient.rpc('issue_employee_award',{p_payload:payload,p_request_id:requestId}));assert.equal(repeat,awardId)
    const issuedSource=await must('server-owned source',service.from('employee_recognition_awards').select('source_kind,source_key').eq('id',awardId).single());assert.equal(issuedSource.source_kind,'administration_manual');assert.equal(issuedSource.source_key,`admin:${requestId}`)
    const deniedKpi=await peopleClient.rpc('issue_employee_award',{p_payload:{...payload,award_category:'monthly_kpi_excellence',title:'Spoofed KPI award'},p_request_id:crypto.randomUUID()});assert.ok(deniedKpi.error);assert.match(deniedKpi.error.message,/cannot be issued manually/i)
    const denied=await ordinaryClient.rpc('issue_employee_award',{p_payload:{...payload,source_key:`${tag}-denied`},p_request_id:crypto.randomUUID()});assert.ok(denied.error)
    const personal=await must('personal delivery',service.from('recognition_ceremony_deliveries').select('id,revision,state').eq('source_kind','personal_award').eq('source_id',awardId).single());deliveryIds.push(personal.id)
    await must('legacy featured badge inactive',service.from('employee_recognition_awards').update({active:false}).eq('id',awardId))

    const beforePreview=await service.from('recognition_governance_audit_events').select('id',{count:'exact',head:true});if(beforePreview.error)throw beforePreview.error
    const preview=await must('preview',peopleClient.rpc('preview_recognition_ceremony',{p_theme:'personal_award',p_payload:{title:'Preview award',message:'Preview only'}}));assert.equal(preview.source_kind,'personal_award');assert.equal('score' in preview,false)
    const afterPreview=await service.from('recognition_governance_audit_events').select('id',{count:'exact',head:true});if(afterPreview.error)throw afterPreview.error;assert.equal(afterPreview.count,beforePreview.count)

    await must('reissue',peopleClient.rpc('reissue_recognition_ceremony',{p_delivery_id:personal.id,p_reason:'Preview interrupted during verification',p_request_id:crypto.randomUUID()}))
    const reissued=await must('reissued row',service.from('recognition_ceremony_deliveries').select('revision,state,claimed_at,presented_at,dismissed_at').eq('id',personal.id).single());assert.equal(reissued.revision,personal.revision+1);assert.equal(reissued.state,'pending');assert.equal(reissued.claimed_at,null)

    await must('publish',peopleClient.rpc('change_employee_award_visibility',{p_award_id:awardId,p_visibility:'company_recognition',p_reason:'Approved for company recognition',p_request_id:crypto.randomUUID()}))
    const companyRows=await must('company deliveries',service.from('recognition_ceremony_deliveries').select('id,recipient_id,presentation').eq('source_kind','company_recognition').eq('source_id',awardId));deliveryIds.push(...companyRows.map(r=>r.id));assert.ok(companyRows.some(r=>r.recipient_id===ordinary.id));assert.equal(companyRows.some(r=>'score' in r.presentation),false)
    const ordinaryCompany=companyRows.find(row=>row.recipient_id===ordinary.id);assert.ok(ordinaryCompany);await must('simulate claimed company delivery',service.from('recognition_ceremony_deliveries').update({state:'claimed',claimed_at:new Date().toISOString()}).eq('id',ordinaryCompany.id))
    const health=await must('health',peopleClient.rpc('list_recognition_delivery_health',{p_from:null,p_to:null}));assert.ok(health.some(r=>r.source_kind==='company_recognition'))

    await must('private',peopleClient.rpc('change_employee_award_visibility',{p_award_id:awardId,p_visibility:'private',p_reason:'Recognition returned to private',p_request_id:crypto.randomUUID()}))
    const revoked=await must('company revoked',service.from('recognition_ceremony_deliveries').select('state').eq('source_kind','company_recognition').eq('source_id',awardId));assert.ok(revoked.every(r=>r.state==='revoked'))

    await must('simulate claimed personal delivery',service.from('recognition_ceremony_deliveries').update({state:'claimed',claimed_at:new Date().toISOString()}).eq('id',personal.id))
    await must('revoke award',peopleClient.rpc('revoke_employee_award',{p_award_id:awardId,p_reason:'Fixture cleanup validation',p_request_id:crypto.randomUUID()}))
    const personalRevoked=await must('claimed personal revoked',service.from('recognition_ceremony_deliveries').select('state').eq('id',personal.id).single());assert.equal(personalRevoked.state,'revoked')
    const award=await must('award revoked',service.from('employee_recognition_awards').select('active,revoked_at,revocation_reason').eq('id',awardId).single());assert.equal(award.active,false);assert.ok(award.revoked_at)
    const audits=await must('audit',service.from('recognition_governance_audit_events').select('action,actor_id').eq('entity_id',awardId));assert.ok(audits.some(r=>r.action==='AWARD_ISSUED'));assert.ok(audits.some(r=>r.action==='AWARD_VISIBILITY_CHANGED'));assert.ok(audits.some(r=>r.action==='AWARD_REVOKED'));assert.ok(audits.every(r=>r.actor_id===people.id))
    const auditHistory=await must('governance audit history',peopleClient.rpc('list_recognition_governance_audit',{p_limit:100}));const issuedAudit=auditHistory.find(row=>row.entity_id===awardId&&row.action==='AWARD_ISSUED');assert.ok(issuedAudit);assert.equal(issuedAudit.actor_id,people.id);assert.equal(issuedAudit.target_employee_id,recipient.id);assert.match(issuedAudit.actor_name,/Governance people/);assert.match(issuedAudit.target_name,/Governance recipient/)
  }finally{
    if(deliveryIds.length)await service.from('recognition_ceremony_deliveries').delete().in('id',deliveryIds)
    await service.from('recognition_governance_audit_events').delete().in('actor_id',users.map(u=>u.id))
    if(awardIds.length){await service.from('recognition_governance_audit_events').delete().in('entity_id',awardIds);await service.from('employee_recognition_awards').delete().in('id',awardIds)}
    await service.from('workspace_workstation_assignments').delete().in('employee_id',users.map(u=>u.id))
    for(const u of users.reverse())await service.auth.admin.deleteUser(u.id)
  }
})
