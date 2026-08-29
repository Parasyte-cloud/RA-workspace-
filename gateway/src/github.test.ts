import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'

import type { GatewayConfig } from './config.js'
import {
  getGitHubRepositorySummary,
  githubStatus,
  listGitHubRepositories
} from './github.js'

function configured():GatewayConfig{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})

  return {
    bindHost:'127.0.0.1',
    port:8787,
    publicOrigin:'https://linux.ridearrivo.com',
    allowedOrigins:new Set(['https://intranet.ridearrivo.com']),
    supabaseUrl:'https://workspace.supabase.co',
    supabaseAnonKey:'publishable-test-key',
    dockerSocket:'/run/user/1001/docker.sock',
    toolingImage:'parasyte-linux-tooling:1.0.0',
    containerNetworkPrefix:'parasyte-engineer',
    containerMemoryBytes:2*1024*1024*1024,
    containerNanoCpus:2_000_000_000,
    containerPids:512,
    idleStopMs:900_000,
    sessionMaxMs:3_600_000,
    authTimeoutMs:10_000,
    maxMessageBytes:65_536,
    ideSessionMaxMs:3_600_000,
    githubOrg:'Parasyte-cloud',
    githubAppId:'12345',
    githubInstallationId:'67890',
    githubPrivateKey:privateKey.export({type:'pkcs8',format:'pem'}).toString()
  }
}

test('reports GitHub disabled without gateway credentials',()=>{
  const config=configured()
  config.githubAppId=null
  config.githubInstallationId=null
  config.githubPrivateKey=null

  assert.deepEqual(githubStatus(config),{
    configured:false,
    organization:'Parasyte-cloud'
  })
})

test('lists only repository fields needed by the engineering dashboard',async()=>{
  const config=configured()
  const requests:string[]=[]

  const fetcher=(async(input:RequestInfo|URL)=>{
    const url=String(input)
    requests.push(url)

    if(url.includes('/access_tokens')){
      return new Response(JSON.stringify({
        token:'installation-token',
        expires_at:new Date(Date.now()+3_600_000).toISOString()
      }),{status:201,headers:{'content-type':'application/json'}})
    }

    return new Response(JSON.stringify({
      repositories:[{
        id:7,
        name:'Arrivo',
        full_name:'Parasyte-cloud/Arrivo',
        private:true,
        default_branch:'main',
        updated_at:'2026-08-29T00:00:00Z',
        html_url:'https://github.com/Parasyte-cloud/Arrivo',
        ignored_secret_field:'must-not-leak'
      }]
    }),{status:200,headers:{'content-type':'application/json'}})
  }) as typeof fetch

  const repositories=await listGitHubRepositories(config,fetcher)

  assert.equal(requests.length,2)
  assert.deepEqual(repositories,[{
    id:7,
    name:'Arrivo',
    fullName:'Parasyte-cloud/Arrivo',
    private:true,
    defaultBranch:'main',
    updatedAt:'2026-08-29T00:00:00Z',
    url:'https://github.com/Parasyte-cloud/Arrivo'
  }])
})

test('rejects unsafe repository names before making a GitHub request',async()=>{
  const config=configured()
  let called=false
  const fetcher=(async()=>{
    called=true
    return new Response('{}',{status:200})
  }) as typeof fetch

  await assert.rejects(
    ()=>getGitHubRepositorySummary(config,'../admin',fetcher),
    /Invalid GitHub repository name/
  )
  assert.equal(called,false)
})
