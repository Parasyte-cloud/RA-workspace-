import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import {
  Copy,
  History,
  LoaderCircle,
  LogIn,
  NotebookPen,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  Video
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../room.css'

type RoomStatus='active'|'ended'

type RoomRecord={
  id:string
  room_code:string
  title:string
  status:RoomStatus
  ai_notes_enabled:boolean
  created_by:string
  started_at:string
  ended_at:string|null
  created_at:string
  updated_at:string
}

type RoomSession={
  room:RoomRecord
  auth_token:string
  participant_id:string
  role:'host'|'member'
}

type ConfigurationState='checking'|'ready'|'missing'|'error'

type FunctionPayload={
  action:'config'|'create'|'join'|'end'
  title?:string
  room_code?:string
  room_id?:string
  ai_notes_enabled?:boolean
}

function normalizeRoomCode(value:string){
  return value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8)
}

function formatWhen(value:string){
  try{
    return new Intl.DateTimeFormat(undefined,{
      day:'numeric',
      month:'short',
      hour:'2-digit',
      minute:'2-digit'
    }).format(new Date(value))
  }catch{
    return value
  }
}

const RoomMeeting=lazy(()=>import('./RoomMeeting'))

export default function RoomModule({
  active=true,
  onOpen,
  onMinimize
}:{
  active?:boolean
  onOpen?:()=>void
  onMinimize?:()=>void
}){
  const client=supabase
  const initialCode=useMemo(()=>{
    if(typeof window==='undefined')return ''
    return normalizeRoomCode(new URLSearchParams(window.location.search).get('room')||'')
  },[])

  const [rooms,setRooms]=useState<RoomRecord[]>([])
  const [roomTitle,setRoomTitle]=useState('')
  const [joinCode,setJoinCode]=useState(initialCode)
  const [aiNotesEnabled,setAiNotesEnabled]=useState(true)
  const [session,setSession]=useState<RoomSession|null>(null)
  const [configState,setConfigState]=useState<ConfigurationState>('checking')
  const [loading,setLoading]=useState(true)
  const [creating,setCreating]=useState(false)
  const [joining,setJoining]=useState(false)
  const [notice,setNotice]=useState('')

  const invokeRoom=useCallback(async(payload:FunctionPayload)=>{
    if(!client)throw new Error('Workspace authentication is not configured.')
    const {data,error}=await client.functions.invoke('room-session',{body:payload})
    if(error)throw error
    if(data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'){
      throw new Error(data.error)
    }
    return data
  },[client])

  const loadRooms=useCallback(async()=>{
    if(!client){
      setRooms([])
      setLoading(false)
      return
    }
    setLoading(true)
    try{
      const {data,error}=await client
        .from('workspace_rooms')
        .select('id,room_code,title,status,ai_notes_enabled,created_by,started_at,ended_at,created_at,updated_at')
        .order('created_at',{ascending:false})
        .limit(20)
      if(error)throw error
      setRooms((data||[]) as RoomRecord[])
    }catch(error){
      console.error('ROOM 7 history load failed:',error)
      setNotice(error instanceof Error?error.message:'Unable to load ROOM 7 history.')
    }finally{
      setLoading(false)
    }
  },[client])

  const loadConfiguration=useCallback(async()=>{
    setConfigState('checking')
    try{
      const data=await invokeRoom({action:'config'})
      setConfigState(data?.configured===true?'ready':'missing')
    }catch(error){
      console.error('ROOM 7 configuration check failed:',error)
      setConfigState('error')
    }
  },[invokeRoom])

  useEffect(()=>{
    if(!active)return
    void loadRooms()
    void loadConfiguration()
  },[active,loadRooms,loadConfiguration])

  const createRoom=async()=>{
    const title=roomTitle.trim()
    if(creating||title.length<2)return
    setCreating(true)
    setNotice('')
    try{
      const data=await invokeRoom({action:'create',title,ai_notes_enabled:aiNotesEnabled})
      if(!data?.room||!data?.auth_token)throw new Error('ROOM 7 service returned an incomplete session.')
      setRoomTitle('')
      setSession(data as RoomSession)
      await loadRooms()
    }catch(error){
      console.error('ROOM 7 creation failed:',error)
      setNotice(error instanceof Error?error.message:'Unable to create ROOM 7.')
    }finally{
      setCreating(false)
    }
  }

  const joinRoom=async(codeOverride?:string)=>{
    const code=normalizeRoomCode(codeOverride||joinCode)
    if(joining||code.length!==8){
      if(code.length!==8)setNotice('Enter the 8-character ROOM 7 code.')
      return
    }
    setJoining(true)
    setNotice('')
    try{
      const data=await invokeRoom({action:'join',room_code:code})
      if(!data?.room||!data?.auth_token)throw new Error('ROOM 7 service returned an incomplete session.')
      setJoinCode(code)
      setSession(data as RoomSession)
      await loadRooms()
    }catch(error){
      console.error('ROOM 7 join failed:',error)
      setNotice(error instanceof Error?error.message:'Unable to join ROOM 7.')
    }finally{
      setJoining(false)
    }
  }

  const endCurrentRoom=async()=>{
    if(!session)return
    setNotice('')
    try{
      await invokeRoom({action:'end',room_id:session.room.id})
      setSession(null)
      setNotice('ROOM 7 ended for everyone.')
      await loadRooms()
    }catch(error){
      console.error('ROOM 7 end failed:',error)
      setNotice(error instanceof Error?error.message:'Unable to end ROOM 7.')
      throw error
    }
  }

  const copyRoom=async(room:RoomRecord)=>{
    const url=new URL(window.location.href)
    url.search=''
    url.hash=''
    url.searchParams.set('section','room')
    url.searchParams.set('room',room.room_code)
    try{
      await navigator.clipboard.writeText(url.toString())
      setNotice(`ROOM 7 invite link copied for ${room.title}.`)
    }catch{
      window.prompt('Copy this ROOM 7 link:',url.toString())
    }
  }

  if(session){
    return <Suspense fallback={
      <div className="roomMeetingState roomMeetingBoot">
        <LoaderCircle size={32} className="roomSpin"/>
        <h3>Loading ROOM 7 meeting engine</h3>
        <p>Preparing secure audio and video controls.</p>
      </div>
    }>
      <RoomMeeting
        session={session}
        minimized={!active}
        onMinimize={()=>onMinimize?.()}
        onRestore={()=>onOpen?.()}
        onLeft={()=>{setSession(null);void loadRooms()}}
        onEnded={endCurrentRoom}
      />
    </Suspense>
  }

  if(!active)return null

  const activeRooms=rooms.filter(room=>room.status==='active')
  const recentRooms=rooms.filter(room=>room.status==='ended')

  return (
    <section className="roomPage">
      <div className="roomHero glassPanel">
        <div className="roomHeroCopy">
          <span className="eyebrow">RIDEARRIVO ROOM 7</span>
          <h2>Meet face to face, without leaving the workplace.</h2>
          <p>
            Start secure internal video meetings, share your screen,
            collaborate in real time and invite teammates with one ROOM 7 code.
          </p>
          <div className="roomTrustRow">
            <span><ShieldCheck size={16}/>Employee authenticated</span>
            <span><Video size={16}/>Audio, video & screen share</span>
            <span><Users size={16}/>Built for RideArrivo teams</span>
            <span><NotebookPen size={16}/>R7 AI meeting minutes</span>
          </div>
        </div>
        <div className="roomHeroMark">
          <div className="roomCameraGlyph"><Video size={54}/></div>
          <strong>Room</strong>
          <small>RideArrivo video meetings</small>
        </div>
      </div>

      {configState==='missing'&&
        <div className="roomConfigNotice">
          <ShieldCheck size={19}/>
          <div>
            <strong>ROOM 7 is ready to plug in</strong>
            <span>The workplace integration is installed. Add the RealtimeKit server credentials to activate live meetings.</span>
          </div>
        </div>
      }
      {configState==='error'&&
        <div className="roomConfigNotice warning">
          <ShieldCheck size={19}/>
          <div>
            <strong>ROOM 7 service is not reachable</strong>
            <span>The ROOM 7 meeting backend has not been deployed yet or could not be reached.</span>
          </div>
        </div>
      }
      {notice&&<div className="roomNotice">{notice}</div>}

      <div className="roomActionGrid">
        <article className="roomActionCard glassCard">
          <div className="roomActionIcon primary"><Plus size={22}/></div>
          <div>
            <span className="eyebrow">NEW MEETING</span>
            <h3>Create ROOM 7</h3>
            <p>Start a new meeting and become the ROOM 7 host.</p>
          </div>
          <label className="roomField">
            <span>ROOM 7 title</span>
            <input
              value={roomTitle}
              maxLength={120}
              placeholder="e.g. Product stand-up"
              disabled={creating||configState!=='ready'}
              onChange={event=>setRoomTitle(event.target.value)}
              onKeyDown={event=>{if(event.key==='Enter')void createRoom()}}
            />
          </label>
          <button
            type="button"
            className={`roomAiToggle ${aiNotesEnabled?'enabled':''}`}
            aria-pressed={aiNotesEnabled}
            disabled={creating||configState!=='ready'}
            onClick={()=>setAiNotesEnabled(value=>!value)}
          >
            <NotebookPen size={18}/>
            <span>
              <strong>R7 AI Note Taker</strong>
              <small>{aiNotesEnabled
                ? 'On · transcript is processed into meeting minutes'
                : 'Off · no AI transcript or summary'
              }</small>
            </span>
            <b>{aiNotesEnabled?'ON':'OFF'}</b>
          </button>
          <button
            type="button"
            className="primaryButton roomWideButton"
            disabled={creating||roomTitle.trim().length<2||configState!=='ready'}
            onClick={()=>void createRoom()}
          >
            {creating?<LoaderCircle size={17} className="roomSpin"/>:<Video size={17}/>}
            {creating?'Creating ROOM 7...':'Create ROOM 7'}
          </button>
        </article>

        <article className="roomActionCard glassCard">
          <div className="roomActionIcon"><LogIn size={22}/></div>
          <div>
            <span className="eyebrow">HAVE A CODE?</span>
            <h3>Join ROOM 7</h3>
            <p>Enter the code shared by a teammate.</p>
          </div>
          <label className="roomField">
            <span>ROOM 7 code</span>
            <input
              value={joinCode}
              maxLength={8}
              inputMode="text"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCD2345"
              disabled={joining||configState!=='ready'}
              onChange={event=>setJoinCode(normalizeRoomCode(event.target.value))}
              onKeyDown={event=>{if(event.key==='Enter')void joinRoom()}}
            />
          </label>
          <button
            type="button"
            className="glassButton roomWideButton"
            disabled={joining||joinCode.length!==8||configState!=='ready'}
            onClick={()=>void joinRoom()}
          >
            {joining?<LoaderCircle size={17} className="roomSpin"/>:<LogIn size={17}/>}
            {joining?'Joining ROOM 7...':'Join ROOM 7'}
          </button>
        </article>
      </div>

      <div className="roomSectionHeading">
        <div>
          <span className="eyebrow">ACTIVE ROOM 7</span>
          <h3>Your current meetings</h3>
          <p>ROOM 7 meetings you created or previously joined appear here.</p>
        </div>
        <button
          type="button"
          className="glassButton"
          disabled={loading}
          onClick={()=>{void loadRooms();void loadConfiguration()}}
        >
          <RefreshCw size={16} className={loading?'roomSpin':''}/>Refresh
        </button>
      </div>

      {loading&&
        <div className="roomEmpty glassCard">
          <LoaderCircle size={28} className="roomSpin"/>
          <strong>Loading Rooms...</strong>
        </div>
      }

      {!loading&&activeRooms.length===0&&
        <div className="roomEmpty glassCard">
          <Video size={34}/>
          <strong>No active ROOM 7 meetings</strong>
          <p>Create ROOM 7 above or join one with a teammate's code.</p>
        </div>
      }

      {!loading&&activeRooms.length>0&&
        <div className="roomList">
          {activeRooms.map(room=>
            <article key={room.id} className="roomListCard glassCard">
              <div className="roomListIcon"><Video size={20}/></div>
              <div className="roomListCopy">
                <span className="roomLivePill"><span/>ACTIVE</span>
                <h4>{room.title}</h4>
                <small>ROOM 7 {room.room_code} · Started {formatWhen(room.started_at)}</small>
              </div>
              <div className="roomListActions">
                <button type="button" className="iconButton" title="Copy invite link" onClick={()=>void copyRoom(room)}>
                  <Copy size={16}/>
                </button>
                <button
                  type="button"
                  className="primaryButton"
                  disabled={joining||configState!=='ready'}
                  onClick={()=>void joinRoom(room.room_code)}
                >
                  Join
                </button>
              </div>
            </article>
          )}
        </div>
      }

      <div className="roomSectionHeading compact">
        <div>
          <span className="eyebrow"><History size={14}/>RECENT</span>
          <h3>ROOM 7 history</h3>
        </div>
      </div>

      {recentRooms.length===0
        ?<div className="roomRecentEmpty">Ended ROOM 7 meetings will appear here.</div>
        :<div className="roomRecentGrid">
          {recentRooms.slice(0,8).map(room=>
            <article key={room.id} className="roomRecentCard">
              <Video size={17}/>
              <div>
                <strong>{room.title}</strong>
                <small>{room.room_code} · {room.ended_at?formatWhen(room.ended_at):formatWhen(room.updated_at)}</small>
              </div>
            </article>
          )}
        </div>
      }
    </section>
  )
}
