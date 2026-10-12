import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  CheckCheck,
  Download,
  FileDown,
  FileText,
  MessageSquareText,
  Mic,
  Paperclip,
  Phone,
  Plus,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  Video,
  X
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { strToU8, zipSync } from 'fflate'
import { createCallRoom, requestJoinRoom } from '../lib/roomApi'
import {
  buildTranscript,
  exportFileName,
  uniqueZipName
} from '../lib/chatExport'
import {
  MAX_VOICE_MS,
  baseMime,
  formatDuration,
  pickRecorderMime,
  voiceFileName
} from '../lib/voiceNote'
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILES_PER_SEND,
  attachmentPath,
  formatBytes,
  isAudioMime,
  isImageMime,
  messagePreview,
  validateAttachment
} from '../lib/chatAttachments'

type Person = {
  id:string
  full_name:string
  email:string
  department:string|null
  job_title:string|null
}

type Membership = {
  conversation_id:string
  user_id:string
  joined_at:string
  last_read_at:string
  archived_at:string|null
}

type Conversation = {
  id:string
  is_group:boolean
  title:string|null
  created_by:string
  created_at:string
}

type Message = {
  id:string
  conversation_id:string
  sender_id:string
  body:string
  edited_at:string|null
  created_at:string
  reply_to_id?:string|null
  attachment_path?:string|null
  attachment_name?:string|null
  attachment_mime?:string|null
  attachment_size?:number|null
  attachment_duration_ms?:number|null
  localUrl?:string
  pending?:boolean
  failed?:boolean
}

type DirectRow = {
  conversation:Conversation
  other:Person|null
  membership:Membership
  otherReadAt:string|null
  latest:Message|null
  unread:number
}

const MESSAGE_COLUMNS='id,conversation_id,sender_id,body,edited_at,created_at,reply_to_id,attachment_path,attachment_name,attachment_mime,attachment_size,attachment_duration_ms'
const OPEN_KEY='ra.chat.open'
const ATTACH_BUCKET='chat-attachments'
const SIGNED_SECONDS=3600

type Staged={id:string;file:File;mime:string;previewUrl:string|null}
type Voice={status:'recording'|'ready';ms:number;blob?:Blob;mime:string;url?:string}

const saveBlob=(blob:Blob,name:string)=>{
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  anchor.href=url
  anchor.download=name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),4000)
}

const initials=(value?:string|null)=>{
  const words=(value || '').trim().split(/\s+/).filter(Boolean)
  if(!words.length)return 'RA'
  return words.slice(0,2).map(word=>word[0]?.toUpperCase()).join('')
}

const displayName=(person?:Person|null)=>person?.full_name?.trim() || person?.email || 'RideArrivo employee'

const secondary=(person?:Person|null)=>{
  if(!person)return 'Employee'
  return person.job_title || person.department || person.email
}

const formatTime=(value?:string|null)=>{
  if(!value)return ''
  const date=new Date(value)
  if(Number.isNaN(date.getTime()))return ''
  return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(date)
}

const dayLabel=(value:string)=>{
  const date=new Date(value)
  const today=new Date()
  const yesterday=new Date()
  yesterday.setDate(today.getDate()-1)
  if(date.toDateString()===today.toDateString())return 'Today'
  if(date.toDateString()===yesterday.toDateString())return 'Yesterday'
  return new Intl.DateTimeFormat(undefined,{weekday:'long',month:'short',day:'numeric'}).format(date)
}

const formatListTime=(value?:string|null)=>{
  if(!value)return ''
  const date=new Date(value)
  if(Number.isNaN(date.getTime()))return ''
  const today=new Date()
  if(date.toDateString()===today.toDateString())return formatTime(value)
  const yesterday=new Date()
  yesterday.setDate(today.getDate()-1)
  if(date.toDateString()===yesterday.toDateString())return 'Yesterday'
  return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(date)
}

const canMarkReadNow=()=>document.visibilityState==='visible' && document.hasFocus()

const byTime=(a:Message,b:Message)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()

const mergeMessages=(current:Message[],incoming:Message[])=>{
  const map=new Map<string,Message>()
  for(const message of current)map.set(message.id,message)
  for(const message of incoming)map.set(message.id,message)
  return Array.from(map.values()).sort(byTime)
}

