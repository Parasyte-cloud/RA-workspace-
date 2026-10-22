import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={
  'Access-Control-Allow-Origin': Deno.env.get('WORKSPACE_ORIGIN') || 'https://intranet.ridearrivo.com',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Cache-Control':'no-store, private, max-age=0',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const b64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
const unb64=(value:string)=>{const s=atob(value);const out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out}
const hex=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('')
const keyPromise=async()=>{
  const raw=Deno.env.get('RA_SECRET_VAULT_MASTER_KEY')||''
  const bytes=unb64(raw)
  if(bytes.byteLength!==32) throw new Error('Vault master key is not configured')
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt'])
}
const encrypt=async(bytes:Uint8Array,aad:string)=>{
  const iv=crypto.getRandomValues(new Uint8Array(12)); const key=await keyPromise()
  const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},key,bytes))
  return {ciphertext:data,iv}
}
const decrypt=async(ciphertext:Uint8Array,iv:Uint8Array,aad:string)=>{
  const key=await keyPromise(); return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},key,ciphertext))
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors})
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')!; const anon=Deno.env.get('SUPABASE_ANON_KEY')!; const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const auth=req.headers.get('Authorization')||''
    if(!auth.startsWith('Bearer ')) return json({error:'Authentication required'},401)
    const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}})
    const admin=createClient(url,service,{auth:{persistSession:false}})
    const {data:{user},error:userError}=await userClient.auth.getUser()
    if(userError||!user) return json({error:'Authentication required'},401)
    const {data:profile}=await userClient.from('employee_profiles').select('id,active').eq('id',user.id).maybeSingle()
    if(!profile?.active) return json({error:'Active employee required'},403)
    const body=await req.json(); const action=String(body?.action||'')

    if(action==='list'){
      const {data,error}=await userClient.from('secret_vault_items').select('id,owner_id,label,kind,classification,mime_type,original_filename,byte_size,last_four,reveal_max_seconds,owner_approval_for_others,created_at,updated_at').order('updated_at',{ascending:false})
      if(error) throw error; return json({items:data||[]})
    }

    if(action==='create'){
      const label=String(body.label||'').trim(); const kind=String(body.kind||'text'); const value=String(body.value_base64||'')
      const bytes=unb64(value); if(!label||!['text','number','document'].includes(kind)) return json({error:'Invalid vault item'},400)
      if(bytes.byteLength===0||bytes.byteLength>15*1024*1024) return json({error:'Vault item must be between 1 byte and 15 MB'},400)
      const max=Math.max(5,Math.min(600,Number(body.reveal_max_seconds||60)))
      const itemId=crypto.randomUUID()
      const aad=`ra-vault:${itemId}:${user.id}:v1`
      const enc=await encrypt(bytes,aad)

      const {data:createdId,error:createError}=await admin.rpc('vault_create_encrypted_item',{
        target_item:itemId,
        target_owner:user.id,
        item_label:label,
        item_kind:kind,
        item_classification:body.classification||'restricted',
        item_mime_type:body.mime_type||null,
        item_original_filename:body.original_filename||null,
        item_byte_size:bytes.byteLength,
        item_last_four:body.last_four||null,
        item_reveal_max_seconds:max,
        item_owner_approval_for_others:body.owner_approval_for_others!==false,
        ciphertext_base64:b64(enc.ciphertext),
        iv_base64:b64(enc.iv),
        payload_aad:aad,
      })

      if(createError||!createdId) throw createError||new Error('Unable to create encrypted Vault item')

      await admin.from('secret_vault_audit_events').insert({
        item_id:createdId,
        actor_id:user.id,
        event_type:'created',
        metadata:{kind,byte_size:bytes.byteLength},
      })

      return json({id:createdId})
    }

    if(action==='authorize_reveal'){
      const itemId=String(body.item_id||''); const purpose=String(body.purpose||'').trim(); const requested=Math.max(5,Math.min(600,Number(body.seconds||30)))
      if(purpose.length<3) return json({error:'Reveal purpose is required'},400)
      const {data:item,error}=await userClient.from('secret_vault_items').select('id,reveal_max_seconds').eq('id',itemId).maybeSingle(); if(error||!item) return json({error:'Vault item not accessible'},403)
      const seconds=Math.min(requested,item.reveal_max_seconds); const token=b64(crypto.getRandomValues(new Uint8Array(32))); const tokenHash=await hex(new TextEncoder().encode(token)); const expires=new Date(Date.now()+seconds*1000).toISOString()
      const {error:sessionError}=await admin.from('secret_vault_reveal_sessions').insert({item_id:itemId,employee_id:user.id,token_hash:tokenHash,purpose,expires_at:expires}); if(sessionError) throw sessionError
      await admin.from('secret_vault_audit_events').insert({item_id:itemId,actor_id:user.id,event_type:'reveal_authorized',metadata:{seconds,purpose}})
      return json({token,expires_at:expires,seconds})
    }

    if(action==='read'){
      const token=String(body.token||''); const itemId=String(body.item_id||''); if(!token||!itemId) return json({error:'Reveal token required'},400)
      const tokenHash=await hex(new TextEncoder().encode(token));
      const {data:session}=await admin.from('secret_vault_reveal_sessions').select('id,employee_id,expires_at,revoked_at').eq('item_id',itemId).eq('token_hash',tokenHash).maybeSingle()
      if(!session||session.employee_id!==user.id||session.revoked_at||new Date(session.expires_at).getTime()<=Date.now()) return json({error:'Reveal authorization expired'},403)
      const {data:allowed}=await userClient.rpc('can_access_secret_vault_item',{target_item:itemId,need_manage:false}); if(!allowed) return json({error:'Vault item not accessible'},403)
      const {data:item}=await userClient.from('secret_vault_items').select('kind,mime_type,original_filename').eq('id',itemId).single()
      const {data:payload,error}=await admin.rpc('vault_read_encrypted_payload',{target_item:itemId}).single(); if(error||!payload) throw error||new Error('Encrypted payload missing')
      const plain=await decrypt(unb64(payload.ciphertext_base64),unb64(payload.iv_base64),payload.aad)
      await admin.from('secret_vault_reveal_sessions').update({last_used_at:new Date().toISOString(),use_count:1}).eq('id',session.id)
      await admin.from('secret_vault_audit_events').insert({item_id:itemId,actor_id:user.id,event_type:'revealed',metadata:{}})
      return json({value_base64:b64(plain),kind:item?.kind,mime_type:item?.mime_type,original_filename:item?.original_filename,expires_at:session.expires_at})
    }

    if(action==='hide'){
      const token=String(body.token||''); if(token){const tokenHash=await hex(new TextEncoder().encode(token));await admin.from('secret_vault_reveal_sessions').update({revoked_at:new Date().toISOString()}).eq('employee_id',user.id).eq('token_hash',tokenHash)}
      return json({ok:true})
    }

    if(action==='delete'){
      const itemId=String(body.item_id||''); const {data:allowed}=await userClient.rpc('can_access_secret_vault_item',{target_item:itemId,need_manage:true}); if(!allowed) return json({error:'Vault management permission required'},403)
      await admin.from('secret_vault_audit_events').insert({item_id:itemId,actor_id:user.id,event_type:'deleted',metadata:{}})
      const {error}=await admin.from('secret_vault_items').delete().eq('id',itemId); if(error) throw error; return json({ok:true})
    }

    return json({error:'Unknown action'},400)
  }catch(error){console.error('[secret-vault]',error);return json({error:'Vault operation failed'},500)}
})
