import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  blogRequest, blogImage, blogOrigin, blankBlogDraft, uploadBlogAsset, listBlogAssets, inferBlogAssetMime,
  importBlogDraft, linkBlogAsset, unlinkBlogAsset, listPostAssets,
  setBlogAssetPublished, deleteBlogAsset,
} from '../lib/blogStudio'
import type {
  BlogMe, BlogList, BlogDraft, BlogArticle, BlogMedia, BlogPerson, BlogEvent,
  BlogAccessEvent, BlogRevision, BlogAsset, BlogPostAssetLink, BlogAssetRelationship,
} from '../lib/blogStudio'
import { parseBlogImport } from '../lib/blogImport'
import type { ImportedDraft } from '../lib/blogImport'
import { BLOG_CATEGORIES, BLOG_ROLE_LABELS, fromLagosInput, toLagosInput } from '../lib/blogPolicy'
import type { BlogRole } from '../lib/blogPolicy'
import '../blog-studio.css'

type Tab = 'articles' | 'media' | 'access' | 'activity'
export const ADD_CONTENT_ACTIONS = ['Quick writeup','New article','Import file','Upload attachment/media'] as const
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed. Please try again.'
const stamp = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })
const fileStem = (name:string) => name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').trim().slice(0,160) || 'Imported document'
function Inline({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g).map((part,i) => {
    if(part.startsWith('**'))return <strong key={i}>{part.slice(2,-2)}</strong>
    if(part.startsWith('`'))return <code key={i}>{part.slice(1,-1)}</code>
    const link=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if(link){try{const u=new URL(link[2]);if(u.protocol==='https:'&&!u.username&&!u.password)return <a key={i} href={u.href} target="_blank" rel="noopener noreferrer">{link[1]}</a>}catch{/* render invalid URL as text */}return <span key={i}>{link[1]}</span>}
    return <span key={i}>{part}</span>
  })}</>
}
function MarkdownPreview({ body }: { body: string }) {
  const items: ReactNode[] = []; let fenced=false,code:string[]=[],paragraph:string[]=[],list:string[]=[]
  const flush=()=>{if(paragraph.length){items.push(<p key={items.length}><Inline text={paragraph.join(' ')}/></p>);paragraph=[]}if(list.length){items.push(<ul key={items.length}>{list.map((t,i)=><li key={i}><Inline text={t}/></li>)}</ul>);list=[]}}
  for(const line of body.replace(/\r\n?/g,'\n').split('\n')){
    if(line.startsWith('```')){flush();if(fenced){items.push(<pre key={items.length}><code>{code.join('\n')}</code></pre>);code=[]}fenced=!fenced;continue}
    if(fenced){code.push(line);continue}
    const heading=/^(#{1,3})\s+(.+)$/.exec(line)
    if(heading){flush();items.push(heading[1].length===3?<h3 key={items.length}><Inline text={heading[2]}/></h3>:<h2 key={items.length}><Inline text={heading[2]}/></h2>)}
    else if(/^[-*]\s+/.test(line)){if(paragraph.length)flush();list.push(line.replace(/^[-*]\s+/,''))}
    else if(/^>/.test(line)){flush();items.push(<blockquote key={items.length}><Inline text={line.replace(/^>\s?/,'')}/></blockquote>)}
    else if(!line.trim())flush();else{if(list.length)flush();paragraph.push(line)}
  }
  flush();if(code.length)items.push(<pre key={items.length}><code>{code.join('\n')}</code></pre>)
  return <div className="bs-prose">{items}</div>
}
function PrivateImage({ id, alt }: { id: string; alt: string }) {
  const [url,setUrl]=useState(''),[failed,setFailed]=useState(false)
  useEffect(()=>{const controller=new AbortController();let objectUrl='';setUrl('');setFailed(false);void blogImage(id,controller.signal).then(blob=>{if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}).catch(()=>{if(!controller.signal.aborted)setFailed(true)});return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}},[id])
  return url?<img src={url} alt={alt}/>:<div className="bs-image-placeholder">{failed?'Image unavailable':'Loading private preview...'}</div>
}
const EMPTY:BlogList={posts:[],total:0,page:1,page_size:12,counts:{}}

