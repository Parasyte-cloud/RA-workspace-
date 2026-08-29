import { randomBytes, randomUUID } from 'node:crypto'
import http from 'node:http'
import type { Duplex } from 'node:stream'

import {
  WebSocket,
  WebSocketServer
} from 'ws'

import {
  AuthorizationError,
  authorizeEngineer,
  type AuthorizedEngineer
} from './auth.js'
import { loadConfig } from './config.js'
import {
  EngineerContainerManager,
  type IdeEndpoint,
  type ShellHandle
} from './container.js'
import {
  getGitHubRepositorySummary,
  githubStatus,
  listGitHubRepositories
} from './github.js'
import {
  ProtocolError,
  parseClientMessage
} from './protocol.js'

const config=loadConfig()
const containers=new EngineerContainerManager(config)
const activeUsers=new Map<string,WebSocket>()
const upgradeAttempts=new Map<string,{count:number;resetAt:number}>()
const responsiveSockets=new WeakSet<WebSocket>()

const IDE_COOKIE='parasyte_ide'

type IdeSession={
  token:string
  userId:string
  endpoint:IdeEndpoint
  expiresAt:number
}

const ideSessions=new Map<string,IdeSession>()
const ideSessionByUser=new Map<string,string>()

function send(
  socket:WebSocket,
  payload:Record<string,unknown>
){
  if(socket.readyState===WebSocket.OPEN){
    socket.send(JSON.stringify(payload))
  }
}

function rejectUpgrade(
  socket:NodeJS.WritableStream,
  status:number,
  message:string
){
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\n`+
    'Connection: close\r\n'+
    'Content-Type: text/plain\r\n'+
    `Content-Length: ${Buffer.byteLength(message)}\r\n`+
    '\r\n'+
    message
  )
  socket.end()
}

function requestIp(request:http.IncomingMessage):string{
  const forwarded=request.headers['x-forwarded-for']

  if(typeof forwarded==='string'){
    return forwarded.split(',')[0]?.trim() || 'unknown'
  }

  return request.socket.remoteAddress || 'unknown'
}

function rateLimited(ip:string):boolean{
  const now=Date.now()

  if(upgradeAttempts.size>10_000){
    for(const [key,value] of upgradeAttempts){
      if(value.resetAt<=now){
        upgradeAttempts.delete(key)
      }
    }
  }

  const current=upgradeAttempts.get(ip)

  if(!current || current.resetAt<=now){
    upgradeAttempts.set(ip,{
      count:1,
      resetAt:now+60_000
    })
    return false
  }

  current.count+=1
  return current.count>60
}

function requestOrigin(request:http.IncomingMessage):string|null{
  const origin=request.headers.origin?.replace(/\/$/,'')
  return origin && config.allowedOrigins.has(origin)
    ? origin
    : null
}

function applyApiCors(
  response:http.ServerResponse,
  origin:string
){
  response.setHeader('access-control-allow-origin',origin)
  response.setHeader('access-control-allow-credentials','true')
  response.setHeader('access-control-allow-methods','GET,POST,DELETE,OPTIONS')
  response.setHeader('access-control-allow-headers','authorization,content-type')
  response.setHeader('vary','Origin')
}

function json(
  response:http.ServerResponse,
  status:number,
  payload:Record<string,unknown>,
  origin?:string|null
){
  if(origin){
    applyApiCors(response,origin)
  }

  response.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  })
  response.end(JSON.stringify(payload))
}

async function authorizeHttp(
  request:http.IncomingMessage
):Promise<AuthorizedEngineer>{
  const header=request.headers.authorization

  if(!header?.startsWith('Bearer ')){
    throw new AuthorizationError('Authentication required')
  }

  const token=header.slice(7).trim()

  if(!token){
    throw new AuthorizationError('Authentication required')
  }

  return authorizeEngineer(token,config)
}

function cookieValue(
  request:http.IncomingMessage,
  name:string
):string|null{
  const header=request.headers.cookie
  if(!header) return null

  for(const part of header.split(';')){
    const [key,...rest]=part.trim().split('=')
    if(key===name){
      return decodeURIComponent(rest.join('='))
    }
  }

  return null
}

function setIdeCookie(
  response:http.ServerResponse,
  token:string,
  expiresAt:number
){
  const maxAge=Math.max(
    1,
    Math.floor((expiresAt-Date.now())/1000)
  )

  response.setHeader(
    'set-cookie',
    `${IDE_COOKIE}=${encodeURIComponent(token)}; Path=/ide/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
  )
}

