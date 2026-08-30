import { useCallback, useEffect, useState } from 'react'
import { Clock3, Laptop, MapPin, RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../sign-in-activity.css'

type SignInRow={
  id:string
  browser_name:string|null
  operating_system:string|null
  platform:string|null
  source_ip:string|null
  timezone:string|null
  location_consent:boolean
  location_sharing_active:boolean
  address_full:string|null
  city:string|null
  state:string|null
  country:string|null
  first_seen_at:string
  last_seen_at:string
  location_captured_at:string|null
  geocoding_provider:string|null
}

function when(value:string|null|undefined){
  if(!value) return 'Not recorded'
  const date=new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function MySignInActivity(){
  const [rows,setRows]=useState<SignInRow[]>([])
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){setLoading(false);return}
    setLoading(true)
    setMessage('')
    try{
      const {data,error}=await client.rpc('my_sign_in_location_history',{p_limit:10})
      if(error) throw error
      setRows((data || []) as SignInRow[])
    }catch(error:any){
      setMessage(error?.message || 'Unable to load sign-in activity.')
    }finally{
      setLoading(false)
    }
  },[])

  useEffect(()=>{void load()},[load])

  return <section className="glassCard mySignInActivity">
    <div className="mySignInHeader">
      <div><span className="eyebrow">ACCOUNT SECURITY</span><h3>My sign-in activity</h3><p>See the browser, network and location information RideArrivo has recorded for your recent authenticated sessions.</p></div>
      <button type="button" className="glassButton" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>Refresh</button>
    </div>

    <div className="mySignInNotice"><ShieldCheck size={16}/><span>Precise location is recorded only after you choose to share it. Security telemetry is retained for a limited period and authorised administrators can review it for account security and workplace administration.</span></div>
    {message&&<div className="moduleNotice">{message}</div>}

    <div className="mySignInList">
      {rows.map(row=><article key={row.id} className="mySignInRow">
        <div className="mySignInIcon"><Laptop size={17}/></div>
        <div className="mySignInMain">
          <strong>{row.browser_name || 'Browser'} · {row.operating_system || row.platform || 'Device'}</strong>
          <span><MapPin size={13}/>{row.address_full || row.city || row.timezone || (row.location_consent?'Address unavailable':'Precise location not shared')}</span>
          <small><Clock3 size={12}/>First seen {when(row.first_seen_at)} · Last seen {when(row.last_seen_at)}</small>
        </div>
        <div className="mySignInMeta"><span>{row.source_ip || 'Network unavailable'}</span><small>{row.location_sharing_active?'Sharing enabled':row.location_consent?'Shared at sign-in':'Not shared'}</small></div>
      </article>)}
      {!loading&&!rows.length&&<div className="mySignInEmpty">No sign-in activity has been recorded yet.</div>}
      {loading&&<div className="mySignInEmpty">Loading sign-in activity...</div>}
    </div>
  </section>
}
