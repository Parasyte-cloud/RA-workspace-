import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import type {
  FormEvent
} from 'react'

import {
  IdCard,
  Lock,
  Save,
  Search,
  Unlock
} from 'lucide-react'

import { supabase } from '../lib/supabase'

type HrDetails = {
  id:string
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

export default function EmployeeHrDetailsAdminPanel({
  employees
}:{
  employees:Record<string,unknown>[]
}){
  const [query,setQuery]=useState('')
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const [form,setForm]=useState<FormState>(EMPTY_FORM)
  const [submittedAt,setSubmittedAt]=useState<string|null>(null)
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [message,setMessage]=useState('')

  const visibleEmployees=useMemo(()=>{
    const q=query.trim().toLowerCase()
    if(!q) return employees.slice(0,12)
    return employees.filter(employee=>
      String(employee.full_name||'').toLowerCase().includes(q)
      || String(employee.email||'').toLowerCase().includes(q)
      || String(employee.department||'').toLowerCase().includes(q)
    ).slice(0,12)
  },[employees,query])

  const selected=employees.find(employee=>String(employee.id)===selectedId)

  const load=useCallback(async(id:string)=>{
    if(!supabase) return
    setLoading(true)
    setMessage('')

    const {data,error}=await supabase
      .from('employee_hr_details')
      .select('*')
      .eq('id',id)
      .maybeSingle()

    setLoading(false)

    if(error){
      setMessage(error.message)
      return
    }

    const row=data as HrDetails|null
    setForm(toForm(row))
    setSubmittedAt(row?.submitted_at||null)
  },[])

  useEffect(()=>{
    if(selectedId){
      void load(selectedId)
    }
  },[selectedId,load])

  const field=(key:keyof FormState)=>({
    value:form[key],
    disabled:saving,
    onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>
      setForm(current=>({...current,[key]:event.target.value}))
  })

  const submit=async(event:FormEvent)=>{
    event.preventDefault()
    if(!supabase || !selectedId) return

    setSaving(true)
    setMessage('')

    const {error}=await supabase
      .from('employee_hr_details')
      .upsert({
        id:selectedId,
        ...form
      })

    setSaving(false)

    if(error){
      setMessage(error.message)
      return
    }

    setMessage('Saved.')
  }

  return (
    <div className="glassCard workbench hrDetailsAdminPanel" aria-label="Employee HR details (HR / Manager / Admin)">
      <div className="workbenchHead">
        <div>
          <h3>Employee HR details</h3>
          <p>View and edit any employee's HR biodata — this bypasses the employee's own lock, since HR, a manager or an admin is allowed to correct it at any time.</p>
        </div>
        <IdCard/>
      </div>

      <div className="moduleSearch">
        <Search size={15}/>
        <input
          value={query}
          onChange={event=>setQuery(event.target.value)}
          placeholder="Search employees by name, email or department"
        />
      </div>

      <div className="hrDetailsAdminGrid">
        <div className="hrDetailsAdminList">
          {visibleEmployees.map(employee=>{
            const id=String(employee.id)
            return (
              <button
                type="button"
                key={id}
                className={id===selectedId?'hrDetailsAdminListItem active':'hrDetailsAdminListItem'}
                onClick={()=>setSelectedId(id)}
              >
                <strong>{String(employee.full_name||employee.email)}</strong>
                <small>{String(employee.department||employee.role||'—')}</small>
              </button>
            )
          })}
          {!visibleEmployees.length && (
            <div className="hrDetailsAdminEmpty">No matching employees.</div>
          )}
        </div>

        <div className="hrDetailsAdminForm">
          {!selected && (
            <div className="hrDetailsAdminEmpty">Select an employee to view or edit their HR details.</div>
          )}

          {selected && loading && (
            <div className="hrDetailsAdminEmpty">Loading...</div>
          )}

          {selected && !loading && (
            <>
              <div className="hrDetailsAdminSelectedHead">
                <strong>{String(selected.full_name||selected.email)}</strong>
                {submittedAt ? (
                  <span className="hrDetailsAdminStatus locked"><Lock size={12}/> Submitted {new Date(submittedAt).toLocaleDateString()}</span>
                ) : (
                  <span className="hrDetailsAdminStatus"><Unlock size={12}/> Not yet submitted by employee</span>
                )}
              </div>

              <form className="quickForm" onSubmit={submit}>
                <div className="quickFormGrid">
                  <label>Home address
                    <input type="text" {...field('home_address')}/>
                  </label>
                  <label>State of origin
                    <input type="text" {...field('state_of_origin')}/>
                  </label>
                  <label>Marital status
                    <select {...field('marital_status')}>
                      <option value="">Select</option>
                      <option value="single">Single</option>
                      <option value="married">Married</option>
                      <option value="divorced">Divorced</option>
                      <option value="widowed">Widowed</option>
                    </select>
                  </label>
                  <label>Next of kin — full name
                    <input type="text" {...field('next_of_kin_name')}/>
                  </label>
                  <label>Next of kin — relationship
                    <input type="text" {...field('next_of_kin_relationship')}/>
                  </label>
                  <label>Next of kin — phone number
                    <input type="tel" {...field('next_of_kin_phone')}/>
                  </label>
                  <label>Bank name
                    <input type="text" {...field('bank_name')}/>
                  </label>
                  <label>Bank account number
                    <input type="text" {...field('bank_account_number')}/>
                  </label>
                  <label>BVN
                    <input type="text" {...field('bvn')}/>
                  </label>
                  <label>Tax Identification Number (TIN)
                    <input type="text" {...field('tax_identification_number')}/>
                  </label>
                  <label>Pension PIN (PenCom)
                    <input type="text" {...field('pension_pin')}/>
                  </label>
                </div>

                {message && <div className="moduleNotice">{message}</div>}

                <button className="primaryButton" disabled={saving}>
                  {saving ? 'Saving...' : <><Save size={15}/> Save details</>}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
