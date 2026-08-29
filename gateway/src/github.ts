import { createSign } from 'node:crypto'

import type { GatewayConfig } from './config.js'

type FetchLike=typeof fetch

type TokenCache={
  token:string
  expiresAt:number
  installationId:string
}

let tokenCache:TokenCache|null=null

function base64url(value:string|Buffer):string{
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g,'')
    .replace(/\+/g,'-')
    .replace(/\//g,'_')
}

function githubAppConfigured(
  config:Pick<
    GatewayConfig,
    'githubAppId'|'githubInstallationId'|'githubPrivateKey'
  >
):config is GatewayConfig & {
  githubAppId:string
  githubInstallationId:string
  githubPrivateKey:string
}{
  return Boolean(
    config.githubAppId &&
    config.githubInstallationId &&
    config.githubPrivateKey
  )
}

export function githubStatus(
  config:Pick<
    GatewayConfig,
    'githubAppId'|'githubInstallationId'|'githubPrivateKey'|'githubOrg'
  >
){
  return {
    configured:githubAppConfigured(config),
    organization:config.githubOrg
  }
}

function createAppJwt(
  appId:string,
  privateKey:string
):string{
  const now=Math.floor(Date.now()/1000)
  const header=base64url(
    JSON.stringify({
      alg:'RS256',
      typ:'JWT'
    })
  )
  const payload=base64url(
    JSON.stringify({
      iat:now-60,
      exp:now+9*60,
      iss:appId
    })
  )
  const unsigned=`${header}.${payload}`
  const signer=createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const signature=base64url(
    signer.sign(privateKey)
  )

  return `${unsigned}.${signature}`
}

async function parseJson(response:Response):Promise<unknown>{
  try{
    return await response.json()
  }catch{
    return null
  }
}

async function installationToken(
  config:GatewayConfig,
  fetcher:FetchLike=fetch
):Promise<string>{
  if(!githubAppConfigured(config)){
    throw new Error('GitHub App integration is not configured')
  }

  const now=Date.now()

  if(
    tokenCache &&
    tokenCache.installationId===config.githubInstallationId &&
    tokenCache.expiresAt-now>5*60*1000
  ){
    return tokenCache.token
  }

  const jwt=createAppJwt(
    config.githubAppId,
    config.githubPrivateKey
  )

  const response=await fetcher(
    `https://api.github.com/app/installations/${encodeURIComponent(config.githubInstallationId)}/access_tokens`,
    {
      method:'POST',
      headers:{
        accept:'application/vnd.github+json',
        authorization:`Bearer ${jwt}`,
        'x-github-api-version':'2026-03-10',
        'user-agent':'RideArrivo-ParAsYtE-Gateway'
      }
    }
  )

  const payload=await parseJson(response) as {
    token?:unknown
    expires_at?:unknown
    message?:unknown
  }|null

  if(
    !response.ok ||
    typeof payload?.token!=='string' ||
    typeof payload.expires_at!=='string'
  ){
    const detail=
      typeof payload?.message==='string'
        ? payload.message
        : `GitHub token request failed (${response.status})`
    throw new Error(detail)
  }

  const expiresAt=Date.parse(payload.expires_at)

  if(!Number.isFinite(expiresAt)){
    throw new Error('GitHub returned an invalid token expiry')
  }

  tokenCache={
    token:payload.token,
    expiresAt,
    installationId:config.githubInstallationId
  }

  return payload.token
}