export function ChatModule(){
  const [userId,setUserId]=useState('')
  const [people,setPeople]=useState<Person[]>([])
  const [directs,setDirects]=useState<DirectRow[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [mobileThreadOpen,setMobileThreadOpen]=useState(false)
  const [messages,setMessages]=useState<Message[]>([])
  const [query,setQuery]=useState('')
  const [filter,setFilter]=useState<'all'|'unread'|'archived'>('all')
  const [newChatOpen,setNewChatOpen]=useState(false)
  const [messageText,setMessageText]=useState('')
  const [loading,setLoading]=useState(true)
  const [threadLoading,setThreadLoading]=useState(false)
  const [starting,setStarting]=useState(false)
  const [notice,setNotice]=useState('')
  const [callNotice,setCallNotice]=useState('')
  const [hasCalling,setHasCalling]=useState(false)
  const [calling,setCalling]=useState(false)
  const [isAdmin,setIsAdmin]=useState(false)
  const [replyTo,setReplyTo]=useState<Message|null>(null)
  const [staged,setStaged]=useState<Staged[]>([])
  const [dragging,setDragging]=useState(false)
  const [imageUrls,setImageUrls]=useState<Record<string,string>>({})
  const [voice,setVoice]=useState<Voice|null>(null)
  const [exportOpen,setExportOpen]=useState(false)
  const [exporting,setExporting]=useState('')
  const [viewer,setViewer]=useState<{url:string;name:string;path:string|null}|null>(null)

  const selectedRef=useRef('')
  const directsRef=useRef<DirectRow[]>([])
  const peopleRef=useRef<Map<string,Person>>(new Map())
  const userRef=useRef('')
  const threadRequestRef=useRef(0)
  const scrollRef=useRef<HTMLDivElement|null>(null)
  const stickToBottomRef=useRef(true)
  const forceScrollRef=useRef(true)
  const composerRef=useRef<HTMLTextAreaElement|null>(null)
  const loadedOnceRef=useRef(false)
  const fileInputRef=useRef<HTMLInputElement|null>(null)
  const retryFilesRef=useRef<Map<string,File>>(new Map())
  const dragDepthRef=useRef(0)
  const recorderRef=useRef<MediaRecorder|null>(null)
  const chunksRef=useRef<Blob[]>([])
  const streamRef=useRef<MediaStream|null>(null)
  const voiceStartRef=useRef(0)
  const voiceTimerRef=useRef<number|undefined>(undefined)
  const voiceDiscardRef=useRef(false)
  const voiceMsRef=useRef(0)

  useEffect(()=>{selectedRef.current=selectedId},[selectedId])
  useEffect(()=>{directsRef.current=directs},[directs])
  useEffect(()=>{userRef.current=userId},[userId])
  useEffect(()=>{peopleRef.current=new Map(people.map(person=>[person.id,person]))},[people])

  const peopleMap=useMemo(()=>new Map(people.map(person=>[person.id,person])),[people])
  const selected=useMemo(()=>directs.find(row=>row.conversation.id===selectedId) || null,[directs,selectedId])
  const totalUnread=useMemo(()=>directs.reduce((sum,row)=>row.membership.archived_at?sum:sum+row.unread,0),[directs])
  const archivedCount=useMemo(()=>directs.filter(row=>row.membership.archived_at).length,[directs])

  const matchingPeople=useMemo(()=>{
    const normalized=query.trim().toLowerCase()
    return people
      .filter(person=>person.id!==userId)
      .filter(person=>{
        if(!normalized)return true
        return [person.full_name,person.email,person.department,person.job_title]
          .filter(Boolean)
          .some(value=>String(value).toLowerCase().includes(normalized))
      })
      .slice(0,40)
  },[people,query,userId])

  const visibleDirects=useMemo(()=>{
    const normalized=query.trim().toLowerCase()
    return directs
      .filter(row=>filter==='archived' ? !!row.membership.archived_at : !row.membership.archived_at)
      .filter(row=>filter!=='unread' || row.unread>0)
      .filter(row=>{
        if(!normalized || newChatOpen)return true
        return displayName(row.other).toLowerCase().includes(normalized) ||
          (row.latest?.body || '').toLowerCase().includes(normalized)
      })
  },[directs,filter,query,newChatOpen])

  // Loads the conversation list. Silent after the first load, so refreshes
  // never blank the list or flash a loading state.
  const loadBase=useCallback(async()=>{
    const client=supabase
    if(!client)return
    try{
      const {data:sessionData,error:sessionError}=await client.auth.getSession()
      if(sessionError)throw sessionError
      const me=sessionData.session?.user?.id
      if(!me)throw new Error('Your workspace session is unavailable.')
      setUserId(me)

      let localPeople=peopleRef.current
      if(!localPeople.size){
        const {data:peopleData,error:peopleError}=await client
          .from('employee_profiles')
          .select('id,full_name,email,department,job_title')
          .eq('active',true)
          .order('full_name')
        if(peopleError)throw peopleError
        const activePeople=(peopleData || []) as Person[]
        setPeople(activePeople)
        localPeople=new Map(activePeople.map(person=>[person.id,person]))
        peopleRef.current=localPeople
      }

      const {data:ownMembershipData,error:membershipError}=await client
        .from('social_conversation_members')
        .select('conversation_id,user_id,joined_at,last_read_at,archived_at')
        .eq('user_id',me)
      if(membershipError)throw membershipError
      const ownMemberships=(ownMembershipData || []) as Membership[]
      const ids=ownMemberships.map(row=>row.conversation_id)

      if(!ids.length){
        setDirects([])
        return
      }

      const {data:conversationData,error:conversationError}=await client
        .from('social_conversations')
        .select('id,is_group,title,created_by,created_at')
        .in('id',ids)
        .eq('is_group',false)
      if(conversationError)throw conversationError

      const conversations=(conversationData || []) as Conversation[]
      const directIds=conversations.map(conversation=>conversation.id)
      if(!directIds.length){
        setDirects([])
        return
      }

      const [memberResult,messageResult]=await Promise.all([
        client
          .from('social_conversation_members')
          .select('conversation_id,user_id,joined_at,last_read_at,archived_at')
          .in('conversation_id',directIds),
        client
          .from('social_messages')
          .select(MESSAGE_COLUMNS)
          .in('conversation_id',directIds)
          .order('created_at',{ascending:false})
          .limit(500)
      ])
      if(memberResult.error)throw memberResult.error
      if(messageResult.error)throw messageResult.error

      const members=(memberResult.data || []) as Membership[]
      const recentMessages=(messageResult.data || []) as Message[]
      const ownMap=new Map(ownMemberships.map(row=>[row.conversation_id,row]))
      const latestMap=new Map<string,Message>()
      const unreadMap=new Map<string,number>()

      for(const message of recentMessages){
        if(!latestMap.has(message.conversation_id))latestMap.set(message.conversation_id,message)
        const membership=ownMap.get(message.conversation_id)
        if(
          membership &&
          message.sender_id!==me &&
          new Date(message.created_at).getTime()>new Date(membership.last_read_at).getTime()
        ){
          unreadMap.set(message.conversation_id,(unreadMap.get(message.conversation_id) || 0)+1)
        }
      }

      const rows:DirectRow[]=conversations.map(conversation=>{
        const membership=ownMap.get(conversation.id)!
        const otherMember=members.find(member=>member.conversation_id===conversation.id && member.user_id!==me)
        const isOpenNow=conversation.id===selectedRef.current && canMarkReadNow()
        return {
          conversation,
          other:otherMember ? localPeople.get(otherMember.user_id) || null : null,
          membership,
          otherReadAt:otherMember?.last_read_at || null,
          latest:latestMap.get(conversation.id) || null,
          unread:isOpenNow ? 0 : unreadMap.get(conversation.id) || 0
        }
      }).sort((a,b)=>{
        const aTime=new Date(a.latest?.created_at || a.conversation.created_at).getTime()
        const bTime=new Date(b.latest?.created_at || b.conversation.created_at).getTime()
        return bTime-aTime
      })

      setDirects(rows)
      setNotice('')
    }catch(error){
      setNotice(error instanceof Error ? error.message : 'Unable to load Chat.')
    }finally{
      loadedOnceRef.current=true
      setLoading(false)
    }
  },[])

  const markRead=useCallback(async(conversationId:string)=>{
    const client=supabase
    if(!client || !conversationId || !canMarkReadNow())return
    setDirects(rows=>rows.map(row=>row.conversation.id===conversationId && row.unread>0
      ? {...row,unread:0}
      : row))
    const {error}=await client.rpc('mark_social_conversation_read',{p_conversation_id:conversationId})
    if(error)setNotice(error.message)
  },[])

  const loadThread=useCallback(async(conversationId:string)=>{
    const client=supabase
    const sequence=++threadRequestRef.current
    if(!client || !conversationId){
      setMessages([])
      return
    }
    try{
      const {data,error}=await client
        .from('social_messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id',conversationId)
        .order('created_at',{ascending:false})
        .limit(300)
      if(error)throw error
      if(sequence!==threadRequestRef.current)return
      const fresh=((data || []) as Message[]).reverse()
      // Keep local messages that are still sending or failed.
      setMessages(current=>{
        const local=current.filter(m=>m.conversation_id===conversationId && (m.pending || m.failed))
        return mergeMessages(fresh,local)
      })
      void markRead(conversationId)
    }catch(error){
      if(sequence===threadRequestRef.current){
        setNotice(error instanceof Error ? error.message : 'Unable to load this conversation.')
      }
    }finally{
      if(sequence===threadRequestRef.current)setThreadLoading(false)
    }
  },[markRead])

  // First load, plus a conversation opened from a notification.
  useEffect(()=>{
    let wanted=''
    try{
      wanted=sessionStorage.getItem(OPEN_KEY) || ''
      if(wanted)sessionStorage.removeItem(OPEN_KEY)
    }catch{
      wanted=''
    }
    if(wanted){
      setSelectedId(wanted)
      setMobileThreadOpen(true)
    }
    void loadBase()
  },[loadBase])

  // Open the first conversation on wide screens once the list is known.
  useEffect(()=>{
    if(selectedId || !directs.length)return
    if(typeof window!=='undefined' && window.matchMedia('(min-width: 861px)').matches){
      setSelectedId(directs[0].conversation.id)
    }
  },[directs,selectedId])

  useEffect(()=>{
    if(!selectedId){
      setMessages([])
      return
    }
    setMessages([])
    setReplyTo(null)
    setStaged([])
    setVoice(null)
    setThreadLoading(true)
    forceScrollRef.current=true
    stickToBottomRef.current=true
    void loadThread(selectedId)
    return()=>{
      threadRequestRef.current+=1
    }
  },[selectedId,loadThread])

  // Scroll: jump on open or own send, follow new messages only if already at the bottom.
  useEffect(()=>{
    const element=scrollRef.current
    if(!element)return
    if(forceScrollRef.current || stickToBottomRef.current){
      element.scrollTop=element.scrollHeight
      if(messages.length)forceScrollRef.current=false
    }
  },[messages])

  const onScroll=()=>{
    const element=scrollRef.current
    if(!element)return
    stickToBottomRef.current=element.scrollHeight-element.scrollTop-element.clientHeight<80
  }

  // One realtime channel for the whole session. Handlers read refs, so the
  // channel is never torn down and rebuilt as the user clicks around.
  useEffect(()=>{
    const client=supabase
    if(!client || !userId)return

    const channel=client
      .channel(`native-chat-${userId}`)
      .on(
        'postgres_changes',
        {event:'INSERT',schema:'public',table:'social_messages'},
        payload=>{
          const row=payload.new as Message
          const known=directsRef.current.some(item=>item.conversation.id===row.conversation_id)
          if(!known){
            void loadBase()
            return
          }
          const mine=row.sender_id===userRef.current
          const open=row.conversation_id===selectedRef.current
          setDirects(rows=>rows.map(item=>item.conversation.id===row.conversation_id
            ? {
                ...item,
                latest:row,
                unread:!mine && !(open && canMarkReadNow()) ? item.unread+1 : item.unread
              }
            : item
          ).sort((a,b)=>new Date(b.latest?.created_at || b.conversation.created_at).getTime()-new Date(a.latest?.created_at || a.conversation.created_at).getTime()))
          if(open){
            setMessages(current=>{
              // Replace our own optimistic copy instead of showing it twice.
              const withoutTemp=mine
                ? current.filter(m=>!(m.pending && m.body===row.body && (m.attachment_name||null)===(row.attachment_name||null)))
                : current
              return mergeMessages(withoutTemp,[row])
            })
            if(!mine)void markRead(row.conversation_id)
          }
        }
      )
      .on(
        'postgres_changes',
        {event:'*',schema:'public',table:'social_conversation_members'},
        ()=>{void loadBase()}
      )
      .subscribe()

    return()=>{
      void client.removeChannel(channel)
    }
  },[userId,loadBase,markRead])

  // Safety net if the realtime socket drops: quiet refresh, and on return to the tab.
  useEffect(()=>{
    const refresh=()=>{
      if(document.visibilityState!=='visible')return
      void loadBase()
      if(selectedRef.current)void loadThread(selectedRef.current)
    }
    const timer=window.setInterval(refresh,45000)
    document.addEventListener('visibilitychange',refresh)
    window.addEventListener('focus',refresh)
    return()=>{
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange',refresh)
      window.removeEventListener('focus',refresh)
    }
  },[loadBase,loadThread])

  const startDirect=async(person:Person)=>{
    const client=supabase
    if(!client || starting)return
    setStarting(true)
    setNotice('')
    try{
      const {data,error}=await client.rpc('start_or_get_social_direct_conversation',{
        p_other_user:person.id
      })
      if(error)throw error
      const conversationId=typeof data==='string' ? data : String(data || '')
      if(!conversationId)throw new Error('Chat could not create the conversation.')
      setQuery('')
      setNewChatOpen(false)
      await loadBase()
      setSelectedId(conversationId)
      setMobileThreadOpen(true)
    }catch(error){
      setNotice(error instanceof Error ? error.message : 'Unable to start conversation.')
    }finally{
      setStarting(false)
    }
  }

  const resizeComposer=()=>{
    const element=composerRef.current
    if(!element)return
    element.style.height='auto'
    element.style.height=`${Math.min(element.scrollHeight,140)}px`
  }

  const sendMessage=async(opts:{body:string;file?:File|null;mime?:string;durationMs?:number|null;tempId?:string;replyId?:string|null})=>{
    const client=supabase
    if(!client || !userId || !selectedId)return
    const conversationId=selectedId
    const {body,file,replyId}=opts
    const id=opts.tempId || `temp-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    const optimistic:Message={
      id,
      conversation_id:conversationId,
      sender_id:userId,
      body,
      edited_at:null,
      created_at:new Date().toISOString(),
      reply_to_id:replyId || null,
      attachment_name:file?.name || null,
      attachment_mime:file ? opts.mime || file.type : null,
      attachment_size:file?.size ?? null,
      attachment_duration_ms:opts.durationMs ?? null,
      localUrl:file && (isImageMime(opts.mime || file.type) || isAudioMime(opts.mime || file.type)) ? URL.createObjectURL(file) : undefined,
      pending:true
    }
    forceScrollRef.current=true
    setMessages(current=>mergeMessages(current.filter(m=>m.id!==id),[optimistic]))

    let uploadedPath:string|null=null
    if(file){
      const path=attachmentPath(conversationId,userId,crypto.randomUUID(),file.name)
      const {error:uploadError}=await client.storage.from(ATTACH_BUCKET).upload(path,file,{
        upsert:false,
        contentType:opts.mime || file.type,
        cacheControl:'3600'
      })
      if(uploadError){
        retryFilesRef.current.set(id,file)
        setMessages(current=>current.map(m=>m.id===id ? {...m,pending:false,failed:true} : m))
        setNotice(uploadError.message || 'Unable to upload the file.')
        return
      }
      uploadedPath=path
    }

    const {data,error}=await client
      .from('social_messages')
      .insert({
        conversation_id:conversationId,
        sender_id:userId,
        body,
        ...(replyId?{reply_to_id:replyId}:{}),
        ...(file && uploadedPath?{
          attachment_path:uploadedPath,
          attachment_name:file.name,
          attachment_mime:opts.mime || file.type,
          attachment_size:file.size,
          ...(opts.durationMs!=null?{attachment_duration_ms:Math.round(opts.durationMs)}:{})
        }:{})
      })
      .select(MESSAGE_COLUMNS)
      .single()

    if(error || !data){
      if(file && uploadedPath){
        // The file is unused now, so remove it. The retry uploads it again.
        void client.storage.from(ATTACH_BUCKET).remove([uploadedPath])
        retryFilesRef.current.set(id,file)
      }
      setMessages(current=>current.map(m=>m.id===id ? {...m,pending:false,failed:true} : m))
      setNotice(error?.message || 'Unable to send message.')
      return
    }
    retryFilesRef.current.delete(id)
    const saved={...(data as Message),localUrl:optimistic.localUrl}
    setNotice('')
    setMessages(current=>mergeMessages(current.filter(m=>m.id!==id),[saved]))
    setDirects(rows=>rows.map(row=>row.conversation.id===conversationId ? {...row,latest:saved} : row))
  }

  const stageFiles=(list:FileList|File[]|null)=>{
    if(!list)return
    const incoming=Array.from(list)
    if(!incoming.length)return
    const accepted:Staged[]=[]
    const problems:string[]=[]
    for(const file of incoming){
      if(staged.length+accepted.length>=MAX_FILES_PER_SEND){
        problems.push(`You can send up to ${MAX_FILES_PER_SEND} files at once.`)
        break
      }
      const verdict=validateAttachment(file)
      if(!verdict.ok){
        problems.push(verdict.reason)
        continue
      }
      accepted.push({
        id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        file,
        mime:verdict.mime,
        previewUrl:isImageMime(verdict.mime) ? URL.createObjectURL(file) : null
      })
    }
    if(accepted.length)setStaged(current=>[...current,...accepted])
    if(problems.length)setNotice(problems[0])
    composerRef.current?.focus()
  }

  const stopVoiceStream=()=>{
    window.clearInterval(voiceTimerRef.current)
    voiceTimerRef.current=undefined
    streamRef.current?.getTracks().forEach(track=>track.stop())
    streamRef.current=null
  }

  const startVoice=async()=>{
    if(voice || !selectedId)return
    if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined'){
      setNotice('Voice notes are not supported in this browser.')
      return
    }
    const mime=pickRecorderMime(type=>MediaRecorder.isTypeSupported(type))
    if(!mime){
      setNotice('This browser cannot record audio in a supported format.')
      return
    }
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true})
      streamRef.current=stream
      chunksRef.current=[]
      voiceDiscardRef.current=false
      const recorder=new MediaRecorder(stream,{mimeType:mime})
      recorderRef.current=recorder
      recorder.ondataavailable=event=>{if(event.data.size)chunksRef.current.push(event.data)}
      recorder.onstop=()=>{
        stopVoiceStream()
        recorderRef.current=null
        if(voiceDiscardRef.current){
          setVoice(null)
          return
        }
        const type=baseMime(recorder.mimeType || mime)
        const blob=new Blob(chunksRef.current,{type})
        if(!blob.size){
          setVoice(null)
          setNotice('Nothing was recorded. Check that your microphone is working.')
          return
        }
        setVoice({status:'ready',ms:voiceMsRef.current,blob,mime:type,url:URL.createObjectURL(blob)})
      }
      recorder.start()
      voiceStartRef.current=Date.now()
      voiceMsRef.current=0
      setVoice({status:'recording',ms:0,mime})
      voiceTimerRef.current=window.setInterval(()=>{
        const elapsed=Date.now()-voiceStartRef.current
        voiceMsRef.current=elapsed
        setVoice(current=>current && current.status==='recording' ? {...current,ms:elapsed} : current)
        if(elapsed>=MAX_VOICE_MS && recorderRef.current?.state==='recording')recorderRef.current.stop()
      },250)
    }catch(error){
      stopVoiceStream()
      const denied=error instanceof DOMException && (error.name==='NotAllowedError' || error.name==='SecurityError')
      setNotice(denied
        ? 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.'
        : 'Could not start recording. Check that a microphone is connected.')
    }
  }

  const stopVoice=()=>{
    if(recorderRef.current?.state==='recording')recorderRef.current.stop()
  }

  const discardVoice=()=>{
    voiceDiscardRef.current=true
    if(recorderRef.current && recorderRef.current.state!=='inactive'){
      recorderRef.current.stop()
    }else{
      stopVoiceStream()
      setVoice(null)
    }
    setVoice(current=>{
      if(current?.url)URL.revokeObjectURL(current.url)
      return null
    })
  }

  const sendVoice=()=>{
    if(!voice || voice.status!=='ready' || !voice.blob)return
    const file=new File([voice.blob],voiceFileName(new Date(),voice.mime),{type:voice.mime})
    const replyId=replyTo && replyTo.conversation_id===selectedId && !replyTo.pending && !replyTo.failed ? replyTo.id : null
    const durationMs=voice.ms
    setReplyTo(null)
    setVoice(null)
    void sendMessage({body:'',file,mime:voice.mime,durationMs,replyId})
  }

  // A recording belongs to one chat: leaving it, or closing the page, drops it.
  useEffect(()=>{
    return()=>{
      voiceDiscardRef.current=true
      if(recorderRef.current && recorderRef.current.state!=='inactive')recorderRef.current.stop()
      stopVoiceStream()
    }
  },[selectedId])

  useEffect(()=>{
    if(!exportOpen)return
    const close=()=>setExportOpen(false)
    window.addEventListener('click',close)
    return()=>window.removeEventListener('click',close)
  },[exportOpen])

  const exportChat=async(withFiles:boolean)=>{
    const client=supabase
    if(!client || !selected || exporting)return
    setExportOpen(false)
    const title=displayName(selected.other)
    const nameOf=(id:string)=>displayName(peopleMap.get(id))
    const now=new Date()
    try{
      setExporting('Collecting messages...')
      const all:Message[]=[]
      for(let from=0;;from+=1000){
        const {data,error}=await client
          .from('social_messages')
          .select(MESSAGE_COLUMNS)
          .eq('conversation_id',selected.conversation.id)
          .order('created_at',{ascending:true})
          .range(from,from+999)
        if(error)throw error
        const page=(data || []) as Message[]
        all.push(...page)
        if(page.length<1000)break
      }

      const files=withFiles ? all.filter(message=>message.attachment_path) : []
      const total=files.reduce((sum,message)=>sum+Number(message.attachment_size || 0),0)
      if(withFiles && total>250*1024*1024){
        setNotice('The files in this chat add up to more than 250 MB, so only the text was exported. Download large files one by one.')
      }

      if(!withFiles || files.length===0 || total>250*1024*1024){
        const text=buildTranscript({title,exportedBy:nameOf(userId),exportedAt:now,messages:all,nameOf})
        saveBlob(new Blob([text],{type:'text/plain;charset=utf-8'}),exportFileName(title,now,'txt'))
        return
      }

      const taken=new Set<string>()
      const entries:Record<string,[Uint8Array,{level:0}]>={}
      const savedAs=new Map<string,string>()
      let index=0
      for(const message of files){
        index+=1
        setExporting(`Adding file ${index} of ${files.length}...`)
        const {data,error}=await client.storage.from(ATTACH_BUCKET).download(message.attachment_path as string)
        if(error || !data)continue
        const unique=uniqueZipName(taken,message.attachment_name || 'file')
        entries[`files/${unique}`]=[new Uint8Array(await data.arrayBuffer()),{level:0}]
        savedAs.set(message.id,`files/${unique}`)
      }
      const text=buildTranscript({title,exportedBy:nameOf(userId),exportedAt:now,messages:all,nameOf,savedAs})
      setExporting('Creating the zip...')
      const zipped=zipSync({'transcript.txt':strToU8(text),...entries})
      saveBlob(new Blob([zipped as BlobPart],{type:'application/zip'}),exportFileName(title,now,'zip'))
      const missed=files.length-savedAs.size
      if(missed>0)setNotice(`${missed} file${missed===1?'':'s'} could not be added to the export.`)
    }catch(error){
      setNotice(error instanceof Error ? error.message : 'Unable to export this chat.')
    }finally{
      setExporting('')
    }
  }

  const unstage=(id:string)=>{
    setStaged(current=>{
      const gone=current.find(item=>item.id===id)
      if(gone?.previewUrl)URL.revokeObjectURL(gone.previewUrl)
      return current.filter(item=>item.id!==id)
    })
  }

  const submit=(event:FormEvent)=>{
    event.preventDefault()
    const body=messageText.trim()
    if(!body && !staged.length)return
    const replyId=replyTo && replyTo.conversation_id===selectedId && !replyTo.pending && !replyTo.failed ? replyTo.id : null
    const files=staged
    setMessageText('')
    setReplyTo(null)
    setStaged([])
    requestAnimationFrame(resizeComposer)
    if(!files.length){
      void sendMessage({body,replyId})
      return
    }
    // The caption and the reply go with the first file; the rest follow in order.
    void (async()=>{
      for(let index=0;index<files.length;index+=1){
        const item=files[index]
        await sendMessage({
          body:index===0 ? body : '',
          file:item.file,
          mime:item.mime,
          replyId:index===0 ? replyId : null
        })
      }
    })()
  }

  const retry=(message:Message)=>{
    setMessages(current=>current.map(m=>m.id===message.id ? {...m,failed:false,pending:true} : m))
    const file=retryFilesRef.current.get(message.id) || null
    const verdict=file ? validateAttachment(file) : null
    void sendMessage({
      body:message.body,
      file,
      mime:verdict && verdict.ok ? verdict.mime : undefined,
      durationMs:message.attachment_duration_ms ?? null,
      tempId:message.id,
      replyId:message.reply_to_id
    })
  }

  // Saves the file from inside the workspace. It is fetched with the person's own
  // session and handed to the browser as a download, so no new tab opens.
  const [downloading,setDownloading]=useState('')
  const downloadFile=async(path:string,name:string)=>{
    const client=supabase
    if(!client || downloading)return
    setDownloading(path)
    try{
      const {data,error}=await client.storage.from(ATTACH_BUCKET).download(path)
      if(error || !data)throw error || new Error('Unable to download this file.')
      saveBlob(data,name)
    }catch(error){
      setNotice(error instanceof Error ? error.message : 'Unable to download this file.')
    }finally{
      setDownloading('')
    }
  }

  useEffect(()=>{
    const client=supabase
    if(!client)return
    const need=Array.from(new Set(messages
      .filter(m=>m.attachment_path && (isImageMime(m.attachment_mime) || isAudioMime(m.attachment_mime)) && !imageUrls[m.attachment_path])
      .map(m=>m.attachment_path as string)))
    if(!need.length)return
    let cancelled=false
    void client.storage.from(ATTACH_BUCKET).createSignedUrls(need,SIGNED_SECONDS).then(({data})=>{
      if(cancelled || !data)return
      setImageUrls(current=>{
        const next={...current}
        for(const row of data){
          if(row.path && row.signedUrl)next[row.path]=row.signedUrl
        }
        return next
      })
    })
    return()=>{cancelled=true}
  },[messages,imageUrls])

  useEffect(()=>{
    if(!viewer)return
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')setViewer(null)}
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  },[viewer])

  // Signed links expire. Drop them well before that so images fetch fresh ones.
  useEffect(()=>{
    const timer=window.setInterval(()=>setImageUrls({}),(SIGNED_SECONDS-300)*1000)
    return()=>window.clearInterval(timer)
  },[])

  const openConversation=(id:string)=>{
    setNotice('')
    setSelectedId(id)
    setMobileThreadOpen(true)
  }

  useEffect(()=>{
    const client=supabase
    if(!client)return
    void client.rpc('has_calling_access').then(({data,error})=>{
      setHasCalling(!error && data===true)
    })
  },[])

  useEffect(()=>{
    const client=supabase
    if(!client)return
    void client.rpc('is_workspace_admin').then(({data,error})=>{
      setIsAdmin(!error && data===true)
    })
  },[])

  const setArchived=async(row:DirectRow,archived:boolean)=>{
    const client=supabase
    if(!client)return
    const stamp=archived ? new Date().toISOString() : null
    setDirects(rows=>rows.map(item=>item.conversation.id===row.conversation.id
      ? {...item,membership:{...item.membership,archived_at:stamp}}
      : item))
    if(archived){
      setSelectedId('')
      setMobileThreadOpen(false)
    }
    const {error}=await client.rpc('set_social_conversation_archived',{
      p_conversation_id:row.conversation.id,
      p_archived:archived
    })
    if(error){
      setNotice(error.message)
      void loadBase()
    }
  }

  const deleteChat=async(row:DirectRow)=>{
    const client=supabase
    if(!client || !isAdmin)return
    const name=displayName(row.other)
    if(!window.confirm(`Delete the chat with ${name} for both people? This removes every message and cannot be undone.`))return
    // Deleting the chat removes its rows. Its files live in storage, so clear them first.
    const {data:fileRows}=await client
      .from('social_messages')
      .select('attachment_path')
      .eq('conversation_id',row.conversation.id)
      .not('attachment_path','is',null)
    const paths=(fileRows || []).map(item=>(item as {attachment_path:string|null}).attachment_path).filter((value):value is string=>!!value)
    if(paths.length){
      const {error:removeError}=await client.storage.from(ATTACH_BUCKET).remove(paths)
      if(removeError){
        setNotice(removeError.message)
        return
      }
    }
    const {error}=await client.rpc('delete_social_conversation',{p_conversation_id:row.conversation.id})
    if(error){
      setNotice(error.message)
      return
    }
    setSelectedId('')
    setMobileThreadOpen(false)
    setDirects(rows=>rows.filter(item=>item.conversation.id!==row.conversation.id))
    void loadBase()
  }

  const jumpToMessage=(id:string)=>{
    const element=document.getElementById(`cm-msg-${id}`)
    if(!element)return
    stickToBottomRef.current=false
    element.scrollIntoView({block:'center',behavior:'smooth'})
    element.classList.add('flash')
    window.setTimeout(()=>element.classList.remove('flash'),1200)
  }

  const startCall=async(kind:'Voice'|'Video')=>{
    const client=supabase
    if(!client || !selected || calling)return
    if(!hasCalling){
      setCallNotice(`${kind} calling is not enabled on your account yet. Reach out to Admin to give you access.`)
      return
    }
    setCalling(true)
    setCallNotice('')
    try{
      const room=await createCallRoom(`Call with ${displayName(selected.other)}`)
      const {error}=await client.rpc('start_chat_call',{
        p_conversation:selected.conversation.id,
        p_kind:kind==='Video'?'video':'voice',
        p_room_code:room.room.room_code
      })
      if(error)throw error
      requestJoinRoom({code:room.room.room_code,audioOnly:kind==='Voice'})
    }catch(error){
      setCallNotice(error instanceof Error ? error.message : 'Unable to start the call.')
    }finally{
      setCalling(false)
    }
  }

  const rows=useMemo(()=>{
    const out:Array<{type:'day';key:string;label:string}|{type:'message';message:Message}>=[]
    let last=''
    for(const message of messages){
      const label=dayLabel(message.created_at)
      if(label!==last){
        out.push({type:'day',key:`${message.id}-day`,label})
        last=label
      }
      out.push({type:'message',message})
    }
    return out
  },[messages])

  return (
    <section className="cm">
      {notice&&<div className="cmNotice" role="status">{notice}<button type="button" aria-label="Dismiss" onClick={()=>setNotice('')}><X size={14}/></button></div>}

      <div className={`cmShell ${mobileThreadOpen && selectedId?'threadOpen':'listOpen'}`}>
        <aside className="cmSide">
          <header className="cmSideHead">
            <h2>Chats{totalUnread>0&&<span className="cmTotal">{totalUnread>99?'99+':totalUnread}</span>}</h2>
            <button
              type="button"
              className="cmRound"
              title="New chat"
              aria-label="New chat"
              onClick={()=>{setNewChatOpen(open=>!open);setQuery('')}}
            >
              {newChatOpen?<X size={18}/>:<Plus size={18}/>}
            </button>
          </header>

          <label className="cmSearch">
            <Search size={16}/>
            <input
              value={query}
              onChange={event=>setQuery(event.target.value)}
              placeholder={newChatOpen?'Search employees':'Search or start a new chat'}
              aria-label="Search chats or employees"
            />
          </label>

          {!newChatOpen&&(
            <div className="cmChips">
              <button type="button" className={filter==='all'?'on':''} onClick={()=>setFilter('all')}>All</button>
              <button type="button" className={filter==='unread'?'on':''} onClick={()=>setFilter('unread')}>
                Unread{totalUnread>0?` ${totalUnread}`:''}
              </button>
              <button type="button" className={filter==='archived'?'on':''} onClick={()=>setFilter('archived')}>
                Archived{archivedCount>0?` ${archivedCount}`:''}
              </button>
            </div>
          )}

          <div className="cmList">
            {(newChatOpen || query.trim())&&(
              <div className="cmGroup">
                <div className="cmGroupLabel">{newChatOpen?'Start a conversation':'People'}</div>
                {matchingPeople.map(person=>(
                  <button key={person.id} type="button" className="cmRow" onClick={()=>void startDirect(person)} disabled={starting}>
                    <span className="cmAvatar">{initials(displayName(person))}</span>
                    <span className="cmRowCopy">
                      <span className="cmRowTop"><strong>{displayName(person)}</strong></span>
                      <span className="cmRowBottom"><small>{secondary(person)}</small></span>
                    </span>
                  </button>
                ))}
                {matchingPeople.length===0&&<div className="cmEmpty">No active employee matches.</div>}
              </div>
            )}

            {!newChatOpen&&(
              <>
                {loading&&!loadedOnceRef.current&&<div className="cmEmpty">Loading chats...</div>}
                {visibleDirects.map(row=>{
                  const mine=row.latest?.sender_id===userId
                  return (
                    <button
                      key={row.conversation.id}
                      type="button"
                      className={`cmRow ${selectedId===row.conversation.id?'active':''}`}
                      onClick={()=>openConversation(row.conversation.id)}
                    >
                      <span className="cmAvatar">{initials(displayName(row.other))}</span>
                      <span className="cmRowCopy">
                        <span className="cmRowTop">
                          <strong>{displayName(row.other)}</strong>
                          <small className={row.unread>0?'unread':''}>{formatListTime(row.latest?.created_at || row.conversation.created_at)}</small>
                        </span>
                        <span className="cmRowBottom">
                          <small>{row.latest?`${mine?'You: ':''}${messagePreview(row.latest)}`:secondary(row.other)}</small>
                          {row.unread>0&&<span className="cmBadge">{row.unread>99?'99+':row.unread}</span>}
                        </span>
                      </span>
                    </button>
                  )
                })}
                {!loading&&visibleDirects.length===0&&(
                  <div className="cmEmpty cmEmptyBlock">
                    <MessageSquareText size={26}/>
                    <strong>{filter==='unread'?'No unread chats':filter==='archived'?'No archived chats':'No chats yet'}</strong>
                    <span>{filter==='unread'?'You are all caught up.':filter==='archived'?'Archive a chat from its top bar to tidy your list.':'Tap + to message a colleague.'}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        <div
          className={`cmThread${dragging?' dragging':''}`}
          onDragEnter={event=>{
            if(!selected || !event.dataTransfer.types.includes('Files'))return
            event.preventDefault()
            dragDepthRef.current+=1
            setDragging(true)
          }}
          onDragOver={event=>{
            if(selected && event.dataTransfer.types.includes('Files'))event.preventDefault()
          }}
          onDragLeave={()=>{
            dragDepthRef.current=Math.max(0,dragDepthRef.current-1)
            if(dragDepthRef.current===0)setDragging(false)
          }}
          onDrop={event=>{
            if(!selected)return
            event.preventDefault()
            dragDepthRef.current=0
            setDragging(false)
            stageFiles(event.dataTransfer.files)
          }}
        >
          {dragging&&<div className="cmDrop">Drop files to send them to {displayName(selected?.other)}</div>}
          {selected ? (
            <>
              <header className="cmThreadHead">
                <button type="button" className="cmBack" aria-label="Back to chats" onClick={()=>setMobileThreadOpen(false)}>
                  <ArrowLeft size={20}/>
                </button>
                <span className="cmAvatar">{initials(displayName(selected.other))}</span>
                <div className="cmHeadCopy">
                  <strong>{displayName(selected.other)}</strong>
                  <small>{secondary(selected.other)}</small>
                </div>
                <div className="cmHeadActions">
                  <button
                    type="button"
                    className="cmRound"
                    title="Export chat"
                    aria-label="Export chat"
                    aria-expanded={exportOpen}
                    disabled={!!exporting}
                    onClick={event=>{event.stopPropagation();setExportOpen(open=>!open)}}
                  >
                    <FileDown size={18}/>
                  </button>
                  {exportOpen&&(
                    <div className="cmMenu" role="menu" onClick={event=>event.stopPropagation()}>
                      <button type="button" role="menuitem" onClick={()=>void exportChat(false)}>
                        <strong>Text only</strong><small>A .txt transcript of every message</small>
                      </button>
                      <button type="button" role="menuitem" onClick={()=>void exportChat(true)}>
                        <strong>With files and images</strong><small>A .zip with the transcript and every attachment</small>
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="cmRound"
                    title={selected.membership.archived_at?'Unarchive chat':'Archive chat'}
                    aria-label={selected.membership.archived_at?'Unarchive chat':'Archive chat'}
                    onClick={()=>void setArchived(selected,!selected.membership.archived_at)}
                  >
                    {selected.membership.archived_at?<ArchiveRestore size={18}/>:<Archive size={18}/>}
                  </button>
                  {isAdmin&&(
                    <button type="button" className="cmRound cmDanger" title="Delete chat (admin only)" aria-label="Delete chat (admin only)" onClick={()=>void deleteChat(selected)}>
                      <Trash2 size={18}/>
                    </button>
                  )}
                  <button type="button" className="cmRound" title="Video call" aria-label="Video call" disabled={calling} onClick={()=>void startCall('Video')}>
                    <Video size={18}/>
                  </button>
                  <button type="button" className="cmRound" title="Voice call" aria-label="Voice call" disabled={calling} onClick={()=>void startCall('Voice')}>
                    <Phone size={18}/>
                  </button>
                </div>
              </header>

              {callNotice&&(
                <div className="cmCallNotice" role="alert">
                  <Phone size={16}/>
                  <span>{callNotice}</span>
                  <button type="button" aria-label="Dismiss" onClick={()=>setCallNotice('')}><X size={14}/></button>
                </div>
              )}

              {exporting&&<div className="cmExporting" role="status">{exporting}</div>}

              <div className="cmMessages" ref={scrollRef} onScroll={onScroll} aria-live="polite">
                <div className="cmLock"><ShieldCheck size={13}/>Private. Only the two of you can see this conversation.</div>
                {threadLoading&&messages.length===0&&<div className="cmEmpty">Loading messages...</div>}
                {!threadLoading&&messages.length===0&&(
                  <div className="cmEmpty cmEmptyBlock">
                    <MessageSquareText size={28}/>
                    <strong>Say hello</strong>
                    <span>Send the first message to {displayName(selected.other)}.</span>
                  </div>
                )}
                {rows.map(item=>{
                  if(item.type==='day')return <div className="cmDay" key={item.key}><span>{item.label}</span></div>
                  const message=item.message
                  const mine=message.sender_id===userId
                  const sender=mine ? null : peopleMap.get(message.sender_id)
                  const read=mine && !message.pending && !message.failed && selected.otherReadAt &&
                    new Date(selected.otherReadAt).getTime()>=new Date(message.created_at).getTime()
                  const quoted=message.reply_to_id ? messages.find(m=>m.id===message.reply_to_id) || null : null
                  const canReply=!message.pending && !message.failed
                  return (
                    <div key={message.id} id={`cm-msg-${message.id}`} className={`cmMsg ${mine?'mine':'theirs'}${message.failed?' failed':''}`}>
                      <div className="cmBubble" title={displayName(sender)}>
                        {canReply&&(
                          <button
                            type="button"
                            className="cmReplyBtn"
                            aria-label="Reply to this message"
                            title="Reply"
                            onClick={()=>{setReplyTo(message);composerRef.current?.focus()}}
                          >
                            <Reply size={14}/>
                          </button>
                        )}
                        {message.reply_to_id&&(
                          <button
                            type="button"
                            className="cmQuote"
                            disabled={!quoted}
                            onClick={()=>quoted&&jumpToMessage(quoted.id)}
                          >
                            <strong>{quoted ? (quoted.sender_id===userId?'You':displayName(peopleMap.get(quoted.sender_id))) : 'Earlier message'}</strong>
                            <span>{quoted ? messagePreview(quoted) : 'Open the older history to see it.'}</span>
                          </button>
                        )}
                        {(message.attachment_name||message.attachment_path)&&(()=>{
                          const mediaSrc=message.localUrl || (message.attachment_path ? imageUrls[message.attachment_path] : '')
                          const path=message.attachment_path || null
                          const name=message.attachment_name||'file'
                          const busy=!!path && downloading===path
                          if(isImageMime(message.attachment_mime)){
                            return mediaSrc ? (
                              <div className="cmImage">
                                <button
                                  type="button"
                                  className="cmImageOpen"
                                  aria-label={`Open ${name}`}
                                  onClick={()=>setViewer({url:mediaSrc,name,path})}
                                >
                                  <img src={mediaSrc} alt={name} loading="lazy"/>
                                </button>
                                {path&&(
                                  <button type="button" className="cmImageDl" title="Download" aria-label={`Download ${name}`} disabled={busy} onClick={()=>void downloadFile(path,name)}>
                                    <Download size={16}/>
                                  </button>
                                )}
                              </div>
                            ) : <div className="cmImage cmImageWait">Loading image...</div>
                          }
                          if(isAudioMime(message.attachment_mime)){
                            return (
                              <div className="cmVoice">
                                {mediaSrc
                                  ? <audio controls preload="metadata" src={mediaSrc}/>
                                  : <span className="cmVoiceWait">Loading voice note...</span>}
                                <span className="cmVoiceMeta">
                                  <Mic size={13}/>
                                  {message.attachment_duration_ms!=null?formatDuration(message.attachment_duration_ms):'Voice note'}
                                  {path&&(
                                    <button type="button" title="Download" aria-label={`Download ${name}`} disabled={busy} onClick={()=>void downloadFile(path,name)}>
                                      <Download size={14}/>
                                    </button>
                                  )}
                                </span>
                              </div>
                            )
                          }
                          return (
                            <div className="cmFile">
                              <FileText size={22}/>
                              <span>
                                <strong>{name}</strong>
                                <small>{formatBytes(message.attachment_size)}</small>
                              </span>
                              {path&&(
                                <button type="button" className="cmFileDl" disabled={busy} onClick={()=>void downloadFile(path,name)}>
                                  <Download size={15}/>{busy?'Saving...':'Download'}
                                </button>
                              )}
                            </div>
                          )
                        })()}
                        {message.body&&<p>{message.body}</p>}
                        <span className="cmMeta">
                          {formatTime(message.created_at)}
                          {message.edited_at?' edited':''}
                          {mine&&(
                            message.failed ? null :
                            message.pending ? <Check size={14} className="cmTick pending"/> :
                            read ? <CheckCheck size={15} className="cmTick read"/> :
                            <Check size={14} className="cmTick"/>
                          )}
                        </span>
                      </div>
                      {message.failed&&(
                        <button type="button" className="cmRetry" onClick={()=>retry(message)}>Not sent. Tap to retry</button>
                      )}
                    </div>
                  )
                })}
              </div>

              {replyTo&&replyTo.conversation_id===selectedId&&(
                <div className="cmReplyBar">
                  <Reply size={15}/>
                  <div>
                    <strong>Replying to {replyTo.sender_id===userId?'yourself':displayName(peopleMap.get(replyTo.sender_id))}</strong>
                    <span>{messagePreview(replyTo)}</span>
                  </div>
                  <button type="button" aria-label="Cancel reply" onClick={()=>setReplyTo(null)}><X size={14}/></button>
                </div>
              )}
              {voice&&(
                <div className="cmVoiceBar">
                  {voice.status==='recording' ? (
                    <>
                      <span className="cmRecDot" aria-hidden="true"/>
                      <strong>{formatDuration(voice.ms)}</strong>
                      <span className="cmVoiceHint">Recording... up to 10 minutes</span>
                      <button type="button" className="cmRound cmDanger" title="Cancel recording" aria-label="Cancel recording" onClick={discardVoice}><Trash2 size={18}/></button>
                      <button type="button" className="cmSend" title="Stop recording" aria-label="Stop recording" onClick={stopVoice}><Square size={16}/></button>
                    </>
                  ) : (
                    <>
                      <audio controls preload="metadata" src={voice.url}/>
                      <button type="button" className="cmRound cmDanger" title="Discard voice note" aria-label="Discard voice note" onClick={discardVoice}><Trash2 size={18}/></button>
                      <button type="button" className="cmSend" title="Send voice note" aria-label="Send voice note" onClick={sendVoice}><Send size={19}/></button>
                    </>
                  )}
                </div>
              )}
              {staged.length>0&&(
                <div className="cmStaged">
                  {staged.map(item=>(
                    <div className="cmStagedItem" key={item.id}>
                      {item.previewUrl ? <img src={item.previewUrl} alt=""/> : <FileText size={22}/>}
                      <span><strong>{item.file.name}</strong><small>{formatBytes(item.file.size)}</small></span>
                      <button type="button" aria-label={`Remove ${item.file.name}`} onClick={()=>unstage(item.id)}><X size={14}/></button>
                    </div>
                  ))}
                </div>
              )}
              <form className="cmComposer" onSubmit={submit} hidden={!!voice}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  accept={ACCEPT_ATTRIBUTE}
                  onChange={event=>{
                    stageFiles(event.target.files)
                    event.target.value=''
                  }}
                />
                <button
                  type="button"
                  className="cmRound cmAttach"
                  title="Attach images or files"
                  aria-label="Attach images or files"
                  onClick={()=>fileInputRef.current?.click()}
                >
                  <Paperclip size={19}/>
                </button>
                <button
                  type="button"
                  className="cmRound cmAttach"
                  title="Record a voice note"
                  aria-label="Record a voice note"
                  onClick={()=>void startVoice()}
                >
                  <Mic size={19}/>
                </button>
                <textarea
                  ref={composerRef}
                  value={messageText}
                  onChange={event=>{
                    setMessageText(event.target.value.slice(0,10000))
                    resizeComposer()
                  }}
                  placeholder={staged.length?'Add a caption (optional)':'Type a message'}
                  onPaste={event=>{
                    const pasted=Array.from(event.clipboardData?.files || [])
                    if(pasted.length){
                      event.preventDefault()
                      stageFiles(pasted)
                    }
                  }}
                  rows={1}
                  aria-label={`Message ${displayName(selected.other)}`}
                  onKeyDown={event=>{
                    if(event.key==='Escape'&&replyTo){
                      setReplyTo(null)
                      return
                    }
                    if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                />
                <button className="cmSend" type="submit" aria-label="Send" disabled={!messageText.trim() && !staged.length}>
                  <Send size={19}/>
                </button>
              </form>
            </>
          ) : (
            <div className="cmNone">
              <span className="cmNoneIcon"><MessageSquareText size={38}/></span>
              <h2>RideArrivo Chat</h2>
              <p>Pick a chat on the left or press + to message a colleague.</p>
              <small><ShieldCheck size={13}/> Employee-only, private conversations</small>
            </div>
          )}
        </div>
      </div>

      {viewer&&(
        <div className="cmViewer" role="dialog" aria-label={viewer.name} onClick={()=>setViewer(null)}>
          <div className="cmViewerBar" onClick={event=>event.stopPropagation()}>
            <strong>{viewer.name}</strong>
            {viewer.path&&(
              <button type="button" onClick={()=>void downloadFile(viewer.path as string,viewer.name)}><Download size={16}/> Download</button>
            )}
            <button type="button" aria-label="Close" onClick={()=>setViewer(null)}><X size={18}/></button>
          </div>
          <img src={viewer.url} alt={viewer.name} onClick={event=>event.stopPropagation()}/>
        </div>
      )}
    </section>
  )
}

export default ChatModule
