import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const {createClient}=require('@supabase/supabase-js')
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
function env(){assert.equal(readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1],'RA-workspace');const out=execFileSync('supabase',['status','-o','env'],{encoding:'utf8'});const v={};for(const line of out.split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(!m)continue;let x=m[2].trim();if(x.startsWith('"'))x=JSON.parse(x);else if(x.startsWith("'"))x=x.slice(1,-1);v[m[1]]=x}assert.ok(['127.0.0.1','localhost'].includes(new URL(v.API_URL).hostname));return{url:v.API_URL,anon:v.ANON_KEY,serviceKey:v.SERVICE_ROLE_KEY}}
async function must(label,p){const r=await p;if(r.error)throw new Error(`${label}: ${r.error.message}`);return r.data}

test('ceremony deliveries snapshot recipients, claim once and preserve history',async()=>{
  const e=env(),service=createClient(e.url,e.serviceKey,opts),tag=`ceremony-${Date.now()}-${crypto.randomUUID().slice(0,6)}`,users=[]
  async function make(key,department='Marketing',active=true){const email=`${tag}-${key}@ridearrivo.com`,password=`Local!${crypto.randomUUID()}Aa1`;const c=await service.auth.admin.createUser({email,password,email_confirm:true});if(c.error)throw c.error;users.push(c.data.user);await must('profile',service.from('employee_profiles').upsert({id:c.data.user.id,email,full_name:`Ceremony ${key}`,department,job_title:'Fixture',role:'employee',location:'Lagos',active},{onConflict:'id'}));return{id:c.data.user.id,email,password}}
  async function login(u){const c=createClient(e.url,e.anon,opts);await must('login',c.auth.signInWithPassword({email:u.email,password:u.password}));return c}
  const first=await make('first'),second=await make('second'),viewer=await make('viewer','Finance'),inactive=await make('inactive','Marketing',false),newMember=await make('new','Finance')
  let achievementId=null,awardId=null
  try{
    const achievement=await must('achievement',service.from('department_achievements').insert({department:'Marketing',kind:'dept_overdue_clear',title:`${tag} trophy`,description:'Fixture',tier:'gold'}).select('id').single());achievementId=achievement.id
    const deliveries=await must('department deliveries',service.from('recognition_ceremony_deliveries').select('recipient_id,state').eq('source_kind','department_achievement').eq('source_id',achievementId));assert.deepEqual(new Set(deliveries.map(r=>r.recipient_id)),new Set([first.id,second.id]));assert.equal(deliveries.some(r=>r.recipient_id===inactive.id),false);assert.equal(deliveries.some(r=>r.recipient_id===viewer.id),false)
    await must('workstation view',service.from('workspace_workstation_assignments').upsert({employee_id:viewer.id,workstation:'marketing',is_primary:false,active:true,assigned_by:first.id},{onConflict:'employee_id,workstation'}));const viewClient=await login(viewer);const history=await must('history',viewClient.rpc('list_department_trophy_history',{p_department:'Marketing',p_limit:20}));assert.ok(history.some(r=>r.id===achievementId));const viewerDelivery=await must('viewer delivery',service.from('recognition_ceremony_deliveries').select('id').eq('source_id',achievementId).eq('recipient_id',viewer.id));assert.equal(viewerDelivery.length,0)
    await must('transfer',service.from('employee_profiles').update({department:'Finance'}).eq('id',second.id));await must('new joins',service.from('employee_profiles').update({department:'Marketing'}).eq('id',newMember.id));const stable=await must('stable snapshot',service.from('recognition_ceremony_deliveries').select('recipient_id').eq('source_id',achievementId));assert.ok(stable.some(r=>r.recipient_id===second.id));assert.equal(stable.some(r=>r.recipient_id===newMember.id),false)
    await must('deactivate snapshot recipient',service.from('employee_profiles').update({active:false}).eq('id',second.id));const deactivatedDelivery=await must('deactivated delivery',service.from('recognition_ceremony_deliveries').select('state,revocation_reason').eq('source_id',achievementId).eq('recipient_id',second.id).single());assert.equal(deactivatedDelivery.state,'revoked');assert.equal(deactivatedDelivery.revocation_reason,'employee_deactivated')
    const firstClient=await login(first);const [a,b]=await Promise.all([firstClient.rpc('claim_next_recognition_ceremony'),firstClient.rpc('claim_next_recognition_ceremony')]);const claims=[a.data,b.data].filter(Boolean);assert.equal(claims.length,1);assert.equal(claims[0].source_kind,'department_achievement');await must('presented',firstClient.rpc('mark_recognition_ceremony_presented',{p_delivery_id:claims[0].delivery_id}));await must('dismissed',firstClient.rpc('mark_recognition_ceremony_dismissed',{p_delivery_id:claims[0].delivery_id}));const trophyHistory=await must('permanent history',firstClient.rpc('list_department_trophy_history',{p_department:'Marketing',p_limit:20}));assert.ok(trophyHistory.some(r=>r.id===achievementId))
    const award=await must('award',service.from('employee_recognition_awards').insert({employee_id:first.id,award_month:new Date().toISOString().slice(0,7)+'-01',performance_month:null,badge_code:'customer_commendation',badge_label:'Customer Commendation',score:null,award_category:'customer_commendation',title:`${tag} personal`,visibility:'private',source_kind:'test',source_key:`${tag}-award`,active:true}).select('id').single());awardId=award.id
    const personal=await must('personal delivery',service.from('recognition_ceremony_deliveries').select('recipient_id,presentation').eq('source_id',awardId));assert.equal(personal.length,1);assert.equal(personal[0].recipient_id,first.id);assert.equal('score' in personal[0].presentation,false)
  }finally{
    const sourceIds=[achievementId,awardId].filter(Boolean)
    if(sourceIds.length)await service.from('recognition_ceremony_deliveries').delete().in('source_id',sourceIds)
    if(awardId)await service.from('employee_recognition_awards').delete().eq('id',awardId)
    if(achievementId)await service.from('department_achievements').delete().eq('id',achievementId)
    await service.from('workspace_workstation_assignments').delete().eq('employee_id',viewer.id).eq('workstation','marketing')
    for(const u of users.reverse())await service.auth.admin.deleteUser(u.id)
  }
})
