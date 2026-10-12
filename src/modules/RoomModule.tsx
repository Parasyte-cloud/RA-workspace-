import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  History,
  LoaderCircle,
  LogIn,
  NotebookPen,
  Plus,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Users,
  Video,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CALL_FINISHED_EVENT, JOIN_ROOM_EVENT, type CallFinishedDetail, type JoinRoomDetail } from '../lib/roomApi'
import {
  friendlyEventError,
  invitationText,
  makeGuestReady,
  whatsappLink,
  type GuestReady,
  type Invoke
} from '../lib/room7Share'
import RoomEventDocumentsManager from './RoomEventDocumentsManager'
import Room7EventControlCenter from './Room7EventControlCenter'
import GuestAdmissionPanel from './GuestAdmissionPanel'
import '../room.css'
import type { RemovedPerson, Room7Moderation } from '../room7-shared/Room7PeoplePanel'

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

export type RoomLeaveReason='left'|'ended'|'kicked'|'rejected'|'schedule'|'lost'

type ConfigurationState='checking'|'ready'|'missing'|'error'

type FunctionPayload={
  action:'config'|'create'|'join'|'end'|'remove'|'removed'|'readmit'
  target?:string
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
  // Rooms that belong to a chat call. They live in Chat's Calls tab, not here.
  const [callRoomCodes,setCallRoomCodes]=useState<Set<string>>(new Set())
  const [myId,setMyId]=useState('')
  const [endingId,setEndingId]=useState('')
  const [roomTitle,setRoomTitle]=useState('')
  const [joinCode,setJoinCode]=useState(initialCode)
  const [aiNotesEnabled,setAiNotesEnabled]=useState(true)
  const [session,setSession]=useState<RoomSession|null>(null)
  const [configState,setConfigState]=useState<ConfigurationState>('checking')
  const [loading,setLoading]=useState(true)
  const [creating,setCreating]=useState(false)
  const [joining,setJoining]=useState(false)
  const [notice,setNotice]=useState('')
  // While in a call the host can open the room list (to manage events,
  // documents, or another room) with the call shrunk to the corner.
  const [showList,setShowList]=useState(false)
  // Placeholder in the page that the full-size call lines up with. The call
  // itself lives in a portal on <body> so no parent style can clip it.
  const [callAnchor,setCallAnchor]=useState<HTMLDivElement|null>(null)
  const [created,setCreated]=useState<{code:string,title:string}|null>(null)
  const [audioOnly,setAudioOnly]=useState(false)
  const [guestInvite,setGuestInvite]=useState<GuestReady|null>(null)
  const [guestBusy,setGuestBusy]=useState('')
  const [guestError,setGuestError]=useState('')
  const [copied,setCopied]=useState('')

  const invokeRoom=useCallback(async(payload:FunctionPayload)=>{
    if(!client)throw new Error('Workspace authentication is not configured.')
    const {data,error}=await client.functions.invoke('room-session',{body:payload})
    if(error){
      // A 4xx from the function arrives as a generic "non-2xx" error; the
      // real reason (removed, ended, not found) is in the response body.
      const response=(error as {context?:unknown}).context
      if(response instanceof Response){
        const body=await response.clone().json().catch(()=>null)
        if(body&&typeof body.error==='string')throw new Error(body.error)
      }
      throw error
    }
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
      // Best effort: if these lookups fail the list simply shows everything.
      const [{data:calls},{data:auth}]=await Promise.all([
        client.from('chat_calls').select('room_code').order('created_at',{ascending:false}).limit(300),
        client.auth.getUser()
      ])
      setCallRoomCodes(new Set((calls||[]).map((row:{room_code:string})=>row.room_code)))
      setMyId(auth?.user?.id||'')
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
      // Stay on the room list so the host can set up the external event
      // (Event button) before joining. Joining is one click on the banner.
      setCreated({code:data.room.room_code,title:data.room.title})
      await loadRooms()
    }catch(error){
      console.error('ROOM 7 creation failed:',error)
      setNotice(error instanceof Error?error.message:'Unable to create ROOM 7.')
    }finally{
      setCreating(false)
    }
  }

  const joinRoom=async(codeOverride?:string,voiceOnly=false)=>{
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
      setCreated(null)
      setAudioOnly(voiceOnly)
      setSession(data as RoomSession)
      await loadRooms()
    }catch(error){
      console.error('ROOM 7 join failed:',error)
      setNotice(error instanceof Error?error.message:'Unable to join ROOM 7.')
    }finally{
      setJoining(false)
    }
  }

  // Chat calls ask ROOM 7 to open a specific room: the caller after starting
  // a call, the callee after pressing Accept.
  const joinRoomRef=useRef(joinRoom)
  joinRoomRef.current=joinRoom
  // The chat call this ROOM 7 session belongs to, if any.
  const callIdRef=useRef('')
  const [chatCall,setChatCall]=useState(false)
  const onOpenRef=useRef(onOpen)
  onOpenRef.current=onOpen
  useEffect(()=>{
    const handler=(event:Event)=>{
      const detail=(event as CustomEvent<JoinRoomDetail>).detail
      if(!detail?.code)return
      // A call started from Chat stays in Chat: no jump to the ROOM 7 page.
      // It opens as a small window over the page and can be expanded.
      if(!detail.inPlace)onOpenRef.current?.()
      callIdRef.current=detail.callId||''
      setChatCall(Boolean(detail.callId))
      void joinRoomRef.current(detail.code,detail.audioOnly)
    }
    window.addEventListener(JOIN_ROOM_EVENT,handler)
    return()=>window.removeEventListener(JOIN_ROOM_EVENT,handler)
  },[])

  useEffect(()=>{if(!session)setChatCall(false)},[session])

  const rejoinSession=useCallback(async()=>{
    const code=session?.room.room_code
    if(!code)return false
    const data=await invokeRoom({action:'join',room_code:code})
    if(!data?.room||!data?.auth_token)throw new Error('ROOM 7 service returned an incomplete session.')
    setSession(data as RoomSession)
    return true
  },[invokeRoom,session?.room.room_code])

  const handleLeft=useCallback((reason:RoomLeaveReason)=>{
    // Hanging up ends the chat call for both people.
    const callId=callIdRef.current
    if(callId){
      callIdRef.current=''
      void client?.rpc('respond_chat_call',{p_call:callId,p_status:'ended'})
    }
    setSession(null)
    setShowList(false)
    const messages:Record<RoomLeaveReason,string>={
      left:'',
      ended:'This ROOM 7 meeting has ended.',
      kicked:'You were removed from this ROOM 7 by the host, or you joined it from another device.',
      rejected:'Your request to join ROOM 7 was declined.',
      schedule:'The scheduled time for this ROOM 7 event has ended.',
      lost:'Your connection to ROOM 7 was lost and could not be restored. Use Join to return.',
    }
    setNotice(messages[reason])
    void loadRooms()
  },[loadRooms,client])

  const roomId=session?.room.id
  const moderation=useMemo<Room7Moderation|undefined>(()=>{
    if(!roomId)return undefined
    return {
      remove:async target=>{await invokeRoom({action:'remove',room_id:roomId,target})},
      readmit:async target=>{await invokeRoom({action:'readmit',room_id:roomId,target})},
      listRemoved:async()=>{
        const data=await invokeRoom({action:'removed',room_id:roomId})
        return Array.isArray(data?.removed)?data.removed as RemovedPerson[]:[]
      }
    }
  },[invokeRoom,roomId])

  const extendSchedule=useCallback(async(endIso:string)=>{
    if(!client||!session)throw new Error('Workspace authentication is not configured.')
    const {data,error}=await client.functions.invoke('room-event-control',{
      body:{action:'configure',room_id:session.room.id,scheduled_end:endIso}
    })
    if(error){
      let message=error.message||'Unable to extend ROOM 7.'
      const response=(error as {context?:unknown}).context
      if(response instanceof Response){
        const payload=await response.clone().json().catch(()=>null)
        if(payload&&typeof payload.error==='string')message=payload.error
      }
      throw new Error(message)
    }
    if(data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'){
      throw new Error(data.error)
    }
    setSession(current=>current?{
      ...current,
      event:{scheduled_end:endIso,event_state:current.event?.event_state||null}
    }:current)
  },[client,session])

  const endCurrentRoom=async()=>{
    if(!session)return
    setNotice('')
    try{
      await invokeRoom({action:'end',room_id:session.room.id})
      const callId=callIdRef.current
      if(callId){
        callIdRef.current=''
        void client?.rpc('respond_chat_call',{p_call:callId,p_status:'ended'})
      }
      setSession(null)
      setNotice('ROOM 7 ended for everyone.')
      await loadRooms()
    }catch(error){
      console.error('ROOM 7 end failed:',error)
      setNotice(error instanceof Error?error.message:'Unable to end ROOM 7.')
      throw error
    }
  }

  // The other person declined, did not answer, cancelled, or hung up: close
  // this call window by itself. The caller hosts the room, so the caller also
  // ends it, which stops it lingering in the room list.
  const endRef=useRef(endCurrentRoom)
  endRef.current=endCurrentRoom
  const sessionRef=useRef(session)
  sessionRef.current=session
  useEffect(()=>{
    const handler=(event:Event)=>{
      const detail=(event as CustomEvent<CallFinishedDetail>).detail
      const current=sessionRef.current
      if(!detail?.callId||!current||detail.callId!==callIdRef.current)return
      callIdRef.current=''
      if(current.role==='host'){
        void endRef.current().catch(()=>setSession(null))
      }else{
        setSession(null)
        setNotice('The call has ended.')
      }
    }
    window.addEventListener(CALL_FINISHED_EVENT,handler)
    return()=>window.removeEventListener(CALL_FINISHED_EVENT,handler)
  },[])

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

  // Talks to the same server function as the Event Control Center, so every
  // server rule (who may open a room to guests, passcode rules) still applies.
  const invokeEvent:Invoke=useCallback(async body=>{
    if(!client)throw new Error('Workspace authentication is not configured.')
    const {data,error}=await client.functions.invoke('room-event-control',{body})
    if(error){
      let message=error.message||'Unable to set up guest access.'
      const response=(error as {context?:unknown}).context
      if(response instanceof Response){
        const payload=await response.clone().json().catch(()=>null)
        if(payload&&typeof payload.error==='string')message=payload.error
      }
      throw new Error(message)
    }
    if(data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'){
      throw new Error(data.error)
    }
    return data as Awaited<ReturnType<Invoke>>
  },[client])

  const prepareGuest=async(room:{id:string;room_code:string;title:string},mode:'keep'|'code'|'new'='keep')=>{
    if(guestBusy)return
    setGuestBusy(room.id)
    setGuestError('')
    setNotice('')
    try{
      const ready=await makeGuestReady(invokeEvent,{id:room.id,code:room.room_code,title:room.title},{newPasscode:mode==='new',codeOnly:mode==='code'})
      setGuestInvite(ready)
      setCopied('')
    }catch(error){
      const message=friendlyEventError(error instanceof Error?error.message:'Unable to set up guest access.')
      setGuestError(message)
      setNotice(message)
    }finally{
      setGuestBusy('')
    }
  }

  const setAdmission=async(invite:GuestReady,admission:'auto'|'host')=>{
    const room=rooms.find(item=>item.room_code===invite.code)
    if(!room||guestBusy)return
    setGuestBusy(room.id)
    setGuestError('')
    try{
      await invokeEvent({action:'configure',room_id:room.id,admission})
      setGuestInvite(current=>current&&current.code===invite.code?{...current,admission}:current)
    }catch(error){
      const message=friendlyEventError(error instanceof Error?error.message:'Unable to change guest approval.')
      setGuestError(message)
      setNotice(message)
    }finally{
      setGuestBusy('')
    }
  }

  const copyText=async(label:string,text:string)=>{
    try{
      await navigator.clipboard.writeText(text)
      setCopied(label)
      window.setTimeout(()=>setCopied(current=>current===label?'':current),2200)
    }catch{
      window.prompt(`Copy the ${label.toLowerCase()}:`,text)
    }
  }

  const fullCall=Boolean(session&&active&&!showList)

  const callNode=session?(
    <Suspense fallback={
      fullCall?
        <div className="roomMeetingState roomMeetingBoot">
          <LoaderCircle size={32} className="roomSpin"/>
          <h3>Loading ROOM 7 meeting engine</h3>
          <p>Preparing secure audio and video controls.</p>
        </div>
      :null
    }>
      <RoomMeeting
        session={session}
        minimized={!fullCall}
        anchor={fullCall?callAnchor:null}
        onMinimize={()=>onMinimize?.()}
        onShowList={()=>setShowList(true)}
        onRestore={()=>{setShowList(false);onOpen?.()}}
        onLeft={handleLeft}
        onEnded={endCurrentRoom}
        onRejoin={rejoinSession}
        onExtend={session.event?extendSchedule:undefined}
        moderation={session.can_moderate?moderation:undefined}
        audioOnly={audioOnly}
        chatCall={chatCall}
      />
    </Suspense>
  ):null

  // Guests waiting for the host's approval show up here, above the call.
  const admissionRoomIds=Array.from(new Set(
    [session?.room.id,...rooms.filter(room=>room.status==='active').map(room=>room.id)]
      .filter((id):id is string=>Boolean(id))
  ))
  const admissionNode=client&&admissionRoomIds.length
    ?<GuestAdmissionPanel roomIds={admissionRoomIds} invoke={invokeEvent}/>
    :null

  if(fullCall){
    return <>
      {callNode}
      {admissionNode}
      <div ref={setCallAnchor} className="roomCallAnchor" aria-hidden="true"/>
    </>
  }

  if(!active)return <>{callNode}{admissionNode}</>

  const meetingRooms=rooms.filter(room=>!callRoomCodes.has(room.room_code))
  const activeRooms=meetingRooms.filter(room=>room.status==='active')
  const recentRooms=meetingRooms.filter(room=>room.status==='ended')

  const endFromList=async(room:{id:string;title:string})=>{
    if(endingId)return
    if(!window.confirm(`End "${room.title}" for everyone? People still inside will be disconnected and the code stops working.`))return
    setEndingId(room.id)
    setNotice('')
    try{
      if(session?.room.id===room.id){
        await endCurrentRoom()
      }else{
        await invokeRoom({action:'end',room_id:room.id})
        setNotice(`${room.title} ended.`)
        await loadRooms()
      }
    }catch(error){
      setNotice(error instanceof Error?error.message:'Unable to end this ROOM 7.')
    }finally{
      setEndingId('')
    }
  }

  return (
    <>
    {callNode}
    {admissionNode}
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
      {created&&
        <div className="roomCreatedBanner">
          <div>
            <strong>{created.title} is ready</strong>
            <span>ROOM 7 {created.code} · Get the guest link and code to share, or join now.</span>
          </div>
          <div className="roomCreatedActions">
            <button
              type="button"
              className="secondaryButton"
              disabled={!!guestBusy}
              onClick={()=>{
                const room=rooms.find(item=>item.room_code===created.code)
                if(room)void prepareGuest(room)
                else setNotice('Refresh the list, then try again.')
              }}
            >
              <Share2 size={15}/>{guestBusy?'Setting up...':'Guest link and code'}
            </button>
            <button
              type="button"
              className="primaryButton"
              disabled={joining||configState!=='ready'}
              onClick={()=>void joinRoom(created.code)}
            >
              <Video size={15}/>Join now
            </button>
            <button type="button" className="iconButton" aria-label="Dismiss" title="Dismiss" onClick={()=>setCreated(null)}>
              <X size={15}/>
            </button>
          </div>
        </div>
      }

      <div className="roomActionGrid">
        <article className="roomActionCard glassCard">
          <div className="roomActionIcon primary"><Plus size={22}/></div>
          <div>
            <span className="eyebrow">NEW MEETING</span>
            <h3>Create ROOM 7</h3>
            <p>Create a meeting as its host. Join straight away, or set it up as an external event first.</p>
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
                <Room7EventControlCenter
                  roomId={room.id}
                  roomTitle={room.title}
                  onSaved={message=>setNotice(`${room.title}: ${message}`)}
                />
                <RoomEventDocumentsManager
                  roomId={room.id}
                  roomTitle={room.title}
                />
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={!!guestBusy}
                  title="Open this meeting to guests and get the link, event code and passcode"
                  onClick={()=>void prepareGuest(room)}
                >
                  <Share2 size={15}/>{guestBusy===room.id?'Setting up...':'Guest link'}
                </button>
                <button type="button" className="iconButton" title="Copy staff link (intranet sign-in required)" aria-label="Copy staff link" onClick={()=>void copyRoom(room)}>
                  <Copy size={16}/>
                </button>
                {room.created_by===myId&&
                  <button
                    type="button"
                    className="secondaryButton roomEndButton"
                    disabled={!!endingId}
                    title="End this meeting for everyone"
                    onClick={()=>void endFromList(room)}
                  >
                    <X size={15}/>{endingId===room.id?'Ending...':'End'}
                  </button>
                }
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

      {guestInvite&&(
        <div className="roomGuestOverlay" role="dialog" aria-label="Guest link and code" onClick={()=>setGuestInvite(null)}>
          <div className="roomGuestCard" onClick={event=>event.stopPropagation()}>
            <header>
              <div>
                <span className="eyebrow">GUEST ACCESS IS OPEN</span>
                <h3>{guestInvite.title}</h3>
              </div>
              <button type="button" className="iconButton" aria-label="Close" onClick={()=>setGuestInvite(null)}><X size={16}/></button>
            </header>

            <p className="roomGuestHint">
              {guestInvite.codeOnly
                ?'Share the link. Guests open it, type their name and email, and press Join. There is nothing else to set up. They can also go to room7.ridearrivo.com and type the event code.'
                :`Guests open the link, type their name and email${guestInvite.passcode?', and the passcode':', and the passcode you gave them'}, then press Join. They can also go to room7.ridearrivo.com and type the event code.`}
            </p>

            {([
              ['Link',guestInvite.link],
              ['Event code',guestInvite.code],
              ...(guestInvite.passcode?[['Passcode',guestInvite.passcode] as [string,string]]:[])
            ] as [string,string][]).map(([label,value])=>(
              <div className="roomGuestRow" key={label}>
                <span>{label}</span>
                <code>{value}</code>
                <button type="button" className="secondaryButton" onClick={()=>void copyText(label,value)}>
                  {copied===label?<><Check size={14}/>Copied</>:<><Copy size={14}/>Copy</>}
                </button>
              </div>
            ))}

            <label className="roomGuestToggle">
              <input
                type="checkbox"
                checked={guestInvite.admission==='host'}
                disabled={!!guestBusy}
                onChange={event=>void setAdmission(guestInvite,event.target.checked?'host':'auto')}
              />
              <span>
                <b>Approve each guest before they enter</b>
                <small>Guests wait on a screen until you press Admit. You see them on top of your call.</small>
              </span>
            </label>

            {!guestInvite.codeOnly&&(
              <div className="roomGuestNote">
                {guestInvite.passcode
                  ?'This passcode is only shown now, so copy it before closing.'
                  :'This meeting already had its own passcode, so it was kept. It cannot be shown again.'}
                <button type="button" className="secondaryButton" disabled={!!guestBusy} onClick={()=>{
                  const room=rooms.find(item=>item.room_code===guestInvite.code)
                  if(room&&window.confirm('Let the event code alone be enough? The old passcode stops being needed, and guests only type their name and email.'))void prepareGuest(room,'code')
                }}>
                  Use the event code only
                </button>
                {!guestInvite.passcode&&(
                  <button type="button" className="secondaryButton" disabled={!!guestBusy} onClick={()=>{
                    const room=rooms.find(item=>item.room_code===guestInvite.code)
                    if(room&&window.confirm('Make a new passcode? The old passcode will stop working for anyone who has not joined yet.'))void prepareGuest(room,'new')
                  }}>
                    Make a new passcode
                  </button>
                )}
              </div>
            )}

            <div className="roomGuestActions">
              <button type="button" className="primaryButton" onClick={()=>void copyText('Invitation',invitationText({title:guestInvite.title,code:guestInvite.code,passcode:guestInvite.passcode,passcodeSeparate:!guestInvite.codeOnly&&!guestInvite.passcode}))}>
                {copied==='Invitation'?<><Check size={15}/>Invitation copied</>:<><Copy size={15}/>Copy invitation message</>}
              </button>
              <a className="secondaryButton" target="_blank" rel="noopener noreferrer" href={whatsappLink(invitationText({title:guestInvite.title,code:guestInvite.code,passcode:guestInvite.passcode,passcodeSeparate:!guestInvite.codeOnly&&!guestInvite.passcode}))}>
                <Send size={15}/>Share on WhatsApp
              </a>
              <a className="secondaryButton" target="_blank" rel="noopener noreferrer" href={guestInvite.link}>
                <ExternalLink size={15}/>Open guest page
              </a>
            </div>
          </div>
        </div>
      )}

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
    </>
  )
}
