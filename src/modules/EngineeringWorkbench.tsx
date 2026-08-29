import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  Activity,
  CheckCircle2,
  Clipboard,
  Code2,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  MonitorPlay,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  TerminalSquare,
  Workflow,
} from 'lucide-react'

import { supabase } from '../lib/supabase'

import '../engineering-workbench.css'


type Repository={
  id:number
  name:string
  fullName:string
  private:boolean
  defaultBranch:string
  updatedAt:string
  url:string
}

type PullRequest={
  number:number
  title:string
  draft:boolean
  author:string
  updatedAt:string
  url:string
}

type WorkflowRun={
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

type RepositorySummary={
  repository:string
  pullRequests:PullRequest[]
  workflowRuns:WorkflowRun[]
}

function gatewayOrigin(){
  const endpoint=
    String(
      import.meta.env.VITE_PARASYTE_LINUX_WS ||
      'wss://linux.ridearrivo.com/ws'
    ).trim()

  try{
    const url=new URL(endpoint)
    url.protocol=url.protocol==='ws:' ? 'http:' : 'https:'
    return url.origin
  }catch{
    return 'https://linux.ridearrivo.com'
  }
}

async function gatewayRequest<T>(
  path:string,
  init:RequestInit={}
):Promise<T>{
  if(!supabase){
    throw new Error('Supabase is not configured.')
  }

  const {
    data:{session},
    error
  }=await supabase.auth.getSession()

  if(error) throw error
  if(!session?.access_token){
    throw new Error('Your workspace session has expired.')
  }

  let response:Response

  try{
    response=await fetch(
      `${gatewayOrigin()}${path}`,
      {
        ...init,
        credentials:'include',
        headers:{
          authorization:`Bearer ${session.access_token}`,
          ...(init.headers || {})
        }
      }
    )
  }catch{
    throw new Error(
      'The secure engineering gateway is not reachable yet. Deploy linux.ridearrivo.com to enable the embedded IDE and GitHub console.'
    )
  }

  const payload=await response.json().catch(()=>null) as {
    message?:unknown
  }|null

  if(!response.ok){
    throw new Error(
      typeof payload?.message==='string'
        ? payload.message
        : `Engineering gateway request failed (${response.status}).`
    )
  }

  return payload as T
}

function relativeTime(value:string){
  const timestamp=Date.parse(value)
  if(!Number.isFinite(timestamp)) return 'Unknown'
  const diff=Math.max(0,Date.now()-timestamp)
  const minutes=Math.floor(diff/60_000)
  if(minutes<1) return 'Just now'
  if(minutes<60) return `${minutes}m ago`
  const hours=Math.floor(minutes/60)
  if(hours<24) return `${hours}h ago`
  const days=Math.floor(hours/24)
  return `${days}d ago`
}

export default function EngineeringWorkbench(){
  const [tab,setTab]=useState<'ide'|'github'|'preview'>('ide')
  const [ideUrl,setIdeUrl]=useState('')
  const [ideBusy,setIdeBusy]=useState(false)
  const [ideMessage,setIdeMessage]=useState('')
  const [previewPort,setPreviewPort]=useState('5173')
  const [previewUrl,setPreviewUrl]=useState('')

  const [githubLoading,setGithubLoading]=useState(false)
  const [githubConfigured,setGithubConfigured]=useState<boolean|null>(null)
  const [githubOrg,setGithubOrg]=useState('Parasyte-cloud')
  const [githubMessage,setGithubMessage]=useState('')
  const [repositories,setRepositories]=useState<Repository[]>([])
  const [selectedRepo,setSelectedRepo]=useState('')
  const [summary,setSummary]=useState<RepositorySummary|null>(null)
  const [copied,setCopied]=useState('')

  const selectedRepository=useMemo(
    ()=>repositories.find(repo=>repo.name===selectedRepo) || null,
    [repositories,selectedRepo]
  )

  const loadGitHub=useCallback(async()=>{
    setGithubLoading(true)
    setGithubMessage('')

    try{
      const status=await gatewayRequest<{
        configured:boolean
        organization:string
      }>('/api/github/status')

      setGithubConfigured(status.configured)
      setGithubOrg(status.organization)

      if(!status.configured){
        setRepositories([])
        setSelectedRepo('')
        setSummary(null)
        return
      }

      const payload=await gatewayRequest<{
        repositories:Repository[]
      }>('/api/github/repositories')

      setRepositories(payload.repositories || [])
      setSelectedRepo(current=>
        current && payload.repositories.some(repo=>repo.name===current)
          ? current
          : payload.repositories[0]?.name || ''
      )
    }catch(error){
      setGithubConfigured(null)
      setGithubMessage(
        error instanceof Error
          ? error.message
          : 'Unable to load GitHub.'
      )
    }finally{
      setGithubLoading(false)
    }
  },[])

  useEffect(()=>{
    if(tab==='github' && githubConfigured===null){
      void loadGitHub()
    }
  },[tab,githubConfigured,loadGitHub])

  useEffect(()=>{
    if(!selectedRepo || githubConfigured!==true){
      setSummary(null)
      return
    }

    let cancelled=false

    void (async()=>{
      try{
        const payload=await gatewayRequest<RepositorySummary>(
          `/api/github/repository?name=${encodeURIComponent(selectedRepo)}`
        )
        if(!cancelled) setSummary(payload)
      }catch(error){
        if(!cancelled){
          setGithubMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load repository activity.'
          )
        }
      }
    })()

    return ()=>{
      cancelled=true
    }
  },[selectedRepo,githubConfigured])

  const startIde=async()=>{
    setIdeBusy(true)
    setIdeMessage('')

    try{
      const payload=await gatewayRequest<{
        url:string
        expiresAt:string
      }>('/api/ide/session',{method:'POST'})

      setIdeUrl(payload.url)
      setTab('ide')
    }catch(error){
      setIdeMessage(
        error instanceof Error
          ? error.message
          : 'Unable to start the secure IDE.'
      )
    }finally{
      setIdeBusy(false)
    }
  }

  const stopIde=async()=>{
    setIdeBusy(true)
    setIdeMessage('')

    try{
      await gatewayRequest<{stopped:boolean}>(
        '/api/ide/session',
        {method:'DELETE'}
      )
      setIdeUrl('')
      setPreviewUrl('')
      setIdeMessage('Secure IDE session stopped.')
    }catch(error){
      setIdeMessage(
        error instanceof Error
          ? error.message
          : 'Unable to stop the IDE session.'
      )
    }finally{
      setIdeBusy(false)
    }
  }

  const openPreview=()=>{
    const port=Number(previewPort)

    if(!Number.isInteger(port) || port<1024 || port>65535){
      setIdeMessage('Enter a development port between 1024 and 65535.')
      return
    }

    if(!ideUrl){
      setIdeMessage('Start the secure VS Code session first.')
      return
    }

    setIdeMessage('')
    setPreviewUrl(`${gatewayOrigin()}/ide/proxy/${port}/`)
    setTab('preview')
  }

  const copyClone=async(repo:Repository)=>{
    const command=`git clone https://github.com/${repo.fullName}.git`
    await navigator.clipboard.writeText(command)
    setCopied(repo.name)
    window.setTimeout(()=>setCopied(''),1600)
  }

  return (
    <section className="engineeringWorkbench glassCard">
      <div className="engineeringWorkbenchHeader">
        <div>
          <span className="eyebrow">SECURE ENGINEERING DESK</span>
          <h3>Code, review and test without leaving RideArrivo</h3>
          <p>
            VS Code runs in the engineer&apos;s isolated ParAsYtE container. GitHub repository, pull-request and Actions data is rendered natively through the gateway rather than attempting to iframe github.com.
          </p>
        </div>
        <div className="engineeringWorkbenchSecurity">
          <ShieldCheck size={17}/>
          <span>Engineer/Admin server-side authorization</span>
        </div>
      </div>

      <div className="engineeringWorkbenchTabs">
        <button type="button" className={tab==='ide'?'active':''} onClick={()=>setTab('ide')}><Code2 size={16}/>VS Code</button>
        <button type="button" className={tab==='github'?'active':''} onClick={()=>setTab('github')}><GitBranch size={16}/>GitHub</button>
        <button type="button" className={tab==='preview'?'active':''} onClick={()=>setTab('preview')}><MonitorPlay size={16}/>App Preview</button>
      </div>

      {ideMessage && <div className="moduleNotice">{ideMessage}</div>}

      {tab==='ide' && (
        <div className="engineeringIdePane">
          <div className="engineeringIdeToolbar">
            <div>
              <strong>RideArrivo Engineering IDE</strong>
              <span>{ideUrl?'Secure remote workspace active':'Start an isolated browser IDE backed by your persistent /workspace volume.'}</span>
            </div>
            <div className="buttonRow">
              {!ideUrl ? (
                <button type="button" className="primaryButton" disabled={ideBusy} onClick={()=>void startIde()}>
                  {ideBusy?<LoaderCircle className="spin" size={16}/>:<Play size={16}/>} Start secure VS Code
                </button>
              ) : (
                <>
                  <button type="button" className="glassButton" disabled={ideBusy} onClick={()=>setIdeUrl(`${gatewayOrigin()}/ide/?reload=${Date.now()}`)}><RefreshCw size={15}/>Reload</button>
                  <button type="button" className="glassButton" disabled={ideBusy} onClick={()=>void stopIde()}><Square size={15}/>Stop IDE</button>
                </>
              )}
            </div>
          </div>

          {ideUrl ? (
            <iframe
              className="engineeringIdeFrame"
              title="RideArrivo secure VS Code"
              src={ideUrl}
              allow="clipboard-read; clipboard-write; fullscreen"
              referrerPolicy="no-referrer"
              allowFullScreen
            />
          ) : (
            <div className="engineeringIdeEmpty">
              <TerminalSquare size={36}/>
              <strong>Remote IDE is ready to be provisioned</strong>
              <p>
                When the Linux gateway is deployed, this starts code-server inside the same isolated engineer container used by ParAsYtE Linux. Browser file download/upload controls are disabled; source work remains in the persistent engineering volume.
              </p>
            </div>
          )}
        </div>
      )}

      {tab==='github' && (
        <div className="engineeringGithubPane">
          <div className="engineeringGithubToolbar">
            <div>
              <strong>GitHub Engineering · {githubOrg}</strong>
              <span>Repositories, open pull requests and workflow runs without exposing a GitHub token to the browser.</span>
            </div>
            <button type="button" className="glassButton" disabled={githubLoading} onClick={()=>void loadGitHub()}>
              <RefreshCw size={15}/>Refresh
            </button>
          </div>

          {githubMessage && <div className="moduleNotice">{githubMessage}</div>}

          {githubLoading ? (
            <div className="engineeringLoading"><LoaderCircle className="spin" size={22}/>Loading engineering repositories…</div>
          ) : githubConfigured===false ? (
            <div className="engineeringGithubSetup">
              <ShieldCheck size={30}/>
              <strong>GitHub App connection required</strong>
              <p>
                Configure the gateway GitHub App with read-only Metadata, Pull requests and Actions permissions and install it only on the RideArrivo repositories the engineering workspace should expose. The private key stays on the gateway server.
              </p>
            </div>
          ) : (
            <div className="engineeringGithubLayout">
              <aside className="engineeringRepoList">
                {repositories.map(repo=>(
                  <button
                    type="button"
                    key={repo.id}
                    className={selectedRepo===repo.name?'active':''}
                    onClick={()=>setSelectedRepo(repo.name)}
                  >
                    <span><strong>{repo.name}</strong><small>{repo.private?'Private':'Public'} · {repo.defaultBranch}</small></span>
                    <small>{relativeTime(repo.updatedAt)}</small>
                  </button>
                ))}
                {repositories.length===0 && <p>No repositories are available to the configured GitHub App.</p>}
              </aside>

              <div className="engineeringRepoDetail">
                {selectedRepository ? (
                  <>
                    <div className="engineeringRepoHeading">
                      <div>
                        <span className="eyebrow">REPOSITORY</span>
                        <h4>{selectedRepository.fullName}</h4>
                        <p>Default branch: {selectedRepository.defaultBranch}</p>
                      </div>
                      <button type="button" className="glassButton" onClick={()=>void copyClone(selectedRepository)}>
                        <Clipboard size={15}/>{copied===selectedRepository.name?'Copied':'Copy clone command'}
                      </button>
                    </div>

                    <div className="engineeringRepoColumns">
                      <div className="engineeringRepoPanel">
                        <div className="engineeringRepoPanelTitle"><GitPullRequest size={16}/><strong>Open pull requests</strong></div>
                        {(summary?.pullRequests || []).map(pr=>(
                          <article key={pr.number}>
                            <span>#{pr.number}{pr.draft?' · Draft':''}</span>
                            <strong>{pr.title}</strong>
                            <small>{pr.author} · {relativeTime(pr.updatedAt)}</small>
                          </article>
                        ))}
                        {summary && summary.pullRequests.length===0 && <p>No open pull requests.</p>}
                        {!summary && <p>Loading repository activity…</p>}
                      </div>

                      <div className="engineeringRepoPanel">
                        <div className="engineeringRepoPanelTitle"><Workflow size={16}/><strong>Recent Actions</strong></div>
                        {(summary?.workflowRuns || []).slice(0,12).map(run=>(
                          <article key={run.id}>
                            <span className="engineeringRunState"><Activity size={13}/>{run.conclusion || run.status}</span>
                            <strong>{run.name}</strong>
                            <small>{run.branch} · {relativeTime(run.updatedAt)}</small>
                          </article>
                        ))}
                        {summary && summary.workflowRuns.length===0 && <p>No workflow runs found.</p>}
                        {!summary && <p>Loading repository activity…</p>}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="engineeringGithubSetup"><GitBranch size={30}/><strong>Select a repository</strong><p>Repository activity will appear here.</p></div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab==='preview' && (
        <div className="engineeringPreviewPane">
          <div className="engineeringPreviewToolbar">
            <div>
              <strong>Local app preview</strong>
              <span>Run the app inside VS Code, expose its container port, and test it here without using the engineer&apos;s laptop localhost.</span>
            </div>
            <div className="engineeringPortControl">
              <label>Port<input value={previewPort} inputMode="numeric" onChange={event=>setPreviewPort(event.target.value.replace(/\D/g,'').slice(0,5))}/></label>
              <button type="button" className="primaryButton" onClick={openPreview}><MonitorPlay size={15}/>Open preview</button>
            </div>
          </div>

          <div className="engineeringPreviewHint">
            <CheckCircle2 size={16}/>
            <span>Example: run <code>npm run dev -- --host 0.0.0.0</code>, note the port (commonly 5173), then open it here. Online environments can still be tested in PArAsYtE Browser.</span>
          </div>

          {previewUrl ? (
            <iframe
              className="engineeringPreviewFrame"
              title="Engineering local app preview"
              src={previewUrl}
              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="engineeringIdeEmpty"><MonitorPlay size={36}/><strong>No local preview open</strong><p>Start VS Code, run your project, then choose the development port above.</p></div>
          )}
        </div>
      )}
    </section>
  )
}