function clearIdeCookie(response:http.ServerResponse){
  response.setHeader(
    'set-cookie',
    `${IDE_COOKIE}=; Path=/ide/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
  )
}

async function releaseIdeSession(session:IdeSession){
  ideSessions.delete(session.token)

  if(ideSessionByUser.get(session.userId)===session.token){
    ideSessionByUser.delete(session.userId)
  }

  await containers.releaseIde(session.userId)
}

function validIdeSession(
  request:http.IncomingMessage
):IdeSession|null{
  const token=cookieValue(request,IDE_COOKIE)
  if(!token) return null

  const session=ideSessions.get(token)

  if(!session) return null

  if(session.expiresAt<=Date.now()){
    void releaseIdeSession(session)
    return null
  }

  return session
}

function sleep(ms:number){
  return new Promise(resolve=>setTimeout(resolve,ms))
}

async function ideHealthy(endpoint:IdeEndpoint):Promise<boolean>{
  return new Promise(resolve=>{
    const request=http.get({
      host:endpoint.host,
      port:endpoint.port,
      path:'/healthz',
      timeout:900
    },response=>{
      response.resume()
      resolve(Boolean(response.statusCode && response.statusCode<500))
    })

    request.once('timeout',()=>{
      request.destroy()
      resolve(false)
    })
    request.once('error',()=>resolve(false))
  })
}

async function waitForIde(endpoint:IdeEndpoint):Promise<void>{
  for(let attempt=0;attempt<50;attempt+=1){
    if(await ideHealthy(endpoint)){
      return
    }
    await sleep(200)
  }

  throw new Error('The engineering IDE did not become ready in time')
}

async function createOrRefreshIdeSession(
  engineer:AuthorizedEngineer
):Promise<IdeSession>{
  const existingToken=ideSessionByUser.get(engineer.id)
  const existing=existingToken
    ? ideSessions.get(existingToken)
    : null

  if(existing && existing.expiresAt>Date.now()){
    if(await ideHealthy(existing.endpoint)){
      existing.expiresAt=Date.now()+config.ideSessionMaxMs
      return existing
    }
    await releaseIdeSession(existing)
  }else if(existing){
    await releaseIdeSession(existing)
  }

  const endpoint=await containers.acquireIde(engineer.id)

  try{
    await waitForIde(endpoint)
  }catch(error){
    await containers.releaseIde(engineer.id)
    throw error
  }

  const session:IdeSession={
    token:randomBytes(32).toString('base64url'),
    userId:engineer.id,
    endpoint,
    expiresAt:Date.now()+config.ideSessionMaxMs
  }

  ideSessions.set(session.token,session)
  ideSessionByUser.set(engineer.id,session.token)

  return session
}

function ideTargetPath(rawUrl:string|undefined):string{
  const url=new URL(rawUrl || '/ide/','http://gateway.internal')
  const withoutPrefix=url.pathname.startsWith('/ide')
    ? url.pathname.slice('/ide'.length)
    : url.pathname
  const path=withoutPrefix || '/'
  return `${path.startsWith('/') ? path : `/${path}`}${url.search}`
}

function rewriteIdeLocation(
  value:string,
  endpoint:IdeEndpoint
):string{
  if(value.startsWith('/')){
    return `/ide${value}`
  }

  const localOrigin=`http://${endpoint.host}:${endpoint.port}`

  if(value.startsWith(localOrigin)){
    return `${config.publicOrigin}/ide${value.slice(localOrigin.length)}`
  }

  return value
}

function frameAncestorsPolicy(value:string|undefined):string{
  const ancestors=Array.from(config.allowedOrigins).join(' ')
  const directive=`frame-ancestors ${ancestors}`

  if(!value){
    return directive
  }

  if(/(^|;)\s*frame-ancestors\s+[^;]*/i.test(value)){
    return value.replace(
      /(^|;)\s*frame-ancestors\s+[^;]*/i,
      match=>`${match.startsWith(';')?'; ':''}${directive}`
    )
  }

  return `${value.replace(/;?\s*$/,'')}; ${directive}`
}

function proxyIdeHttp(
  request:http.IncomingMessage,
  response:http.ServerResponse,
  session:IdeSession
){
  const headers={...request.headers}
  delete headers.cookie
  delete headers.authorization
  delete headers['content-length']
  headers.host=`${session.endpoint.host}:${session.endpoint.port}`
  headers['x-forwarded-host']=new URL(config.publicOrigin).host
  headers['x-forwarded-proto']='https'
  headers['x-forwarded-prefix']='/ide'

  const upstream=http.request({
    host:session.endpoint.host,
    port:session.endpoint.port,
    method:request.method,
    path:ideTargetPath(request.url),
    headers
  },upstreamResponse=>{
    const responseHeaders={...upstreamResponse.headers}
    delete responseHeaders['set-cookie']
    delete responseHeaders['x-frame-options']

    const location=responseHeaders.location
    if(typeof location==='string'){
      responseHeaders.location=rewriteIdeLocation(
        location,
        session.endpoint
      )
    }

    const csp=responseHeaders['content-security-policy']
    responseHeaders['content-security-policy']=frameAncestorsPolicy(
      Array.isArray(csp) ? csp.join('; ') : csp
    )
    responseHeaders['x-content-type-options']='nosniff'
    responseHeaders['referrer-policy']='no-referrer'

    response.writeHead(
      upstreamResponse.statusCode || 502,
      responseHeaders
    )
    upstreamResponse.pipe(response)
  })

  upstream.once('error',error=>{
    console.error('[IDE HTTP proxy]',error)

    if(!response.headersSent){
      response.writeHead(502,{
        'content-type':'text/plain; charset=utf-8',
        'cache-control':'no-store'
      })
    }

    response.end('Engineering IDE unavailable')
  })

  request.pipe(upstream)
}

async function handleApi(
  request:http.IncomingMessage,
  response:http.ServerResponse
):Promise<boolean>{
  const url=new URL(request.url || '/','http://gateway.internal')

  if(!url.pathname.startsWith('/api/')){
    return false
  }

  const origin=requestOrigin(request)

  if(request.method==='OPTIONS'){
    if(!origin){
      json(response,403,{error:'forbidden'})
      return true
    }

    applyApiCors(response,origin)
    response.writeHead(204,{
      'cache-control':'no-store'
    })
    response.end()
    return true
  }

  if(!origin){
    json(response,403,{error:'forbidden'})
    return true
  }

  if(rateLimited(requestIp(request))){
    json(response,429,{error:'rate_limited'},origin)
    return true
  }

  let engineer:AuthorizedEngineer

  try{
    engineer=await authorizeHttp(request)
  }catch(error){
    const message=error instanceof AuthorizationError
      ? error.message
      : 'Authentication failed'
    json(response,401,{error:'unauthorized',message},origin)
    return true
  }

  try{
    if(request.method==='POST' && url.pathname==='/api/ide/session'){
      const session=await createOrRefreshIdeSession(engineer)
      setIdeCookie(response,session.token,session.expiresAt)
      json(response,200,{
        url:`${config.publicOrigin}/ide/`,
        expiresAt:new Date(session.expiresAt).toISOString()
      },origin)
      return true
    }

    if(request.method==='DELETE' && url.pathname==='/api/ide/session'){
      const token=ideSessionByUser.get(engineer.id)
      const session=token ? ideSessions.get(token) : null
      if(session){
        await releaseIdeSession(session)
      }
      clearIdeCookie(response)
      json(response,200,{stopped:true},origin)
      return true
    }

    if(request.method==='GET' && url.pathname==='/api/github/status'){
      json(response,200,githubStatus(config),origin)
      return true
    }

    if(request.method==='GET' && url.pathname==='/api/github/repositories'){
      const repositories=await listGitHubRepositories(config)
      json(response,200,{repositories},origin)
      return true
    }

    if(request.method==='GET' && url.pathname==='/api/github/repository'){
      const name=url.searchParams.get('name') || ''
      const summary=await getGitHubRepositorySummary(config,name)
      json(response,200,summary,origin)
      return true
    }

    json(response,404,{error:'not_found'},origin)
    return true
  }catch(error){
    console.error('[gateway API]',error)
    json(response,503,{
      error:'service_unavailable',
      message:error instanceof Error
        ? error.message
        : 'Engineering service unavailable'
    },origin)
    return true
  }
}

const server=http.createServer((request,response)=>{
  void (async()=>{
    if(request.method==='GET' && request.url==='/health'){
      response.writeHead(200,{
        'content-type':'application/json',
        'cache-control':'no-store',
        'x-content-type-options':'nosniff'
      })
      response.end(JSON.stringify({status:'ok'}))
      return
    }

    if(await handleApi(request,response)){
      return
    }

    if(request.url?.startsWith('/ide/')){
      const method=(request.method || 'GET').toUpperCase()
      if(
        method!=='GET' &&
        method!=='HEAD' &&
        request.headers.origin?.replace(/\/$/,'')!==config.publicOrigin
      ){
        response.writeHead(403,{
          'content-type':'text/plain; charset=utf-8',
          'cache-control':'no-store'
        })
        response.end('Forbidden')
        return
      }

      const session=validIdeSession(request)

      if(!session){
        response.writeHead(401,{
          'content-type':'text/plain; charset=utf-8',
          'cache-control':'no-store',
          'x-content-type-options':'nosniff'
        })
        response.end('Engineering IDE session required')
        return
      }

      proxyIdeHttp(request,response,session)
      return
    }

    response.writeHead(404,{
      'content-type':'application/json',
      'cache-control':'no-store'
    })
    response.end(JSON.stringify({error:'not_found'}))
  })().catch(error=>{
    console.error('[HTTP request]',error)
    if(!response.headersSent){
      response.writeHead(500,{
        'content-type':'application/json',
        'cache-control':'no-store'
      })
    }
    response.end(JSON.stringify({error:'internal_error'}))
  })
})

const webSockets=new WebSocketServer({
  noServer:true,
  maxPayload:config.maxMessageBytes,
  perMessageDeflate:false,
  clientTracking:true
})

const ideWebSockets=new WebSocketServer({
  noServer:true,
  maxPayload:16*1024*1024,
  clientTracking:false
})

function rawDataToBuffer(data:unknown):Buffer{
  if(Buffer.isBuffer(data)) return data
  if(data instanceof ArrayBuffer) return Buffer.from(data)
  if(Array.isArray(data) && data.every(Buffer.isBuffer)){
    return Buffer.concat(data as Buffer[])
  }
  if(ArrayBuffer.isView(data)){
    return Buffer.from(data.buffer,data.byteOffset,data.byteLength)
  }
  return Buffer.from(String(data))
}

function safeWebSocketCloseCode(code:number):number{
  if(code===1000 || (code>=3000 && code<=4999)) return code
  return 1011
}

function proxyIdeWebSocket(
  request:http.IncomingMessage,
  socket:Duplex,
  head:Buffer,
  session:IdeSession
){
  const requestedProtocols=
    typeof request.headers['sec-websocket-protocol']==='string'
      ? request.headers['sec-websocket-protocol']
          .split(',')
          .map(value=>value.trim())
          .filter(Boolean)
      : []

  ideWebSockets.handleUpgrade(request,socket,head,client=>{
    const targetUrl=
      `ws://${session.endpoint.host}:${session.endpoint.port}${ideTargetPath(request.url)}`
    const targetOptions={
      perMessageDeflate:false,
      headers:{
        host:`${session.endpoint.host}:${session.endpoint.port}`,
        origin:config.publicOrigin,
        'x-forwarded-host':new URL(config.publicOrigin).host,
        'x-forwarded-proto':'https',
        'x-forwarded-prefix':'/ide'
      }
    }
    const target=requestedProtocols.length
      ? new WebSocket(targetUrl,requestedProtocols,targetOptions)
      : new WebSocket(targetUrl,targetOptions)

    const pending:Array<{data:Buffer;isBinary:boolean}>=[]
    let closed=false

    const closeBoth=(code=1011,reason='IDE connection closed')=>{
      if(closed) return
      closed=true
      if(client.readyState===WebSocket.OPEN){
        client.close(code,reason)
      }
      if(target.readyState===WebSocket.OPEN){
        target.close(code,reason)
      }else if(target.readyState===WebSocket.CONNECTING){
        target.terminate()
      }
    }

    client.on('message',(data,isBinary)=>{
      const buffer=rawDataToBuffer(data)

      if(target.readyState===WebSocket.OPEN){
        target.send(buffer,{binary:isBinary})
      }else if(target.readyState===WebSocket.CONNECTING){
        if(pending.length>=128){
          closeBoth(1013,'IDE client sent data too quickly')
          return
        }
        pending.push({data:buffer,isBinary})
      }
    })

    target.on('open',()=>{
      for(const item of pending){
        target.send(item.data,{binary:item.isBinary})
      }
      pending.length=0
    })

    target.on('message',(data,isBinary)=>{
      if(client.readyState===WebSocket.OPEN){
        client.send(data,{binary:isBinary})
      }
    })

    target.once('error',error=>{
      console.error('[IDE WS upstream]',error)
      closeBoth(1011,'IDE upstream unavailable')
    })
    client.once('error',()=>closeBoth())
    target.once('close',(code,reason)=>{
      if(client.readyState===WebSocket.OPEN){
        client.close(safeWebSocketCloseCode(code),reason.toString().slice(0,120))
      }
    })
    client.once('close',(code,reason)=>{
      if(target.readyState===WebSocket.OPEN){
        target.close(safeWebSocketCloseCode(code),reason.toString().slice(0,120))
      }else if(target.readyState===WebSocket.CONNECTING){
        target.terminate()
      }
    })
  })
}

server.on('upgrade',(request,socket,head)=>{
  const url=new URL(
    request.url || '/',
    'http://gateway.internal'
  )

  if(url.pathname.startsWith('/ide/')){
    if(request.headers.origin?.replace(/\/$/,'')!==config.publicOrigin){
      rejectUpgrade(socket,403,'Forbidden')
      return
    }

    const session=validIdeSession(request)

    if(!session){
      rejectUpgrade(socket,401,'Unauthorized')
      return
    }

    if(rateLimited(requestIp(request))){
      rejectUpgrade(socket,429,'Too Many Requests')
      return
    }

    proxyIdeWebSocket(request,socket,head,session)
    return
  }

  if(url.pathname!=='/ws'){
    rejectUpgrade(socket,404,'Not Found')
    return
  }

  const origin=request.headers.origin?.replace(/\/$/,'')

  if(!origin || !config.allowedOrigins.has(origin)){
    rejectUpgrade(socket,403,'Forbidden')
    return
  }

  if(rateLimited(requestIp(request))){
    rejectUpgrade(socket,429,'Too Many Requests')
    return
  }

  webSockets.handleUpgrade(request,socket,head,client=>{
    webSockets.emit('connection',client,request)
  })
})

webSockets.on('connection',socket=>{
  let authenticated=false
  let authenticating=false
  let engineerId:string|null=null
  let shell:ShellHandle|null=null
  let closed=false

  const authenticationTimer=setTimeout(()=>{
    send(socket,{
      type:'error',
      message:'Authentication timed out.'
    })
    socket.close(4001,'Authentication timeout')
  },config.authTimeoutMs)

  const sessionTimer=setTimeout(()=>{
    send(socket,{
      type:'error',
      message:'Session limit reached. Reconnect to continue.'
    })
    socket.close(4001,'Session expired')
  },config.sessionMaxMs)

  sessionTimer.unref()
  responsiveSockets.add(socket)

  socket.on('pong',()=>{
    responsiveSockets.add(socket)
  })

  const cleanup=()=>{
    if(closed){
      return
    }

    closed=true
    clearTimeout(authenticationTimer)
    clearTimeout(sessionTimer)

    if(
      engineerId &&
      activeUsers.get(engineerId)===socket
    ){
      activeUsers.delete(engineerId)
    }

    shell?.close()
    shell=null
  }

  socket.on('message',async(raw,isBinary)=>{
    if(isBinary){
      socket.close(1003,'Binary messages are not supported')
      return
    }

    let message

    try{
      message=parseClientMessage(raw.toString())
    }catch(error){
      const detail=error instanceof ProtocolError
        ? error.message
        : 'Invalid message'

      send(socket,{type:'error',message:detail})
      socket.close(1008,'Protocol violation')
      return
    }

    if(!authenticated){
      if(message.type!=='auth' || authenticating){
        socket.close(1008,'Authentication required')
        return
      }

      authenticating=true

      try{
        const engineer=await authorizeEngineer(
          message.accessToken,
          config
        )

        if(activeUsers.has(engineer.id)){
          throw new AuthorizationError(
            'An engineering terminal session is already active for this account'
          )
        }

        engineerId=engineer.id
        activeUsers.set(engineer.id,socket)

        shell=await containers.openShell(
          engineer.id,
          message.cols,
          message.rows
        )

        authenticated=true
        clearTimeout(authenticationTimer)

        shell.stream.on('data',chunk=>{
          if(socket.bufferedAmount>1_048_576){
            shell?.stream.pause()
            socket.close(1013,'Client is not consuming terminal output')
            return
          }

          send(socket,{
            type:'output',
            data:Buffer.from(chunk).toString('utf8')
          })
        })

        shell.stream.once('error',error=>{
          console.error('[shell stream]',error)
          send(socket,{
            type:'error',
            message:'The Linux shell stopped unexpectedly.'
          })
          socket.close(1011,'Shell error')
        })

        shell.stream.once('end',()=>{
          socket.close(1000,'Shell exited')
        })

        send(socket,{
          type:'ready',
          sessionId:randomUUID(),
          role:engineer.role
        })
      }catch(error){
        if(
          engineerId &&
          activeUsers.get(engineerId)===socket
        ){
          activeUsers.delete(engineerId)
        }

        const detail=error instanceof AuthorizationError
          ? error.message
          : 'Unable to start the engineering session'

        console.error('[session start]',error)
        send(socket,{type:'error',message:detail})
        socket.close(4003,'Session rejected')
      }finally{
        authenticating=false
      }

      return
    }

    if(message.type==='auth'){
      socket.close(1008,'Already authenticated')
      return
    }

    if(message.type==='input'){
      shell?.stream.write(message.data)
      return
    }

    try{
      await shell?.resize(message.cols,message.rows)
    }catch(error){
      console.error('[shell resize]',error)
    }
  })

  socket.once('close',cleanup)
  socket.once('error',cleanup)
})

const heartbeat=setInterval(()=>{
  for(const socket of webSockets.clients){
    if(socket.readyState!==WebSocket.OPEN){
      continue
    }

    if(!responsiveSockets.has(socket)){
      socket.terminate()
      continue
    }

    responsiveSockets.delete(socket)
    socket.ping()
  }
},30_000)

heartbeat.unref()

const ideExpirySweep=setInterval(()=>{
  const now=Date.now()
  for(const session of ideSessions.values()){
    if(session.expiresAt<=now){
      void releaseIdeSession(session)
    }
  }
},60_000)

ideExpirySweep.unref()

async function start(){
  await containers.ping()

  server.listen(
    config.port,
    config.bindHost,
    ()=>{
      console.log(
        `ParAsYtE Linux Gateway listening on ${config.bindHost}:${config.port}`
      )
    }
  )
}

function shutdown(signal:string){
  console.log(`Received ${signal}; closing gateway`)
  clearInterval(heartbeat)
  clearInterval(ideExpirySweep)

  for(const socket of webSockets.clients){
    socket.close(1012,'Gateway restarting')
  }

  for(const session of ideSessions.values()){
    void releaseIdeSession(session)
  }

  server.close(error=>{
    if(error){
      console.error('[shutdown]',error)
      process.exitCode=1
    }
  })
}

process.on('SIGTERM',()=>shutdown('SIGTERM'))
process.on('SIGINT',()=>shutdown('SIGINT'))

void start().catch(error=>{
  console.error('[startup]',error)
  process.exitCode=1
})
