import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  Archive,
  Building2,
  Check,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Lock,
  Music,
  Pencil,
  Presentation,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
  Users,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatBytes } from '../lib/chatAttachments'
import {
  ARCHIVE_ACCEPT,
  BIN_DAYS,
  DEFAULT_FOLDER,
  DEFAULT_SHARE_DAYS,
  SHARE_DAY_OPTIONS,
  VISIBILITY_LABEL,
  allFolderNames,
  archivePath,
  binDaysLeft,
  binExpired,
  canPreview,
  filterAndSort,
  folderCounts,
  folderKey,
  friendlyArchiveError,
  kindOf,
  limitFor,
  normaliseFolder,
  shareState,
  shareUrl,
  validateArchiveFile,
  type ArchiveRow,
  type FolderLimit,
  type Kind,
  type ShareRow,
  type SortKey
} from '../lib/archive'
import '../archive.css'

const BUCKET='archive'

type Visibility=ArchiveRow['visibility']
type Job={key:string;name:string;state:'waiting'|'uploading'|'done'|'failed';note:string}

const KIND_ICON:Record<Kind,typeof FileIcon>={
  image:ImageIcon,pdf:FileText,doc:FileText,sheet:FileSpreadsheet,slides:Presentation,
  video:Film,audio:Music,zip:FileArchive,text:FileText,other:FileIcon
}
const KIND_LABEL:Record<Kind,string>={
  image:'Images',pdf:'PDFs',doc:'Documents',sheet:'Spreadsheets',slides:'Presentations',
  video:'Video',audio:'Audio',zip:'Zip files',text:'Text',other:'Other'
}

function when(value:string){
  const d=new Date(value)
  return Number.isNaN(d.getTime())?'':d.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})
}

