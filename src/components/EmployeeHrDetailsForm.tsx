import {
  useCallback,
  useEffect,
  useState
} from 'react'

import type {
  FormEvent
} from 'react'

import {
  IdCard,
  Loader2,
  Lock,
  Save
} from 'lucide-react'

import { supabase } from '../lib/supabase'

type HrDetails = {
  home_address:string|null
  state_of_origin:string|null
  marital_status:string|null
  next_of_kin_name:string|null
  next_of_kin_relationship:string|null
  next_of_kin_phone:string|null
  bank_name:string|null
  bank_account_number:string|null
  bvn:string|null
  tax_identification_number:string|null
  pension_pin:string|null
  submitted_at:string|null
}

type FormState={
  home_address:string
  state_of_origin:string
  marital_status:string
  next_of_kin_name:string
  next_of_kin_relationship:string
  next_of_kin_phone:string
  bank_name:string
  bank_account_number:string
  bvn:string
  tax_identification_number:string
  pension_pin:string
}

const EMPTY_FORM:FormState={
  home_address:'',
  state_of_origin:'',
  marital_status:'',
  next_of_kin_name:'',
  next_of_kin_relationship:'',
  next_of_kin_phone:'',
  bank_name:'',
  bank_account_number:'',
  bvn:'',
  tax_identification_number:'',
  pension_pin:''
}

function toForm(row:HrDetails|null):FormState{
  if(!row) return EMPTY_FORM
  return {
    home_address:row.home_address||'',
    state_of_origin:row.state_of_origin||'',
    marital_status:row.marital_status||'',
    next_of_kin_name:row.next_of_kin_name||'',
    next_of_kin_relationship:row.next_of_kin_relationship||'',
    next_of_kin_phone:row.next_of_kin_phone||'',
    bank_name:row.bank_name||'',
    bank_account_number:row.bank_account_number||'',
    bvn:row.bvn||'',
    tax_identification_number:row.tax_identification_number||'',
    pension_pin:row.pension_pin||''
  }
}

export default function EmployeeHrDetailsForm(){
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [submittedAt,setSubmittedAt]=useState<string|null>(null)
  const [form,setForm]=useState<FormState>(EMPTY_FORM)
  const [message,setMessage]=useState('')

  const locked=Boolean(submittedAt)

  const load=useCallback(async()=>{
    if(!supabase){
      setLoading(false)
      return
    }

    const {data:{user}}=await supabase.auth.getUser()
    if(!user){
      setLoading(false)
      return
    }

    const {data,error}=await supabase
      .from('employee_hr_details')
      .select('*')
      .eq('id',user.id)
      .maybeSingle()

    if(error){
      console.error('[RideArrivo HR details]',error)
      setLoading(false)
      return
    }

    const row=data as HrDetails|null
    setForm(toForm(row))
    setSubmittedAt(row?.submitted_at||null)
    setLoading(false)
  },[])

  useEffect(()=>{ void load() },[load])

  const field=(key:keyof FormState)=>({
    value:form[key],
    disabled:locked||saving,
    onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>
      setForm(current=>({...current,[key]:event.target.value}))
  })

  const submit=async(event:FormEvent)=>{
    event.preventDefault()
    if(!supabase || locked) return

    setSaving(true)
    setMessage('')

    const {data:{user}}=await supabase.auth.getUser()
    if(!user){
      setMessage('Your workspace session has expired.')
      setSaving(false)
      return
    }

    const nowIso=new Date().toISOString()

    const {error}=await supabase
      .from('employee_hr_details')
      .upsert({
        id:user.id,
        ...form,
        submitted_at:nowIso
      })

    setSaving(false)

    if(error){
      setMessage(error.message)
      return
    }

    setSubmittedAt(nowIso)
    setMessage('Submitted. Your HR details are now locked — contact your manager, HR or Administration to change them.')
  }

  if(loading){
    return (
      <section className="glassCard employeeHrDetails" aria-label="Employee HR details">
        <div className="employeeHrDetailsHead">
          <IdCard size={20}/>
          <div>
            <span className="eyebrow">HR DETAILS</span>
            <h3>Employee HR Details</h3>
          </div>
        </div>
        <p className="employeeHrDetailsLoading"><Loader2 size={14} className="employeeHrDetailsSpin"/> Loading...</p>
      </section>
    )
  }

  return (
    <section className="glassCard employeeHrDetails" aria-label="Employee HR details">
      <div className="employeeHrDetailsHead">
        <IdCard size={20}/>
        <div>
          <span className="eyebrow">HR DETAILS</span>
          <h3>Employee HR Details</h3>
          <p>Home address, next of kin and the bank/statutory details HR and payroll need on file. Fill this in once — after you submit, only your manager, HR or Administration can change it.</p>
        </div>
      </div>

      {locked && (
        <div className="employeeHrDetailsLocked">
          <Lock size={14}/>
          Submitted{submittedAt?` on ${new Date(submittedAt).toLocaleDateString()}`:''}. These details are locked to you now — ask your manager, HR or Administration if something needs to change.
        </div>
      )}

      <form className="quickForm" onSubmit={submit}>
        <div className="quickFormGrid">
          <label>Home address
            <input type="text" required {...field('home_address')} placeholder="Street, city, state"/>
          </label>

          <label>State of origin
            <input type="text" required {...field('state_of_origin')}/>
          </label>

          <label>Marital status
            <select required {...field('marital_status')}>
              <option value="">Select</option>
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="divorced">Divorced</option>
              <option value="widowed">Widowed</option>
            </select>
          </label>

          <label>Next of kin — full name
            <input type="text" required {...field('next_of_kin_name')}/>
          </label>

          <label>Next of kin — relationship
            <input type="text" required {...field('next_of_kin_relationship')} placeholder="e.g. Spouse, Parent, Sibling"/>
          </label>

          <label>Next of kin — phone number
            <input type="tel" required {...field('next_of_kin_phone')}/>
          </label>

          <label>Bank name
            <input type="text" required {...field('bank_name')}/>
          </label>

          <label>Bank account number
            <input type="text" required {...field('bank_account_number')}/>
          </label>

          <label>BVN
            <input type="text" required {...field('bvn')}/>
          </label>

          <label>Tax Identification Number (TIN)
            <input type="text" {...field('tax_identification_number')}/>
          </label>

          <label>Pension PIN (PenCom)
            <input type="text" {...field('pension_pin')}/>
          </label>
        </div>

        {message && <div className="moduleNotice">{message}</div>}

        {!locked && (
          <button className="primaryButton" disabled={saving}>
            {saving ? 'Submitting...' : <><Save size={15}/> Submit HR details</>}
          </button>
        )}
      </form>
    </section>
  )
}
