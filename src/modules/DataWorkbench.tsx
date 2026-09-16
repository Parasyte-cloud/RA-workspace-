import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  FormEvent,
  ReactNode,
} from 'react'

import {
  Pencil,
  RefreshCw,
  Search,
} from 'lucide-react'

import {
  supabase,
} from '../lib/supabase'


type Field={
  key:string
  label:string
  type?:
    | 'text'
    | 'number'
    | 'date'
    | 'datetime-local'
    | 'time'
    | 'select'
    | 'textarea'
    | 'employee'
  required?:boolean
  options?:string[]
}

type Column={
  key:string
  label:string
  render?:(
    row:Record<string,unknown>,
    employees:EmployeeOption[]
  )=>ReactNode
}

type EmployeeOption={
  id:string
  full_name:string
  email:string
}

function toDatetimeLocalValue(value:unknown):string{
  if(value===null||value===undefined||value===''){
    return ''
  }

  const date=new Date(String(value))

  if(Number.isNaN(date.getTime())){
    return ''
  }

  const pad=(part:number)=>String(part).padStart(2,'0')

  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toFormValue(field:Field,raw:unknown):string{
  if(raw===null||raw===undefined){
    return ''
  }

  if(field.type==='datetime-local'){
    return toDatetimeLocalValue(raw)
  }

  if(field.type==='date'){
    return String(raw).slice(0,10)
  }

  if(field.type==='time'){
    return String(raw).slice(0,5)
  }

  return String(raw)
}

export function DataWorkbench({
  table,
  title,
  description,
  fields,
  columns,
  createLabel='Add record',
  orderBy='created_at'
}:{
  table:string
  title:string
  description:string
  fields:Field[]
  columns:Column[]
  createLabel?:string
  orderBy?:string
}){
  const [rows,setRows]=useState<Record<string,unknown>[]>([])
  const [form,setForm]=useState<Record<string,string>>({})
  const [loading,setLoading]=useState(true)
  const [refreshing,setRefreshing]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [open,setOpen]=useState(false)
  const [editingId,setEditingId]=useState<string|null>(null)
  const [query,setQuery]=useState('')
  const [employees,setEmployees]=useState<EmployeeOption[]>([])

  const requestSequenceRef=useRef(0)
  const hasLoadedRef=useRef(false)

  const load=useCallback(async()=>{
    const client=supabase

    if(!client){
      setLoading(false)
      setRefreshing(false)
      return
    }

    const requestSequence=++requestSequenceRef.current

    if(hasLoadedRef.current){
      setRefreshing(true)
    }else{
      setLoading(true)
    }

    setError('')

    const {data,error:loadError}=await client
      .from(table)
      .select('*')
      .order(orderBy,{ascending:false})
      .limit(100)

    if(requestSequence!==requestSequenceRef.current){
      return
    }

    if(loadError){
      // Keep the last successful table snapshot. A transient refresh error
      // must not replace valid records with an empty table.
      setError(loadError.message)
    }else{
      setRows((data||[]) as Record<string,unknown>[])
      hasLoadedRef.current=true
    }

    setLoading(false)
    setRefreshing(false)
  },[table,orderBy])

  useEffect(()=>{
    hasLoadedRef.current=false
    setRows([])
    setError('')
    void load()

    return()=>{
      requestSequenceRef.current+=1
    }
  },[load])

  const needsEmployeeField=fields.some(
    field=>field.type==='employee'
  )

  useEffect(()=>{
    const client=supabase
    if(!client || !needsEmployeeField){
      setEmployees([])
      return
    }

    let cancelled=false

    void client
      .from('employee_profiles')
      .select('id,full_name,email')
      .eq('active',true)
      .order('full_name')
      .then(({data,error:employeeError})=>{
        if(cancelled){
          return
        }

        if(employeeError){
          console.error(
            `[RideArrivo ${title}] employee options failed`,
            employeeError
          )
          return
        }

        setEmployees(
          (data||[]) as EmployeeOption[]
        )
      })

    return()=>{
      cancelled=true
    }
  },[needsEmployeeField,title])

  const visible=useMemo(()=>{
    const q=query.trim().toLowerCase()
    return q
      ? rows.filter(row=>
          Object.values(row).some(value=>
            String(value??'')
              .toLowerCase()
              .includes(q)
          )
        )
      : rows
  },[rows,query])

  const startCreate=()=>{
    setForm({})
    setEditingId(null)
    setError('')
    setOpen(true)
  }

  const startEdit=(row:Record<string,unknown>)=>{
    const next:Record<string,string>={}

    for(const field of fields){
      next[field.key]=toFormValue(field,row[field.key])
    }

    setForm(next)
    setEditingId(row.id?String(row.id):null)
    setError('')
    setOpen(true)
  }

  const closeForm=()=>{
    setOpen(false)
    setEditingId(null)
    setForm({})
    setError('')
  }

  const submit=async(event:FormEvent)=>{
    event.preventDefault()

    const client=supabase
    if(!client){
      return
    }

    setSaving(true)
    setError('')

    const payload:Record<string,unknown>={}

    for(const field of fields){
      const value=form[field.key]
      if(value!==undefined && value!==''){
        payload[field.key]=
          field.type==='number'
            ? Number(value)
            : value
      }
    }

    const {error:saveError}=editingId
      ? await client
          .from(table)
          .update(payload)
          .eq('id',editingId)
      : await client
          .from(table)
          .insert(payload)

    setSaving(false)

    if(saveError){
      setError(saveError.message)
      return
    }

    setForm({})
    setOpen(false)
    setEditingId(null)
    await load()
  }

  const initialLoading=loading && !hasLoadedRef.current

  return (
    <div className="glassCard workbench" aria-busy={initialLoading||refreshing}>
      <div className="workbenchHead">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="workbenchActions">
          <button
            className="iconButton"
            type="button"
            onClick={()=>void load()}
            title="Refresh"
            disabled={loading||refreshing}
          >
            <RefreshCw size={16}/>
          </button>
          {open ? (
            <button
              className="glassButton"
              type="button"
              onClick={closeForm}
            >
              Cancel
            </button>
          ) : (
            <button
              className="primaryButton"
              type="button"
              onClick={startCreate}
            >
              {createLabel}
            </button>
          )}
        </div>
      </div>

      <div className="moduleSearch">
        <Search size={15}/>
        <input
          value={query}
          onChange={event=>setQuery(event.target.value)}
          placeholder={`Search ${title.toLowerCase()}`}
        />
      </div>

      {error&&<div className="moduleError">{error}</div>}

      {open&&(
        <form className="quickForm" onSubmit={submit}>
          <div className="quickFormGrid">
            {fields.map(field=>(
              <label key={field.key}>
                {field.label}
                {field.type==='select' ? (
                  <select
                    required={field.required}
                    value={form[field.key]||''}
                    onChange={event=>setForm({
                      ...form,
                      [field.key]:event.target.value,
                    })}
                  >
                    <option value="">Select</option>
                    {field.options?.map(option=>(
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : field.type==='employee' ? (
                  <select
                    required={field.required}
                    value={form[field.key]||''}
                    onChange={event=>setForm({
                      ...form,
                      [field.key]:event.target.value,
                    })}
                  >
                    <option value="">Select employee</option>
                    {employees.map(employee=>(
                      <option key={employee.id} value={employee.id}>
                        {employee.full_name} ({employee.email})
                      </option>
                    ))}
                  </select>
                ) : field.type==='textarea' ? (
                  <textarea
                    required={field.required}
                    value={form[field.key]||''}
                    onChange={event=>setForm({
                      ...form,
                      [field.key]:event.target.value,
                    })}
                  />
                ) : (
                  <input
                    required={field.required}
                    type={field.type||'text'}
                    value={form[field.key]||''}
                    onChange={event=>setForm({
                      ...form,
                      [field.key]:event.target.value,
                    })}
                  />
                )}
              </label>
            ))}
          </div>

          <button className="primaryButton" disabled={saving}>
            {saving
              ? 'Saving...'
              : editingId
                ? 'Save changes'
                : 'Save record'}
          </button>
        </form>
      )}

      <div className="moduleTableWrap">
        <table className="moduleTable">
          <thead>
            <tr>
              {columns.map(column=>(
                <th key={column.key}>{column.label}</th>
              ))}
              <th aria-label="Actions"/>
            </tr>
          </thead>
          <tbody>
            {initialLoading ? (
              <tr>
                <td colSpan={columns.length+1}>Loading…</td>
              </tr>
            ) : visible.length===0 ? (
              <tr>
                <td colSpan={columns.length+1}>No records yet.</td>
              </tr>
            ) : visible.map((row,index)=>(
              <tr key={String(row.id||index)}>
                {columns.map(column=>(
                  <td key={column.key}>
                    {column.render
                      ? column.render(row,employees)
                      : String(row[column.key]??'—')}
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="workbenchEditButton"
                    onClick={()=>startEdit(row)}
                    title={`Edit this ${title.toLowerCase()} record`}
                  >
                    <Pencil size={13}/>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
