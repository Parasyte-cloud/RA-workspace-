import { useCallback, useEffect, useRef, useState } from 'react'
import { FileUp, Images, LockKeyhole, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../headshot-gallery.css'

const BUCKET='employee-headshots'
const MAX_BYTES=5*1024*1024
const SIGNED_URL_SECONDS=15*60

type HeadshotRow={id:string;employee_id:string;storage_path:string;original_name:string|null;mime_type:string;file_size:number;created_at:string}
type GalleryItem=HeadshotRow & {url:string|null}

function formatDate(value:string){return new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value))}
function extensionFor(file:File){switch(file.type){case 'image/jpeg':return 'jpg';case 'image/png':return 'png';case 'image/webp':return 'webp';default:return ''}}

export function HeadshotGallery(){
  const [items,setItems]=useState<GalleryItem[]>([])
  const [userId,setUserId]=useState('')
  const [loading,setLoading]=useState(true)
  const [uploading,setUploading]=useState(false)
  const [message,setMessage]=useState('')
  const [selected,setSelected]=useState<GalleryItem|null>(null)
  const inputRef=useRef<HTMLInputElement|null>(null)

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){setLoading(false);setMessage('Your headshot collection is unavailable.');return}
    setLoading(true)
    try{
      const {data:{user},error:userError}=await client.auth.getUser()
      if(userError) throw userError
      if(!user) throw new Error('Your session has expired.')
      setUserId(user.id)
      const {data:rows,error:rowsError}=await client.from('employee_headshots').select('id,employee_id,storage_path,original_name,mime_type,file_size,created_at').eq('employee_id',user.id).order('created_at',{ascending:false})
      if(rowsError) throw rowsError
      const headshots=(rows||[]) as HeadshotRow[]
      const paths=headshots.map(item=>item.storage_path)
      const signedMap=new Map<string,string>()
      if(paths.length){
        const {data:signed,error:signedError}=await client.storage.from(BUCKET).createSignedUrls(paths,SIGNED_URL_SECONDS)
        if(signedError) throw signedError
        for(const result of signed||[]){if(result.path&&result.signedUrl)signedMap.set(result.path,result.signedUrl)}
      }
      setItems(headshots.map(item=>({...item,url:signedMap.get(item.storage_path)||null})))
      setMessage('')
    }catch(error){console.error('Private headshot load failed:',error);setMessage(error instanceof Error?error.message:'Unable to load your headshots.')}
    finally{setLoading(false)}
  },[])

  useEffect(()=>{void load()},[load])

  const upload=async(event:React.ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(event.target.files||[]);event.target.value='';if(!files.length)return
    const client=supabase;if(!client)return
    setUploading(true);setMessage('')
    try{
      const {data:{user},error:userError}=await client.auth.getUser();if(userError)throw userError;if(!user)throw new Error('Your session has expired.')
      if(files.length>8)throw new Error('Upload a maximum of 8 headshots at once.')
      for(const file of files){
        const extension=extensionFor(file);if(!extension)throw new Error(`${file.name}: use JPG, PNG or WEBP only.`);if(file.size>MAX_BYTES)throw new Error(`${file.name}: maximum file size is 5 MB.`)
        const storagePath=[user.id,`${crypto.randomUUID()}.${extension}`].join('/')
        const {error:uploadError}=await client.storage.from(BUCKET).upload(storagePath,file,{upsert:false,contentType:file.type,cacheControl:'900'});if(uploadError)throw uploadError
        const {error:insertError}=await client.from('employee_headshots').insert({employee_id:user.id,storage_path:storagePath,original_name:file.name,mime_type:file.type,file_size:file.size})
        if(insertError){await client.storage.from(BUCKET).remove([storagePath]);throw insertError}
      }
      setMessage(files.length===1?'Private headshot uploaded.':`${files.length} private headshots uploaded.`);await load()
    }catch(error){console.error('Headshot upload failed:',error);setMessage(error instanceof Error?error.message:'Unable to upload headshot.')}
    finally{setUploading(false)}
  }

  const remove=async(item:GalleryItem)=>{
    if(!userId||item.employee_id!==userId)return
    if(!window.confirm('Delete this private headshot?'))return
    const client=supabase;if(!client)return;setMessage('')
    try{
      const {error:rowError}=await client.from('employee_headshots').delete().eq('id',item.id).eq('employee_id',userId);if(rowError)throw rowError
      const {error:fileError}=await client.storage.from(BUCKET).remove([item.storage_path]);if(fileError)console.warn('Headshot row removed but file cleanup failed:',fileError.message)
      if(selected?.id===item.id)setSelected(null);setMessage('Private headshot deleted.');await load()
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to delete headshot.')}
  }

  return <section className="headshotGallery">
    <div className="headshotGalleryHero"><div><span className="eyebrow">PRIVATE IDENTITY ASSETS</span><h2>My Headshots</h2><p>Your private professional headshot collection. Only your signed-in account can list, view, upload or delete these images.</p></div><div className="headshotGalleryActions"><input ref={inputRef} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event=>void upload(event)}/><button className="primaryButton" type="button" disabled={uploading} onClick={()=>inputRef.current?.click()}><FileUp size={17}/>{uploading?'Uploading...':'Upload headshots'}</button></div></div>
    <div className="headshotPolicy"><LockKeyhole size={18}/><span>Account-owner only · not visible in team directories · no company-wide gallery · signed previews expire after 15 minutes</span></div>
    {message&&<div className="moduleNotice">{message}</div>}
    {loading?<div className="headshotEmpty glassCard">Loading your private headshots...</div>:items.length===0?<div className="headshotEmpty glassCard"><Images size={28}/><strong>No private headshots yet</strong><span>Upload professional headshots for your own account.</span></div>:<div className="headshotGrid">{items.map(item=><article className="headshotCard" key={item.id}><button type="button" className="headshotPreview" onClick={()=>setSelected(item)}>{item.url?<img src={item.url} alt="Your professional headshot" referrerPolicy="no-referrer"/>:<span>Image unavailable</span>}</button><div className="headshotInfo"><strong>Private headshot</strong><span>{item.original_name||item.mime_type}</span><small>Uploaded {formatDate(item.created_at)}</small></div><div className="headshotCardActions"><button type="button" className="danger" onClick={()=>void remove(item)} title="Delete your headshot"><Trash2 size={16}/>Delete</button></div></article>)}</div>}
    {selected&&<div className="headshotModal" role="dialog" aria-modal="true" aria-label="Private headshot preview"><button type="button" className="headshotModalClose" onClick={()=>setSelected(null)} aria-label="Close headshot"><X size={20}/></button><div className="headshotModalBody">{selected.url&&<img src={selected.url} alt="Your professional headshot" referrerPolicy="no-referrer"/>}<div><strong>Private headshot</strong><span>This image is available only to your signed-in account.</span></div></div></div>}
  </section>
}
