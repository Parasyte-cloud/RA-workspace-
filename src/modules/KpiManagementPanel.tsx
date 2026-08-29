import { useCallback, useEffect, useState } from 'react'
import { Award, RefreshCw, ShieldCheck, Target } from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../kpi-management.css'

type Row={
  employee_id:string
  full_name:string
  email:string
  department:string|null
  job_title:string|null
  role:string
  workstation:string|null
  rolling_score:number|null
  rolling_status:string|null
  annual_score:number|null
  annual_status:string|null
  current_badge:string|null
}

function score(value:number|null){
  return value===null || value===undefined ? '—' : `${Math.round(Number(value))}%`
}

export default function KpiManagementPanel(){
  const [rows,setRows]=useState<Row[]>([])
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){
      setLoading(false)
      setMessage('KPI service is not configured.')
      return
    }
    setLoading(true)
    setMessage('')
    const {data,error}=await client.rpc('managed_employee_kpi_summary')
    if(error){
      setRows([])
      setMessage(error.message)
    }else{
      setRows((data || []) as Row[])
    }
    setLoading(false)
  },[])

  useEffect(()=>{ void load() },[load])

  return (
    <section className="glassCard kpiManagementPanel">
      <div className="kpiManagementHeader">
        <div>
          <span className="eyebrow">PEOPLE PERFORMANCE</span>
          <h3>Transparent KPI monitor</h3>
          <p>30-day delivery and year-to-date evaluation use the same evidence available to employees on their dashboards.</p>
        </div>
        <button type="button" className="glassButton" disabled={loading} onClick={()=>void load()}>
          <RefreshCw size={15}/>{loading?'Refreshing...':'Refresh'}
        </button>
      </div>

      <div className="kpiGovernanceNote">
        <ShieldCheck size={17}/>
        <span>KPI automation is a coaching and recognition signal. Context and documented manager review remain required for compensation, promotion, discipline or termination decisions.</span>
      </div>

      {message&&<div className="moduleNotice">{message}</div>}

      {loading ? (
        <div className="kpiManagementEmpty">Loading employee KPI data...</div>
      ) : rows.length===0 ? (
        <div className="kpiManagementEmpty">No active employee KPI records are available yet.</div>
      ) : (
        <div className="kpiManagementTableWrap">
          <table className="kpiManagementTable">
            <thead><tr><th>Employee</th><th>Workstation</th><th>30-day KPI</th><th>Annual KPI</th><th>Recognition</th></tr></thead>
            <tbody>
              {rows.map(row=>(
                <tr key={row.employee_id}>
                  <td><strong>{row.full_name || row.email}</strong><small>{row.job_title || row.department || row.role}</small></td>
                  <td>{row.workstation || 'Unassigned'}</td>
                  <td><span className="kpiScore"><Target size={14}/>{score(row.rolling_score)}</span><small>{row.rolling_status || 'insufficient data'}</small></td>
                  <td><span className="kpiScore"><Target size={14}/>{score(row.annual_score)}</span><small>{row.annual_status || 'insufficient data'}</small></td>
                  <td>{row.current_badge ? <span className="kpiBadge"><Award size={14}/>{row.current_badge}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
