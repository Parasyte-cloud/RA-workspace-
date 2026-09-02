import {
  useEffect,
  useMemo,
  useState
} from 'react'
import {
  DoorOpen,
  Link2,
  LoaderCircle,
  NotebookPen,
  ShieldCheck
} from 'lucide-react'
import {
  RealtimeKitProvider,
  useRealtimeKitClient
} from '@cloudflare/realtimekit-react'
import { RtkMeeting } from '@cloudflare/realtimekit-react-ui'

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

export default function RoomMeeting({
  session,
  onBack,
  onEnded
}:{
  session:RoomSession
  onBack:()=>void
  onEnded:()=>Promise<void>
}){
  const [meeting,initMeeting]=useRealtimeKitClient()
  const [initError,setInitError]=useState('')
  const [ending,setEnding]=useState(false)
  const [copied,setCopied]=useState(false)

  useEffect(()=>{
    let active=true
    setInitError('')
    Promise.resolve(initMeeting({
      authToken:session.auth_token,
      defaults:{audio:true,video:true}
    })).catch(error=>{
      if(active){
        setInitError(error instanceof Error?error.message:'Unable to initialise ROOM 7 media.')
      }
    })
    return()=>{active=false}
  },[session.auth_token])

  const inviteUrl=useMemo(()=>{
    const url=new URL(window.location.href)
    url.search=''
    url.hash=''
    url.searchParams.set('section','room')
    url.searchParams.set('room',session.room.room_code)
    return url.toString()
  },[session.room.room_code])

  const copyInvite=async()=>{
    try{
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(()=>setCopied(false),1800)
    }catch{
      window.prompt('Copy this ROOM 7 link:',inviteUrl)
    }
  }

  const endRoom=async()=>{
    if(ending||session.role!=='host')return
    if(!window.confirm('End this ROOM 7 meeting for everyone? Participants will be disconnected and the ROOM 7 code will stop accepting joins.'))return
    setEnding(true)
    try{
      await onEnded()
    }finally{
      setEnding(false)
    }
  }

  return (
    <section className="roomCallPage">
      <div className="roomCallTopbar">
        <div>
          <span className="roomLivePill"><span/>LIVE ROOM 7</span>
          <strong>{session.room.title}</strong>
          <small>{session.room.room_code} · {session.role==='host'?'Host':'Participant'}</small>
          <span className={`roomAiBadge ${session.room.ai_notes_enabled?'on':'off'}`}>
            <NotebookPen size={13}/>
            {session.room.ai_notes_enabled?'R7 AI Notes On':'R7 AI Notes Off'}
          </span>
        </div>
        <div className="roomCallActions">
          <button type="button" className="glassButton" onClick={()=>void copyInvite()}>
            <Link2 size={16}/>{copied?'Copied':'Invite'}
          </button>
          {session.role==='host'&&
            <button type="button" className="roomDangerButton" disabled={ending} onClick={()=>void endRoom()}>
              {ending?<LoaderCircle size={16} className="roomSpin"/>:<DoorOpen size={16}/>}
              {ending?'Ending ROOM 7...':'End ROOM 7'}
            </button>
          }
          <button type="button" className="glassButton" onClick={onBack}>Back to ROOM 7</button>
        </div>
      </div>

      <div className="roomMeetingFrame">
        {initError&&
          <div className="roomMeetingState">
            <ShieldCheck size={30}/>
            <h3>ROOM 7 could not start</h3>
            <p>{initError}</p>
            <button type="button" className="glassButton" onClick={onBack}>Return to ROOM 7</button>
          </div>
        }
        {!initError&&!meeting&&
          <div className="roomMeetingState">
            <LoaderCircle size={32} className="roomSpin"/>
            <h3>Preparing ROOM 7</h3>
            <p>Initialising secure audio and video.</p>
          </div>
        }
        {!initError&&meeting&&
          <RealtimeKitProvider value={meeting}>
            <RtkMeeting
              meeting={meeting}
              mode="fill"
              showSetupScreen={true}
              leaveOnUnmount={true}
            />
          </RealtimeKitProvider>
        }
      </div>
    </section>
  )
}
