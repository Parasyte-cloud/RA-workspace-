import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Check,
  CircleDollarSign,
  Clock3,
  RefreshCw,
  Send,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../workflow-unification.css'

type Context=
  | 'department'
  | 'finance'
  | 'executive'

type FinanceRequest={
  id:string
  request_code:string
  requester_id:string
  requesting_department:string
  title:string
  purpose:string
  category:string
  amount:number|string
  currency:string
  needed_by:string|null
  status:string
  finance_review_note:string|null
  executive_note:string|null
  execution_note:string|null
  created_at:string
  updated_at:string
}

const categories=[
  ['vendor_payment','Vendor payment'],
  ['procurement','Procurement'],
  ['reimbursement','Reimbursement'],
  ['refund','Customer refund'],
  ['payroll','Payroll / people cost'],
  ['operations','Operations'],
  ['marketing','Marketing spend'],
  ['other','Other'],
] as const

function label(value:string){
  return value
    .replace(/_/g,' ')
    .replace(
      /\b\w/g,
      character=>character.toUpperCase()
    )
}

function money(
  value:number|string,
  currency='NGN'
){
  const amount=Number(value || 0)

  return new Intl.NumberFormat(
    'en-NG',
    {
      style:'currency',
      currency,
      maximumFractionDigits:2,
    }
  ).format(
    Number.isFinite(amount)
      ? amount
      : 0
  )
}

