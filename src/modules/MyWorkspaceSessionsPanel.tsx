import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  Laptop,
  RefreshCw,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../workflow-unification.css'

type DeviceSession={
  id:string
  employee_id:string
  browser_device_id:string
  browser_name?:string|null
  operating_system?:string|null
  platform?:string|null
  screen_width?:number|null
  screen_height?:number|null
  timezone?:string|null
  location_consent?:boolean|null
  location_sharing_active?:boolean|null
  first_seen_at?:string|null
  last_seen_at?:string|null
  [key:string]:unknown
}

function date(value:unknown){
  if(typeof value!=='string' || !value){
    return '—'
  }

  const parsed=new Date(value)

  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString()
}

export default function MyWorkspaceSessionsPanel(){
  const [sessions,setSessions]=
    useState<DeviceSession[]>([])

  const [loading,setLoading]=useState(true)
  const [notice,setNotice]=useState('')

  const load=useCallback(async()=>{
    const client=supabase

    if(!client){
      setLoading(false)
      return
    }

    setLoading(true)
    setNotice('')

    try{
      const {
        data:{user},
        error:userError,
      }=await client.auth.getUser()

      if(userError){
        throw userError
      }

      if(!user){
        throw new Error(
          'Your workspace session has expired.'
        )
      }

      const result=await client
        .from('employee_device_sessions')
        .select('*')
        .eq(
          'employee_id',
          user.id
        )
        .order(
          'last_seen_at',
          {ascending:false}
        )
        .limit(100)

      if(result.error){
        throw result.error
      }

      setSessions(
        (result.data || []) as DeviceSession[]
      )
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to load your workspace sessions.'
      )
    }finally{
      setLoading(false)
    }
  },[])

  useEffect(()=>{
    void load()
  },[
    load,
  ])

  return (
    <section className="myWorkspaceSessions glassCard">
      <header className="myWorkspaceSessionsHeader">
        <div>
          <span className="eyebrow">
            MY WORKSPACE SESSIONS
          </span>
          <strong>
            Registered browsers and sessions
          </strong>
          <p>
            These are only the workspace sessions associated
            with your signed-in employee identity.
          </p>
        </div>

        <button
          type="button"
          className="glassButton"
          disabled={loading}
          onClick={()=>{
            void load()
          }}
        >
          <RefreshCw size={15}/>
          Refresh
        </button>
      </header>

      {notice&&
        <div className="moduleNotice">
          {notice}
        </div>
      }

      <div className="myWorkspaceSessionsGrid">
        {sessions.map(session=>(
          <article
            key={session.id}
            className="myWorkspaceSession"
          >
            <Laptop size={18}/>

            <div>
              <strong>
                {session.browser_name
                  || 'Workspace browser'
                }
              </strong>

              <span>
                {[
                  session.operating_system,
                  session.platform,
                  session.timezone,
                ]
                  .filter(Boolean)
                  .join(' · ')
                  || 'Registered workspace session'
                }
              </span>

              <small>
                Last seen: {date(session.last_seen_at)}
              </small>

              <small>
                First seen: {date(session.first_seen_at)}
              </small>

              {session.screen_width
                && session.screen_height &&
                <small>
                  Screen: {session.screen_width}
                  ×
                  {session.screen_height}
                </small>
              }
            </div>
          </article>
        ))}

        {!loading&&!sessions.length&&
          <div className="workflowEmpty">
            No registered workspace sessions found.
          </div>
        }
      </div>
    </section>
  )
}
