import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { unzipSync } from "https://esm.sh/fflate@0.8.2"

const MAX_BYTES = 25 * 1024 * 1024
const QUARANTINE = "collaboration-quarantine"
const CHAT_BUCKET = "chat-attachments"
const COLLAB_BUCKET = "collaboration-files"

const allowed = new Set([
  "image/png","image/jpeg","image/webp","image/gif","application/pdf","text/plain","text/csv","application/zip",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "audio/webm","audio/mp4","audio/ogg","audio/mpeg","audio/wav","audio/x-wav",
])

const cors = {
  "Access-Control-Allow-Origin": "https://intranet.ridearrivo.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(status:number, body:unknown) {
  return new Response(JSON.stringify(body), { status, headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"} })
}
function env(name:string){ const v=Deno.env.get(name); if(!v) throw new Error(`Missing ${name}`); return v }
function isUuid(v:unknown):v is string { return typeof v==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) }
function ext(name:string){ return name.toLowerCase().split('.').pop() || '' }
function starts(b:Uint8Array, sig:number[]){ return sig.every((v,i)=>b[i]===v) }
function utf8Text(bytes:Uint8Array){
  if(bytes.some(v=>v===0)) return false
  try { new TextDecoder("utf-8",{fatal:true}).decode(bytes); return true } catch { return false }
}
function sniff(bytes:Uint8Array, name:string):string | null {
  if(starts(bytes,[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) return "image/png"
  if(starts(bytes,[0xff,0xd8,0xff])) return "image/jpeg"
  if(bytes.length>12 && new TextDecoder().decode(bytes.slice(0,4))==="RIFF" && new TextDecoder().decode(bytes.slice(8,12))==="WEBP") return "image/webp"
  if(new TextDecoder().decode(bytes.slice(0,6)).startsWith("GIF8")) return "image/gif"
  if(new TextDecoder().decode(bytes.slice(0,5))==="%PDF-") return "application/pdf"
  if(starts(bytes,[0x50,0x4b,0x03,0x04])) {
    try {
      const markers=new Set(["word/document.xml","xl/workbook.xml","ppt/presentation.xml"])
      const entries=Object.keys(unzipSync(bytes,{
        filter:(entry)=>markers.has(entry.name) && entry.originalSize <= 1024 * 1024,
      }))
      if(entries.includes("word/document.xml")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      if(entries.includes("xl/workbook.xml")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      if(entries.includes("ppt/presentation.xml")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    } catch { return null }
    return "application/zip"
  }
  if(starts(bytes,[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])) {
    const e=ext(name)
    if(e==="doc") return "application/msword"
    if(e==="xls") return "application/vnd.ms-excel"
    if(e==="ppt") return "application/vnd.ms-powerpoint"
    return null
  }
  const head=new TextDecoder("latin1").decode(bytes.slice(0,64))
  if(head.startsWith("ID3") || starts(bytes,[0xff,0xfb]) || starts(bytes,[0xff,0xf3]) || starts(bytes,[0xff,0xf2])) return "audio/mpeg"
  if(head.startsWith("OggS")) return "audio/ogg"
  if(head.startsWith("RIFF") && head.slice(8,12)==="WAVE") return "audio/wav"
  if(starts(bytes,[0x1a,0x45,0xdf,0xa3])) return "audio/webm"
  if(bytes.length>12 && head.slice(4,8)==="ftyp") return "audio/mp4"
  if(utf8Text(bytes)) return ext(name)==="csv" ? "text/csv" : "text/plain"
  return null
}
async function sha256(bytes:Uint8Array){
  const digest=await crypto.subtle.digest("SHA-256",bytes)
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("")
}
async function scan(bytes:Uint8Array, name:string, mime:string){
  const apiKey=Deno.env.get("CLOUDMERSIVE_API_KEY")
  if(!apiKey) throw new Error("Cloudmersive malware scanning is not configured")
  const url=Deno.env.get("CLOUDMERSIVE_SCAN_URL") || "https://api.cloudmersive.com/virus/scan/file"
  const form=new FormData()
  form.set("inputFile",new Blob([bytes],{type:mime}),name)
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),20_000)
  try {
    const res=await fetch(url,{method:"POST",headers:{Apikey:apiKey},body:form,signal:controller.signal})
    if(!res.ok) throw new Error(`Cloudmersive scanner failed (${res.status})`)
    const data=await res.json().catch(()=>null) as Record<string,unknown>|null
    if(!data || typeof data.CleanResult!=="boolean") throw new Error("Cloudmersive scanner returned an invalid response")
    return {clean:data.CleanResult===true,provider:"cloudmersive",details:data}
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  if(req.method!=="POST") return json(405,{error:"Use POST."})
  try {
    const url=env("SUPABASE_URL"), anon=env("SUPABASE_ANON_KEY"), service=env("SUPABASE_SERVICE_ROLE_KEY")
    const auth=req.headers.get("Authorization") || ""
    if(!auth.startsWith("Bearer ")) return json(401,{error:"Authentication required."})
    const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}})
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:userData,error:userError}=await caller.auth.getUser()
    if(userError || !userData.user) return json(401,{error:"Authentication required."})
    const body=await req.json().catch(()=>null) as Record<string,unknown>|null
    if(!body) return json(400,{error:"Send JSON."})

    if(body.action==="sign") {
      const scopeKind=String(body.scope_kind||""), scopeId=body.scope_id, name=String(body.name||""), mime=String(body.mime||""), bytes=Number(body.bytes||0)
      if(!isUuid(scopeId)) return json(400,{error:"Invalid collaboration scope."})
      if(!Number.isInteger(bytes)||bytes<1||bytes>MAX_BYTES) return json(400,{error:"File must be between 1 byte and 25 MB."})
      const {data,error}=await caller.rpc("begin_collaboration_file_upload",{
        p_scope_kind:scopeKind,p_scope_id:scopeId,p_name:name,p_declared_mime:mime,p_bytes:bytes,
        p_classification:String(body.classification||"internal")
      })
      if(error || !data?.[0]) return json(error?.code==="42501"?403:400,{error:error?.message||"Could not prepare upload."})
      const row=data[0]
      const signed=await admin.storage.from(QUARANTINE).createSignedUploadUrl(row.quarantine_path,{upsert:false})
      if(signed.error || !signed.data) return json(500,{error:"Could not prepare secure upload."})
      return json(200,{file_id:row.file_id,version_id:row.version_id,path:row.quarantine_path,token:signed.data.token,signed_url:signed.data.signedUrl})
    }


    if(body.action==="copy") {
      const sourceMessageId=body.source_message_id, targetConversationId=body.target_conversation_id
      if(!isUuid(sourceMessageId)||!isUuid(targetConversationId)) return json(400,{error:"Invalid forward request."})
      const {data:source,error:sourceErr}=await caller.from("social_messages")
        .select("id,attachment_path,attachment_name,attachment_mime,attachment_size")
        .eq("id",sourceMessageId).single()
      if(sourceErr||!source?.attachment_path) return json(403,{error:"Attachment is not accessible."})
      const {data:canWrite,error:writeErr}=await caller.rpc("can_write_to_conversation",{p_conversation_id:targetConversationId})
      if(writeErr||!canWrite) return json(403,{error:"Conversation write access required."})

      const downloaded=await admin.storage.from(CHAT_BUCKET).download(source.attachment_path)
      if(downloaded.error||!downloaded.data) throw new Error("The original attachment is unavailable.")
      const bytes=new Uint8Array(await downloaded.data.arrayBuffer())
      if(bytes.byteLength<1||bytes.byteLength>MAX_BYTES) throw new Error("The original attachment size is invalid.")
      const name=String(source.attachment_name||"file")
      const verified=sniff(bytes,name)
      if(!verified||!allowed.has(verified)) return json(415,{error:"The attachment contents are not an allowed file format."})
      const digest=await sha256(bytes)
      const scanResult=await scan(bytes,name,verified)
      if(!scanResult.clean) return json(422,{error:"Security scanning rejected this attachment."})

      const prepared=await caller.rpc("begin_collaboration_file_upload",{
        p_scope_kind:"conversation",p_scope_id:targetConversationId,p_name:name,
        p_declared_mime:String(source.attachment_mime||verified),p_bytes:bytes.byteLength,p_classification:"internal"
      })
      if(prepared.error||!prepared.data?.[0]) throw new Error(prepared.error?.message||"Could not create governed file record.")
      const record=prepared.data[0]
      const safeName=name.replace(/[^A-Za-z0-9._-]+/g,"_").slice(0,80)||"file"
      const targetPath=`${targetConversationId}/${userData.user.id}/${record.version_id}-${safeName}`
      const uploaded=await admin.storage.from(CHAT_BUCKET).upload(targetPath,bytes,{contentType:verified,upsert:false,cacheControl:"300"})
      if(uploaded.error) throw new Error("The attachment could not be securely copied.")
      const now=new Date().toISOString()
      const versionUpdate=await admin.from("collaboration_file_versions").update({
        verified_mime:verified,sha256:digest,scan_status:"clean",scan_provider:scanResult.provider,
        scan_details:scanResult.details,storage_bucket:CHAT_BUCKET,storage_path:targetPath,promoted_at:now
      }).eq("id",record.version_id).eq("file_id",record.file_id)
      if(versionUpdate.error) throw versionUpdate.error
      await admin.from("collaboration_files").update({current_version_id:record.version_id,updated_at:now}).eq("id",record.file_id)
      await admin.from("collaboration_file_access_events").insert({
        file_id:record.file_id,version_id:record.version_id,actor_id:userData.user.id,action:"upload_verified",
        metadata:{source_message_id:sourceMessageId,mime:verified,sha256:digest}
      })
      return json(200,{path:targetPath,file_id:record.file_id})
    }

    if(body.action==="finalize") {
      const fileId=body.file_id, versionId=body.version_id
      if(!isUuid(fileId)||!isUuid(versionId)) return json(400,{error:"Invalid file reference."})
      const {data:file,error:fileErr}=await caller.from("collaboration_files").select("id,space_id,conversation_id,room_id,display_name,current_version_id").eq("id",fileId).single()
      if(fileErr||!file) return json(403,{error:"File is not accessible."})
      const {data:version,error:verErr}=await caller.from("collaboration_file_versions").select("*").eq("id",versionId).eq("file_id",fileId).single()
      if(verErr||!version) return json(403,{error:"Upload is not accessible."})
      if(version.scan_status==="clean") return json(200,{ok:true,file_id:fileId,version_id:versionId,mime:version.verified_mime,sha256:version.sha256})
      const downloaded=await admin.storage.from(QUARANTINE).download(version.quarantine_path)
      if(downloaded.error||!downloaded.data) throw new Error("Uploaded bytes are missing")
      const bytes=new Uint8Array(await downloaded.data.arrayBuffer())
      if(bytes.byteLength!==Number(version.bytes) || bytes.byteLength<1 || bytes.byteLength>MAX_BYTES) throw new Error("Uploaded size does not match")
      const verified=sniff(bytes,file.display_name)
      if(!verified || !allowed.has(verified)) {
        await admin.from("collaboration_file_versions").update({scan_status:"rejected",scan_details:{reason:"unsupported_signature"}}).eq("id",versionId)
        await admin.from("collaboration_file_access_events").insert({file_id:fileId,version_id:versionId,actor_id:userData.user.id,action:"upload_rejected",metadata:{reason:"unsupported_signature"}})
        await admin.storage.from(QUARANTINE).remove([version.quarantine_path])
        return json(415,{error:"The file contents do not match an allowed file format."})
      }
      const digest=await sha256(bytes)
      const scanResult=await scan(bytes,file.display_name,verified)
      if(!scanResult.clean) {
        await admin.from("collaboration_file_versions").update({verified_mime:verified,sha256:digest,scan_status:"infected",scan_provider:scanResult.provider,scan_details:scanResult.details}).eq("id",versionId)
        await admin.from("collaboration_file_access_events").insert({file_id:fileId,version_id:versionId,actor_id:userData.user.id,action:"upload_rejected",metadata:{reason:"malware_scan"}})
        await admin.storage.from(QUARANTINE).remove([version.quarantine_path])
        return json(422,{error:"Security scanning rejected this file."})
      }
      const targetBucket=file.conversation_id ? CHAT_BUCKET : COLLAB_BUCKET
      const safeName=file.display_name.replace(/[^A-Za-z0-9._-]+/g,"_").slice(0,80)||"file"
      const targetPath=file.conversation_id
        ? `${file.conversation_id}/${userData.user.id}/${versionId}-${safeName}`
        : `${fileId}/${versionId}/${safeName}`
      const uploaded=await admin.storage.from(targetBucket).upload(targetPath,bytes,{contentType:verified,upsert:false,cacheControl:"300"})
      if(uploaded.error) throw new Error("Could not promote verified file")
      const now=new Date().toISOString()
      const upd=await admin.from("collaboration_file_versions").update({verified_mime:verified,sha256:digest,scan_status:"clean",scan_provider:scanResult.provider,scan_details:scanResult.details,storage_bucket:targetBucket,storage_path:targetPath,promoted_at:now}).eq("id",versionId).eq("file_id",fileId)
      if(upd.error) throw upd.error
      await admin.from("collaboration_files").update({current_version_id:versionId,updated_at:now}).eq("id",fileId)
      await admin.from("collaboration_file_access_events").insert({file_id:fileId,version_id:versionId,actor_id:userData.user.id,action:"upload_verified",metadata:{mime:verified,sha256:digest}})
      await admin.storage.from(QUARANTINE).remove([version.quarantine_path])
      return json(200,{ok:true,file_id:fileId,version_id:versionId,mime:verified,sha256:digest})
    }

    return json(400,{error:"Unknown action."})
  } catch(error) {
    console.error("collaboration-file-ingest",error)
    return json(500,{error:error instanceof Error ? error.message : "File security processing failed."})
  }
})
