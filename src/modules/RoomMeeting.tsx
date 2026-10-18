import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useHoldIdleSignOut } from '../lib/useIdleSignOut'
import { useWakeLock } from '../lib/useWakeLock'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useRetiredClients } from '../room7-shared/useRetiredClients'
import {
  DoorOpen,
  LayoutList,
  Link2,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minimize2,
  NotebookPen,
  PhoneOff,
  RefreshCw,
  ShieldCheck,
  WifiOff
} from 'lucide-react'
import {
  RealtimeKitProvider,
  useRealtimeKitClient
} from '@cloudflare/realtimekit-react'
import { RtkMeeting } from '@cloudflare/realtimekit-react-ui'
import FaceTimeStage from './FaceTimeStage'
import { classicCall } from '../lib/callStyle'
import {
  Room7ExtrasControls,
  Room7ExtrasOverlay,
  useRoom7MeetingExtras
} from '../room7-shared/useRoom7MeetingExtras'
import {
  Room7PeopleButton,
  Room7PeoplePanel,
  useJoinedCount
} from '../room7-shared/Room7PeoplePanel'
import type { Room7Moderation } from '../room7-shared/Room7PeoplePanel'
import type { RoomLeaveReason } from './RoomModule'
import RoomChat from '../room7-shared/RoomChat'
import { useRoomChat } from '../room7-shared/useRoomChat'
import '../room7-shared/room7-chat.css'
import { supabase } from '../lib/supabase'
import { useCanGiveRibbon } from '../components/Recognition'

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
  can_moderate?:boolean
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
  onExtend,
  moderation,
  audioOnly=false,
  chatCall=false
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
  moderation?:Room7Moderation
  audioOnly?:boolean
  /** A one-to-one call started from Chat: shown as a call, not as a ROOM 7 meeting. */
  chatCall?:boolean
}){
  const [meeting,initMeeting]=useRealtimeKitClient()
  useHoldIdleSignOut(Boolean(meeting))
  useWakeLock(Boolean(meeting))
  const {retire,isRetired}=useRetiredClients()
  const meetingRef=useRef(meeting)
  meetingRef.current=meeting
  const [initError,setInitError]=useState('')
  const [ending,setEnding]=useState(false)
  const [copied,setCopied]=useState<''|'staff'|'guest'>('')
  const [connection,setConnection]=useState<Connection>('connected')
  const [rejoinAttempt,setRejoinAttempt]=useState(0)
  const [frameStyle,setFrameStyle]=useState<CSSProperties>({})
  const [peopleOpen,setPeopleOpen]=useState(false)
  const [teamChatOpen,setTeamChatOpen]=useState(false)
  const [initTry,setInitTry]=useState(0)
  const [elapsed,setElapsed]=useState(0)
  // Chat calls look like FaceTime unless this device chose the classic screen.
  const [faceTime]=useState(()=>chatCall&&!classicCall())
  useEffect(()=>{
    if(!chatCall)return
    const started=Date.now()
    const timer=window.setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000)
    return()=>window.clearInterval(timer)
  },[chatCall])

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
  // The "did the new connection come up" watchdog, so it can be cancelled.
  const joinWatchRef=useRef(0)
  useEffect(()=>()=>{
    if(joinWatchRef.current)window.clearTimeout(joinWatchRef.current)
  },[])

  // A different room is a fresh join: show the setup screen again.
  useEffect(()=>{
    rejoiningRef.current=false
  },[session.room.id])

  useEffect(()=>{
    let active=true
    let client:{leave:()=>Promise<void>}|undefined
    setInitError('')

    // One failed start used to leave a dead black screen. A start can fail for
    // a moment (network blip, media service busy), so try up to three times
    // before giving up, and only then show the error with a Try again button.
    const start=async()=>{
      let lastError:unknown=null
      for(let attempt=1;attempt<=3&&active;attempt++){
        try{
          const created=await initMeeting({
            authToken:session.auth_token,
            defaults:rejoiningRef.current?mediaStateRef.current:{audio:true,video:!audioOnly}
          })
          if(!created)return
          if(active)client=created
          else retire(created)
          return
        }catch(error){
          lastError=error
          if(attempt<3)await wait(1200*attempt)
        }
      }
      if(active){
        const message=lastError instanceof Error?lastError.message:''
        setInitError(
          /ERR0001|failed to initiali[sz]e/i.test(message)||!message
            ?'Could not connect the call. Check your internet connection and try again.'
            :message
        )
      }
    }
    void start()
    // A new token (rejoin) or leaving the page: shut the old client down so
    // it cannot come back as a ghost copy of this person.
    return()=>{
      active=false
      retire(client)
    }
  },[session.auth_token,initTry])

  const reconnect=useCallback(async()=>{
    if(rejoinInFlightRef.current)return
    rejoinInFlightRef.current=true
    setConnection('reconnecting')
    rejoiningRef.current=true
    // Stop the dead client first. Otherwise the SDK's own recovery can
    // bring it back next to the new connection and show us twice.
    retire(meetingRef.current)
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
          if(joinWatchRef.current)window.clearTimeout(joinWatchRef.current)
          joinWatchRef.current=window.setTimeout(()=>{
            joinWatchRef.current=0
            if(rejoinInFlightRef.current){
              rejoinInFlightRef.current=false
              setConnection('lost')
            }
          },25000)
          return
        }
      }catch(error){
        const message=error instanceof Error?error.message:''
        if(/removed/i.test(message)){
          rejoinInFlightRef.current=false
          onLeftRef.current('kicked')
          return
        }
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
      if(isRetired(meeting))return
      if(joinWatchRef.current){window.clearTimeout(joinWatchRef.current);joinWatchRef.current=0}
      rejoinInFlightRef.current=false
      setConnection('connected')
      setRejoinAttempt(0)
    }

    const handleRoomLeft=({state}:{state:string})=>{
      // Our own shutdown of a replaced client is not the user leaving.
      if(isRetired(meeting))return
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
  },[meeting,reconnect,session.role,isRetired])

  // When the network or the app comes back after the connection was given up
  // on, try again by itself instead of waiting for a tap.
  const connectionRef=useRef(connection)
  connectionRef.current=connection
  useEffect(()=>{
    const again=()=>{
      if(document.visibilityState==='hidden')return
      if(connectionRef.current==='lost'&&!rejoinInFlightRef.current){
        setConnection('connected')
        window.setTimeout(()=>void reconnect(),0)
      }
    }
    window.addEventListener('online',again)
    document.addEventListener('visibilitychange',again)
    return()=>{
      window.removeEventListener('online',again)
      document.removeEventListener('visibilitychange',again)
    }
  },[reconnect])

  // Closing the tab or the installed app leaves the meeting properly, so the
  // person does not stay in the room as a ghost for minutes.
  useEffect(()=>{
    if(!meeting)return
    // A page that may come back from the back/forward cache (persisted) is
    // only paused, not closed, so it keeps its place in the meeting.
    const leaveNow=(event:PageTransitionEvent)=>{
      if(event.persisted)return
      void meeting.leave().catch(()=>undefined)
    }
    window.addEventListener('pagehide',leaveNow)
    return()=>window.removeEventListener('pagehide',leaveNow)
  },[meeting])

  const scheduleLeave=useCallback(()=>{
    void meeting?.leave().catch(()=>{})
    onLeftRef.current('schedule')
  },[meeting])

  const ribbonRights=useCanGiveRibbon()
  const extras=useRoom7MeetingExtras({
    meeting,
    role:session.role==='host'?'host':'member',
    scheduledEnd:session.event?.scheduled_end||null,
    onAutoEnd:session.role==='host'?onEnded:undefined,
    onExtend:session.role==='host'?onExtend:undefined,
    onScheduleLeave:scheduleLeave,
    buzzer:session.role==='host'&&ribbonRights.canGive?{
      onBuzz:async(honoree,message)=>{
        if(!supabase)return 'Not connected.'
        const {error}=await supabase.rpc('give_room_buzzer',{p_honoree:honoree,p_message:message,p_ref:session.room.id})
        return error?error.message:null
      }
    }:undefined
  })

  // The saved team chat of this meeting (not for one-to-one calls). It is
  // kept after the meeting ends, unlike RealtimeKit's own chat.
  const myUserId=String(meeting?.self?.customParticipantId||'')
  const teamChat=useRoomChat(chatCall||!myUserId?'':session.room.id,myUserId,teamChatOpen&&!minimized)

  // Creator or administrator (decided by the server on join).
  const canModerate=Boolean(moderation)&&(session.can_moderate??session.role==='host')
  const joinedCount=useJoinedCount(canModerate?meeting:null)

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
    if(!chatCall&&!window.confirm('End this ROOM 7 meeting for everyone? Participants will be disconnected and the ROOM 7 code will stop accepting joins.'))return
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

  const hangUp=()=>{
    if(session.role==='host'){void endRoom();return}
    void meeting?.leave().catch(()=>{})
    onLeft('left')
  }
  const clock=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`
  const callTitle=session.room.title.replace(/^Call with /,'')

  const frame=(
      <div className={chatCall?'callStage':'roomMeetingFrame'}>
        {initError&&
          <div className="roomMeetingState">
            <ShieldCheck size={30}/>
            <h3>{chatCall?'The call could not start':'ROOM 7 could not start'}</h3>
            <p>{initError}</p>
            <div className="roomMeetingStateActions">
              <button type="button" className="primaryButton" onClick={()=>setInitTry(n=>n+1)}>Try again</button>
              <button type="button" className="glassButton" onClick={()=>onLeft('left')}>{chatCall?'Back to chat':'Return to ROOM 7'}</button>
            </div>
          </div>
        }
        {!initError&&!meeting&&
          <div className="roomMeetingState">
            <LoaderCircle size={32} className="roomSpin"/>
            <h3>{chatCall?'Connecting call':'Preparing ROOM 7'}</h3>
            <p>Initialising secure audio and video.</p>
          </div>
        }
        {!initError&&meeting&&
          <RealtimeKitProvider value={meeting}>
            {faceTime
              ?<FaceTimeStage
                key={session.auth_token}
                meeting={meeting}
                audioOnly={audioOnly}
                title={callTitle}
                clock={clock}
                minimized={minimized}
                onHangUp={hangUp}
                onMinimize={onMinimize}
                onRestore={onRestore}
                onJoinError={setInitError}
              />
              :<RtkMeeting
                key={session.auth_token}
                meeting={meeting}
                mode="fill"
                showSetupScreen={!rejoiningRef.current}
                leaveOnUnmount={false}
              />}
            <Room7ExtrasOverlay extras={extras}/>
            {!chatCall&&teamChatOpen&&!minimized&&myUserId&&
              <aside className="rcDrawer" aria-label="Team chat">
                <header>
                  <strong>Team chat</strong>
                  <button type="button" aria-label="Close team chat" onClick={()=>setTeamChatOpen(false)}>×</button>
                </header>
                <RoomChat chat={teamChat} myId={myUserId} canModerate={canModerate}/>
              </aside>
            }
            {canModerate&&moderation&&peopleOpen&&!minimized&&
              <Room7PeoplePanel
                meeting={meeting}
                creatorId={session.room.created_by}
                selfTarget={String(meeting.self?.customParticipantId||'')}
                moderation={moderation}
                onClose={()=>setPeopleOpen(false)}
              />
            }
          </RealtimeKitProvider>
        }
        {connection!=='connected'&&
          <div className={`roomReconnect ${connection}`} role="status">
            {connection==='reconnecting'
              ?<><RefreshCw size={18} className="roomSpin"/>
                <span>Connection interrupted. Reconnecting{rejoinAttempt>1?` (attempt ${rejoinAttempt})`:''}...</span></>
              :<><WifiOff size={18}/>
                <span>{chatCall?'Could not reconnect the call.':'Could not reconnect to ROOM 7.'}</span>
                <button type="button" onClick={retryNow}>Try again</button>
                <button type="button" onClick={()=>onLeft('lost')}>Leave</button></>
            }
          </div>
        }
      </div>
  )

  const callScreen=(
    <section
      className={`callScreen ${minimized?'callMini':'callFull'} ${audioOnly?'callVoice':'callVideo'}${faceTime?' callFT':''}`}
      role="dialog"
      aria-label={`${audioOnly?'Voice':'Video'} call with ${callTitle}`}
    >
      {!faceTime&&<header className="callBar">
        <div className="callWho">
          <span className="callPill"><i/>{audioOnly?'Voice call':'Video call'}</span>
          <strong>{callTitle}</strong>
          <small className="callClock">{clock}</small>
        </div>
        <div className="callBtns">
          <button
            type="button"
            className="callRoundBtn"
            onClick={minimized?onRestore:onMinimize}
            aria-label={minimized?'Return to call':'Minimize call'}
            title={minimized?'Return to call':'Minimize call'}
          >
            {minimized?<Maximize2 size={18}/>:<Minimize2 size={18}/>}
          </button>
          <button type="button" className="callEndBtn" disabled={ending} onClick={hangUp}>
            {ending?<LoaderCircle size={18} className="roomSpin"/>:<PhoneOff size={18}/>}
            <span>{ending?'Ending':'End'}</span>
          </button>
        </div>
      </header>}
      {frame}
    </section>
  )

  const call=(
    <section
      className={`roomCallPage roomCallPortal responsiveModule ${minimized?'roomCallMini':'roomCallFull'}`}
      style={minimized?undefined:(frameStyle.width?frameStyle:{visibility:'hidden'})}
      aria-label={chatCall?`${audioOnly?'Voice':'Video'} call: ${session.room.title}`:`ROOM 7 call: ${session.room.title}`}
    >
      <div className="roomCallTopbar">
        <div>
          <span className="roomLivePill"><span/>{chatCall?(audioOnly?'VOICE CALL':'VIDEO CALL'):'LIVE ROOM 7'}</span>
          <strong>{session.room.title}</strong>
          {!chatCall&&<small>{session.room.room_code} · {session.role==='host'?'Host':'Participant'}</small>}
          {!chatCall&&<span className={`roomAiBadge ${session.room.ai_notes_enabled?'on':'off'}`}>
            <NotebookPen size={13}/>
            {session.room.ai_notes_enabled?'R7 AI Notes On':'R7 AI Notes Off'}
          </span>}
        </div>
        <div className="roomCallActions responsiveActionBar">
          {!chatCall&&<Room7ExtrasControls extras={extras} compact={minimized}/>}
          {canModerate&&!minimized&&!chatCall&&
            <Room7PeopleButton open={peopleOpen} count={joinedCount} onToggle={()=>{setPeopleOpen(open=>!open);setTeamChatOpen(false)}}/>
          }
          {!chatCall&&!minimized&&myUserId&&
            <button type="button" className="glassButton roomSecondaryCallAction" aria-pressed={teamChatOpen} onClick={()=>{setTeamChatOpen(open=>!open);setPeopleOpen(false)}} title="Saved chat for this meeting. It stays after the meeting ends.">
              <MessageSquare size={16}/>Team chat{teamChat.unread>0&&!teamChatOpen?` (${teamChat.unread>9?'9+':teamChat.unread})`:''}
            </button>
          }
          {!chatCall&&<button type="button" className="glassButton roomSecondaryCallAction" onClick={()=>void copyLink('staff')} title="Link for RideArrivo staff (intranet sign-in)">
            <Link2 size={16}/>{copied==='staff'?'Copied':'Staff link'}
          </button>}
          {session.event&&!chatCall&&
            <button type="button" className="glassButton roomSecondaryCallAction" onClick={()=>void copyLink('guest')} title="Public link for external guests">
              <Link2 size={16}/>{copied==='guest'?'Copied':'Guest link'}
            </button>
          }
          {!chatCall&&<button type="button" className="glassButton roomSecondaryCallAction" onClick={onShowList} title="Open the ROOM 7 list while the call continues in the corner">
            <LayoutList size={16}/>Rooms
          </button>}
          {chatCall&&session.role!=='host'&&
            <button type="button" className="roomDangerButton roomCallEnd" onClick={()=>{void meeting?.leave().catch(()=>{});onLeft('left')}}>
              <DoorOpen size={16}/>End call
            </button>
          }
          {session.role==='host'&&
            <button type="button" className={`roomDangerButton${chatCall?' roomCallEnd':''}`} disabled={ending} onClick={()=>void endRoom()}>
              {ending?<LoaderCircle size={16} className="roomSpin"/>:<DoorOpen size={16}/>}
              {chatCall?(ending?'Ending...':'End call'):(ending?'Ending ROOM 7...':'End ROOM 7')}
            </button>
          }
          <button
            type="button"
            className="glassButton roomMinimizeButton"
            onClick={minimized?onRestore:onMinimize}
            aria-label={minimized?(chatCall?'Return to call':'Return to ROOM 7 call'):(chatCall?'Minimize call':'Minimize ROOM 7 call')}
          >
            {minimized?<Maximize2 size={16}/>:<Minimize2 size={16}/>}
            {minimized?'Return to call':'Minimize'}
          </button>
        </div>
      </div>

      {frame}
    </section>
  )

  // The call always lives in a portal on <body>. Parents in the intranet use
  // backdrop-filter and overflow:hidden, which would otherwise trap a
  // position:fixed call window and could clip it off-screen.
  return createPortal(chatCall?callScreen:call,document.body)
}
