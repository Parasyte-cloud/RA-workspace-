import {
  useEffect,
  useMemo,
  useState
} from 'react'

import type {
  FormEvent,
  ReactNode
} from 'react'

import {
  RefreshCw,
  Search
} from 'lucide-react'

import {
  supabase
} from '../lib/supabase'


type Field={
  key:string
  label:string
  type?:
    | 'text'
    | 'number'
    | 'date'
    | 'select'
    | 'textarea'
  required?:boolean
  options?:string[]
}

type Column={
  key:string
  label:string
  render?:(
    row:Record<string,unknown>
  )=>ReactNode
}


export function DataWorkbench({table,title,description,fields,columns,createLabel='Add record',orderBy='created_at'}:{table:string;title:string;description:string;fields:Field[];columns:Column[];createLabel?:string;orderBy?:string}){
 const [rows,setRows]=useState<Record<string,unknown>[]>([]),[form,setForm]=useState<Record<string,string>>({}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false),[query,setQuery]=useState('')
 const load=async()=>{if(!supabase){setLoading(false);return}setLoading(true);setError('');const {data,error}=await supabase.from(table).select('*').order(orderBy,{ascending:false}).limit(100);if(error)setError(error.message);setRows((data||[]) as Record<string,unknown>[]);setLoading(false)}
 useEffect(()=>{void load()},[table])
 const visible=useMemo(()=>{const q=query.trim().toLowerCase();return q?rows.filter(r=>Object.values(r).some(v=>String(v??'').toLowerCase().includes(q))):rows},[rows,query])
 const submit=async(e:FormEvent)=>{e.preventDefault();if(!supabase)return;setSaving(true);setError('');const payload:Record<string,unknown>={};for(const f of fields){const v=form[f.key];if(v!==undefined&&v!=='')payload[f.key]=f.type==='number'?Number(v):v}const {error}=await supabase.from(table).insert(payload);setSaving(false);if(error){setError(error.message);return}setForm({});setOpen(false);await load()}
 return <div className="glassCard workbench"><div className="workbenchHead"><div><h3>{title}</h3><p>{description}</p></div><div className="workbenchActions"><button className="iconButton" onClick={()=>void load()} title="Refresh"><RefreshCw size={16}/></button><button className="primaryButton" onClick={()=>setOpen(v=>!v)}>{open?'Close':createLabel}</button></div></div><div className="moduleSearch"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${title.toLowerCase()}`}/></div>{error&&<div className="moduleError">{error}</div>}{open&&<form className="quickForm" onSubmit={submit}><div className="quickFormGrid">{fields.map(f=><label key={f.key}>{f.label}{f.type==='select'?<select required={f.required} value={form[f.key]||''} onChange={e=>setForm({...form,[f.key]:e.target.value})}><option value="">Select</option>{f.options?.map(o=><option key={o} value={o}>{o}</option>)}</select>:f.type==='textarea'?<textarea required={f.required} value={form[f.key]||''} onChange={e=>setForm({...form,[f.key]:e.target.value})}/>:<input required={f.required} type={f.type||'text'} value={form[f.key]||''} onChange={e=>setForm({...form,[f.key]:e.target.value})}/>}</label>)}</div><button className="primaryButton" disabled={saving}>{saving?'Saving...':'Save record'}</button></form>}<div className="moduleTableWrap"><table className="moduleTable"><thead><tr>{columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={columns.length}>Loading…</td></tr>:visible.length===0?<tr><td colSpan={columns.length}>No records yet.</td></tr>:visible.map((r,i)=><tr key={String(r.id||i)}>{columns.map(c=><td key={c.key}>{c.render?c.render(r):String(r[c.key]??'—')}</td>)}</tr>)}</tbody></table></div></div>
}
