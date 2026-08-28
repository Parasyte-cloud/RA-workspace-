import { randomUUID } from 'node:crypto'
import http from 'node:http'

import {
  WebSocket,
  WebSocketServer
} from 'ws'

import {
  AuthorizationError,
  authorizeEngineer
} from './auth.js'
import { loadConfig } from './config.js'
import {
  EngineerContainerManager,
  type ShellHandle
} from './container.js'
import {
  ProtocolError,
  parseClientMessage
} from './protocol.js'

const config=loadConfig()
const containers=new EngineerContainerManager(config)
const activeUsers=new Map<string,WebSocket>()
const upgradeAttempts=new Map<string,{count:number;resetAt:number}>()
const responsiveSockets=new WeakSet<WebSocket>()

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
    return forwarded.split(',').at(-1)?.trim() || 'unknown'
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
  return current.count>30
}

const server=http.createServer((request,response)=>{
  if(request.method==='GET' && request.url==='/health'){
    response.writeHead(200,{
      'content-type':'application/json',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff'
    })
    response.end(JSON.stringify({status:'ok'}))
    return
  }

  response.writeHead(404,{
    'content-type':'application/json',
    'cache-control':'no-store'
  })
  response.end(JSON.stringify({error:'not_found'}))
})

const webSockets=new WebSocketServer({
  noServer:true,
  maxPayload:config.maxMessageBytes,
  perMessageDeflate:false,
  clientTracking:true
})

server.on('upgrade',(request,socket,head)=>{
  const origin=request.headers.origin?.replace(/\/$/,'')
  const url=new URL(
    request.url || '/',
    'http://gateway.internal'
  )

  if(url.pathname!=='/ws'){
    rejectUpgrade(socket,404,'Not Found')
    return
  }

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
            'An engineering session is already active for this account'
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

  for(const socket of webSockets.clients){
    socket.close(1012,'Gateway restarting')
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
