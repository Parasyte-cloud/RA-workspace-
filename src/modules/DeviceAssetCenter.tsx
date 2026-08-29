import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clipboard, Copy, Laptop, MapPin, MonitorSmartphone, Pencil, Plus, RefreshCw, Smartphone } from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../device-asset-center.css'

type Employee={id:string;full_name:string;email:string;department:string|null;job_title:string|null}
type Device={
  id:string;asset_tag:string;assigned_employee_id:string|null;device_type:string;manufacturer:string|null;model:string|null;
  serial_number:string|null;imei:string|null;color:string|null;memory_label:string|null;storage_label:string|null;
  operating_system:string|null;hostname:string|null;location_label:string|null;status:string;issued_at:string|null;returned_at:string|null;notes:string|null;updated_at:string
}
type SessionRow={
  id:string;employee_id:string;browser_device_id:string;browser_name:string|null;operating_system:string|null;platform:string|null;
  screen_width:number|null;screen_height:number|null;hardware_concurrency:number|null;device_memory_gb:number|null;timezone:string|null;
  latitude:number|null;longitude:number|null;location_accuracy_m:number|null;last_seen_at:string
}
type Command={id:string;title:string;category:string;platform:string;command_text:string;description:string|null;risk_level:string;active:boolean;updated_at:string}

type DeviceDraft={
  id:string;asset_tag:string;assigned_employee_id:string;device_type:string;manufacturer:string;model:string;serial_number:string;imei:string;color:string;
  memory_label:string;storage_label:string;operating_system:string;hostname:string;location_label:string;status:string;issued_at:string;notes:string
}

const emptyDevice:DeviceDraft={
  id:'',asset_tag:'',assigned_employee_id:'',device_type:'laptop',manufacturer:'',model:'',serial_number:'',imei:'',color:'',memory_label:'',storage_label:'',operating_system:'',hostname:'',location_label:'',status:'assigned',issued_at:'',notes:''
}

function deviceIcon(type:string){
  if(type==='phone') return <Smartphone size={17}/>
  if(type==='tablet') return <MonitorSmartphone size={17}/>
  return <Laptop size={17}/>
}