export default function BlogStudio(){
  const [me,setMe]=useState<BlogMe|null>(null),[initializing,setInitializing]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [tab,setTab]=useState<Tab>('articles'),[list,setList]=useState<BlogList>(EMPTY),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1),[loading,setLoading]=useState(false)
  const [draft,setDraft]=useState<BlogDraft|null>(null),[dirty,setDirty]=useState(false),[preview,setPreview]=useState(false),[schedule,setSchedule]=useState(''),[revisions,setRevisions]=useState<BlogRevision[]>([])
  const [media,setMedia]=useState<BlogMedia[]>([]),[mediaPage,setMediaPage]=useState(1),[mediaMore,setMediaMore]=useState(false)
  const [assets,setAssets]=useState<BlogAsset[]>([]),[linkedAssets,setLinkedAssets]=useState<BlogPostAssetLink[]>([])
  const [people,setPeople]=useState<BlogPerson[]>([]),[peopleQuery,setPeopleQuery]=useState(''),[events,setEvents]=useState<BlogEvent[]>([]),[accessEvents,setAccessEvents]=useState<BlogAccessEvent[]>([])
  const [addOpen,setAddOpen]=useState(false),[importFile,setImportFile]=useState<File|null>(null),[sourceAsset,setSourceAsset]=useState<BlogAsset|null>(null),[importPreview,setImportPreview]=useState<ImportedDraft|null>(null),[importFailure,setImportFailure]=useState('')
  const dirtyRef=useRef(false),activeRef=useRef(true),generation=useRef(0)
  const origin=blogOrigin()
  const refreshIdentity=useCallback(async()=>{const result=await blogRequest<BlogMe>('me');if(activeRef.current)setMe(result);return result},[])
  const refreshAssets=useCallback(async()=>{const value=await listBlogAssets();if(activeRef.current)setAssets(value.assets);return value.assets},[])
  useEffect(()=>{activeRef.current=true;void refreshIdentity().then(result=>{if(activeRef.current&&!result.permissions.write&&result.permissions.manage_access)setTab('access')}).catch(e=>setError(errorText(e))).finally(()=>setInitializing(false));return()=>{activeRef.current=false;generation.current++}},[refreshIdentity])
  useEffect(()=>{dirtyRef.current=dirty},[dirty])
  useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(dirtyRef.current){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler)},[])
  useEffect(()=>{const focused=()=>void refreshIdentity().catch(()=>{});window.addEventListener('focus',focused);return()=>window.removeEventListener('focus',focused)},[refreshIdentity])
  const load=useCallback(async()=>{
    if(!me)return
    const ticket=++generation.current;setLoading(true);setError('')
    try{
      if(tab==='articles'&&me.permissions.write){const p=new URLSearchParams({q:query,page:String(page)});if(status)p.set('status',status);const value=await blogRequest<BlogList>('posts?'+p);if(ticket===generation.current)setList(value)}
      else if(tab==='media'&&me.permissions.write){const [legacy,generic]=await Promise.all([blogRequest<{media:BlogMedia[];has_more:boolean}>(`media?page=${mediaPage}`),listBlogAssets()]);if(ticket===generation.current){setMedia(legacy.media);setMediaMore(legacy.has_more);setAssets(generic.assets)}}
      else if(tab==='access'&&me.permissions.manage_access){const value=await blogRequest<{people:BlogPerson[]}>('access?q='+encodeURIComponent(peopleQuery));if(ticket===generation.current)setPeople(value.people)}
      else if(tab==='activity'){const [a,b]=await Promise.all([me.permissions.write?blogRequest<{events:BlogEvent[]}>('audit'):Promise.resolve({events:[]}),me.permissions.manage_access?blogRequest<{events:BlogAccessEvent[]}>('access-audit'):Promise.resolve({events:[]})]);if(ticket===generation.current){setEvents(a.events);setAccessEvents(b.events)}}
    }catch(e){if(ticket===generation.current)setError(errorText(e))}finally{if(ticket===generation.current)setLoading(false)}
  },[me,tab,query,status,page,mediaPage,peopleQuery])
  useEffect(()=>{const timer=setTimeout(()=>void load(),220);return()=>{clearTimeout(timer);generation.current++}},[load])
  const abandon=()=>!dirtyRef.current||window.confirm('Discard the unsaved article changes?')
  const resetImport=()=>{setImportFile(null);setSourceAsset(null);setImportPreview(null);setImportFailure('')}
  const changeTab=(next:Tab)=>{if(busy||!abandon())return;setDraft(null);setLinkedAssets([]);setDirty(false);setPreview(false);setAddOpen(false);resetImport();setTab(next);setError('')}
  const newDraft=()=>{if(busy||!abandon())return;setDraft(blankBlogDraft('article'));setLinkedAssets([]);setSchedule('');setRevisions([]);setDirty(false);setPreview(false);setAddOpen(false);setNotice('New article draft. Nothing is published until an editor publishes it.')}
  const newQuick=()=>{if(busy||!abandon())return;const next=blankBlogDraft('quick_post');next.category='Company news';setDraft(next);setLinkedAssets([]);setSchedule('');setRevisions([]);setDirty(false);setPreview(false);setAddOpen(false);setNotice('Quick writeup ready. Write directly here; no file, title, slug or excerpt is required.')}
  const openDraft=async(id:string)=>{if(busy||!abandon())return;setBusy(true);setError('');try{const [result,links,library]=await Promise.all([blogRequest<{post:BlogArticle}>(`posts/${id}`),listPostAssets(id),listBlogAssets()]);setDraft(result.post);setLinkedAssets(links);setAssets(library.assets);setSchedule(toLagosInput(result.post.published_at));setRevisions([]);setPreview(false);setDirty(false)}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const update=(fields:Partial<BlogDraft>)=>{setDraft(value=>value?{...value,...fields}:value);setDirty(true);setNotice('')}
  const save=async(event?:FormEvent,targetStatus?:BlogDraft['status'])=>{
    event?.preventDefault();if(!draft||busy)return
    const statusToSave=targetStatus??draft.status
    setBusy(true);setError('');setNotice('')
    try{
      const data={...draft,status:statusToSave,published_at:statusToSave==='scheduled'?fromLagosInput(schedule):statusToSave==='published'&&draft.published_at&&Date.parse(draft.published_at)<=Date.now()?draft.published_at:null}
      const result=await blogRequest<{post:BlogArticle}>(draft.id?`posts/${draft.id}`:'posts',{method:draft.id?'PATCH':'POST',data})
      setDraft(result.post);setSchedule(toLagosInput(result.post.published_at));setDirty(false);setNotice(result.post.status==='published'?'Content saved and published. Its link is ready to share.':result.post.status==='scheduled'?'Content scheduled. It becomes public at its Lagos publication time.':'Draft saved.');await load();if(result.post.id){setLinkedAssets(await listPostAssets(result.post.id));await refreshAssets()}
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  const uploadCover=async(file:File|undefined,attach=false)=>{
    if(!file||busy)return
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){setError('Choose a JPEG, PNG or WebP image of 5 MiB or smaller.');return}
    setBusy(true);setError('')
    try{const result=await blogRequest<{media:BlogMedia}>('media',{method:'POST',file});if(attach)update({cover_media_id:result.media.id});setNotice('Image uploaded privately. It becomes public only when used by published content.');await load()}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  const uploadGeneric=async(file:File|undefined,attachToDraft=false)=>{
    if(!file||busy)return
    const image=inferBlogAssetMime(file).startsWith('image/');if((image&&file.size>5*1024*1024)||(!image&&file.size>15*1024*1024)){setError(image?'Images must be 5 MiB or smaller.':'Documents must be 15 MiB or smaller.');return}
    setBusy(true);setError('')
    try{
      const asset=await uploadBlogAsset(file,image?'image':'attachment');setAssets(v=>[asset,...v.filter(a=>a.id!==asset.id)])
      if(attachToDraft&&draft?.id){await linkBlogAsset(draft.id,asset.id,'attachment');setLinkedAssets(await listPostAssets(draft.id));setNotice(`${asset.original_filename} uploaded and attached.`)}
      else setNotice('File uploaded privately to the Blog asset library.')
      setAddOpen(false)
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  const publishAsset=async(
    asset:BlogAsset,
    published:boolean,
  )=>{
    if(busy)return

    setBusy(true)
    setError('')
    setNotice('')

    try{
      await setBlogAssetPublished(
        asset.id,
        published,
      )

      await refreshAssets()

      setNotice(
        published
          ? `${asset.original_filename} is published and its public link is ready.`
          : `${asset.original_filename} is private again.`,
      )
    }catch(e){
      setError(errorText(e))
    }finally{
      setBusy(false)
    }
  }

  const copyAssetLink=async(
    asset:BlogAsset,
  )=>{
    const url=`${origin}/files/${asset.id}`

    try{
      await navigator.clipboard.writeText(url)
      setNotice('Public file link copied.')
    }catch{
      setError(
        'Clipboard access is unavailable. Use Open public link and copy the address instead.',
      )
    }
  }

  const removeAsset=async(
    asset:BlogAsset,
  )=>{
    if(busy)return

    const confirmed=window.confirm(
      `Delete "${asset.original_filename}" permanently? This cannot be undone.`,
    )

    if(!confirmed)return

    setBusy(true)
    setError('')
    setNotice('')

    try{
      await deleteBlogAsset(asset.id)

      setAssets(value=>
        value.filter(item=>item.id!==asset.id)
      )

      setNotice(
        `${asset.original_filename} was permanently deleted.`,
      )
    }catch(e){
      setError(errorText(e))
    }finally{
      setBusy(false)
    }
  }

  const extractImport=async(file:File,existing?:BlogAsset)=>{
    const allowed=/\.(docx|pdf|md|txt|json)$/i.test(file.name);if(!allowed){setError('Choose a DOCX, PDF, Markdown, TXT or Blog article JSON file.');return}
    if(file.size>15*1024*1024){setError('Import files must be 15 MiB or smaller.');return}
    setBusy(true);setError('');setImportFailure('');setImportFile(file);setAddOpen(false)
    try{
      const source=existing||await uploadBlogAsset(file,'source');setSourceAsset(source)
      try{const parsed=await parseBlogImport(file);setImportPreview(parsed);setNotice('Source preserved privately. Review the extracted content, then create the draft.')}catch(e){setImportPreview(null);setImportFailure(errorText(e));setNotice('The original source is safely uploaded. Extraction can be retried or you can create a blank draft.')}
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  const createImported=async(blank=false)=>{
    if(!sourceAsset||!importFile||busy)return;setBusy(true);setError('')
    try{
      const value=blank?{title:fileStem(importFile.name),excerpt:'',body:'',category:'Company news'}:(importPreview||{title:fileStem(importFile.name),excerpt:'',body:'',category:'Company news'})
      const result=await importBlogDraft(sourceAsset.id,{title:value.title||fileStem(importFile.name),slug:'',excerpt:value.excerpt||'',body:value.body||'',category:value.category||'Company news',editorial_note:`Imported from preserved source: ${sourceAsset.original_filename}`})
      setDraft(result.post);setLinkedAssets(await listPostAssets(result.post.id));setSchedule('');setDirty(false);setPreview(false);resetImport();setTab('articles');setNotice('Imported as an unpublished draft. Review it before publishing.');await load()
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  const attachAsset=async(asset:BlogAsset)=>{if(!draft?.id||busy)return;const relationship:BlogAssetRelationship='attachment';setBusy(true);try{await linkBlogAsset(draft.id,asset.id,relationship);setLinkedAssets(await listPostAssets(draft.id));setNotice(`${asset.original_filename} attached.`)}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const detachAsset=async(link:BlogPostAssetLink)=>{if(!draft?.id||busy||link.relationship==='source')return;setBusy(true);try{await unlinkBlogAsset(draft.id,link.asset.id,link.relationship);setLinkedAssets(await listPostAssets(draft.id));setNotice(`${link.asset.original_filename} detached.`)}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const remove=async()=>{if(!draft?.id||busy)return;if(dirty){setError('Save or discard your changes before deleting.');return}const confirm=window.prompt(`Permanent deletion removes the article from the journal. Revision and audit records remain. Type this slug to confirm:\n${draft.slug}`);if(confirm!==draft.slug)return;setBusy(true);try{await blogRequest(`posts/${draft.id}`,{method:'DELETE',data:{confirm,version:draft.version}});setDraft(null);setDirty(false);setNotice('Article deleted. Its audit trail is retained.');await load()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const grant=async(person:BlogPerson,role:string)=>{if(busy||role===(person.blog_role||''))return;const label=role?BLOG_ROLE_LABELS[role as BlogRole]:'No blog access';if(!window.confirm(`Change ${person.full_name}'s blog access to ${label}?`))return;setBusy(true);setError('');try{await blogRequest('access',{method:'POST',data:{employee_id:person.employee_id,role:role||null}});setNotice(`Access updated for ${person.full_name}.`);await refreshIdentity();await load()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  const copy=async()=>{if(!draft)return;try{await navigator.clipboard.writeText(`${origin}/stories/${draft.slug}`);setNotice('Content link copied.')}catch{setError('Clipboard unavailable. Copy the link shown in the publishing panel.')}}
  if(initializing)return <section className="bs-root"><div className="bs-empty"><span className="bs-eyebrow">RIDEARRIVO / BLOG STUDIO</span><h2>Opening your editorial desk...</h2><p>Checking your current workspace permissions.</p></div></section>
  const enabled=me?.permissions.write||me?.permissions.manage_access
  const editingAllowed=Boolean(me?.permissions.write&&draft?.can_edit!==false)
  const publicNow=Boolean(draft&&['published','scheduled'].includes(draft.status)&&draft.published_at&&Date.parse(draft.published_at)<=Date.now()&&!dirty)
  const quick=draft?.content_type==='quick_post'
  return <section className="bs-root" aria-label="Blog Studio">
    <header className="bs-hero"><div><span className="bs-eyebrow">RIDEARRIVO / EDITORIAL WORKSTATION</span><h1>Stories that <em>move us.</em></h1><p>Create quick updates, long-form stories and file-based drafts from one publishing desk.</p><div className="bs-pills"><span>Cloudflare D1 + R2</span><span>{me?.identity.role?BLOG_ROLE_LABELS[me.identity.role]:me?.permissions.manage_access?'Access manager':'No assigned blog role'}</span></div></div><a className="bs-btn bs-outline" href={origin} target="_blank" rel="noopener noreferrer">View public journal &#8599;</a></header>
    {error&&<div className="bs-alert bs-error" role="alert">{error}<button onClick={()=>setError('')} type="button" aria-label="Dismiss error">&times;</button></div>}
    {notice&&<div className="bs-alert" role="status">{notice}<button onClick={()=>setNotice('')} type="button" aria-label="Dismiss notification">&times;</button></div>}
    {!enabled?<div className="bs-empty"><h2>{me?'You do not have blog access yet.':'Blog Studio could not connect.'}</h2><p>{me?'An administrator must assign you an individual blog role.':'Check the Blog deployment and workspace identity settings.'}</p><button className="bs-btn" onClick={()=>void refreshIdentity().catch(e=>setError(errorText(e)))}>Check access again</button></div>:<>
      <nav className="bs-tabs" aria-label="Blog Studio sections">{([['articles','Articles',me?.permissions.write],['media','Files & media',me?.permissions.write],['access','Access management',me?.permissions.manage_access],['activity','Activity',true]] as const).filter(item=>item[2]).map(([id,label])=><button type="button" key={id} disabled={busy} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>changeTab(id)}>{label}</button>)}<button type="button" className="bs-refresh" disabled={busy||loading} onClick={()=>void load()}>Refresh</button></nav>
      {tab==='articles'&&me?.permissions.write&&<>
        {!draft?<>
          <div className="bs-stats">{['draft','review','scheduled','published'].map(item=><button key={item} className={status===item?'active':''} onClick={()=>{setStatus(status===item?'':item);setPage(1)}}><span>{item==='review'?'In review':item}</span><strong>{list.counts[item]||0}</strong></button>)}</div>
          <div className="bs-toolbar"><label className="bs-search"><span className="bs-sr-only">Search articles</span><input value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}} placeholder="Search titles, excerpts and articles" maxLength={100}/></label><label><span className="bs-sr-only">Article status</span><select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">All statuses</option>{['draft','review','scheduled','published','archived'].map(s=><option key={s}>{s}</option>)}</select></label><button className="bs-btn" type="button" onClick={()=>setAddOpen(v=>!v)} disabled={busy}>+ Add content</button></div>
          {addOpen&&<div className="bs-add-sheet" role="dialog" aria-label="Add content"><div className="bs-add-sheet-head"><div><span className="bs-eyebrow">ADD CONTENT</span><h2>What are you publishing?</h2></div><button type="button" onClick={()=>setAddOpen(false)} aria-label="Close Add Content">&times;</button></div><div className="bs-add-actions"><button type="button" onClick={newQuick}><strong>{ADD_CONTENT_ACTIONS[0]}</strong><span>Write a short X-like update directly in RA-Workspace.</span></button><button type="button" onClick={newDraft}><strong>{ADD_CONTENT_ACTIONS[1]}</strong><span>Open the full article editor.</span></button><label><strong>{ADD_CONTENT_ACTIONS[2]}</strong><span>DOCX, PDF, Markdown, TXT or Blog JSON.</span><input className="bs-file-input" type="file" accept=".docx,.pdf,.md,.txt,.json" onChange={e=>{const file=e.target.files?.[0];if(file)void extractImport(file);e.target.value=''}}/></label><label><strong>{ADD_CONTENT_ACTIONS[3]}</strong><span>Store a reusable image or downloadable document.</span><input className="bs-file-input" type="file" accept="image/jpeg,image/png,image/webp,.pdf,.docx,.md,.txt,.json" onChange={e=>{void uploadGeneric(e.target.files?.[0]);e.target.value=''}}/></label></div></div>}
          {sourceAsset&&importFile&&<section className="bs-import-panel"><div className="bs-import-source"><span className="bs-status">Source preserved</span><strong>{sourceAsset.original_filename}</strong><small>{Math.ceil(sourceAsset.byte_size/1024)} KiB &middot; private R2 source</small></div><h2>Extraction preview</h2>{importFailure?<div className="bs-alert bs-error"><strong>Extraction needs review.</strong><p>{importFailure}</p><div className="bs-import-actions"><button className="bs-btn bs-outline" type="button" disabled={busy} onClick={()=>void extractImport(importFile,sourceAsset)}>Retry extraction</button><button className="bs-btn" type="button" disabled={busy} onClick={()=>void createImported(true)}>Create blank draft</button></div></div>:importPreview&&<><label>Detected title<input value={importPreview.title} onChange={e=>setImportPreview(v=>v?{...v,title:e.target.value}:v)}/></label><label>Category<select value={importPreview.category||'Company news'} onChange={e=>setImportPreview(v=>v?{...v,category:e.target.value}:v)}>{BLOG_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label><label>Extracted body<textarea rows={14} value={importPreview.body} onChange={e=>setImportPreview(v=>v?{...v,body:e.target.value}:v)}/></label><div className="bs-import-actions"><button className="bs-btn" type="button" disabled={busy} onClick={()=>void createImported(false)}>Create draft</button><button className="bs-btn bs-outline" type="button" onClick={resetImport}>Cancel</button></div></>}</section>}
          <p className="bs-muted">{list.total} items {me.identity.role==='writer'?'assigned to you':'in the editorial library'}.</p><div className="bs-article-list">{list.posts.map(post=><button key={post.id} className="bs-article-row" onClick={()=>void openDraft(post.id)} disabled={busy}><span className={'bs-status '+post.status}>{post.status}</span><span className="bs-row-title"><strong>{post.title}</strong><small>{post.content_type==='quick_post'?'Quick writeup':'Article'} &middot; {post.category} &middot; {post.author_name}</small></span><span className="bs-row-date">{stamp(post.updated_at)}<small>Lagos time &middot; v{post.version}</small></span><span aria-hidden="true">&#8599;</span></button>)}</div>{!list.posts.length&&!loading&&<div className="bs-empty"><h2>Your next story starts here.</h2><p>Use Add content to write, import a file or upload media. Nothing is published automatically.</p><button className="bs-btn" onClick={()=>setAddOpen(true)}>+ Add content</button></div>}<div className="bs-pagination"><button disabled={page<=1||loading} onClick={()=>setPage(v=>v-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(list.total/12))}</span><button disabled={page*12>=list.total||loading} onClick={()=>setPage(v=>v+1)}>Next</button></div>
        </>:<>
          <div className="bs-editor-top"><button className="bs-btn bs-outline" disabled={busy} onClick={()=>{if(abandon()){setDraft(null);setLinkedAssets([]);setDirty(false)}}}>&#8592; All content</button><span className="bs-muted">{quick?'Quick writeup':draft.id?`Saved version ${draft.version}`:'New article'}{dirty?' / Unsaved changes':''}{busy?' / Working...':''}</span>{!quick&&<button className="bs-btn bs-outline" type="button" onClick={()=>setPreview(v=>!v)}>{preview?'Write':'Preview'}</button>}</div>
          {draft.ever_published&&<div className="bs-alert">This content has been scheduled or published before. Its permalink is locked.</div>}
          <form className={'bs-editor '+(quick?'bs-quick-editor':'')} onSubmit={event=>event.preventDefault()}><fieldset disabled={busy||!editingAllowed} className="bs-writing">{quick?<><div className="bs-quick-heading"><span className="bs-eyebrow">QUICK WRITEUP</span><h2>Write it like a post.</h2><p>No upload, title, slug, excerpt or SEO setup required.</p></div><label>Quick writeup body<textarea className="bs-body" rows={14} required value={draft.body} maxLength={100000} onChange={e=>update({body:e.target.value})} placeholder="Share an update, perspective or announcement..."/></label><div className="bs-character-count" aria-label="character count">Character count: {draft.body.length.toLocaleString()}</div><div className="bs-quick-media"><span>Optional image</span><div className="bs-cover-preview">{draft.cover_media_id?<PrivateImage id={draft.cover_media_id} alt={draft.cover_alt||'Quick writeup image preview'}/>:<span>No image selected</span>}</div><label className="bs-btn bs-outline bs-upload">Choose image<input type="file" accept="image/jpeg,image/png,image/webp" className="bs-file-input" disabled={busy||!editingAllowed} onChange={e=>{void uploadCover(e.target.files?.[0],true);e.target.value=''}}/></label>{draft.cover_media_id&&<><button type="button" className="bs-inline-button" onClick={()=>update({cover_media_id:null,cover_alt:''})}>Remove image</button><label>Image description<textarea rows={2} value={draft.cover_alt} onChange={e=>update({cover_alt:e.target.value})}/></label></>}</div></>:<><label>Article title<input className="bs-title-input" value={draft.title} maxLength={160} required onChange={e=>update({title:e.target.value})} placeholder="Give your story a strong opening."/></label><label>Short introduction<textarea rows={3} value={draft.excerpt} maxLength={320} onChange={e=>update({excerpt:e.target.value})} placeholder="A clear summary for the journal and sharing preview."/></label><div className="bs-editor-label"><span>Article body</span><span>Markdown &middot; {draft.body.trim().split(/\s+/).filter(Boolean).length} words</span></div>{preview?<div className="bs-preview"><MarkdownPreview body={draft.body}/></div>:<textarea className="bs-body" aria-label="Article body in Markdown" value={draft.body} maxLength={100000} rows={25} onChange={e=>update({body:e.target.value})} placeholder={'## Begin with a perspective\n\nTell the story here.'}/>}<details className="bs-help"><summary>Formatting guide</summary><p>Use ## for section headings, ### for subheadings, **bold**, - for lists, &gt; for a quotation and Markdown links. Raw HTML is never executed.</p></details><label>Private editorial note<textarea rows={3} value={draft.editorial_note} maxLength={1000} onChange={e=>update({editorial_note:e.target.value})} placeholder="Sources to verify or notes for the reviewing editor. Never shown publicly."/></label></>}</fieldset>
            <aside className="bs-publishing"><fieldset disabled={busy||!editingAllowed}><h2>Publishing</h2>{!quick&&<><label>URL slug<input value={draft.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={120} required disabled={Boolean(draft.ever_published)||busy||!editingAllowed} onChange={e=>update({slug:e.target.value})} placeholder="your-story-title"/></label><button type="button" className="bs-inline-button" disabled={Boolean(draft.ever_published)} onClick={()=>update({slug:draft.title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120).replace(/-$/,'')})}>Generate from title</button></>}<label>Category<select value={draft.category} onChange={e=>update({category:e.target.value})}>{BLOG_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label><div className="bs-current-status"><span>Current state</span><strong className={'bs-status '+draft.status}>{draft.status==='review'?'In review':draft.status}</strong></div>{me.permissions.publish&&<label>Schedule publication in Lagos (UTC+1)<input type="datetime-local" value={schedule} onChange={e=>{setSchedule(e.target.value);setDirty(true)}}/></label>}{!quick&&<><div className="bs-cover-preview">{draft.cover_media_id?<PrivateImage id={draft.cover_media_id} alt={draft.cover_alt||'Article cover preview'}/>:<span>No cover image selected</span>}</div><label className="bs-btn bs-outline bs-upload">Upload cover<input type="file" accept="image/jpeg,image/png,image/webp" className="bs-file-input" disabled={busy||!editingAllowed} onChange={e=>{void uploadCover(e.target.files?.[0],true);e.target.value=''}}/></label>{draft.cover_media_id&&<button type="button" className="bs-inline-button" onClick={()=>update({cover_media_id:null,cover_alt:''})}>Remove cover</button>}<label>Image description (alt text)<textarea rows={2} maxLength={240} value={draft.cover_alt} onChange={e=>update({cover_alt:e.target.value})}/></label></>}<label className="bs-checkbox"><input type="checkbox" checked={draft.fact_checked} onChange={e=>update({fact_checked:e.target.checked})}/><span>I have reviewed the facts, sources and image rights. Publication requires this confirmation.</span></label><div className="bs-publish-actions"><button className="bs-btn bs-outline" type="button" onClick={()=>void save(undefined,'draft')}>Save draft</button><button className="bs-btn bs-outline" type="button" onClick={()=>void save(undefined,'review')}>Submit for review</button>{me.permissions.publish&&<><button className="bs-btn" type="button" disabled={!draft.fact_checked} onClick={()=>void save(undefined,'published')}>Publish now</button><button className="bs-btn bs-outline" type="button" disabled={!draft.fact_checked||!schedule} onClick={()=>void save(undefined,'scheduled')}>Schedule publication</button></>}</div></fieldset>
              {draft.id&&<><div className="bs-share-box"><small>{publicNow?'Public link':'Draft link (not public yet)'}</small><code>{origin}/stories/{draft.slug}</code><button type="button" className="bs-inline-button" onClick={()=>void copy()}>Copy link</button></div><section className="bs-attachments"><div className="bs-attachments-head"><div><h3>Sources & attachments</h3><p className="bs-muted">Source files stay private. Attachments can become downloadable only with published content.</p></div><label className="bs-btn bs-outline">Upload attachment/media<input className="bs-file-input" type="file" accept="image/jpeg,image/png,image/webp,.pdf,.docx,.md,.txt,.json" onChange={e=>{const file=e.target.files?.[0];if(file)void uploadGeneric(file,true);e.target.value=''}}/></label></div>{linkedAssets.map(link=><div className="bs-asset-row" key={`${link.asset.id}-${link.relationship}`}><span><strong>{link.asset.original_filename}</strong><small>{link.relationship} &middot; {Math.ceil(link.asset.byte_size/1024)} KiB</small></span>{link.relationship!=='source'&&<button type="button" className="bs-inline-button" onClick={()=>void detachAsset(link)}>Detach</button>}</div>)}<details><summary>Attach from Files & media</summary><div className="bs-asset-picker">{assets.filter(a=>!linkedAssets.some(l=>l.asset.id===a.id)).map(asset=><button type="button" key={asset.id} onClick={()=>void attachAsset(asset)}><strong>{asset.original_filename}</strong><small>{asset.asset_kind} &middot; {Math.ceil(asset.byte_size/1024)} KiB</small></button>)}</div></details></section><button type="button" className="bs-btn bs-outline" onClick={()=>void blogRequest<{revisions:BlogRevision[]}>(`posts/${draft.id}/revisions`).then(v=>setRevisions(v.revisions)).catch(e=>setError(errorText(e)))}>View saved versions</button>{revisions.map(r=><details key={r.id} className="bs-revision"><summary>Version {r.version} &middot; {r.event}</summary><small>{stamp(r.created_at)}</small><h3>{r.snapshot.title}</h3><pre>{r.snapshot.body}</pre></details>)}{me.permissions.publish&&draft.status!=='archived'&&<button type="button" className="bs-btn bs-danger" disabled={busy} onClick={()=>{if(window.confirm('Archive this content? It will stop being public but remain in Blog Studio.'))void save(undefined,'archived')}}>Archive content</button>}{me.permissions.remove&&draft.status==='archived'&&<button type="button" className="bs-btn bs-danger" disabled={busy||dirty} onClick={()=>void remove()}>Permanently delete</button>}</>}
            </aside></form>
        </>}
      </>}
      {tab==='media'&&me?.permissions.write&&<><div className="bs-toolbar"><div><h2>Files & media</h2><p className="bs-muted">Reusable images, source documents and downloadable attachments stored privately in Blog R2.</p></div><label className="bs-btn">Upload attachment/media<input className="bs-file-input" type="file" accept="image/jpeg,image/png,image/webp,.pdf,.docx,.md,.txt,.json" disabled={busy} onChange={e=>{void uploadGeneric(e.target.files?.[0]);e.target.value=''}}/></label></div><div className="bs-asset-library">{assets.map(asset=><article key={asset.id} className="bs-asset-card"><div className="bs-asset-icon">{asset.asset_kind==='image'?'IMG':'FILE'}</div><div className="bs-asset-copy"><strong>{asset.original_filename}</strong><small>{asset.asset_kind} &middot; {asset.mime_type} &middot; {Math.ceil(asset.byte_size/1024)} KiB</small><small>{stamp(asset.created_at)}</small><span className={'bs-asset-state '+(asset.published_at?'published':'private')}>{asset.asset_kind==='source'?'Private source':asset.published_at?'Published':'Private'}</span></div><div className="bs-asset-actions">{me.permissions.publish&&asset.asset_kind!=='source'&&<button type="button" className={asset.published_at?'bs-btn bs-outline':'bs-btn'} disabled={busy} onClick={()=>void publishAsset(asset,!asset.published_at)}>{asset.published_at?'Unpublish':'Publish'}</button>}{asset.published_at&&asset.asset_kind!=='source'&&<><a className="bs-btn bs-outline" href={`${origin}/files/${asset.id}`} target="_blank" rel="noopener noreferrer">Open public link</a><button type="button" className="bs-btn bs-outline" onClick={()=>void copyAssetLink(asset)}>Copy link</button></>}{me.permissions.remove&&<button type="button" className="bs-btn bs-danger bs-asset-delete" disabled={busy} onClick={()=>void removeAsset(asset)}>Delete</button>}</div></article>)}</div>{!assets.length&&!loading&&<div className="bs-empty"><h2>Your file library is ready.</h2><p>Upload media or a document to reuse it in Blog Studio.</p></div>}<details className="bs-legacy-media"><summary>Legacy cover image library</summary><div className="bs-media-grid">{media.map(m=><article key={m.id}><PrivateImage id={m.id} alt={m.filename}/><div><strong>{m.filename}</strong><small>{Math.ceil(m.bytes/1024)} KiB</small><button className="bs-inline-button" onClick={()=>{if(abandon()){setDraft({...blankBlogDraft(),cover_media_id:m.id});setDirty(true);setSchedule('');setTab('articles');setPreview(false)}}}>Use in a new article</button></div></article>)}</div><div className="bs-pagination"><button disabled={mediaPage<=1||loading} onClick={()=>setMediaPage(v=>v-1)}>Previous</button><span>Page {mediaPage}</span><button disabled={!mediaMore||loading} onClick={()=>setMediaPage(v=>v+1)}>Next</button></div></details></>}
      {tab==='access'&&me?.permissions.manage_access&&<><div className="bs-access-intro"><h2>The right access. The right people.</h2><p>Blog roles are separate from department roles. Only existing, approved staff can receive access.</p></div><div className="bs-role-guide"><div><h3>Writer</h3><p>Own drafts, quick writeups, imports and uploads.</p></div><div><h3>Editor</h3><p>All content, publishing, scheduling and archiving.</p></div><div><h3>Blog administrator</h3><p>Full editorial control, permanent deletion and access management.</p></div></div>{!me.permissions.write&&<div className="bs-alert">You can manage access because you are a workspace administrator. Assign yourself an explicit blog role to create or publish content.</div>}<label className="bs-search"><span className="bs-sr-only">Search existing employees</span><input value={peopleQuery} maxLength={100} onChange={e=>setPeopleQuery(e.target.value)} placeholder="Find a staff member by name or email"/></label><div className="bs-people">{people.map(p=><div key={p.employee_id} className="bs-person"><div className="bs-avatar" aria-hidden="true">{p.full_name.slice(0,1)}</div><div><strong>{p.full_name}</strong><small>{p.email}</small><small>{p.department} &middot; {p.active?'Active employee':'Inactive employee'}</small></div><label><span className="bs-sr-only">Blog access for {p.full_name}</span><select value={p.blog_role||''} disabled={busy} onChange={e=>void grant(p,e.target.value)}><option value="">No blog access</option>{Object.entries(BLOG_ROLE_LABELS).map(([id,label])=><option key={id} value={id} disabled={!p.active}>{label}</option>)}</select></label></div>)}</div></>}
      {tab==='activity'&&<><h2>Editorial activity</h2><p className="bs-muted">Latest article and access changes. Times are shown in Lagos.</p><div className="bs-activity">{events.map(e=><div key={e.id}><span className="bs-status">{e.event}</span><span><strong>{e.title}</strong><small>Version {e.version} &middot; {stamp(e.created_at)}</small></span></div>)}{accessEvents.map(e=><div key={e.id}><span className="bs-status">Access</span><span><strong>{e.target_name}: {e.new_role?BLOG_ROLE_LABELS[e.new_role]:'Access revoked'}</strong><small>By {e.actor_name} &middot; {stamp(e.happened_at)}</small></span></div>)}</div></>}
    </>}
    <footer className="bs-footer">RideArrivo Blog Studio <span>Editorial content: Cloudflare D1 / Files & media: R2 / Identity: RA-Workspace</span></footer>
  </section>
}