async function githubJson(
  config:GatewayConfig,
  path:string,
  fetcher:FetchLike=fetch
):Promise<unknown>{
  const token=await installationToken(config,fetcher)
  const response=await fetcher(
    `https://api.github.com${path}`,
    {
      method:'GET',
      headers:{
        accept:'application/vnd.github+json',
        authorization:`Bearer ${token}`,
        'x-github-api-version':'2026-03-10',
        'user-agent':'RideArrivo-ParAsYtE-Gateway'
      }
    }
  )
  const payload=await parseJson(response)

  if(!response.ok){
    const message=
      payload &&
      typeof payload==='object' &&
      'message' in payload &&
      typeof payload.message==='string'
        ? payload.message
        : `GitHub API request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

export type GitHubRepository={
  id:number
  name:string
  fullName:string
  private:boolean
  defaultBranch:string
  updatedAt:string
  url:string
}

export type GitHubPullRequest={
  number:number
  title:string
  draft:boolean
  author:string
  updatedAt:string
  url:string
}

export type GitHubWorkflowRun={
  id:number
  name:string
  event:string
  status:string
  conclusion:string|null
  branch:string
  createdAt:string
  updatedAt:string
  url:string
}

function safeRepoName(value:string):string{
  const trimmed=value.trim()

  if(!/^[A-Za-z0-9_.-]{1,100}$/.test(trimmed)){
    throw new Error('Invalid GitHub repository name')
  }

  return trimmed
}

export async function listGitHubRepositories(
  config:GatewayConfig,
  fetcher:FetchLike=fetch
):Promise<GitHubRepository[]>{
  const payload=await githubJson(
    config,
    '/installation/repositories?per_page=100',
    fetcher
  ) as {
    repositories?:unknown
  }|null

  const rows=Array.isArray(payload?.repositories)
    ? payload.repositories
    : []

  return rows.flatMap(row=>{
    if(!row || typeof row!=='object'){
      return []
    }

    const value=row as Record<string,unknown>

    if(
      typeof value.id!=='number' ||
      typeof value.name!=='string' ||
      typeof value.full_name!=='string' ||
      typeof value.private!=='boolean' ||
      typeof value.default_branch!=='string' ||
      typeof value.updated_at!=='string' ||
      typeof value.html_url!=='string'
    ){
      return []
    }

    return [{
      id:value.id,
      name:value.name,
      fullName:value.full_name,
      private:value.private,
      defaultBranch:value.default_branch,
      updatedAt:value.updated_at,
      url:value.html_url
    }]
  })
}

export async function getGitHubRepositorySummary(
  config:GatewayConfig,
  repoName:string,
  fetcher:FetchLike=fetch
):Promise<{
  repository:string
  pullRequests:GitHubPullRequest[]
  workflowRuns:GitHubWorkflowRun[]
}>{
  const repo=safeRepoName(repoName)
  const owner=encodeURIComponent(config.githubOrg)
  const encodedRepo=encodeURIComponent(repo)

  const [pullPayload,runPayload]=await Promise.all([
    githubJson(
      config,
      `/repos/${owner}/${encodedRepo}/pulls?state=open&per_page=30`,
      fetcher
    ),
    githubJson(
      config,
      `/repos/${owner}/${encodedRepo}/actions/runs?per_page=30`,
      fetcher
    )
  ])

  const pullRows=Array.isArray(pullPayload)
    ? pullPayload
    : []

  const runRows=
    runPayload &&
    typeof runPayload==='object' &&
    'workflow_runs' in runPayload &&
    Array.isArray(runPayload.workflow_runs)
      ? runPayload.workflow_runs
      : []

  const pullRequests:GitHubPullRequest[]=pullRows.flatMap(row=>{
    if(!row || typeof row!=='object'){
      return []
    }

    const value=row as Record<string,unknown>
    const user=
      value.user && typeof value.user==='object'
        ? value.user as Record<string,unknown>
        : null

    if(
      typeof value.number!=='number' ||
      typeof value.title!=='string' ||
      typeof value.draft!=='boolean' ||
      typeof value.updated_at!=='string' ||
      typeof value.html_url!=='string'
    ){
      return []
    }

    return [{
      number:value.number,
      title:value.title,
      draft:value.draft,
      author:typeof user?.login==='string'
        ? user.login
        : 'unknown',
      updatedAt:value.updated_at,
      url:value.html_url
    }]
  })

  const workflowRuns:GitHubWorkflowRun[]=runRows.flatMap(row=>{
    if(!row || typeof row!=='object'){
      return []
    }

    const value=row as Record<string,unknown>

    if(
      typeof value.id!=='number' ||
      typeof value.name!=='string' ||
      typeof value.event!=='string' ||
      typeof value.status!=='string' ||
      typeof value.head_branch!=='string' ||
      typeof value.created_at!=='string' ||
      typeof value.updated_at!=='string' ||
      typeof value.html_url!=='string'
    ){
      return []
    }

    return [{
      id:value.id,
      name:value.name,
      event:value.event,
      status:value.status,
      conclusion:typeof value.conclusion==='string'
        ? value.conclusion
        : null,
      branch:value.head_branch,
      createdAt:value.created_at,
      updatedAt:value.updated_at,
      url:value.html_url
    }]
  })

  return {
    repository:repo,
    pullRequests,
    workflowRuns
  }
}
