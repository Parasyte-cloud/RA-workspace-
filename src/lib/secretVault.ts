import { supabase } from './supabase'
export type VaultItem={id:string;owner_id:string;label:string;kind:'text'|'number'|'document';classification:string;mime_type:string|null;original_filename:string|null;byte_size:number|null;last_four:string|null;reveal_max_seconds:number;created_at:string;updated_at:string}
const toBase64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
export async function vaultCall<T>(body:Record<string,unknown>):Promise<T>{
  if(!supabase) throw new Error('Supabase unavailable')
  const {data:{session}}=await supabase.auth.getSession(); if(!session) throw new Error('Sign in required')
  const {data,error}=await supabase.functions.invoke('secret-vault',{body,headers:{Authorization:`Bearer ${session.access_token}`}})
  if(error) throw error; if(data?.error) throw new Error(data.error); return data as T
}
export const listVault=()=>vaultCall<{items:VaultItem[]}>({action:'list'})
export const createTextSecret=(input:{label:string;value:string;kind:'text'|'number';classification:string;reveal_max_seconds:number;last_four?:string})=>vaultCall<{id:string}>({action:'create',...input,value_base64:toBase64(new TextEncoder().encode(input.value))})
export async function createDocumentSecret(input:{label:string;file:File;classification:string;reveal_max_seconds:number}){const bytes=new Uint8Array(await input.file.arrayBuffer());return vaultCall<{id:string}>({action:'create',label:input.label,kind:'document',classification:input.classification,reveal_max_seconds:input.reveal_max_seconds,mime_type:input.file.type||'application/octet-stream',original_filename:input.file.name,value_base64:toBase64(bytes)})}
export const authorizeReveal=(item_id:string,seconds:number,purpose:string)=>vaultCall<{token:string;expires_at:string;seconds:number}>({action:'authorize_reveal',item_id,seconds,purpose})
export const readReveal=(item_id:string,token:string)=>vaultCall<{value_base64:string;kind:string;mime_type:string|null;original_filename:string|null;expires_at:string}>({action:'read',item_id,token})
export const hideReveal=(token:string)=>vaultCall<{ok:boolean}>({action:'hide',token})
export const deleteVaultItem=(item_id:string)=>vaultCall<{ok:boolean}>({action:'delete',item_id})
export const decodeBase64=(v:string)=>{const s=atob(v);const out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out}
