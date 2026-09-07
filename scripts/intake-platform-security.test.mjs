import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}

function localEnv(){
  const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8')
  assert.equal(config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1],'RA-workspace')
  const out=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
  const env={}
  for(const line of out.split(/\r?\n/)){
    const m=line.match(/^([A-Z0-9_]+)=(.*)$/)
    if(!m) continue
    let v=m[2].trim()
    if(v.startsWith('"')&&v.endsWith('"')) v=JSON.parse(v)
    else if(v.startsWith("'")&&v.endsWith("'")) v=v.slice(1,-1)
    env[m[1]]=v
  }
  assert.ok(env.API_URL&&env.ANON_KEY&&env.SERVICE_ROLE_KEY)
  const host=new URL(env.API_URL).hostname
  assert.ok(host==='127.0.0.1'||host==='localhost',`Refusing non-local API ${env.API_URL}`)
  return {url:env.API_URL,anon:env.ANON_KEY,serviceKey:env.SERVICE_ROLE_KEY}
}

async function data(label,p){
  const r=await p
  if(r.error) throw new Error(`${label}: ${r.error.message}`)
  return r.data
}
async function denied(label,p,re){
  const r=await p
  assert.ok(r.error,`${label}: expected denial`)
  if(re) assert.match(String(r.error.message||''),re)
}
async function count(label,p,n){
  const rows=await data(label,p)
  assert.equal(rows.length,n,`${label}: expected ${n}, got ${rows.length}`)
}
async function zeroUpdate(label,p){ await count(label,p,0) }

