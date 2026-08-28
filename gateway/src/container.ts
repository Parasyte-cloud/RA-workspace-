import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'

import Docker from 'dockerode'

import type { GatewayConfig } from './config.js'

const OWNER_LABEL='com.ridearrivo.parasyte.owner'
const MANAGED_LABEL='com.ridearrivo.parasyte.managed'

function identityHash(userId:string):string{
  return createHash('sha256')
    .update(userId)
    .digest('hex')
    .slice(0,24)
}

function missing(error:unknown):boolean{
  return Boolean(
    error &&
    typeof error==='object' &&
    'statusCode' in error &&
    error.statusCode===404
  )
}

export type ShellHandle = {
  stream:Duplex
  resize:(cols:number,rows:number)=>Promise<void>
  close:()=>void
}

export class EngineerContainerManager{
  private readonly docker:Docker
  private readonly stopTimers=new Map<string,NodeJS.Timeout>()

  constructor(
    private readonly config:GatewayConfig
  ){
    this.docker=new Docker({
      socketPath:config.dockerSocket
    })
  }

  async ping():Promise<void>{
    await this.docker.ping()
  }

  private names(userId:string){
    const hash=identityHash(userId)

    return {
      hash,
      container:`parasyte-engineer-${hash}`,
      volume:`parasyte-workspace-${hash}`,
      network:`${this.config.containerNetworkPrefix}-${hash}`
    }
  }

  private async ensureNetwork(
    networkName:string,
    ownerHash:string
  ):Promise<void>{
    const network=this.docker.getNetwork(networkName)

    try{
      const details=await network.inspect()

      if(
        details.Labels?.[OWNER_LABEL]!==ownerHash ||
        details.Labels?.[MANAGED_LABEL]!=='true'
      ){
        throw new Error('Engineer network ownership mismatch')
      }

      return
    }catch(error){
      if(!missing(error)){
        throw error
      }
    }

    await this.docker.createNetwork({
      Name:networkName,
      Driver:'bridge',
      Internal:false,
      Attachable:false,
      CheckDuplicate:true,
      Labels:{
        [MANAGED_LABEL]:'true',
        [OWNER_LABEL]:ownerHash
      }
    })
  }

  private async ensureVolume(
    volumeName:string,
    ownerHash:string
  ):Promise<void>{
    const volume=this.docker.getVolume(volumeName)

    try{
      const details=await volume.inspect()

      if(details.Labels?.[OWNER_LABEL]!==ownerHash){
        throw new Error('Workspace volume ownership mismatch')
      }

      return
    }catch(error){
      if(!missing(error)){
        throw error
      }
    }

    await this.docker.createVolume({
      Name:volumeName,
      Labels:{
        [MANAGED_LABEL]:'true',
        [OWNER_LABEL]:ownerHash
      }
    })

    const initializer=await this.docker.createContainer({
      Image:this.config.toolingImage,
      User:'0:0',
      Cmd:[
        '/bin/sh',
        '-c',
        'mkdir -p /workspace/.home && chown -R 10001:10001 /workspace'
      ],
      Labels:{
        [MANAGED_LABEL]:'true',
        [OWNER_LABEL]:ownerHash,
        'com.ridearrivo.parasyte.purpose':'volume-initializer'
      },
      HostConfig:{
        AutoRemove:false,
        CapDrop:['ALL'],
        CapAdd:['CHOWN'],
        NetworkMode:'none',
        ReadonlyRootfs:true,
        PidsLimit:32,
        Memory:128*1024*1024,
        Mounts:[{
          Type:'volume',
          Source:volumeName,
          Target:'/workspace',
          ReadOnly:false
        }]
      }
    })

    try{
      await initializer.start()
      const result=await initializer.wait()

      if(result.StatusCode!==0){
        throw new Error(
          `Workspace volume initialization failed (${result.StatusCode})`
        )
      }
    }finally{
      await initializer.remove({force:true}).catch(()=>undefined)
    }
  }

