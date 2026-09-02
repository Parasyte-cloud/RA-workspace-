import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import {
  Clock3,
  FileText,
  RefreshCw,
  Search,
  Sparkles,
  Users
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type Attendee={
  user_id:string
  display_name:string
  joined_at:string|null
  left_at:string|null
}

type AdminMinuteRow={
  id:string
  room_id:string
  session_id:string
  status:'pending'|'ready'|'failed'
  started_at:string|null
  ended_at:string|null
  duration_seconds:number|null
  end_reason:string|null
  transcript_received_at:string|null
  summary_received_at:string|null
  summary_markdown:string|null
  participant_count:number
  created_at:string
  updated_at:string
  room_code:string
  room_title:string
  host_id:string
  host_name:string|null
  host_email:string|null
  ai_notes_enabled:boolean
  attendees:Attendee[]
}

function when(value:string|null){
  if(!value)return 'Pending'
  const date=new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function duration(seconds:number|null){
  if(seconds===null||seconds<0)return '—'
  const mins=Math.floor(seconds/60)
  const secs=seconds%60
  if(mins<60)return `${mins}m ${secs}s`
  const hours=Math.floor(mins/60)
  return `${hours}h ${mins%60}m`
}

export default function Room7MinutesPanel(){
  const client=supabase
  const [minutes,setMinutes]=useState<AdminMinuteRow[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [search,setSearch]=useState('')
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')

  const load=useCallback(async()=>{
    if(!client){
      setLoading(false)
      setMessage('Workspace data service is not configured.')
      return
    }

    setLoading(true)
    setMessage('')

    try{
      const {data,error}=await client.rpc('admin_room7_minutes')
      if(error)throw error

      const rows=((data||[]) as AdminMinuteRow[]).map(row=>({
        ...row,
        attendees:Array.isArray(row.attendees)?row.attendees:[]
      }))

      setMinutes(rows)
      setSelectedId(current=>
        current&&rows.some(row=>row.id===current)
          ? current
          : rows[0]?.id||''
      )
    }catch(error){
      console.error('ROOM 7 minutes load failed:',error)
      setMessage(error instanceof Error?error.message:'Unable to load ROOM 7 minutes.')
    }finally{
      setLoading(false)
    }
  },[client])

  useEffect(()=>{
    void load()
    const timer=window.setInterval(()=>void load(),30000)
    return()=>window.clearInterval(timer)
  },[load])

  const filtered=useMemo(()=>{
    const term=search.trim().toLowerCase()
    if(!term)return minutes
    return minutes.filter(row=>
      [
        row.room_title,
        row.room_code,
        row.host_name,
        row.host_email,
        row.summary_markdown,
        row.status
      ].some(value=>String(value||'').toLowerCase().includes(term))
    )
  },[minutes,search])

  const selected=minutes.find(row=>row.id===selectedId)||filtered[0]||null

  return <div className="adminRoom7Minutes">
    <div className="glassCard adminRoom7Header">
      <div>
        <span className="eyebrow">R7 AI NOTE TAKER</span>
        <h3>ROOM 7 Minutes</h3>
        <p>
          AI-generated meeting minutes, decisions and action items arrive here automatically
          after a ROOM 7 meeting is processed. This surface is admin-only.
        </p>
      </div>
      <div className="buttonRow">
        <label className="adminRoom7Search">
          <Search size={14}/>
          <input
            value={search}
            onChange={event=>setSearch(event.target.value)}
            placeholder="Search ROOM 7 minutes..."
          />
        </label>
        <button className="glassButton" onClick={()=>void load()} disabled={loading}>
          <RefreshCw size={15} className={loading?'roomSpin':''}/>
          Refresh
        </button>
      </div>
    </div>

    {message&&<div className="moduleNotice">{message}</div>}

    <div className="adminRoom7Split">
      <div className="glassCard adminRoom7List">
        <div className="adminRoom7ListTitle">
          <div><strong>Meeting minutes</strong><small>{filtered.length} available</small></div>
          <Sparkles size={17}/>
        </div>

        {loading&&!minutes.length&&<div className="adminEmpty">Loading ROOM 7 minutes...</div>}
        {!loading&&!filtered.length&&
          <div className="adminEmpty">No ROOM 7 minutes yet. Completed AI-enabled meetings will appear here.</div>
        }

        {filtered.map(row=>
          <button
            key={row.id}
            type="button"
            className={`adminRoom7MinuteRow ${row.id===selected?.id?'selected':''}`}
            onClick={()=>setSelectedId(row.id)}
          >
            <div>
              <strong>{row.room_title||'ROOM 7 meeting'}</strong>
              <small>{row.room_code||'—'} · {when(row.ended_at||row.created_at)}</small>
            </div>
            <span className={`adminRoom7Status ${row.status}`}>{row.status}</span>
          </button>
        )}
      </div>

      <div className="glassCard adminRoom7Detail">
        {!selected&&<div className="adminEmpty">Select a meeting to open its minutes.</div>}

        {selected&&<>
          <div className="adminRoom7DetailHead">
            <div>
              <span className="eyebrow">MEETING RECORD</span>
              <h3>{selected.room_title||'ROOM 7 meeting'}</h3>
              <p>
                ROOM 7 {selected.room_code||'—'} · Host{' '}
                {selected.host_name||selected.host_email||'RideArrivo employee'}
              </p>
            </div>
            <span className={`adminRoom7Status ${selected.status}`}>{selected.status}</span>
          </div>

          <div className="adminRoom7Meta">
            <div><Clock3 size={15}/><span>Started</span><strong>{when(selected.started_at)}</strong></div>
            <div><Clock3 size={15}/><span>Duration</span><strong>{duration(selected.duration_seconds)}</strong></div>
            <div><Users size={15}/><span>Participants</span><strong>{selected.participant_count||selected.attendees.length}</strong></div>
            <div><FileText size={15}/><span>Transcript</span><strong>{selected.transcript_received_at?'Processed':'Pending'}</strong></div>
          </div>

          <div className="adminRoom7Participants">
            <strong>Attendees</strong>
            {selected.attendees.length
              ? <div>{selected.attendees.map(person=>
                  <span key={person.user_id}>{person.display_name||person.user_id}</span>
                )}</div>
              : <small>Attendance will appear after participants join the live session.</small>
            }
          </div>

          <div className="adminRoom7Summary">
            <div>
              <span className="eyebrow">AI MINUTES</span>
              <small>
                {selected.summary_received_at
                  ? `Generated ${when(selected.summary_received_at)}`
                  : 'Waiting for R7 AI processing'
                }
              </small>
            </div>
            {selected.summary_markdown
              ? <pre>{selected.summary_markdown}</pre>
              : <div className="adminEmpty">R7 AI is preparing the meeting summary, decisions and action items.</div>
            }
          </div>

          <div className="adminRoom7Privacy">
            <Sparkles size={16}/>
            <p>
              ROOM 7 stores the generated minutes in RideArrivo. The full transcript is not
              persisted by this MVP; only its processing state is retained.
            </p>
          </div>
        </>}
      </div>
    </div>
  </div>
}