function clean(value:string){return value.trim() || null}
function when(value:string){
  const date=new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function DeviceAssetCenter(){
  const [employees,setEmployees]=useState<Employee[]>([])
  const [devices,setDevices]=useState<Device[]>([])
  const [sessions,setSessions]=useState<SessionRow[]>([])
  const [commands,setCommands]=useState<Command[]>([])
  const [draft,setDraft]=useState<DeviceDraft>(emptyDevice)
  const [commandDraft,setCommandDraft]=useState({title:'',category:'Device information',platform:'Any',command_text:'',description:'',risk_level:'safe'})
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){setLoading(false);return}
    setLoading(true)
    setMessage('')
    const [peopleResult,devicesResult,sessionsResult,commandsResult]=await Promise.all([
      client.from('employee_profiles').select('id,full_name,email,department,job_title').eq('active',true).order('full_name'),
      client.from('company_devices').select('id,asset_tag,assigned_employee_id,device_type,manufacturer,model,serial_number,imei,color,memory_label,storage_label,operating_system,hostname,location_label,status,issued_at,returned_at,notes,updated_at').order('asset_tag'),
      client.from('employee_device_sessions').select('id,employee_id,browser_device_id,browser_name,operating_system,platform,screen_width,screen_height,hardware_concurrency,device_memory_gb,timezone,latitude,longitude,location_accuracy_m,last_seen_at').order('last_seen_at',{ascending:false}).limit(100),
      client.from('support_command_library').select('id,title,category,platform,command_text,description,risk_level,active,updated_at').eq('active',true).order('platform').order('title'),
    ])
    const error=peopleResult.error || devicesResult.error || sessionsResult.error || commandsResult.error
    if(error) setMessage(error.message)
    setEmployees((peopleResult.data || []) as Employee[])
    setDevices((devicesResult.data || []) as Device[])
    setSessions((sessionsResult.data || []) as SessionRow[])
    setCommands((commandsResult.data || []) as Command[])
    setLoading(false)
  },[])

  useEffect(()=>{void load()},[load])

  const peopleById=useMemo(()=>new Map(employees.map(person=>[person.id,person])),[employees])

  const saveDevice=async()=>{
    const client=supabase
    if(!client || !draft.asset_tag.trim()) return
    setSaving(true);setMessage('')
    const payload={
      asset_tag:draft.asset_tag.trim(),
      assigned_employee_id:draft.assigned_employee_id || null,
      device_type:draft.device_type,
      manufacturer:clean(draft.manufacturer),model:clean(draft.model),serial_number:clean(draft.serial_number),imei:clean(draft.imei),
      color:clean(draft.color),memory_label:clean(draft.memory_label),storage_label:clean(draft.storage_label),operating_system:clean(draft.operating_system),
      hostname:clean(draft.hostname),location_label:clean(draft.location_label),status:draft.status,issued_at:draft.issued_at || null,notes:clean(draft.notes),
    }
    const result=draft.id
      ? await client.from('company_devices').update(payload).eq('id',draft.id)
      : await client.from('company_devices').insert(payload)
    if(result.error){setMessage(result.error.message)}
    else{setMessage(draft.id?'Device updated.':'Device registered.');setDraft(emptyDevice);await load()}
    setSaving(false)
  }

  const editDevice=(device:Device)=>setDraft({
    id:device.id,asset_tag:device.asset_tag,assigned_employee_id:device.assigned_employee_id || '',device_type:device.device_type,
    manufacturer:device.manufacturer || '',model:device.model || '',serial_number:device.serial_number || '',imei:device.imei || '',color:device.color || '',
    memory_label:device.memory_label || '',storage_label:device.storage_label || '',operating_system:device.operating_system || '',hostname:device.hostname || '',
    location_label:device.location_label || '',status:device.status,issued_at:device.issued_at || '',notes:device.notes || '',
  })

  const saveCommand=async()=>{
    const client=supabase
    if(!client || !commandDraft.title.trim() || !commandDraft.command_text.trim()) return
    setSaving(true);setMessage('')
    const {error}=await client.from('support_command_library').insert({
      title:commandDraft.title.trim(),category:commandDraft.category.trim() || 'General',platform:commandDraft.platform.trim() || 'Any',
      command_text:commandDraft.command_text.trim(),description:clean(commandDraft.description),risk_level:commandDraft.risk_level,
    })
    if(error) setMessage(error.message)
    else{
      setMessage('Support command added. Commands are stored for copy/use only and never execute automatically.')
      setCommandDraft({title:'',category:'Device information',platform:'Any',command_text:'',description:'',risk_level:'safe'})
      await load()
    }
    setSaving(false)
  }

  const copy=async(value:string)=>{
    await navigator.clipboard.writeText(value)
    setMessage('Command copied. Review it before running on an employee device.')
  }

  return (
    <section className="deviceAssetCenter glassCard">
      <div className="deviceAssetHeader">
        <div><span className="eyebrow">IT ASSETS & SUPPORT</span><h3>Device registry and support command centre</h3><p>Register company laptops, phones and gadgets, assign them to employees, review signed-in browser/device presence and store approved troubleshooting commands.</p></div>
        <button type="button" className="glassButton" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>Refresh</button>
      </div>
      <div className="deviceCapabilityNote"><MonitorSmartphone size={17}/><div><strong>Automatic detection boundary</strong><span>The browser can automatically record OS/browser, screen, timezone, basic hardware hints and consented coarse location. Browsers cannot read a PC/phone serial number, IMEI or asset tag. Enter those here, or connect an approved MDM/native agent later.</span></div></div>
      {message&&<div className="moduleNotice">{message}</div>}

      <div className="deviceAssetGrid">
        <div className="deviceRegistryPanel">
          <div className="devicePanelTitle"><div><strong>{draft.id?'Edit device':'Register device'}</strong><span>Serial/IMEI stays behind employee-self + Support/Admin RLS.</span></div>{draft.id&&<button className="glassButton" type="button" onClick={()=>setDraft(emptyDevice)}>New device</button>}</div>
          <div className="deviceFormGrid">
            <label>Asset tag<input value={draft.asset_tag} onChange={e=>setDraft({...draft,asset_tag:e.target.value})} placeholder="RA-LAP-001"/></label>
            <label>Assigned employee<select value={draft.assigned_employee_id} onChange={e=>setDraft({...draft,assigned_employee_id:e.target.value})}><option value="">Unassigned / inventory</option>{employees.map(person=><option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}</select></label>
            <label>Device type<select value={draft.device_type} onChange={e=>setDraft({...draft,device_type:e.target.value})}>{['laptop','desktop','phone','tablet','accessory','other'].map(value=><option key={value}>{value}</option>)}</select></label>
            <label>Status<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}>{['inventory','assigned','repair','lost','retired','returned'].map(value=><option key={value}>{value}</option>)}</select></label>
            <label>Manufacturer<input value={draft.manufacturer} onChange={e=>setDraft({...draft,manufacturer:e.target.value})} placeholder="Dell / Google / Apple"/></label>
            <label>Model<input value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value})} placeholder="Latitude 3520 / Pixel 6"/></label>
            <label>Serial number<input value={draft.serial_number} onChange={e=>setDraft({...draft,serial_number:e.target.value})} autoComplete="off"/></label>
            <label>IMEI / mobile identifier<input value={draft.imei} onChange={e=>setDraft({...draft,imei:e.target.value})} autoComplete="off"/></label>
            <label>Colour<input value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}/></label>
            <label>Memory<input value={draft.memory_label} onChange={e=>setDraft({...draft,memory_label:e.target.value})} placeholder="24 GB / 12 GB"/></label>
            <label>Storage<input value={draft.storage_label} onChange={e=>setDraft({...draft,storage_label:e.target.value})} placeholder="256 GB SSD / 128 GB"/></label>
            <label>Operating system<input value={draft.operating_system} onChange={e=>setDraft({...draft,operating_system:e.target.value})} placeholder="Windows 11 / Android"/></label>
            <label>Hostname<input value={draft.hostname} onChange={e=>setDraft({...draft,hostname:e.target.value})}/></label>
            <label>Physical location<input value={draft.location_label} onChange={e=>setDraft({...draft,location_label:e.target.value})} placeholder="Lagos office / Support desk"/></label>
            <label>Issued date<input type="date" value={draft.issued_at} onChange={e=>setDraft({...draft,issued_at:e.target.value})}/></label>
            <label className="deviceWide">Notes<textarea value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
          </div>
          <button type="button" className="primaryButton" onClick={()=>void saveDevice()} disabled={saving || !draft.asset_tag.trim()}><Plus size={15}/>{draft.id?'Save device':'Register device'}</button>
        </div>

        <div className="deviceInventoryPanel">
          <div className="devicePanelTitle"><div><strong>Company equipment</strong><span>{devices.length} registered assets</span></div></div>
          <div className="deviceInventoryList">
            {devices.map(device=>{
              const person=device.assigned_employee_id?peopleById.get(device.assigned_employee_id):null
              return <article key={device.id} className="deviceInventoryRow">
                <div className="deviceIcon">{deviceIcon(device.device_type)}</div>
                <div className="deviceInventoryCopy"><strong>{device.asset_tag} · {[device.manufacturer,device.model].filter(Boolean).join(' ') || device.device_type}</strong><span>{person?.full_name || 'Unassigned'} · {device.status}</span><small>{device.serial_number?`Serial: ${device.serial_number}`:'Serial not recorded'}{device.imei?` · IMEI: ${device.imei}`:''}</small></div>
                <button type="button" className="iconButton" title="Edit device" onClick={()=>editDevice(device)}><Pencil size={14}/></button>
              </article>
            })}
            {!loading&&!devices.length&&<div className="deviceEmpty">No company devices registered yet.</div>}
          </div>
        </div>
      </div>

      <div className="deviceAssetGrid lower">
        <div className="deviceInventoryPanel">
          <div className="devicePanelTitle"><div><strong>Detected signed-in devices</strong><span>Browser-level presence; not a hardware serial detector.</span></div></div>
          <div className="deviceInventoryList sessions">
            {sessions.map(session=>{
              const person=peopleById.get(session.employee_id)
              const location=session.latitude!==null&&session.longitude!==null?`${Number(session.latitude).toFixed(2)}, ${Number(session.longitude).toFixed(2)}`:(session.timezone || 'Location not shared')
              return <article key={session.id} className="deviceInventoryRow">
                <div className="deviceIcon"><MonitorSmartphone size={17}/></div>
                <div className="deviceInventoryCopy"><strong>{person?.full_name || person?.email || 'Employee'} · {session.operating_system || session.platform || 'Device'}</strong><span>{session.browser_name || 'Browser'} · {session.screen_width&&session.screen_height?`${session.screen_width}×${session.screen_height}`:'screen n/a'} · seen {when(session.last_seen_at)}</span><small><MapPin size={11}/>{location}</small></div>
              </article>
            })}
            {!loading&&!sessions.length&&<div className="deviceEmpty">No signed-in device records yet. They appear after the new migration and frontend are deployed.</div>}
          </div>
        </div>

        <div className="commandPanel">
          <div className="devicePanelTitle"><div><strong>Approved support commands</strong><span>Stored snippets only; RideArrivo never auto-runs them.</span></div></div>
          <div className="commandList">
            {commands.map(command=><article key={command.id} className="commandRow"><div className="commandMeta"><span>{command.platform} · {command.category}</span><strong>{command.title}</strong><p>{command.description || 'Approved support command.'}</p><code>{command.command_text}</code></div><button className="iconButton" type="button" title="Copy command" onClick={()=>void copy(command.command_text)}><Copy size={14}/></button></article>)}
          </div>
          <div className="commandComposer">
            <strong>Add approved command</strong>
            <div className="deviceFormGrid compact">
              <label>Title<input value={commandDraft.title} onChange={e=>setCommandDraft({...commandDraft,title:e.target.value})}/></label>
              <label>Platform<input value={commandDraft.platform} onChange={e=>setCommandDraft({...commandDraft,platform:e.target.value})} placeholder="Windows PowerShell"/></label>
              <label>Category<input value={commandDraft.category} onChange={e=>setCommandDraft({...commandDraft,category:e.target.value})}/></label>
              <label>Risk<select value={commandDraft.risk_level} onChange={e=>setCommandDraft({...commandDraft,risk_level:e.target.value})}><option value="safe">safe</option><option value="caution">caution</option><option value="admin">admin</option></select></label>
              <label className="deviceWide">Command<textarea value={commandDraft.command_text} onChange={e=>setCommandDraft({...commandDraft,command_text:e.target.value})}/></label>
              <label className="deviceWide">Description<textarea value={commandDraft.description} onChange={e=>setCommandDraft({...commandDraft,description:e.target.value})}/></label>
            </div>
            <button type="button" className="glassButton" onClick={()=>void saveCommand()} disabled={saving || !commandDraft.title.trim() || !commandDraft.command_text.trim()}><Clipboard size={15}/>Save command</button>
          </div>
        </div>
      </div>
    </section>
  )
}
