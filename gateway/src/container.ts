import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'

import Docker from 'dockerode'

import type { GatewayConfig } from './config.js'

const OWNER_LABEL='com.ridearrivo.parasyte.owner'
const MANAGED_LABEL='com.ridearrivo.parasyte.managed'
const TOOLING_REVISION_LABEL='com.ridearrivo.parasyte.tooling-revision'
const TOOLING_REVISION='ide-v1'
const IDE_PORT='3000/tcp'

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

export type IdeEndpoint={
  host:'127.0.0.1'
  port:number
}

export class EngineerContainerManager{
  private readonly docker:Docker
  private readonly stopTimers=new Map<string,NodeJS.Timeout>()
  private readonly activeShellUsers=new Set<string>()
  private readonly activeIdeUsers=new Set<string>()

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

  private compatibleContainer(
    details:Docker.ContainerInspectInfo,
    ownerHash:string,
    networkName:string
  ):boolean{
    const labels=details.Config.Labels || {}
    const binding=details.HostConfig.PortBindings?.[IDE_PORT]?.[0]

    return (
      labels[OWNER_LABEL]===ownerHash &&
      labels[MANAGED_LABEL]==='true' &&
      labels[TOOLING_REVISION_LABEL]===TOOLING_REVISION &&
      details.HostConfig.NetworkMode===networkName &&
      Boolean(details.Config.ExposedPorts?.[IDE_PORT]) &&
      Boolean(binding) &&
      (!binding?.HostIp || binding.HostIp==='127.0.0.1')
    )
  }

  private async replaceManagedContainer(
    container:Docker.Container,
    details:Docker.ContainerInspectInfo,
    ownerHash:string
  ):Promise<void>{
    const labels=details.Config.Labels || {}

    if(
      labels[OWNER_LABEL]!==ownerHash ||
      labels[MANAGED_LABEL]!=='true'
    ){
      throw new Error('Refusing to replace an unmanaged engineer container')
    }

    if(details.State.Running){
      await container.stop({t:10}).catch(error=>{
        if(
          !error ||
          typeof error!=='object' ||
          !('statusCode' in error) ||
          error.statusCode!==304
        ){
          throw error
        }
      })
    }

    /*
     * Deliberately remove only the disposable container. The separately
     * labelled named workspace volume is retained, so an IDE upgrade does
     * not delete the engineer's project files or editor state.
     */
    await container.remove({force:true,v:false})
  }

  private async createEngineerContainer(
    userId:string
  ):Promise<Docker.Container>{
    const names=this.names(userId)

    return this.docker.createContainer({
      name:names.container,
      Image:this.config.toolingImage,
      User:'10001:10001',
      WorkingDir:'/workspace',
      Cmd:[
        'code-server',
        '--bind-addr','0.0.0.0:3000',
        '--auth','none',
        '--disable-file-downloads',
        '--disable-file-uploads',
        '--disable-telemetry',
        '--disable-update-check',
        '--disable-getting-started-override',
        '--app-name','RideArrivo Engineering IDE',
        '/workspace'
      ],
      Env:[
        'HOME=/workspace/.home',
        'TERM=xterm-256color',
        'COLORTERM=truecolor',
        'NODE_ENV=development',
        'NPM_CONFIG_CACHE=/workspace/.home/.npm-cache',
        'PIP_CACHE_DIR=/workspace/.home/.cache/pip',
        'VSCODE_PROXY_URI=./proxy/{{port}}',
        'CS_DISABLE_GETTING_STARTED_OVERRIDE=1'
      ],
      ExposedPorts:{
        [IDE_PORT]:{}
      },
      Labels:{
        [MANAGED_LABEL]:'true',
        [OWNER_LABEL]:names.hash,
        [TOOLING_REVISION_LABEL]:TOOLING_REVISION
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
          '/run':'rw,nosuid,nodev,noexec,size=33554432,mode=755'
        },
        PortBindings:{
          [IDE_PORT]:[{
            HostIp:'127.0.0.1',
            HostPort:''
          }]
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

      if(this.compatibleContainer(details,names.hash,names.network)){
        return existing
      }

      await this.replaceManagedContainer(
        existing,
        details,
        names.hash
      )

      return this.createEngineerContainer(userId)
    }catch(error){
      if(!missing(error)){
        throw error
      }
    }

    return this.createEngineerContainer(userId)
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

    if(
      this.activeShellUsers.has(userId) ||
      this.activeIdeUsers.has(userId)
    ){
      return
    }

    const timer=setTimeout(
      ()=>{
        this.stopTimers.delete(userId)

        if(
          this.activeShellUsers.has(userId) ||
          this.activeIdeUsers.has(userId)
        ){
          return
        }

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

  private async runningContainer(userId:string):Promise<Docker.Container>{
    this.cancelScheduledStop(userId)

    const container=await this.ensureContainer(userId)
    const details=await container.inspect()

    if(!details.State.Running){
      await container.start()
    }

    return container
  }

  async acquireIde(userId:string):Promise<IdeEndpoint>{
    this.activeIdeUsers.add(userId)

    try{
      const container=await this.runningContainer(userId)
      const details=await container.inspect()
      const binding=details.NetworkSettings.Ports?.[IDE_PORT]?.[0]
      const port=Number(binding?.HostPort)

      if(
        !binding ||
        binding.HostIp!=='127.0.0.1' ||
        !Number.isInteger(port) ||
        port<1 ||
        port>65535
      ){
        throw new Error('IDE loopback port is unavailable')
      }

      return {
        host:'127.0.0.1',
        port
      }
    }catch(error){
      this.activeIdeUsers.delete(userId)
      throw error
    }
  }

  async releaseIde(userId:string):Promise<void>{
    this.activeIdeUsers.delete(userId)

    try{
      const container=await this.ensureContainer(userId)
      this.scheduleStop(userId,container)
    }catch(error){
      console.error('[IDE release]',error)
    }
  }

  async openShell(
    userId:string,
    cols:number,
    rows:number
  ):Promise<ShellHandle>{
    this.activeShellUsers.add(userId)

    let container:Docker.Container

    try{
      container=await this.runningContainer(userId)
    }catch(error){
      this.activeShellUsers.delete(userId)
      throw error
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
        this.activeShellUsers.delete(userId)
        stream.end()
        stream.destroy()
        this.scheduleStop(userId,container)
      }
    }
  }
}
