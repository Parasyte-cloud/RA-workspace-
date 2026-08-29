import { useCallback, useEffect, useState } from 'react'
import { Download, LockKeyhole, Send, ShieldCheck, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../download-access.css'

export type DownloadResource={
  resourceType:string
  resourceKey:string
  resourceName:string
}

type RequestRow={
  id:string
  status:'pending'|'approved'|'denied'|'revoked'
  requested_at:string
  reviewed_at:string|null
  grant_expires_at:string|null
  decision_note:string|null
}

type Props={
  resource:DownloadResource
  onGranted:()=>void|Promise<void>
  className?:string
  label?:string
  compact?:boolean
}

function activeGrant(row:RequestRow|null){
  if(!row || row.status!=='approved') return false
  if(!row.grant_expires_at) return true
  return new Date(row.grant_expires_at).getTime()>Date.now()
}

export default function ControlledDownloadButton({resource,onGranted,className='glassButton',label='Download',compact=false}:Props){
  const [latest,setLatest]=useState<RequestRow|null>(null)
  const [allowed,setAllowed]=useState(false)
  const [checking,setChecking]=useState(true)
  const [showRequest,setShowRequest]=useState(false)
  const [reason,setReason]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')

  const refresh=useCallback(async()=>{
    if(!supabase){setChecking(false);return}
    setChecking(true)
    const [{data:access},{data:requests}]=await Promise.all([
      supabase.rpc('has_workspace_download_access',{p_resource_type:resource.resourceType,p_resource_key:resource.resourceKey}),
      supabase.from('workspace_download_requests').select('id,status,requested_at,reviewed_at,grant_expires_at,decision_note').eq('resource_type',resource.resourceType).eq('resource_key',resource.resourceKey).order('requested_at',{ascending:false}).limit(1)
    ])
    setAllowed(access===true)
    setLatest((requests?.[0]||null) as RequestRow|null)
    setChecking(false)
  },[resource.resourceKey,resource.resourceType])

  useEffect(()=>{void refresh()},[refresh])

  const execute=async()=>{
    if(!supabase)return
    setBusy(true);setMessage('')
    try{
      const {data:access,error}=await supabase.rpc('has_workspace_download_access',{p_resource_type:resource.resourceType,p_resource_key:resource.resourceKey})
      if(error)throw error
      if(access!==true){setShowRequest(true);await refresh();return}
      const {error:recordError}=await supabase.rpc('record_workspace_download',{p_resource_type:resource.resourceType,p_resource_key:resource.resourceKey})
      if(recordError)throw recordError
      await onGranted()
      setMessage('Download authorised and recorded.')
    }catch(error:any){setMessage(error?.message||'Unable to complete this download.')}
    finally{setBusy(false)}
  }

  const request=async()=>{
    if(!supabase)return
    setBusy(true);setMessage('')
    try{
      const {error}=await supabase.rpc('request_workspace_download',{p_resource_type:resource.resourceType,p_resource_key:resource.resourceKey,p_resource_name:resource.resourceName,p_reason:reason.trim()||null})
      if(error)throw error
      setShowRequest(false);setReason('');setMessage('Request sent to the workspace administrator.');await refresh()
    }catch(error:any){setMessage(error?.message||'Unable to request download access.')}
    finally{setBusy(false)}
  }

  const pending=latest?.status==='pending'
  const grantActive=allowed||activeGrant(latest)
  const buttonLabel=checking?'Checking access…':busy?'Please wait…':pending&&!grantActive?'Access requested':grantActive?label:'Request download'

  return <div className={`downloadGuard ${compact?'compact':''}`}>
    <button type="button" className={`${className} downloadGuardButton`} disabled={checking||busy||pending&&!grantActive} onClick={()=>grantActive?void execute():setShowRequest(true)}>
      {grantActive?<Download size={16}/>:pending?<ShieldCheck size={16}/>:<LockKeyhole size={16}/>} {buttonLabel}
    </button>
    {message&&<small className="downloadGuardStatus">{message}</small>}
    {latest?.status==='denied'&&latest.decision_note&&!message&&<small className="downloadGuardStatus">Last request denied: {latest.decision_note}</small>}
    {showRequest&&<div className="downloadAccessOverlay" role="dialog" aria-modal="true">
      <div className="downloadAccessModal glassCard">
        <div className="downloadAccessModalHead"><LockKeyhole size={22}/><div><h3>Request download access</h3><p><strong>{resource.resourceName}</strong> is protected. An administrator must approve this download before the file can leave the workspace.</p></div></div>
        <label>Business reason<textarea autoFocus value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why do you need to download this file?"/></label>
        <div className="downloadAccessModalActions"><button type="button" className="glassButton" onClick={()=>setShowRequest(false)}><X size={15}/>Cancel</button><button type="button" className="primaryButton" disabled={busy} onClick={()=>void request()}><Send size={15}/>Send request</button></div>
      </div>
    </div>}
  </div>
}
