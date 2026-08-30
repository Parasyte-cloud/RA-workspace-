import { supabase } from './supabase'

export async function invokeWorkspaceAdmin(payload:Record<string,unknown>){
  if(!supabase){
    throw new Error('Supabase is not configured.')
  }

  const {data:{session},error}=await supabase.auth.getSession()
  if(error || !session?.access_token){
    throw new Error('Your administrator session has expired. Sign in again.')
  }

  const endpoint=`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workspace-user-admin`
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':`Bearer ${session.access_token}`,
      'apikey':import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body:JSON.stringify(payload),
  })

  let result:any=null
  try{result=await response.json()}catch{result=null}

  if(!response.ok || result?.error){
    throw new Error(result?.error || result?.message || `Administrator request failed (${response.status}).`)
  }

  return result
}
