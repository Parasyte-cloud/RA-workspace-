import type { GatewayConfig } from './config.js'

export type AuthorizedEngineer = {
  id:string
  email:string
  role:'engineer'|'admin'
}

export class AuthorizationError extends Error{}

type FetchLike = typeof fetch

async function responseJson(
  response:Response
):Promise<unknown>{
  try{
    return await response.json()
  }catch{
    return null
  }
}

export async function authorizeEngineer(
  accessToken:string,
  config:Pick<
    GatewayConfig,
    'supabaseUrl'|'supabaseAnonKey'|'authTimeoutMs'
  >,
  fetcher:FetchLike=fetch
):Promise<AuthorizedEngineer>{
  const controller=new AbortController()
  const timeout=setTimeout(
    ()=>controller.abort(),
    config.authTimeoutMs
  )

  const headers={
    apikey:config.supabaseAnonKey,
    authorization:`Bearer ${accessToken}`
  }

  try{
    const userResponse=await fetcher(
      `${config.supabaseUrl}/auth/v1/user`,
      {
        method:'GET',
        headers,
        signal:controller.signal
      }
    )

    const user=await responseJson(userResponse) as {
      id?:unknown
      email?:unknown
    }|null

    if(
      !userResponse.ok ||
      typeof user?.id!=='string' ||
      typeof user.email!=='string'
    ){
      throw new AuthorizationError('Authentication failed')
    }

    const roleResponse=await fetcher(
      `${config.supabaseUrl}/rest/v1/rpc/authorize_parasyte_linux`,
      {
        method:'POST',
        headers:{
          ...headers,
          'content-type':'application/json'
        },
        body:'{}',
        signal:controller.signal
      }
    )

    const rolePayload=await responseJson(roleResponse)
    const rows=Array.isArray(rolePayload)
      ? rolePayload
      : rolePayload
        ? [rolePayload]
        : []

    const authorization=rows[0] as {
      user_id?:unknown
      email?:unknown
      role?:unknown
    }|undefined

    if(
      !roleResponse.ok ||
      authorization?.user_id!==user.id ||
      authorization.email!==user.email ||
      (
        authorization.role!=='engineer' &&
        authorization.role!=='admin'
      )
    ){
      throw new AuthorizationError(
        'Engineer or Administrator access is required'
      )
    }

    return {
      id:user.id,
      email:user.email,
      role:authorization.role
    }
  }catch(error){
    if(error instanceof AuthorizationError){
      throw error
    }

    throw new AuthorizationError('Authentication service unavailable')
  }finally{
    clearTimeout(timeout)
  }
}
