export type GatewayConfig = {
  bindHost:string
  port:number
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

  return {
    bindHost:env.PARASYTE_BIND_HOST?.trim() || '127.0.0.1',
    port:integer(env,'PARASYTE_PORT',8787,1,65535),
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
    )
  }
}
