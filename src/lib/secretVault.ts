import { supabase } from './supabase'
export type VaultItem={id:string;owner_id:string;label:string;kind:'text'|'number'|'document';classification:string;mime_type:string|null;original_filename:string|null;byte_size:number|null;last_four:string|null;reveal_max_seconds:number;created_at:string;updated_at:string}
const toBase64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
export async function vaultCall<T>(body:Record<string,unknown>):Promise<T>{
  if(!supabase) throw new Error('Supabase unavailable')
  const {data:{session}}=await supabase.auth.getSession(); if(!session) throw new Error('Sign in required')
  const {data,error}=await supabase.functions.invoke('secret-vault',{body,headers:{Authorization:`Bearer ${session.access_token}`}})
  if(error){const message=await serverMessage(error); throw message?new Error(message):error}
  if(data?.error) throw new Error(data.error); return data as T
}
// A non-2xx answer arrives as a generic "Edge Function returned a non-2xx
// status code". The real reason (file too large, not allowed) is in the body.
async function serverMessage(error:unknown):Promise<string|null>{
  const response=(error as {context?:Response}|null)?.context
  if(!response||typeof response.json!=='function') return null
  try{const body=await response.json();return typeof body?.error==='string'&&body.error?body.error:null}catch{return null}
}
export const MAX_VAULT_FILE_BYTES=15*1024*1024
export const listVault=()=>vaultCall<{items:VaultItem[]}>({action:'list'})
export const createTextSecret=(input:{label:string;value:string;kind:'text'|'number';classification:string;reveal_max_seconds:number;last_four?:string})=>vaultCall<{id:string}>({action:'create',...input,value_base64:toBase64(new TextEncoder().encode(input.value))})
export async function createDocumentSecret(input:{label:string;file:File;classification:string;reveal_max_seconds:number}){const bytes=new Uint8Array(await input.file.arrayBuffer());return vaultCall<{id:string}>({action:'create',label:input.label,kind:'document',classification:input.classification,reveal_max_seconds:input.reveal_max_seconds,mime_type:input.file.type||'application/octet-stream',original_filename:input.file.name,value_base64:toBase64(bytes)})}
export const authorizeReveal=(item_id:string,seconds:number,purpose:string)=>vaultCall<{token:string;expires_at:string;seconds:number}>({action:'authorize_reveal',item_id,seconds,purpose})
export const readReveal=(item_id:string,token:string)=>vaultCall<{value_base64:string;kind:string;mime_type:string|null;original_filename:string|null;expires_at:string}>({action:'read',item_id,token})
export const hideReveal=(token:string)=>vaultCall<{ok:boolean}>({action:'hide',token})
export const deleteVaultItem=(item_id:string)=>vaultCall<{ok:boolean}>({action:'delete',item_id})
export const decodeBase64=(v:string)=>{const s=atob(v);const out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out}

// What a revealed document may be shown as. The stored mime type was chosen by
// whoever uploaded the file, and a blob: URL runs with the WORKSPACE's own
// origin. An uploaded "text/html" file shown in an iframe would run its script
// next to the signed-in session. So the type is decided here from a short
// allowlist AND the file's first bytes, and the blob is always built with that
// type, never the stored one. Anything else is not previewed.
export type VaultPreview =
  | { kind: 'pdf'; type: 'application/pdf' }
  | { kind: 'image'; type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' }
  | { kind: 'text'; type: 'text/plain' }
  | { kind: 'none' }
const startsWith=(bytes:Uint8Array,sig:number[],at=0)=>sig.every((b,i)=>bytes[at+i]===b)
export function vaultPreview(bytes:Uint8Array,declaredMime:string|null):VaultPreview{
  const mime=(declaredMime||'').toLowerCase().split(';')[0].trim()
  if(mime==='application/pdf'&&startsWith(bytes,[0x25,0x50,0x44,0x46,0x2d])) return {kind:'pdf',type:'application/pdf'}
  if(mime==='image/png'&&startsWith(bytes,[0x89,0x50,0x4e,0x47])) return {kind:'image',type:'image/png'}
  if(mime==='image/jpeg'&&startsWith(bytes,[0xff,0xd8,0xff])) return {kind:'image',type:'image/jpeg'}
  if(mime==='image/gif'&&startsWith(bytes,[0x47,0x49,0x46,0x38])) return {kind:'image',type:'image/gif'}
  if(mime==='image/webp'&&startsWith(bytes,[0x52,0x49,0x46,0x46])&&startsWith(bytes,[0x57,0x45,0x42,0x50],8)) return {kind:'image',type:'image/webp'}
  if(mime==='text/plain') return {kind:'text',type:'text/plain'}
  return {kind:'none'}
}
