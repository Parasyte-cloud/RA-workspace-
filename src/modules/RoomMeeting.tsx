import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  DoorOpen,
  LayoutList,
  Link2,
  LoaderCircle,
  Maximize2,
  Minimize2,
  NotebookPen,
  RefreshCw,
  ShieldCheck,
  WifiOff
} from 'lucide-react'
import {
  RealtimeKitProvider,
  useRealtimeKitClient
} from '@cloudflare/realtimekit-react'
import { RtkMeeting } from '@cloudflare/realtimekit-react-ui'
import {
  Room7ExtrasControls,
  Room7ExtrasOverlay,
  useRoom7MeetingExtras
} from '../room7-shared/useRoom7MeetingExtras'
import type { RoomLeaveReason } from './RoomModule'

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
  event?:{
    scheduled_end:string|null
    event_state:string|null
  }|null
}

type Connection='connected'|'reconnecting'|'lost'

const MAX_REJOIN_ATTEMPTS=6

function wait(ms:number){
  return new Promise(resolve=>window.setTimeout(resolve,ms))
}

export default function RoomMeeting({
  session,
  minimized=false,
  anchor=null,
  onMinimize,
  onShowList,
  onRestore,
  onLeft,
  onEnded,
  onRejoin,
  onExtend
}:{
  session:RoomSession
  minimized?:boolean
  anchor?:HTMLElement|null
  onMinimize:()=>void
  onShowList:()=>void
  onRestore:()=>void
  onLeft:(reason:RoomLeaveReason)=>void
  onEnded:()=>Promise<void>
  onRejoin:()=>Promise<boolean>
  onExtend?:(endIso:string)=>Promise<void>
}){
  const [meeting,initMeeting]=useRealtimeKitClient()
  const [initError,setInitError]=useState('')
  const [ending,setEnding]=useState(false)
  const [copied,setCopied]=useState<''|'staff'|'guest'>('')
  const [connection,setConnection]=useState<Connection>('connected')
  const [rejoinAttempt,setRejoinAttempt]=useState(0)
  const [frameStyle,setFrameStyle]=useState<CSSProperties>({})

  // After a reconnect we skip RealtimeKit's setup screen and restore the
  // microphone/camera state the person had before the drop.
  const rejoiningRef=useRef(false)
  const mediaStateRef=useRef({audio:true,video:true})
  const onLeftRef=useRef(onLeft)
  onLeftRef.current=onLeft
  const onRejoinRef=useRef(onRejoin)
  onRejoinRef.current=onRejoin
  const onEndedRef=useRef(onEnded)
  onEndedRef.current=onEnded
  // True only while our own rejoin is running. Guards against a second
  // reconnect loop and against treating our own stale-peer kick as a
  // real removal.
  const rejoinInFlightRef=useRef(false)

  // A different room is a fresh join: show the setup screen again.
  useEffect(()=>{
    rejoiningRef.current=false
  },[session.room.id])

  useEffect(()=>{
    let active=true
    setInitError('')
    Promise.resolve(initMeeting({
      authToken:session.auth_token,
      defaults:rejoiningRef.current?mediaStateRef.current:{audio:true,video:true}
    })).catch(error=>{
      if(active){
        setInitError(error instanceof Error?error.message:'Unable to initialise ROOM 7 media.')
      }
    })
    return()=>{active=false}
  },[session.auth_token])

  const reconnect=useCallback(async()=>{
    if(rejoinInFlightRef.current)return
    rejoinInFlightRef.current=true
    setConnection('reconnecting')
    rejoiningRef.current=true
    for(let attempt=1;attempt<=MAX_REJOIN_ATTEMPTS;attempt++){
      setRejoinAttempt(attempt)
      if(!navigator.onLine){
        // Wait for the network to come back before spending an attempt.
        await new Promise<void>(resolve=>{
          const done=()=>{window.removeEventListener('online',done);resolve()}
          window.addEventListener('online',done)
          window.setTimeout(done,15000)
        })
      }
      try{
        // The server removes the dead connection before issuing a new
        // token, so the rejoin never shows this person twice.
        const ok=await onRejoinRef.current()
        // Success: the new token re-initialises the meeting; the flag is
        // cleared when that meeting reports roomJoined. If it never does,
        // stop waiting and offer a manual retry.
        if(ok){
          window.setTimeout(()=>{
            if(rejoinInFlightRef.current){
              rejoinInFlightRef.current=false
              setConnection('lost')
            }
          },25000)
          return
        }
      }catch(error){
        const message=error instanceof Error?error.message:''
        if(/ended|not found/i.test(message)){
          rejoinInFlightRef.current=false
          onLeftRef.current('ended')
          return
        }
      }
      await wait(Math.min(2000*attempt,10000))
    }
    rejoinInFlightRef.current=false
    setConnection('lost')
  },[])

  // Meeting lifecycle. Only a deliberate exit leaves the call; a dropped
  // connection is recovered in place.
  useEffect(()=>{
    if(!meeting)return
    const self=meeting.self

    const handleJoined=()=>{
      rejoinInFlightRef.current=false
      setConnection('connected')
      setRejoinAttempt(0)
    }

    const handleRoomLeft=({state}:{state:string})=>{
      mediaStateRef.current={
        audio:Boolean(self.audioEnabled),
        video:Boolean(self.videoEnabled)
      }
      if(state==='disconnected'||state==='failed'){
        void reconnect()
        return
      }
      if(state==='stageLeft'||state==='connected-meeting')return
      if(state==='ended'){
        // A host who ends the call with RealtimeKit's own "end meeting for
        // all" bypasses End ROOM 7. Finish the job so the room and its
        // public event are closed too. Safe to repeat: ending an ended room
        // is a no-op on the server.
        if(session.role==='host'){
          void onEndedRef.current().catch(()=>onLeftRef.current('ended'))
          return
        }
        onLeftRef.current('ended')
        return
      }
      if(state==='kicked'){
        // During our own reconnect the server kicks the old connection;
        // that is expected and must not end the call.
        if(rejoinInFlightRef.current)return
        onLeftRef.current('kicked')
        return
      }
      if(state==='rejected'){onLeftRef.current('rejected');return}
      onLeftRef.current('left')
    }

    const handleSocket=(update:{state:string})=>{
      if(update.state==='reconnecting')setConnection('reconnecting')
      if(update.state==='connected')setConnection('connected')
    }

    self.on('roomJoined',handleJoined as never)
    self.on('roomLeft',handleRoomLeft as never)
    meeting.meta.on('socketConnectionUpdate',handleSocket as never)
    return()=>{
      self.removeListener('roomJoined',handleJoined as never)
      self.removeListener('roomLeft',handleRoomLeft as never)
      meeting.meta.removeListener('socketConnectionUpdate',handleSocket as never)
    }
  },[meeting,reconnect,session.role])

  const scheduleLeave=useCallback(()=>{
    void meeting?.leave().catch(()=>{})
    onLeftRef.current('schedule')
  },[meeting])

  const extras=useRoom7MeetingExtras({
    meeting,
    role:session.role==='host'?'host':'member',
    scheduledEnd:session.event?.scheduled_end||null,
    onAutoEnd:session.role==='host'?onEnded:undefined,
    onExtend:session.role==='host'?onExtend:undefined,
    onScheduleLeave:scheduleLeave
  })

  // Full-size mode lines the portaled call up with the placeholder in the
  // page, stopping at the sticky top bar so it never covers it.
  useLayoutEffect(()=>{
    if(minimized||!anchor){
      setFrameStyle({})
      return
    }
    const update=()=>{
      const rect=anchor.getBoundingClientRect()
      const bar=document.querySelector('.topbar')
      const barBottom=bar?bar.getBoundingClientRect().bottom:0
      const top=Math.max(rect.top,barBottom)
      setFrameStyle({
        top,
        left:rect.left,
        width:rect.width,
        height:Math.max(0,rect.bottom-top)
      })
    }
    update()
    const observer=new ResizeObserver(update)
    observer.observe(anchor)
    window.addEventListener('resize',update)
    window.addEventListener('scroll',update,true)
    return()=>{
      observer.disconnect()
      window.removeEventListener('resize',update)
      window.removeEventListener('scroll',update,true)
    }
  },[anchor,minimized])

  const staffUrl=useMemo(()=>{
    const url=new URL(window.location.href)
    url.search=''
    url.hash=''
    url.searchParams.set('section','room')
    url.searchParams.set('room',session.room.room_code)
    return url.toString()
  },[session.room.room_code])

  const guestUrl=`https://room7.ridearrivo.com/r/${session.room.room_code}`

  const copyLink=async(kind:'staff'|'guest')=>{
    const url=kind==='staff'?staffUrl:guestUrl
    try{
      await navigator.clipboard.writeText(url)
      setCopied(kind)
      window.setTimeout(()=>setCopied(''),1800)
    }catch{
      window.prompt('Copy this ROOM 7 link:',url)
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

  const retryNow=()=>{
    setConnection('connected')
    window.setTimeout(()=>void reconnect(),0)
  }

  const call=(
    <section
      className={`roomCallPage roomCallPortal ${minimized?'roomCallMini':'roomCallFull'}`}
      style={minimized?undefined:(frameStyle.width?frameStyle:{visibility:'hidden'})}
      aria-label={`ROOM 7 call: ${session.room.title}`}
    >
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
          <Room7ExtrasControls extras={extras} compact={minimized}/>
          <button type="button" className="glassButton roomSecondaryCallAction" onClick={()=>void copyLink('staff')} title="Link for RideArrivo staff (intranet sign-in)">
            <Link2 size={16}/>{copied==='staff'?'Copied':'Staff link'}
          </button>
          {session.event&&
            <button type="button" className="glassButton roomSecondaryCallAction" onClick={()=>void copyLink('guest')} title="Public link for external guests">
              <Link2 size={16}/>{copied==='guest'?'Copied':'Guest link'}
            </button>
          }
          <button type="button" className="glassButton roomSecondaryCallAction" onClick={onShowList} title="Open the ROOM 7 list while the call continues in the corner">
            <LayoutList size={16}/>Rooms
          </button>
          {session.role==='host'&&
            <button type="button" className="roomDangerButton" disabled={ending} onClick={()=>void endRoom()}>
              {ending?<LoaderCircle size={16} className="roomSpin"/>:<DoorOpen size={16}/>}
              {ending?'Ending ROOM 7...':'End ROOM 7'}
            </button>
          }
          <button
            type="button"
            className="glassButton roomMinimizeButton"
            onClick={minimized?onRestore:onMinimize}
            aria-label={minimized?'Return to ROOM 7 call':'Minimize ROOM 7 call'}
          >
            {minimized?<Maximize2 size={16}/>:<Minimize2 size={16}/>}
            {minimized?'Return to call':'Minimize'}
          </button>
        </div>
      </div>

      <div className="roomMeetingFrame">
        {initError&&
          <div className="roomMeetingState">
            <ShieldCheck size={30}/>
            <h3>ROOM 7 could not start</h3>
            <p>{initError}</p>
            <button type="button" className="glassButton" onClick={()=>onLeft('left')}>Return to ROOM 7</button>
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
              key={session.auth_token}
              meeting={meeting}
              mode="fill"
              showSetupScreen={!rejoiningRef.current}
              leaveOnUnmount={false}
            />
            <Room7ExtrasOverlay extras={extras}/>
          </RealtimeKitProvider>
        }
        {connection!=='connected'&&
          <div className={`roomReconnect ${connection}`} role="status">
            {connection==='reconnecting'
              ?<><RefreshCw size={18} className="roomSpin"/>
                <span>Connection interrupted. Reconnecting{rejoinAttempt>1?` (attempt ${rejoinAttempt})`:''}...</span></>
              :<><WifiOff size={18}/>
                <span>Could not reconnect to ROOM 7.</span>
                <button type="button" onClick={retryNow}>Try again</button>
                <button type="button" onClick={()=>onLeft('lost')}>Leave</button></>
            }
          </div>
        }
      </div>
    </section>
  )

  // The call always lives in a portal on <body>. Parents in the intranet use
  // backdrop-filter and overflow:hidden, which would otherwise trap a
  // position:fixed call window and could clip it off-screen.
  return createPortal(call,document.body)
}