export default function ArchiveModule(){
  const [userId,setUserId]=useState('')
  const [rows,setRows]=useState<ArchiveRow[]>([])
  const [bin,setBin]=useState<ArchiveRow[]>([])
  const [loading,setLoading]=useState(true)
  const [view,setView]=useState<'files'|'bin'>('files')
  const [query,setQuery]=useState('')
  const [folder,setFolder]=useState('')
  const [kind,setKind]=useState<Kind|''>('')
  const [sort,setSort]=useState<SortKey>('newest')
  const [mineOnly,setMineOnly]=useState(false)
  const [notice,setNotice]=useState('')
  const [dragging,setDragging]=useState(false)
  const [staged,setStaged]=useState<File[]>([])
  const [upFolder,setUpFolder]=useState(DEFAULT_FOLDER)
  const [upVisibility,setUpVisibility]=useState<Visibility>('company')
  const [upDescription,setUpDescription]=useState('')
  const [jobs,setJobs]=useState<Job[]>([])
  const [uploading,setUploading]=useState(false)
  const [editing,setEditing]=useState<ArchiveRow|null>(null)
  const [busyId,setBusyId]=useState('')
  const [limits,setLimits]=useState<FolderLimit[]>([])
  const [isAdmin,setIsAdmin]=useState(false)
  const [foldersOpen,setFoldersOpen]=useState(false)
  const [sharing,setSharing]=useState<ArchiveRow|null>(null)
  const inputRef=useRef<HTMLInputElement|null>(null)

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){setLoading(false);return}
    const [{data:auth},files,trash,folderLimits]=await Promise.all([
      client.auth.getUser(),
      client.rpc('list_archive_files',{p_bin:false}),
      client.rpc('list_archive_files',{p_bin:true}),
      client.rpc('list_archive_folders')
    ])
    const uid=auth?.user?.id||''
    setUserId(uid)
    if(uid){
      const {data:me}=await client.from('employee_profiles').select('role').eq('id',uid).maybeSingle()
      setIsAdmin(String(me?.role||'').toLowerCase()==='admin')
    }
    if(!folderLimits.error)setLimits((folderLimits.data||[]) as FolderLimit[])
    if(files.error)setNotice(files.error.message)
    else setRows((files.data||[]) as ArchiveRow[])
    if(!trash.error)setBin((trash.data||[]) as ArchiveRow[])
    setLoading(false)
  },[])

  useEffect(()=>{void load()},[load])

  const counts=useMemo(()=>folderCounts(rows),[rows])
  const folders=useMemo(()=>{
    const byKey=new Map(counts.map(c=>[folderKey(c.folder),c.count]))
    return allFolderNames(rows,limits).map(name=>({folder:name,count:byKey.get(folderKey(name))||0}))
  },[rows,limits,counts])
  const shown=useMemo(
    ()=>filterAndSort(rows,{query,folder,kind,mineOnly,userId,sort}),
    [rows,query,folder,kind,mineOnly,userId,sort]
  )
  const kindsPresent=useMemo(()=>[...new Set(rows.map(r=>kindOf(r.mime_type)))].sort(),[rows])

  const stage=(list:FileList|File[]|null)=>{
    if(!list)return
    const accepted:File[]=[]
    const problems:string[]=[]
    for(const file of Array.from(list)){
      const verdict=validateArchiveFile(file)
      if(verdict.ok)accepted.push(file)
      else problems.push(verdict.reason)
    }
    setNotice(problems.join(' '))
    if(accepted.length)setStaged(current=>[...current,...accepted].slice(0,50))
  }

  const onDrop=(event:DragEvent)=>{
    event.preventDefault()
    setDragging(false)
    stage(event.dataTransfer.files)
  }

  const startUpload=async()=>{
    const client=supabase
    if(!client||!staged.length||uploading||!userId)return
    const targetFolder=normaliseFolder(upFolder)
    const batch=staged
    setUploading(true)
    setNotice('')
    setJobs(batch.map((file,i)=>({key:`${i}-${file.name}`,name:file.name,state:'waiting',note:''})))
    const patch=(i:number,change:Partial<Job>)=>setJobs(current=>current.map((job,j)=>j===i?{...job,...change}:job))
    let next=0
    const worker=async()=>{
      while(next<batch.length){
        const i=next++
        const file=batch[i]
        const verdict=validateArchiveFile(file)
        if(!verdict.ok){patch(i,{state:'failed',note:verdict.reason});continue}
        patch(i,{state:'uploading'})
        const id=crypto.randomUUID()
        const path=archivePath(userId,id,file.name)
        const up=await client.storage.from(BUCKET).upload(path,file,{contentType:verdict.mime,upsert:false})
        if(up.error){patch(i,{state:'failed',note:friendlyArchiveError(up.error.message)});continue}
        const ins=await client.from('archive_files').insert({
          id,
          name:file.name.slice(0,200),
          description:upDescription.trim()||null,
          folder:targetFolder,
          storage_path:path,
          mime_type:verdict.mime,
          size_bytes:file.size,
          uploaded_by:userId,
          visibility:upVisibility
        })
        if(ins.error){
          // Do not leave a file nobody can see.
          await client.storage.from(BUCKET).remove([path]).catch(()=>{})
          patch(i,{state:'failed',note:friendlyArchiveError(ins.error.message)})
          continue
        }
        patch(i,{state:'done'})
      }
    }
    await Promise.all([worker(),worker(),worker()])
    setUploading(false)
    setStaged([])
    setUpDescription('')
    await load()
  }

  const signed=async(row:ArchiveRow,download:boolean)=>{
    const client=supabase
    if(!client)return null
    const {data,error}=await client.storage.from(BUCKET).createSignedUrl(
      row.storage_path,
      download?120:600,
      download?{download:row.name}:undefined
    )
    if(error||!data?.signedUrl){setNotice(error?.message||'Could not open this file.');return null}
    return data.signedUrl
  }

  const download=async(row:ArchiveRow)=>{
    setBusyId(row.id)
    const url=await signed(row,true)
    setBusyId('')
    if(!url)return
    const link=document.createElement('a')
    link.href=url
    link.rel='noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const preview=async(row:ArchiveRow)=>{
    // Open the tab first so the browser does not treat it as a blocked popup.
    const tab=window.open('','_blank')
    setBusyId(row.id)
    const url=await signed(row,false)
    setBusyId('')
    if(!url){tab?.close();return}
    if(tab)tab.location.href=url
    else window.location.href=url
  }

  const saveEdit=async()=>{
    const client=supabase
    if(!client||!editing)return
    setBusyId(editing.id)
    const {error}=await client.from('archive_files').update({
      name:editing.name.trim().slice(0,200)||'Untitled',
      description:(editing.description||'').trim()||null,
      folder:normaliseFolder(editing.folder),
      visibility:editing.visibility
    }).eq('id',editing.id)
    setBusyId('')
    if(error){setNotice(friendlyArchiveError(error.message));return}
    setEditing(null)
    await load()
  }

  const moveToBin=async(row:ArchiveRow)=>{
    const client=supabase
    if(!client)return
    if(!window.confirm(`Move "${row.name}" to the bin? It stays there for ${BIN_DAYS} days and you can restore it.`))return
    setBusyId(row.id)
    const {error}=await client.from('archive_files').update({deleted_at:new Date().toISOString()}).eq('id',row.id)
    setBusyId('')
    if(error){setNotice(error.message);return}
    await load()
  }

  const restore=async(row:ArchiveRow)=>{
    const client=supabase
    if(!client)return
    setBusyId(row.id)
    const {error}=await client.from('archive_files').update({deleted_at:null}).eq('id',row.id)
    setBusyId('')
    if(error){setNotice(error.message);return}
    await load()
  }

  const removeForever=useCallback(async(row:ArchiveRow,ask:boolean)=>{
    const client=supabase
    if(!client)return false
    if(ask&&!window.confirm(`Delete "${row.name}" for good? This cannot be undone.`))return false
    setBusyId(row.id)
    const gone=await client.storage.from(BUCKET).remove([row.storage_path])
    if(gone.error){setBusyId('');setNotice(gone.error.message);return false}
    const {error}=await client.from('archive_files').delete().eq('id',row.id)
    setBusyId('')
    if(error){setNotice(error.message);return false}
    return true
  },[])

  // Opening the bin clears what has been there for 30 days.
  useEffect(()=>{
    if(view!=='bin')return
    const old=bin.filter(row=>row.can_manage&&binExpired(row.deleted_at))
    if(!old.length)return
    let cancelled=false
    void (async()=>{
      for(const row of old){
        if(cancelled)return
        await removeForever(row,false)
      }
      if(!cancelled)await load()
    })()
    return()=>{cancelled=true}
  },[view,bin,removeForever,load])

  const visibleBin=bin.filter(row=>!binExpired(row.deleted_at))

  const visIcon=(v:Visibility)=>v==='private'?<Lock size={12}/>:v==='department'?<Building2 size={12}/>:<Users size={12}/>

  return (
    <section className="arcPage">
      <header className="arcHead">
        <div>
          <span className="eyebrow"><Archive size={12}/> ARCHIVE</span>
          <h2>Company Archive</h2>
          <p>One shared place for files. Upload anything useful, find it later. You choose who can see each file.</p>
        </div>
        <div className="arcTabs" role="tablist">
          <button type="button" role="tab" aria-selected={view==='files'} className={view==='files'?'on':''} onClick={()=>setView('files')}>Files <b>{rows.length}</b></button>
          <button type="button" role="tab" aria-selected={view==='bin'} className={view==='bin'?'on':''} onClick={()=>setView('bin')}>Bin <b>{visibleBin.length}</b></button>
        </div>
      </header>

      {notice&&<div className="arcNotice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss" onClick={()=>setNotice('')}><X size={14}/></button></div>}

      {view==='files'&&(
        <>
          <div
            className={`arcDrop${dragging?' over':''}`}
            onDragOver={event=>{event.preventDefault();setDragging(true)}}
            onDragLeave={()=>setDragging(false)}
            onDrop={onDrop}
          >
            <input ref={inputRef} type="file" multiple hidden accept={ARCHIVE_ACCEPT} onChange={event=>{stage(event.target.files);event.target.value=''}}/>
            <Upload size={26}/>
            <strong>Drop files here</strong>
            <span>or</span>
            <button type="button" className="primaryButton" onClick={()=>inputRef.current?.click()}>Choose files</button>
            <small>Up to 50 MB each. Documents, spreadsheets, slides, PDFs, images, audio, video and zip files.</small>
          </div>

          {staged.length>0&&(
            <div className="arcStaged">
              <div className="arcStagedList">
                {staged.map((file,i)=>(
                  <span className="arcChip" key={`${file.name}-${i}`}>
                    {file.name} <small>{formatBytes(file.size)}</small>
                    {!uploading&&<button type="button" aria-label={`Remove ${file.name}`} onClick={()=>setStaged(current=>current.filter((_,j)=>j!==i))}><X size={12}/></button>}
                  </span>
                ))}
              </div>
              <div className="arcForm">
                <label>
                  <span>Folder</span>
                  <input list="arc-folders" value={upFolder} maxLength={60} disabled={uploading} onChange={event=>setUpFolder(event.target.value)} placeholder="General"/>
                  <datalist id="arc-folders">{folders.map(f=><option key={f.folder} value={f.folder}/>)}</datalist>
                </label>
                <label>
                  <span>Who can see it</span>
                  <select value={upVisibility} disabled={uploading} onChange={event=>setUpVisibility(event.target.value as Visibility)}>
                    <option value="company">Everyone in the company</option>
                    <option value="department">My department</option>
                    <option value="private">Only me</option>
                  </select>
                </label>
                <label className="arcWide">
                  <span>Note (optional, applies to all)</span>
                  <input value={upDescription} maxLength={1000} disabled={uploading} onChange={event=>setUpDescription(event.target.value)} placeholder="What is this?"/>
                </label>
              </div>
              <div className="arcStagedActions">
                <button type="button" className="secondaryButton" disabled={uploading} onClick={()=>setStaged([])}>Clear</button>
                <button type="button" className="primaryButton" disabled={uploading} onClick={()=>void startUpload()}>
                  {uploading?<LoaderCircle size={16} className="arcSpin"/>:<Upload size={16}/>}
                  {uploading?'Uploading...':`Upload ${staged.length} file${staged.length===1?'':'s'}`}
                </button>
              </div>
            </div>
          )}

          {jobs.length>0&&(
            <ul className="arcJobs" aria-live="polite">
              {jobs.map(job=>(
                <li key={job.key} className={job.state}>
                  <span>{job.name}</span>
                  <small>{job.state==='waiting'?'Waiting':job.state==='uploading'?'Uploading...':job.state==='done'?'Uploaded':job.note||'Failed'}</small>
                </li>
              ))}
              {!uploading&&<li className="arcJobsClear"><button type="button" className="secondaryButton" onClick={()=>setJobs([])}>Clear list</button></li>}
            </ul>
          )}

          <div className="arcTools">
            <label className="arcSearch">
              <Search size={16}/>
              <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search name, note, folder or person" aria-label="Search the archive"/>
            </label>
            <select value={kind} onChange={event=>setKind(event.target.value as Kind|'')} aria-label="File type">
              <option value="">All types</option>
              {kindsPresent.map(k=><option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <select value={sort} onChange={event=>setSort(event.target.value as SortKey)} aria-label="Sort">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name A to Z</option>
              <option value="size">Largest first</option>
            </select>
            <label className="arcMine"><input type="checkbox" checked={mineOnly} onChange={event=>setMineOnly(event.target.checked)}/> My uploads</label>
            {isAdmin&&<button type="button" className="secondaryButton arcFolderBtn" onClick={()=>setFoldersOpen(true)}><Settings2 size={15}/>Folder access</button>}
          </div>

          <div className="arcFolders" role="tablist" aria-label="Folders">
            <button type="button" className={!folder?'on':''} onClick={()=>setFolder('')}><Folder size={13}/>All <b>{rows.length}</b></button>
            {folders.map(f=>(
              <button type="button" key={f.folder} className={folder===f.folder?'on':''} title={limitFor(limits,f.folder)?`Limited to: ${limitFor(limits,f.folder)!.departments.join(', ')}`:undefined} onClick={()=>setFolder(f.folder)}>
                {limitFor(limits,f.folder)?<Lock size={13}/>:<Folder size={13}/>}{f.folder} <b>{f.count}</b>
              </button>
            ))}
          </div>

          {loading&&<div className="arcEmpty">Loading the archive...</div>}
          {!loading&&shown.length===0&&(
            <div className="arcEmpty">
              <Archive size={28}/>
              <strong>{rows.length===0?'Nothing here yet':'No files match'}</strong>
              <span>{rows.length===0?'Drop the first file above.':'Try a different word or clear the filters.'}</span>
            </div>
          )}

          <ul className="arcList">
            {shown.map(row=>{
              const Icon=KIND_ICON[kindOf(row.mime_type)]
              const busy=busyId===row.id
              return (
                <li key={row.id} className="arcRow">
                  <span className="arcIcon"><Icon size={20}/></span>
                  <div className="arcMeta">
                    <strong title={row.name}>{row.name}</strong>
                    <span>
                      <i className="arcTag"><Folder size={11}/>{row.folder}</i>
                      <i className="arcTag vis">{visIcon(row.visibility)}{VISIBILITY_LABEL[row.visibility]}</i>
                      {row.uploader_name} &middot; {when(row.created_at)} &middot; {formatBytes(row.size_bytes)}
                    </span>
                    {row.description&&<small>{row.description}</small>}
                  </div>
                  <div className="arcActions">
                    {canPreview(row.mime_type)&&<button type="button" className="iconButton" title="Preview" aria-label={`Preview ${row.name}`} disabled={busy} onClick={()=>void preview(row)}><Eye size={16}/></button>}
                    <button type="button" className="iconButton" title="Download" aria-label={`Download ${row.name}`} disabled={busy} onClick={()=>void download(row)}>{busy?<LoaderCircle size={16} className="arcSpin"/>:<Download size={16}/>}</button>
                    {row.can_manage&&<button type="button" className="iconButton" title="Share outside the company" aria-label={`Share ${row.name} outside the company`} onClick={()=>setSharing(row)}><Link2 size={16}/></button>}
                    {row.can_manage&&<button type="button" className="iconButton" title="Edit" aria-label={`Edit ${row.name}`} onClick={()=>setEditing(row)}><Pencil size={16}/></button>}
                    {row.can_manage&&<button type="button" className="iconButton arcDanger" title="Move to bin" aria-label={`Move ${row.name} to the bin`} disabled={busy} onClick={()=>void moveToBin(row)}><Trash2 size={16}/></button>}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {view==='bin'&&(
        <>
          <p className="arcBinNote">Deleted files stay here for {BIN_DAYS} days, then they are removed for good. Only the person who uploaded a file, and administrators, can see or restore it.</p>
          {visibleBin.length===0&&<div className="arcEmpty"><Trash2 size={28}/><strong>The bin is empty</strong></div>}
          <ul className="arcList">
            {visibleBin.map(row=>{
              const Icon=KIND_ICON[kindOf(row.mime_type)]
              const busy=busyId===row.id
              return (
                <li key={row.id} className="arcRow">
                  <span className="arcIcon"><Icon size={20}/></span>
                  <div className="arcMeta">
                    <strong title={row.name}>{row.name}</strong>
                    <span>{row.uploader_name} &middot; {formatBytes(row.size_bytes)} &middot; {binDaysLeft(row.deleted_at)} days left</span>
                  </div>
                  <div className="arcActions">
                    <button type="button" className="secondaryButton" disabled={busy} onClick={()=>void restore(row)}><RotateCcw size={14}/>Restore</button>
                    <button type="button" className="iconButton arcDanger" title="Delete for good" aria-label={`Delete ${row.name} for good`} disabled={busy} onClick={()=>void removeForever(row,true).then(ok=>{if(ok)void load()})}><Trash2 size={16}/></button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {editing&&(
        <div className="arcModalBack" onClick={()=>setEditing(null)}>
          <div className="arcModal" role="dialog" aria-modal="true" aria-label="Edit file" onClick={event=>event.stopPropagation()}>
            <header><strong>Edit file</strong><button type="button" className="iconButton" aria-label="Close" onClick={()=>setEditing(null)}><X size={16}/></button></header>
            <label><span>Name</span><input value={editing.name} maxLength={200} onChange={event=>setEditing({...editing,name:event.target.value})}/></label>
            <label><span>Note</span><input value={editing.description||''} maxLength={1000} onChange={event=>setEditing({...editing,description:event.target.value})}/></label>
            <label>
              <span>Folder</span>
              <input list="arc-folders-edit" value={editing.folder} maxLength={60} onChange={event=>setEditing({...editing,folder:event.target.value})}/>
              <datalist id="arc-folders-edit">{folders.map(f=><option key={f.folder} value={f.folder}/>)}</datalist>
            </label>
            <label>
              <span>Who can see it</span>
              <select value={editing.visibility} onChange={event=>setEditing({...editing,visibility:event.target.value as Visibility})}>
                <option value="company">Everyone in the company</option>
                <option value="department">My department</option>
                <option value="private">Only me</option>
              </select>
            </label>
            <div className="arcStagedActions">
              <button type="button" className="secondaryButton" onClick={()=>setEditing(null)}>Cancel</button>
              <button type="button" className="primaryButton" disabled={busyId===editing.id} onClick={()=>void saveEdit()}>Save</button>
            </div>
          </div>
        </div>
      )}
      {foldersOpen&&<FolderAccessModal names={folders.map(f=>f.folder)} limits={limits} onClose={()=>setFoldersOpen(false)} onSaved={()=>{void load()}} onError={setNotice}/>}
      {sharing&&<ShareModal row={sharing} onClose={()=>setSharing(null)} onError={setNotice}/>}
    </section>
  )
}

function FolderAccessModal({names,limits,onClose,onSaved,onError}:{
  names:string[];limits:FolderLimit[];onClose:()=>void;onSaved:()=>void;onError:(message:string)=>void
}){
  const [departments,setDepartments]=useState<string[]|null>(null)
  const [drafts,setDrafts]=useState<Record<string,string[]>>({})
  const [newName,setNewName]=useState('')
  const [saving,setSaving]=useState('')
  const all=useMemo(()=>{
    const base=[...names]
    const extra=normaliseFolder(newName)
    if(newName.trim()&&!base.some(n=>folderKey(n)===folderKey(extra)))base.push(extra)
    return base
  },[names,newName])

  useEffect(()=>{
    const client=supabase
    if(!client)return
    void client.rpc('list_archive_departments').then(({data,error})=>{
      if(error){onError(friendlyArchiveError(error.message));setDepartments([]);return}
      setDepartments(((data||[]) as {department:string}[]).map(d=>d.department))
    })
  },[onError])

  const current=(name:string)=>drafts[folderKey(name)]??limitFor(limits,name)?.departments??[]
  const toggle=(name:string,department:string)=>{
    const list=current(name)
    const next=list.includes(department)?list.filter(d=>d!==department):[...list,department]
    setDrafts(d=>({...d,[folderKey(name)]:next}))
  }

  const save=async(name:string)=>{
    const client=supabase
    if(!client)return
    const list=current(name)
    if(list.length>0&&!window.confirm(`Only ${list.join(', ')} (and administrators) will see files in "${name}". Everyone else loses access to them straight away. Continue?`))return
    setSaving(name)
    const {error}=await client.rpc('set_archive_folder_access',{p_folder:name,p_departments:list})
    setSaving('')
    if(error){onError(friendlyArchiveError(error.message));return}
    setDrafts(d=>{const copy={...d};delete copy[folderKey(name)];return copy})
    onSaved()
  }

  return (
    <div className="arcModalBack" onClick={onClose}>
      <div className="arcModal arcModalWide" role="dialog" aria-modal="true" aria-label="Folder access" onClick={event=>event.stopPropagation()}>
        <header><strong>Folder access</strong><button type="button" className="iconButton" aria-label="Close" onClick={onClose}><X size={16}/></button></header>
        <p className="arcHint">Tick the departments that may see a folder. With nothing ticked, everyone can. Administrators and the person who uploaded a file always keep access.</p>
        <label>
          <span>Add or limit a folder not in the list</span>
          <input value={newName} maxLength={60} onChange={event=>setNewName(event.target.value)} placeholder="Folder name"/>
        </label>
        {departments===null&&<div className="arcEmpty">Loading departments...</div>}
        {departments&&departments.length===0&&<div className="arcEmpty">No departments are set on employee profiles yet.</div>}
        {departments&&departments.length>0&&(
          <ul className="arcAccessList">
            {all.map(name=>{
              const list=current(name)
              const saved=limitFor(limits,name)?.departments??[]
              const changed=list.slice().sort().join('|')!==saved.slice().sort().join('|')
              return (
                <li key={folderKey(name)}>
                  <div className="arcAccessHead">
                    <strong>{list.length?<Lock size={13}/>:<Folder size={13}/>} {name}</strong>
                    <small>{list.length?`Limited to ${list.length} department${list.length===1?'':'s'}`:'Open to everyone'}</small>
                  </div>
                  <div className="arcDeps">
                    {departments.map(dep=>(
                      <label key={dep} className={list.includes(dep)?'on':''}>
                        <input type="checkbox" checked={list.includes(dep)} onChange={()=>toggle(name,dep)}/>{dep}
                      </label>
                    ))}
                  </div>
                  <div className="arcStagedActions">
                    <button type="button" className="primaryButton" disabled={!changed||saving===name} onClick={()=>void save(name)}>
                      {saving===name?'Saving...':'Save'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function ShareModal({row,onClose,onError}:{row:ArchiveRow;onClose:()=>void;onError:(message:string)=>void}){
  const [days,setDays]=useState<number>(DEFAULT_SHARE_DAYS)
  const [shares,setShares]=useState<ShareRow[]>([])
  const [fresh,setFresh]=useState<{url:string;expires:string}|null>(null)
  const [copied,setCopied]=useState(false)
  const [busy,setBusy]=useState(false)
  const base=(import.meta.env.VITE_SUPABASE_URL as string|undefined)||''

  const refresh=useCallback(async()=>{
    const client=supabase
    if(!client)return
    const {data,error}=await client.rpc('list_archive_shares',{p_file:row.id})
    if(error){onError(friendlyArchiveError(error.message));return}
    setShares((data||[]) as ShareRow[])
  },[row.id,onError])

  useEffect(()=>{void refresh()},[refresh])

  const create=async()=>{
    const client=supabase
    if(!client||busy)return
    setBusy(true)
    const {data,error}=await client.rpc('create_archive_share',{p_file:row.id,p_days:days})
    setBusy(false)
    if(error){onError(friendlyArchiveError(error.message));return}
    const made=(Array.isArray(data)?data[0]:data) as {token:string;expires_at:string}|undefined
    if(!made){onError('Could not make the link.');return}
    setFresh({url:shareUrl(base,made.token),expires:made.expires_at})
    setCopied(false)
    await refresh()
  }

  const revoke=async(id:string)=>{
    const client=supabase
    if(!client)return
    if(!window.confirm('Stop this link working now?'))return
    const {error}=await client.rpc('revoke_archive_share',{p_id:id})
    if(error){onError(friendlyArchiveError(error.message));return}
    await refresh()
  }

  const copy=async()=>{
    if(!fresh)return
    try{await navigator.clipboard.writeText(fresh.url)}catch{window.prompt('Copy this link:',fresh.url)}
    setCopied(true)
  }

  return (
    <div className="arcModalBack" onClick={onClose}>
      <div className="arcModal arcModalWide" role="dialog" aria-modal="true" aria-label="Share outside the company" onClick={event=>event.stopPropagation()}>
        <header><strong>Share outside the company</strong><button type="button" className="iconButton" aria-label="Close" onClick={onClose}><X size={16}/></button></header>
        <p className="arcHint"><b>{row.name}</b><br/>Anyone with the link can download this file, with no sign-in. It stops working on its own after the time you pick, or when you revoke it. Share it only with people who should have it.</p>
        <div className="arcShareMake">
          <label>
            <span>Link works for</span>
            <select value={days} onChange={event=>setDays(Number(event.target.value))}>
              {SHARE_DAY_OPTIONS.map(d=><option key={d} value={d}>{d===1?'1 day':`${d} days`}</option>)}
            </select>
          </label>
          <button type="button" className="primaryButton" disabled={busy} onClick={()=>void create()}>
            {busy?<LoaderCircle size={16} className="arcSpin"/>:<Link2 size={16}/>}Make link
          </button>
        </div>
        {fresh&&(
          <div className="arcFresh">
            <code>{fresh.url}</code>
            <button type="button" className="secondaryButton" onClick={()=>void copy()}>{copied?<><Check size={14}/>Copied</>:<><Copy size={14}/>Copy</>}</button>
            <small>Copy it now. For safety the full link is shown only once. Expires {new Date(fresh.expires).toLocaleString()}.</small>
          </div>
        )}
        <div>
          <strong className="arcSmallTitle">Links for this file</strong>
          {shares.length===0&&<div className="arcHint">None yet.</div>}
          <ul className="arcShareList">
            {shares.map(share=>{
              const state=shareState(share)
              return (
                <li key={share.id} className={state}>
                  <span>
                    <b>{state==='active'?'Active':state==='expired'?'Expired':'Revoked'}</b>
                    <small>Made {when(share.created_at)} by {share.created_by_name}. {state==='active'?`Expires ${new Date(share.expires_at).toLocaleString()}.`:''} Opened {share.download_count} time{share.download_count===1?'':'s'}.</small>
                  </span>
                  {state==='active'&&<button type="button" className="secondaryButton" onClick={()=>void revoke(share.id)}>Revoke</button>}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