export default function DepartmentFinanceRequestPanel({
  context='department',
}:{
  context?:Context
}){
  const [requests,setRequests]=
    useState<FinanceRequest[]>([])

  const [actorRole,setActorRole]=
    useState('')

  const [
    financeAuthorised,
    setFinanceAuthorised,
  ]=useState(false)

  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')

  const [notes,setNotes]=
    useState<Record<string,string>>({})

  const submissionIdempotencyKeyRef=
    useRef<string>(crypto.randomUUID())

  const [form,setForm]=useState({
    title:'',
    purpose:'',
    category:'vendor_payment',
    amount:'',
    needed_by:'',
  })

  const executiveAuthorised=
    actorRole==='manager'
    || actorRole==='admin'

  const load=useCallback(async()=>{
    const client=supabase

    if(!client){
      setLoading(false)
      return
    }

    setLoading(true)
    setNotice('')

    try{
      const {
        data:{user},
        error:userError,
      }=await client.auth.getUser()

      if(userError){
        throw userError
      }

      if(!user){
        throw new Error(
          'Your workspace session has expired.'
        )
      }

      const [
        profileResult,
        assignmentResult,
        requestResult,
      ]=await Promise.all([
        client
          .from('employee_profiles')
          .select('id,role')
          .eq('id',user.id)
          .eq('active',true)
          .maybeSingle(),

        client
          .from('workspace_workstation_assignments')
          .select('workstation,active')
          .eq('employee_id',user.id)
          .eq('active',true),

        client
          .from('department_finance_requests')
          .select('*')
          .order(
            'created_at',
            {ascending:false}
          )
          .limit(250),
      ])

      if(profileResult.error){
        throw profileResult.error
      }

      if(assignmentResult.error){
        throw assignmentResult.error
      }

      if(requestResult.error){
        throw requestResult.error
      }

      const role=
        String(
          profileResult.data?.role || ''
        )

      setActorRole(role)

      const assignments=
        (assignmentResult.data || []) as {
          workstation:string
          active:boolean
        }[]

      setFinanceAuthorised(
        role==='finance'
        || assignments.some(
          assignment=>
            assignment.active
            && assignment.workstation==='finance'
        )
      )

      setRequests(
        (requestResult.data || []) as FinanceRequest[]
      )
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to load Finance requests.'
      )
    }finally{
      setLoading(false)
    }
  },[])

  useEffect(()=>{
    void load()
  },[
    load,
  ])

  const submit=async()=>{
    const client=supabase
    const amount=Number(form.amount)

    if(
      !client
      || !form.title.trim()
      || !form.purpose.trim()
      || !Number.isFinite(amount)
      || amount<=0
    ){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const result=await client.rpc(
        'submit_department_finance_request',
        {
          p_title:form.title.trim(),
          p_purpose:form.purpose.trim(),
          p_category:form.category,
          p_amount:amount,
          p_idempotency_key:
            submissionIdempotencyKeyRef.current,
          p_needed_by:
            form.needed_by || null,
        }
      )

      if(result.error){
        throw result.error
      }

      submissionIdempotencyKeyRef.current=
        crypto.randomUUID()

      setForm({
        title:'',
        purpose:'',
        category:'vendor_payment',
        amount:'',
        needed_by:'',
      })

      setNotice(
        'Finance request submitted for governed review.'
      )

      await load()
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to submit Finance request.'
      )
    }finally{
      setBusy(false)
    }
  }

  const financeReview=async(
    requestId:string,
    approve:boolean
  )=>{
    const client=supabase

    if(!client || !financeAuthorised){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const result=await client.rpc(
        'finance_review_department_request',
        {
          p_request_id:requestId,
          p_approve:approve,
          p_note:
            notes[requestId]?.trim()
            || null,
        }
      )

      if(result.error){
        throw result.error
      }

      setNotice(
        approve
          ? 'Finance review completed.'
          : 'Finance request rejected.'
      )

      await load()
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to complete Finance review.'
      )
    }finally{
      setBusy(false)
    }
  }

  const executiveDecision=async(
    requestId:string,
    approve:boolean
  )=>{
    const client=supabase

    if(!client || !executiveAuthorised){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const result=await client.rpc(
        'executive_approve_department_finance_request',
        {
          p_request_id:requestId,
          p_approve:approve,
          p_note:
            notes[requestId]?.trim()
            || null,
        }
      )

      if(result.error){
        throw result.error
      }

      setNotice(
        approve
          ? 'Executive approval recorded.'
          : 'Executive rejection recorded.'
      )

      await load()
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to record executive decision.'
      )
    }finally{
      setBusy(false)
    }
  }

  const executionStatus=async(
    requestId:string,
    status:
      | 'executing'
      | 'executed'
      | 'execution_failed'
  )=>{
    const client=supabase

    if(!client || !financeAuthorised){
      return
    }

    setBusy(true)
    setNotice('')

    try{
      const result=await client.rpc(
        'set_department_finance_execution_status',
        {
          p_request_id:requestId,
          p_status:status,
          p_note:
            notes[requestId]?.trim()
            || null,
        }
      )

      if(result.error){
        throw result.error
      }

      setNotice(
        `Execution status updated to ${label(status)}.`
      )

      await load()
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to update execution status.'
      )
    }finally{
      setBusy(false)
    }
  }

  const heading=useMemo(()=>{
    if(context==='finance'){
      return {
        eyebrow:'FINANCE REVIEW',
        title:'Department Finance Requests',
        copy:'Review department requests, prepare approved items for execution and record execution outcome. No payment is executed automatically from this panel.',
      }
    }

    if(context==='executive'){
      return {
        eyebrow:'EXECUTIVE APPROVAL',
        title:'Finance Approval Queue',
        copy:'Approve or reject requests only after Finance review. Approval does not itself move money.',
      }
    }

    return {
      eyebrow:'FINANCE REQUESTS',
      title:'Request Department Funding or Payment',
      copy:'Submit a governed request to Finance. The request does not grant Finance access to your private department discussion.',
    }
  },[
    context,
  ])

  return (
    <section className="departmentFinanceRequests glassCard">
      <header className="financeRequestHeader">
        <div>
          <span className="eyebrow">
            {heading.eyebrow}
          </span>
          <h3>
            {heading.title}
          </h3>
          <p>
            {heading.copy}
          </p>
        </div>

        <button
          type="button"
          className="glassButton"
          disabled={loading}
          onClick={()=>{
            void load()
          }}
        >
          <RefreshCw size={15}/>
          Refresh
        </button>
      </header>

      {notice&&
        <div className="moduleNotice">
          {notice}
        </div>
      }

      {context==='department'&&
        <div className="financeRequestCreator">
          <label>
            Request title
            <input
              value={form.title}
              maxLength={160}
              placeholder="Vendor payment for campaign production"
              onChange={event=>{
                setForm({
                  ...form,
                  title:event.target.value,
                })
              }}
            />
          </label>

          <label>
            Purpose
            <textarea
              value={form.purpose}
              maxLength={4000}
              placeholder="Business purpose, supporting context and expected outcome"
              onChange={event=>{
                setForm({
                  ...form,
                  purpose:event.target.value,
                })
              }}
            />
          </label>

          <div className="financeRequestFormGrid">
            <label>
              Category
              <select
                value={form.category}
                onChange={event=>{
                  setForm({
                    ...form,
                    category:event.target.value,
                  })
                }}
              >
                {categories.map(
                  ([value,text])=>(
                    <option
                      key={value}
                      value={value}
                    >
                      {text}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              Amount (NGN)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={event=>{
                  setForm({
                    ...form,
                    amount:event.target.value,
                  })
                }}
              />
            </label>

            <label>
              Needed by
              <input
                type="date"
                value={form.needed_by}
                onChange={event=>{
                  setForm({
                    ...form,
                    needed_by:event.target.value,
                  })
                }}
              />
            </label>
          </div>

          <button
            type="button"
            className="primaryButton"
            disabled={
              busy
              || !form.title.trim()
              || !form.purpose.trim()
              || !(Number(form.amount)>0)
            }
            onClick={()=>{
              void submit()
            }}
          >
            <Send size={16}/>
            Submit to Finance
          </button>
        </div>
      }

      <div className="financeRequestList">
        {requests.map(request=>(
          <article
            key={request.id}
            className="financeRequestCard"
          >
            <div className="financeRequestTop">
              <div>
                <small>
                  {request.request_code}
                  {' · '}
                  {request.requesting_department}
                </small>
                <strong>
                  {request.title}
                </strong>
              </div>

              <span className={`statusPill ${request.status}`}>
                {label(request.status)}
              </span>
            </div>

            <p>
              {request.purpose}
            </p>

            <div className="financeRequestFacts">
              <span>
                <CircleDollarSign size={15}/>
                {money(
                  request.amount,
                  request.currency || 'NGN'
                )}
              </span>

              <span>
                <Clock3 size={15}/>
                {request.needed_by
                  ? `Needed ${request.needed_by}`
                  : new Date(
                      request.created_at
                    ).toLocaleDateString()
                }
              </span>

              <span>
                {label(request.category)}
              </span>
            </div>

            {(request.finance_review_note
              || request.executive_note
              || request.execution_note) &&
              <div className="financeRequestNotes">
                {request.finance_review_note&&
                  <small>
                    Finance: {request.finance_review_note}
                  </small>
                }

                {request.executive_note&&
                  <small>
                    Executive: {request.executive_note}
                  </small>
                }

                {request.execution_note&&
                  <small>
                    Execution: {request.execution_note}
                  </small>
                }
              </div>
            }

            {(
              context==='finance'
              || context==='executive'
            )&&
              <textarea
                className="financeRequestActionNote"
                value={notes[request.id] || ''}
                maxLength={2000}
                placeholder="Optional review / execution note"
                onChange={event=>{
                  setNotes(current=>({
                    ...current,
                    [request.id]:
                      event.target.value,
                  }))
                }}
              />
            }

            {context==='finance'
              && financeAuthorised
              && request.status==='submitted' &&
              <div className="financeRequestActions">
                <button
                  type="button"
                  className="primaryButton"
                  disabled={busy}
                  onClick={()=>{
                    void financeReview(
                      request.id,
                      true
                    )
                  }}
                >
                  <Check size={15}/>
                  Finance approve
                </button>

                <button
                  type="button"
                  className="glassButton danger"
                  disabled={busy}
                  onClick={()=>{
                    void financeReview(
                      request.id,
                      false
                    )
                  }}
                >
                  <X size={15}/>
                  Reject
                </button>
              </div>
            }

            {context==='executive'
              && executiveAuthorised
              && request.status==='finance_reviewed' &&
              <div className="financeRequestActions">
                <button
                  type="button"
                  className="primaryButton"
                  disabled={busy}
                  onClick={()=>{
                    void executiveDecision(
                      request.id,
                      true
                    )
                  }}
                >
                  <Check size={15}/>
                  Executive approve
                </button>

                <button
                  type="button"
                  className="glassButton danger"
                  disabled={busy}
                  onClick={()=>{
                    void executiveDecision(
                      request.id,
                      false
                    )
                  }}
                >
                  <X size={15}/>
                  Reject
                </button>
              </div>
            }

            {context==='finance'
              && financeAuthorised
              && (
                request.status==='executive_approved'
                || request.status==='execution_failed'
              ) &&
              <div className="financeRequestActions">
                <button
                  type="button"
                  className="primaryButton"
                  disabled={busy}
                  onClick={()=>{
                    void executionStatus(
                      request.id,
                      'executing'
                    )
                  }}
                >
                  Begin execution
                </button>
              </div>
            }

            {context==='finance'
              && financeAuthorised
              && request.status==='executing' &&
              <div className="financeRequestActions">
                <button
                  type="button"
                  className="primaryButton"
                  disabled={busy}
                  onClick={()=>{
                    void executionStatus(
                      request.id,
                      'executed'
                    )
                  }}
                >
                  <Check size={15}/>
                  Mark executed
                </button>

                <button
                  type="button"
                  className="glassButton danger"
                  disabled={busy}
                  onClick={()=>{
                    void executionStatus(
                      request.id,
                      'execution_failed'
                    )
                  }}
                >
                  <X size={15}/>
                  Mark failed
                </button>
              </div>
            }
          </article>
        ))}

        {!loading&&!requests.length&&
          <div className="workflowEmpty">
            <CircleDollarSign size={28}/>
            <strong>
              No Finance requests visible here yet.
            </strong>
          </div>
        }
      </div>
    </section>
  )
}