  private async ensureContainer(userId:string):Promise<Docker.Container>{
    const names=this.names(userId)

    await this.ensureVolume(
      names.volume,
      names.hash
    )

    await this.ensureNetwork(
      names.network,
      names.hash
    )

    const existing=this.docker.getContainer(names.container)

    try{
      const details=await existing.inspect()

      if(
        details.Config.Labels?.[OWNER_LABEL]!==names.hash ||
        details.Config.Labels?.[MANAGED_LABEL]!=='true' ||
        details.HostConfig.NetworkMode!==names.network
      ){
        throw new Error('Engineer container ownership mismatch')
      }

      return existing
    }catch(error){
      if(!missing(error)){
        throw error
      }
    }

    return this.docker.createContainer({
      name:names.container,
      Image:this.config.toolingImage,
      User:'10001:10001',
      WorkingDir:'/workspace',
      Cmd:['sleep','infinity'],
      Env:[
        'HOME=/workspace/.home',
        'TERM=xterm-256color',
        'COLORTERM=truecolor',
        'NODE_ENV=development',
        'NPM_CONFIG_CACHE=/workspace/.home/.npm-cache',
        'PIP_CACHE_DIR=/workspace/.home/.cache/pip'
      ],
      Labels:{
        [MANAGED_LABEL]:'true',
        [OWNER_LABEL]:names.hash
      },
      HostConfig:{
        AutoRemove:false,
        CapDrop:['ALL'],
        SecurityOpt:['no-new-privileges:true'],
        ReadonlyRootfs:true,
        NetworkMode:names.network,
        Memory:this.config.containerMemoryBytes,
        MemorySwap:this.config.containerMemoryBytes,
        NanoCpus:this.config.containerNanoCpus,
        PidsLimit:this.config.containerPids,
        OomKillDisable:false,
        Tmpfs:{
          '/tmp':'rw,nosuid,nodev,noexec,size=268435456,mode=1777',
          '/run':'rw,nosuid,nodev,noexec,size=16777216,mode=755'
        },
        Mounts:[{
          Type:'volume',
          Source:names.volume,
          Target:'/workspace',
          ReadOnly:false
        }],
        Ulimits:[{
          Name:'nofile',
          Soft:4096,
          Hard:4096
        }],
        LogConfig:{
          Type:'local',
          Config:{
            'max-size':'10m',
            'max-file':'3'
          }
        }
      },
      StopTimeout:10
    })
  }

  private cancelScheduledStop(userId:string){
    const timer=this.stopTimers.get(userId)

    if(timer){
      clearTimeout(timer)
      this.stopTimers.delete(userId)
    }
  }

  private scheduleStop(
    userId:string,
    container:Docker.Container
  ){
    this.cancelScheduledStop(userId)

    const timer=setTimeout(
      ()=>{
        this.stopTimers.delete(userId)

        void container.stop({t:10}).catch(error=>{
          if(
            !error ||
            typeof error!=='object' ||
            !('statusCode' in error) ||
            error.statusCode!==304
          ){
            console.error('[container stop]',error)
          }
        })
      },
      this.config.idleStopMs
    )

    timer.unref()
    this.stopTimers.set(userId,timer)
  }

  async openShell(
    userId:string,
    cols:number,
    rows:number
  ):Promise<ShellHandle>{
    this.cancelScheduledStop(userId)

    const container=await this.ensureContainer(userId)
    const details=await container.inspect()

    if(!details.State.Running){
      await container.start()
    }

    const execution=await container.exec({
      AttachStdin:true,
      AttachStdout:true,
      AttachStderr:true,
      Tty:true,
      User:'10001:10001',
      WorkingDir:'/workspace',
      Cmd:['/bin/bash','--login']
    })

    const stream=await execution.start({
      hijack:true,
      stdin:true
    }) as Duplex

    await execution.resize({
      w:cols,
      h:rows
    })

    let closed=false

    return {
      stream,
      resize:async(nextCols,nextRows)=>{
        if(closed){
          return
        }

        await execution.resize({
          w:nextCols,
          h:nextRows
        })
      },
      close:()=>{
        if(closed){
          return
        }

        closed=true
        stream.end()
        stream.destroy()
        this.scheduleStop(userId,container)
      }
    }
  }
}
