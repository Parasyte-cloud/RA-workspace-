import { createPrivateKey } from 'node:crypto'

export type GatewayConfig = {
  bindHost:string
  port:number
  publicOrigin:string
  allowedOrigins:Set<string>
  supabaseUrl:string
  supabaseAnonKey:string
  dockerSocket:string
  toolingImage:string
  containerNetworkPrefix:string
  containerMemoryBytes:number
  containerNanoCpus:number
  containerPids:number
  idleStopMs:number
  sessionMaxMs:number
  authTimeoutMs:number
  maxMessageBytes:number
  ideSessionMaxMs:number
  githubOrg:string
  githubAppId:string|null
  githubInstallationId:string|null
  githubPrivateKey:string|null
}

function required(
  env:NodeJS.ProcessEnv,
  name:string
):string{
  const value=env[name]?.trim()

  if(!value){
    throw new Error(`${name} is required`)
  }

  return value
}

function integer(
  env:NodeJS.ProcessEnv,
  name:string,
  fallback:number,
  minimum:number,
  maximum:number
):number{
  const raw=env[name]?.trim()
  const value=raw ? Number(raw) : fallback

  if(
    !Number.isInteger(value) ||
    value<minimum ||
    value>maximum
  ){
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`
    )
  }

  return value
}

function decimal(
  env:NodeJS.ProcessEnv,
  name:string,
  fallback:number,
  minimum:number,
  maximum:number
):number{
  const raw=env[name]?.trim()
  const value=raw ? Number(raw) : fallback

  if(
    !Number.isFinite(value) ||
    value<minimum ||
    value>maximum
  ){
    throw new Error(
      `${name} must be between ${minimum} and ${maximum}`
    )
  }

  return value
}

function origin(
  value:string,
  name:string
):string{
  let parsed:URL

  try{
    parsed=new URL(value)
  }catch{
    throw new Error(`${name} must be a valid URL origin`)
  }

  if(
    parsed.protocol!=='https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname!=='/' ||
    parsed.search ||
    parsed.hash
  ){
    throw new Error(`${name} must be an HTTPS origin without a path`)
  }

  return parsed.origin
}

function optionalPrivateKey(
  env:NodeJS.ProcessEnv
):string|null{
  const encoded=env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim()

  if(!encoded){
    return null
  }

  let decoded:string

  try{
    decoded=Buffer.from(encoded,'base64').toString('utf8')
  }catch{
    throw new Error('GITHUB_APP_PRIVATE_KEY_BASE64 must contain base64 data')
  }

  try{
    const key=createPrivateKey(decoded)
    if(key.asymmetricKeyType!=='rsa'){
      throw new Error('GitHub App private key must be RSA')
    }
  }catch{
    throw new Error('GITHUB_APP_PRIVATE_KEY_BASE64 is not a valid RSA PEM private key')
  }

  return decoded
}

export function loadConfig(
  env:NodeJS.ProcessEnv=process.env
):GatewayConfig{
  const supabaseUrl=required(env,'SUPABASE_URL')
    .replace(/\/+$/,'')

  const origins=required(
    env,
    'PARASYTE_ALLOWED_ORIGINS'
  )
    .split(',')
    .map(value=>value.trim().replace(/\/$/,''))
    .filter(Boolean)

  if(!origins.length){
    throw new Error(
      'PARASYTE_ALLOWED_ORIGINS must contain at least one origin'
    )
  }

  for(const allowed of origins){
    origin(allowed,'PARASYTE_ALLOWED_ORIGINS')
  }

  const memoryMb=integer(
    env,
    'PARASYTE_CONTAINER_MEMORY_MB',
    2048,
    512,
    16384
  )

  const cpus=decimal(
    env,
    'PARASYTE_CONTAINER_CPUS',
    2,
    .25,
    8
  )

  const networkPrefix=
    env.PARASYTE_CONTAINER_NETWORK_PREFIX?.trim() ||
    'parasyte-engineer'

  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}$/.test(networkPrefix)){
    throw new Error(
      'PARASYTE_CONTAINER_NETWORK_PREFIX contains invalid characters'
    )
  }

  const dockerSocket=required(
    env,
    'PARASYTE_DOCKER_SOCKET'
  )

  if(dockerSocket==='/var/run/docker.sock'){
    throw new Error(
      'PARASYTE_DOCKER_SOCKET must point to the dedicated rootless Docker daemon'
    )
  }

  const githubAppId=env.GITHUB_APP_ID?.trim() || null
  const githubInstallationId=
    env.GITHUB_APP_INSTALLATION_ID?.trim() || null
  const githubOrg=env.GITHUB_ORG?.trim() || 'Parasyte-cloud'

  if(githubAppId && !/^\d+$/.test(githubAppId)){
    throw new Error('GITHUB_APP_ID must be numeric')
  }

  if(githubInstallationId && !/^\d+$/.test(githubInstallationId)){
    throw new Error('GITHUB_APP_INSTALLATION_ID must be numeric')
  }

  if(!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(githubOrg)){
    throw new Error('GITHUB_ORG is not a valid GitHub organization name')
  }

  const githubPrivateKey=optionalPrivateKey(env)
  const githubConfiguredCount=[
    githubAppId,
    githubInstallationId,
    githubPrivateKey
  ].filter(Boolean).length

  if(githubConfiguredCount!==0 && githubConfiguredCount!==3){
    throw new Error(
      'GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID and GITHUB_APP_PRIVATE_KEY_BASE64 must be configured together'
    )
  }

  return {
    bindHost:env.PARASYTE_BIND_HOST?.trim() || '127.0.0.1',
    port:integer(env,'PARASYTE_PORT',8787,1,65535),
    publicOrigin:origin(
      env.PARASYTE_PUBLIC_ORIGIN?.trim() ||
        'https://linux.ridearrivo.com',
      'PARASYTE_PUBLIC_ORIGIN'
    ),
    allowedOrigins:new Set(origins),
    supabaseUrl,
    supabaseAnonKey:required(env,'SUPABASE_ANON_KEY'),
    dockerSocket,
    toolingImage:
      env.PARASYTE_TOOLING_IMAGE?.trim() ||
      'parasyte-linux-tooling:1.0.0',
    containerNetworkPrefix:networkPrefix,
    containerMemoryBytes:memoryMb*1024*1024,
    containerNanoCpus:Math.round(cpus*1_000_000_000),
    containerPids:integer(
      env,
      'PARASYTE_CONTAINER_PIDS',
      512,
      64,
      4096
    ),
    idleStopMs:integer(
      env,
      'PARASYTE_IDLE_STOP_SECONDS',
      900,
      30,
      86400
    )*1000,
    sessionMaxMs:integer(
      env,
      'PARASYTE_SESSION_MAX_SECONDS',
      3600,
      300,
      28800
    )*1000,
    authTimeoutMs:integer(
      env,
      'PARASYTE_AUTH_TIMEOUT_MS',
      10000,
      2000,
      30000
    ),
    maxMessageBytes:integer(
      env,
      'PARASYTE_MAX_MESSAGE_BYTES',
      65536,
      4096,
      1048576
    ),
    ideSessionMaxMs:integer(
      env,
      'PARASYTE_IDE_SESSION_SECONDS',
      3600,
      300,
      28800
    )*1000,
    githubOrg,
    githubAppId,
    githubInstallationId,
    githubPrivateKey
  }
}
