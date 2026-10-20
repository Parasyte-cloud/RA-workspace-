import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
function env() {
  assert.equal(readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1], 'RA-workspace')
  const out = execFileSync('supabase', ['status','-o','env'], { encoding:'utf8' })
  const values = {}
  for (const line of out.split(/\r?\n/)) { const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(!m)continue; let v=m[2].trim(); if(v.startsWith('"'))v=JSON.parse(v); else if(v.startsWith("'"))v=v.slice(1,-1); values[m[1]]=v }
  assert.ok(['127.0.0.1','localhost'].includes(new URL(values.API_URL).hostname))
  return { url:values.API_URL, anon:values.ANON_KEY, serviceKey:values.SERVICE_ROLE_KEY }
}
async function must(label,promise){const r=await promise;if(r.error)throw new Error(`${label}: ${r.error.message}`);return r.data}

test('personal awards are private by default and company recognition is sanitized', async()=>{
  const e=env(); const service=createClient(e.url,e.serviceKey,opts); const tag=`awards-${Date.now()}-${crypto.randomUUID().slice(0,6)}`; const users=[]
  async function user(key,active=true){const email=`${tag}-${key}@ridearrivo.com`;const password=`Local!${crypto.randomUUID()}Aa1`;const c=await service.auth.admin.createUser({email,password,email_confirm:true});if(c.error)throw c.error;users.push(c.data.user);await must('profile',service.from('employee_profiles').upsert({id:c.data.user.id,email,full_name:`Award ${key}`,department:'Marketing',job_title:'Fixture',role:'employee',location:'Lagos',active},{onConflict:'id'}));return{id:c.data.user.id,email,password}}
  async function login(u){const c=createClient(e.url,e.anon,opts);await must('login',c.auth.signInWithPassword({email:u.email,password:u.password}));return c}
  const owner=await user('owner'); const other=await user('other'); const inactive=await user('inactive',false)
  try{
    const month=new Date().toISOString().slice(0,7)+'-01'
    const inserted=await must('awards',service.from('employee_recognition_awards').insert([
      {employee_id:owner.id,award_month:month,performance_month:month,badge_code:'monthly_kpi',badge_label:'Monthly KPI',score:91,award_category:'monthly_kpi_excellence',title:'Monthly KPI Excellence',visibility:'private',source_kind:'test',source_key:`${tag}-private`,active:true},
      {employee_id:owner.id,award_month:month,performance_month:null,badge_code:'customer_commendation',badge_label:'Customer Commendation',score:null,award_category:'customer_commendation',title:'Customer Commendation',description:'Private detail',visibility:'company_recognition',company_title:'Service Star',company_message:'Recognised for exceptional service.',source_kind:'test',source_key:`${tag}-company`,active:false},
      {employee_id:owner.id,award_month:month,performance_month:null,badge_code:'team_commendation',badge_label:'Historical Team Award',score:null,award_category:'team_commendation',title:'Historical Team Award',description:'Permanent unrevoked history',visibility:'private',source_kind:'test',source_key:`${tag}-historical`,active:false},
      {employee_id:owner.id,award_month:month,performance_month:null,badge_code:'other',badge_label:'Revoked',score:null,award_category:'other',title:'Revoked',visibility:'private',source_kind:'test',source_key:`${tag}-revoked`,active:true,revoked_at:new Date().toISOString(),revoked_by:owner.id,revocation_reason:'Fixture revocation'},
    ]).select('id'))
    const ownerClient=await login(owner); const otherClient=await login(other); const inactiveClient=await login(inactive)
    const mine=await must('mine',ownerClient.rpc('list_my_awards',{p_limit:20,p_before:null})); assert.equal(mine.length,3); assert.ok(mine.some(a=>a.title==='Monthly KPI Excellence')); assert.ok(mine.some(a=>a.title==='Historical Team Award'))
    const otherMine=await must('other mine',otherClient.rpc('list_my_awards',{p_limit:20,p_before:null})); assert.equal(otherMine.length,0)
    const company=await must('company',otherClient.rpc('list_company_recognition_awards',{p_limit:20,p_before:null})); const row=company.find(a=>a.title==='Service Star'); assert.ok(row); assert.equal('score' in row,false); assert.equal('description' in row,false)
    const inactiveRows=await must('inactive',inactiveClient.rpc('list_my_awards',{p_limit:20,p_before:null})); assert.equal(inactiveRows.length,0)
    const sameMonth=await must('same month discretionary',service.from('employee_recognition_awards').insert({employee_id:other.id,award_month:month,performance_month:null,badge_code:'team_commendation',badge_label:'Team',score:null,award_category:'team_commendation',title:'Team',visibility:'private',source_kind:'test',source_key:`${tag}-same-month`,active:true}).select('id')); assert.equal(sameMonth.length,1)
    assert.equal(inserted.length,4)
  } finally { await service.from('employee_recognition_awards').delete().eq('source_kind','test').like('source_key',`${tag}%`); for(const u of users.reverse())await service.auth.admin.deleteUser(u.id) }
})