test('reusable intake platform security matrix',{timeout:120000},async()=>{
  const {url,anon,serviceKey}=localEnv()
  const service=createClient(url,serviceKey,opts)
  const anonymous=createClient(url,anon,opts)
  const tag=`intake-security-${Date.now()}-${crypto.randomUUID()}`
  const users=[]
  let formId=null
  let submissionId=null

  async function identity(key,role,department,active){
    const email=`${tag}-${key}@ridearrivo.com`
    const password=`LocalOnly!${crypto.randomUUID()}Aa1`
    const r=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:`Intake Test ${key}`}})
    if(r.error||!r.data?.user) throw new Error(`create ${key}: ${r.error?.message||'missing user'}`)
    const u={id:r.data.user.id,key,email,password}; users.push(u)
    await data(`profile ${key}`,service.from('employee_profiles').upsert({
      id:u.id,full_name:`Intake Test ${key}`,email,department,
      job_title:'Local intake security fixture',role,location:'Lagos',active
    },{onConflict:'id'}))
    return u
  }
  async function login(u){
    const c=createClient(url,anon,opts)
    const r=await c.auth.signInWithPassword({email:u.email,password:u.password})
    if(r.error) throw new Error(`login ${u.key}: ${r.error.message}`)
    return c
  }
  async function supportAccess(id){
    await data('support assignment',service.from('workspace_workstation_assignments').insert({
      employee_id:id,workstation:'support',is_primary:false,active:true
    }))
  }
  async function route(label,c,assignee,expected){
    const r=await data(label,c.rpc('can_access_intake_route',{p_workstation:'support',p_assignee:assignee}))
    assert.equal(typeof r,'boolean',`${label}: non-boolean ${String(r)}`)
    assert.equal(r,expected,`${label}: expected ${expected}`)
  }
  async function cleanup(){
    if(formId){
      await data('cleanup submissions',service.from('intake_submissions').delete().eq('form_id',formId))
      await data('disable cleanup form',service.from('intake_forms').update({lifecycle_status:'disabled',published_version_id:null}).eq('id',formId))
      await data('delete cleanup form',service.from('intake_forms').delete().eq('id',formId))
    }
    const ids=users.map(u=>u.id)
    if(ids.length) await data('cleanup assignments',service.from('workspace_workstation_assignments').delete().in('employee_id',ids))
    for(const u of [...users].reverse()){
      const r=await service.auth.admin.deleteUser(u.id)
      if(r.error) throw new Error(`cleanup ${u.key}: ${r.error.message}`)
    }
    assert.equal((await data('residual profiles',service.from('employee_profiles').select('id').like('email',`${tag}%`))).length,0)
    assert.equal((await data('residual forms',service.from('intake_forms').select('id').like('slug',`${tag}%`))).length,0)
    assert.equal((await data('residual submissions',service.from('intake_submissions').select('id').like('source_reference',`${tag}%`))).length,0)
  }

  let failure=null
  try{
    const admin=await identity('admin','admin','Administration',true)
    const manager=await identity('manager','manager','Management',true)
    const support=await identity('support','support','Support',true)
    const assignee=await identity('assignee','employee','General',true)
    const finance=await identity('finance','finance','Finance',true)
    const inactive=await identity('inactive','support','Support',false)
    const [adminC,managerC,supportC,assigneeC,financeC,inactiveC]=await Promise.all(
      [admin,manager,support,assignee,finance,inactive].map(login)
    )
    await supportAccess(support.id); await supportAccess(inactive.id)

    await route('support route',supportC,null,true)
    await route('finance route',financeC,null,false)
    await route('finance forced assignee route',financeC,finance.id,false)
    await route('inactive route',inactiveC,inactive.id,false)
    await route('unassigned route',assigneeC,null,false)
    await route('direct assignee outside workstation route',assigneeC,assignee.id,false)

    await supportAccess(assignee.id)
    await route('eligible assignee route',assigneeC,assignee.id,true)

    await denied(
      'anonymous candidate directory',
      anonymous.rpc(
        'list_intake_assignment_candidates',
        {p_workstation:'support'}
      )
    )

    await denied(
      'support candidate directory',
      supportC.rpc(
        'list_intake_assignment_candidates',
        {p_workstation:'support'}
      ),
      /Only Management or Administration/i
    )

    await denied(
      'ordinary employee candidate directory',
      assigneeC.rpc(
        'list_intake_assignment_candidates',
        {p_workstation:'support'}
      ),
      /Only Management or Administration/i
    )

    await denied(
      'blank candidate workstation',
      adminC.rpc(
        'list_intake_assignment_candidates',
        {p_workstation:''}
      ),
      /Destination workstation is required/i
    )

    const adminCandidates=await data(
      'admin assignment candidates',
      adminC.rpc(
        'list_intake_assignment_candidates',
        {p_workstation:'support'}
      )
    )

    const managerCandidates=await data(
      'manager assignment candidates',
      managerC.rpc(
        'list_intake_assignment_candidates',
        {p_workstation:'support'}
      )
    )

    const expectedCandidateIds=[
      admin.id,
      manager.id,
      support.id,
      assignee.id
    ]

    for(const id of expectedCandidateIds){
      assert.ok(
        adminCandidates.some(
          x => x.employee_id===id
        ),
        `admin candidate list missing ${id}`
      )

      assert.ok(
        managerCandidates.some(
          x => x.employee_id===id
        ),
        `manager candidate list missing ${id}`
      )
    }

    for(const rows of [
      adminCandidates,
      managerCandidates
    ]){
      assert.ok(
        rows.every(
          x =>
            x.employee_id &&
            x.full_name &&
            x.employee_role
        )
      )

      assert.ok(
        !rows.some(
          x => x.employee_id===finance.id
        )
      )

      assert.ok(
        !rows.some(
          x => x.employee_id===inactive.id
        )
      )

      assert.equal(
        new Set(
          rows.map(x=>x.employee_id)
        ).size,
        rows.length
      )
    }

    console.log(
      'INTAKE_ASSIGNMENT_CANDIDATE_DIRECTORY=PASS'
    )

    await denied('anon categories',anonymous.from('intake_categories').select('id'))
    const slugs=new Set((await data('categories',supportC.from('intake_categories').select('slug'))).map(x=>x.slug))
    for(const s of ['potential-investors','customer-support','business-partners','corporate-clients','driver-applications','complaints','general-enquiries']) assert.ok(slugs.has(s),`missing ${s}`)
    assert.equal((await data('inactive categories',inactiveC.from('intake_categories').select('id'))).length,0)

    const category=await data('support category',adminC.from('intake_categories').select('id,title,default_workstation').eq('slug','customer-support').single())
    const alternate=await data('alternate category',adminC.from('intake_categories').select('id').eq('slug','business-partners').single())
    assert.equal(category.title,'Customer Support'); assert.equal(category.default_workstation,'support')

    const baseForm={
      category_id:category.id,internal_name:'Local Intake Security Form',
      public_slug:`${tag}-public`,destination_workstation:'support',
      default_assignee_id:assignee.id,visibility:'public',lifecycle_status:'draft'
    }
    await denied(
      'wrong route default assignee',
      adminC.from('intake_forms').insert({
        ...baseForm,
        slug:`${tag}-wrong-route-default`,
        default_assignee_id:finance.id
      }),
      /eligible.*destination workstation/i
    )

    await denied('support form admin',supportC.from('intake_forms').insert({...baseForm,slug:`${tag}-support-denied`}))
    await denied('manager form admin',managerC.from('intake_forms').insert({...baseForm,slug:`${tag}-manager-denied`}))
    const form=await data('admin form',adminC.from('intake_forms').insert({...baseForm,slug:`${tag}-form`}).select('id,created_by,lifecycle_status').single())
    formId=form.id
    assert.equal(form.created_by,admin.id); assert.equal(form.lifecycle_status,'draft')
    await count('support draft visibility',supportC.from('intake_forms').select('id').eq('id',form.id),0)
    await count('manager draft visibility',managerC.from('intake_forms').select('id').eq('id',form.id),1)

    await denied('invalid schema',adminC.from('intake_form_versions').insert({
      form_id:form.id,version_number:99,title:'Invalid',field_schema:{fields:{bad:true}}
    }))
    const version=await data('version',adminC.from('intake_form_versions').insert({
      form_id:form.id,version_number:1,title:'Reusable Intake Security Test',
      description:'Local-only security regression form.',
      field_schema:{fields:[
        {key:'full_name',label:'Full Name',type:'text',required:true},
        {key:'email',label:'Email',type:'email',required:true},
        {key:'message',label:'Message',type:'textarea',required:true}
      ]}
    }).select('id,created_by,published_at').single())
    assert.equal(version.created_by,admin.id); assert.equal(version.published_at,null)

    await denied('draft submit',service.from('intake_submissions').insert({
      form_id:form.id,payload:{full_name:'Draft'},source_reference:`${tag}-draft`
    }),/not currently published/i)
    await denied('support publish',supportC.rpc('publish_intake_form_version',{p_form_id:form.id,p_version_id:version.id}),/only administration/i)
    await denied('manager publish',managerC.rpc('publish_intake_form_version',{p_form_id:form.id,p_version_id:version.id}),/only administration/i)
    await data('admin publish',adminC.rpc('publish_intake_form_version',{p_form_id:form.id,p_version_id:version.id}))
    const published=await data('published state',adminC.from('intake_forms').select('lifecycle_status,published_version_id').eq('id',form.id).single())
    assert.equal(published.lifecycle_status,'published'); assert.equal(published.published_version_id,version.id)
    await count('support published visibility',supportC.from('intake_forms').select('id').eq('id',form.id),1)
    await count('inactive published visibility',inactiveC.from('intake_forms').select('id').eq('id',form.id),0)
    await denied('published immutable',adminC.from('intake_form_versions').update({title:'Tampered'}).eq('id',version.id),/immutable/i)

    await denied('anon direct submit',anonymous.from('intake_submissions').insert({form_id:form.id,payload:{full_name:'Anon'}}))
    await denied('support direct submit',supportC.from('intake_submissions').insert({form_id:form.id,payload:{full_name:'Support'}}))
    await denied('admin direct submit',adminC.from('intake_submissions').insert({form_id:form.id,payload:{full_name:'Admin'}}))

    const submission=await data('service submit',service.from('intake_submissions').insert({
      form_id:form.id,form_version_id:alternate.id,category_id:alternate.id,
      form_title_snapshot:'Injected',category_title_snapshot:'Injected',
      destination_workstation:'finance',assigned_employee_id:finance.id,status:'closed',
      payload:{full_name:'Local Intake Prospect',email:'prospect@example.test',message:'Local authorization test only.'},
      source:'form',source_reference:`${tag}-submission`
    }).select('id,form_version_id,category_id,form_title_snapshot,category_title_snapshot,destination_workstation,assigned_employee_id,status,search_text').single())
    submissionId=submission.id
    assert.equal(submission.form_version_id,version.id)
    assert.equal(submission.category_id,category.id)
    assert.equal(submission.form_title_snapshot,'Reusable Intake Security Test')
    assert.equal(submission.category_title_snapshot,'Customer Support')
    assert.equal(submission.destination_workstation,'support')
    assert.equal(submission.assigned_employee_id,assignee.id)
    assert.equal(submission.status,'new')
    assert.match(String(submission.search_text||''),/local intake prospect/i)

    const initial=await data('created event',service.from('intake_submission_events').select('event_type').eq('submission_id',submission.id))
    assert.deepEqual(initial.map(x=>x.event_type),['created'])

    await denied('anon submission read',anonymous.from('intake_submissions').select('id').eq('id',submission.id))
    await count('support submission',supportC.from('intake_submissions').select('id').eq('id',submission.id),1)
    await count('assignee submission',assigneeC.from('intake_submissions').select('id').eq('id',submission.id),1)
    await count('finance isolation',financeC.from('intake_submissions').select('id').eq('id',submission.id),0)
    await count('inactive isolation',inactiveC.from('intake_submissions').select('id').eq('id',submission.id),0)
    await count('manager oversight',managerC.from('intake_submissions').select('id').eq('id',submission.id),1)
    await count('admin oversight',adminC.from('intake_submissions').select('id').eq('id',submission.id),1)

    assert.equal((await data('in progress',supportC.from('intake_submissions').update({status:'in_progress'}).eq('id',submission.id).select('status').single())).status,'in_progress')
    const followed=await data('followed up',assigneeC.from('intake_submissions').update({status:'followed_up'}).eq('id',submission.id).select('status,followed_up_at').single())
    assert.equal(followed.status,'followed_up'); assert.ok(followed.followed_up_at)
    await zeroUpdate('finance update',financeC.from('intake_submissions').update({status:'closed'}).eq('id',submission.id).select('id'))
    await zeroUpdate('inactive update',inactiveC.from('intake_submissions').update({status:'closed'}).eq('id',submission.id).select('id'))
    await denied('support payload rewrite',supportC.from('intake_submissions').update({payload:{tampered:true}}).eq('id',submission.id),/immutable/i)
    await denied('service payload rewrite',service.from('intake_submissions').update({payload:{tampered:true}}).eq('id',submission.id),/immutable/i)
    await denied('support reassign',supportC.from('intake_submissions').update({assigned_employee_id:support.id}).eq('id',submission.id),/only management|reassign/i)
    await denied('inactive assignee',managerC.from('intake_submissions').update({assigned_employee_id:inactive.id}).eq('id',submission.id),/active employee/i)

    await denied(
      'manager wrong workstation assignee',
      managerC
        .from('intake_submissions')
        .update({assigned_employee_id:finance.id})
        .eq('id',submission.id)
        .select('assigned_employee_id'),
      /eligible.*destination workstation/i
    )

    await denied(
      'service wrong workstation assignee',
      service
        .from('intake_submissions')
        .update({assigned_employee_id:finance.id})
        .eq('id',submission.id)
        .select('assigned_employee_id'),
      /eligible.*destination workstation/i
    )

    const moved=await data('manager reassign',managerC.from('intake_submissions').update({assigned_employee_id:support.id}).eq('id',submission.id).select('assigned_employee_id').single())
    assert.equal(moved.assigned_employee_id,support.id)
    await count('eligible former assignee route access',assigneeC.from('intake_submissions').select('id').eq('id',submission.id),1)
    const unassigned=await data(
      'manager unassign',
      managerC
        .from('intake_submissions')
        .update({assigned_employee_id:null})
        .eq('id',submission.id)
        .select('assigned_employee_id')
        .single()
    )
    assert.equal(unassigned.assigned_employee_id,null)

    const claimed=await data(
      'eligible staff claim',
      assigneeC
        .from('intake_submissions')
        .update({assigned_employee_id:assignee.id})
        .eq('id',submission.id)
        .select('assigned_employee_id')
        .single()
    )
    assert.equal(claimed.assigned_employee_id,assignee.id)

    const resolved=await data('resolve',managerC.from('intake_submissions').update({status:'resolved'}).eq('id',submission.id).select('status,resolved_at').single())
    assert.equal(resolved.status,'resolved'); assert.ok(resolved.resolved_at)
    const closed=await data('close',supportC.from('intake_submissions').update({status:'closed'}).eq('id',submission.id).select('status,followed_up_at,resolved_at,closed_at').single())
    assert.equal(closed.status,'closed'); assert.ok(closed.followed_up_at&&closed.resolved_at&&closed.closed_at)

    const events=await data('events',service.from('intake_submission_events').select('event_type,actor_user_id').eq('submission_id',submission.id).order('created_at',{ascending:true}))
    assert.equal(events.length,8)
    assert.equal(events.filter(x=>x.event_type==='status_changed').length,4)
    assert.equal(events.filter(x=>x.event_type==='reassigned').length,2)
    assert.equal(events.filter(x=>x.event_type==='assigned').length,1)
    assert.ok(events.some(x=>x.event_type==='status_changed'&&x.actor_user_id===support.id))
    assert.ok(events.some(x=>x.event_type==='status_changed'&&x.actor_user_id===assignee.id))
    assert.ok(events.some(x=>x.event_type==='reassigned'&&x.actor_user_id===manager.id))
    assert.ok(events.some(x=>x.event_type==='assigned'&&x.actor_user_id===assignee.id))
    await count('support events',supportC.from('intake_submission_events').select('id').eq('submission_id',submission.id),8)
    await count('finance events',financeC.from('intake_submission_events').select('id').eq('submission_id',submission.id),0)
    await count('inactive events',inactiveC.from('intake_submission_events').select('id').eq('submission_id',submission.id),0)
    await count('eligible assignee events',assigneeC.from('intake_submission_events').select('id').eq('submission_id',submission.id),8)
    await denied('forged event',supportC.from('intake_submission_events').insert({submission_id:submission.id,event_type:'forged_event',metadata:{}}))

    console.log('INTAKE_ASSIGNMENT_ROUTE_HARDENING=PASS')
    console.log('INTAKE_SECURITY_MATRIX=PASS')
  }catch(e){
    failure=e instanceof Error?e:new Error(String(e))
  }

  try{
    await cleanup()
    console.log('INTAKE_SECURITY_FIXTURE_CLEANUP=PASS')
  }catch(e){
    if(!failure) failure=e instanceof Error?e:new Error(String(e))
    else console.error('INTAKE_SECURITY_CLEANUP_FAILURE',e)
  }

  if(failure) throw failure
  assert.ok(submissionId)
})
