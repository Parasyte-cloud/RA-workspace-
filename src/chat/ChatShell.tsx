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
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Pencil,
  Plus,
  Reply,
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
import { createCallRoom, endCallRoom, requestJoinRoom } from '../lib/roomApi'
import {
  callPreview,
  describeCall,
  mergeTimeline,
  unseenMissed,
  type CallRecord
} from '../lib/callLog'
import { useChatCalls } from '../modules/useChatCalls'
import { useConversations } from './hooks/useConversations'
import { useMessages } from './hooks/useMessages'
import { ConversationSidebar } from './conversations/ConversationSidebar'
import { ConversationSearch } from './conversations/ConversationSearch'
import { RoomList } from './conversations/RoomList'
import { RoomCreator } from './rooms/RoomCreator'
import { RoomDetails } from './rooms/RoomDetails'
import type {
  RoomCandidate,
  RoomMember,
} from './rooms/RoomMembers'
import type {
  ConversationKind,
  ConversationSummary,
} from './types'
import { MessageTimeline } from './messages/MessageTimeline'
import {
  MessageComposer,
  type MessageSendState
} from './messages/MessageComposer'
import {
  MentionSuggestions,
  type MentionSuggestionPerson
} from './messages/MentionSuggestions'
import {
  registerMessageMentions as registerChatMessageMentions,
  sendMessage as sendChatMessage
} from './api/chatApi'
import {
  ackChatDelivered,
  ackChatRead,
  listReceiptSummaries,
  receiptState,
  receiptTitle,
  type ChatReceiptSummary
} from './api/chatReceipts'
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
import {
  OLDER_PAGE,
  TYPING_SHOW_MS,
  canDelete,
  canEdit,
  isDeleted,
  keepOlderThan,
  mergeOlder,
  shouldSendTyping,
  typingLine
} from '../lib/chatEdit'

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
  conversation_kind:ConversationKind
}

type Message = {
  id:string
  conversation_id:string
  sender_id:string
  body:string
  edited_at:string|null
  deleted_at?:string|null
  created_at:string
  reply_to_id?:string|null
  client_message_id?:string|null
  mentionedUserIds?:string[]
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

const MESSAGE_COLUMNS='id,conversation_id,sender_id,body,edited_at,deleted_at,created_at,reply_to_id,attachment_path,attachment_name,attachment_mime,attachment_size,attachment_duration_ms'
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

export function ChatShell(){
  const [userId,setUserId]=useState('')
  const [people,setPeople]=useState<Person[]>([])
  const [selectedId,setSelectedId]=useState('')
  const {
    conversations:directs,
    setConversations:setDirects,
    selected:selectedDirect
  }=useConversations<DirectRow>(selectedId)
  const [rooms,setRooms]=useState<ConversationSummary[]>([])
  const [roomMembers,setRoomMembers]=useState<RoomMember[]>([])
  const [canAdministerRoom,setCanAdministerRoom]=useState(false)
  const [isGlobalChatAdmin,setIsGlobalChatAdmin]=useState(false)
  const [roomDetailsLoading,setRoomDetailsLoading]=useState(false)
  const [mobileThreadOpen,setMobileThreadOpen]=useState(false)
  const [mobileDetailsOpen,setMobileDetailsOpen]=useState(false)
  const {
    messages,
    setMessages
  }=useMessages<Message>()
  const [query,setQuery]=useState('')
  const [filter,setFilter]=useState<'all'|'unread'|'archived'|'calls'>('all')
  const [newChatOpen,setNewChatOpen]=useState(false)
  const [messageText,setMessageText]=useState('')
  const [mentionQuery,setMentionQuery]=useState<string|null>(null)
  const [mentionStart,setMentionStart]=useState(-1)
  const [mentionIndex,setMentionIndex]=useState(0)
  const [selectedMentions,setSelectedMentions]=useState<
    Array<{userId:string;token:string}>
  >([])
  const [loading,setLoading]=useState(true)
  const [threadLoading,setThreadLoading]=useState(false)
  const [starting,setStarting]=useState(false)
  const [notice,setNotice]=useState('')
  const [callNotice,setCallNotice]=useState('')
  const [hasCalling,setHasCalling]=useState(false)
  const [receiptSummaries,setReceiptSummaries]=useState<Record<string,ChatReceiptSummary>>({})
  // When each chat was last looked at in this session, so a missed call stops
  // counting as new the moment its chat is opened.
  const [callSeen,setCallSeen]=useState<Record<string,string>>({})
  const [editingId,setEditingId]=useState('')
  const [editText,setEditText]=useState('')
  const [editBusy,setEditBusy]=useState(false)
  const [otherTyping,setOtherTyping]=useState(false)
  const [hasOlder,setHasOlder]=useState(false)
  const [loadingOlder,setLoadingOlder]=useState(false)
  const typingChannelRef=useRef<{send:(payload:unknown)=>unknown}|null>(null)
  const typingSentRef=useRef(0)
  const typingTimerRef=useRef<number|undefined>(undefined)
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

  // Typing indicator: a broadcast channel per open chat. Nothing is stored.
  useEffect(()=>{
    const client=supabase
    setOtherTyping(false)
    typingChannelRef.current=null
    if(!client || !selectedId || !userId)return
    const channel=client.channel(`typing-${selectedId}`)
    channel
      .on('broadcast',{event:'typing'},payload=>{
        const from=(payload.payload as {userId?:string}|undefined)?.userId
        if(!from || from===userId)return
        setOtherTyping(true)
        window.clearTimeout(typingTimerRef.current)
        typingTimerRef.current=window.setTimeout(()=>setOtherTyping(false),TYPING_SHOW_MS)
      })
      .subscribe()
    typingChannelRef.current=channel as unknown as {send:(payload:unknown)=>unknown}
    return()=>{
      window.clearTimeout(typingTimerRef.current)
      typingChannelRef.current=null
      void client.removeChannel(channel)
    }
  },[selectedId,userId])

  const pingTyping=()=>{
    const channel=typingChannelRef.current
    const now=Date.now()
    if(!channel || !shouldSendTyping(typingSentRef.current,now))return
    typingSentRef.current=now
    void channel.send({type:'broadcast',event:'typing',payload:{userId}})
  }
  useEffect(()=>{directsRef.current=directs},[directs])
  useEffect(()=>{userRef.current=userId},[userId])

  useEffect(()=>{peopleRef.current=new Map(people.map(person=>[person.id,person]))},[people])

  const selectedRoom=useMemo(
    ()=>rooms.find(room=>room.id===selectedId) || null,
    [rooms,selectedId]
  )

  const mentionSuggestions=useMemo<MentionSuggestionPerson[]>(()=>{
    if(mentionQuery===null || !selectedRoom)return []

    const normalized=mentionQuery.trim().toLowerCase()

    return roomMembers
      .filter(member=>member.userId!==userId)
      .filter(member=>{
        if(!normalized)return true
        return member.name.toLowerCase().includes(normalized) ||
          (member.email || '').toLowerCase().includes(normalized)
      })
      .slice(0,8)
      .map(member=>({
        userId:member.userId,
        name:member.name,
        email:member.email
      }))
  },[mentionQuery,roomMembers,selectedRoom,userId])

  const closeMentionSuggestions=()=>{
    setMentionQuery(null)
    setMentionStart(-1)
    setMentionIndex(0)
  }

  const updateMentionQuery=(value:string,caret:number)=>{
    if(!selectedRoom){
      closeMentionSuggestions()
      return
    }

    const prefix=value.slice(0,caret)
    const match=prefix.match(/(?:^|\s)@([^\s@]*)$/)

    if(!match){
      closeMentionSuggestions()
      return
    }

    setMentionStart(prefix.lastIndexOf('@'))
    setMentionQuery(match[1] || '')
    setMentionIndex(0)
  }

  const selectMention=(person:MentionSuggestionPerson)=>{
    if(mentionStart<0)return

    const input=composerRef.current
    const caret=input?.selectionStart ?? messageText.length
    const token=`@${person.name}`
    const before=messageText.slice(0,mentionStart)
    const after=messageText.slice(caret)
    const next=`${before}${token} ${after}`.slice(0,10000)
    const nextCaret=Math.min(
      mentionStart+token.length+1,
      next.length
    )

    setMessageText(next)
    setSelectedMentions(current=>[
      ...current.filter(item=>item.userId!==person.userId),
      {
        userId:person.userId,
        token
      }
    ])
    closeMentionSuggestions()

    requestAnimationFrame(()=>{
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(
        nextCaret,
        nextCaret
      )
      resizeComposer()
    })
  }

  const selected=useMemo<DirectRow|null>(()=> {
    if(selectedDirect)return selectedDirect
    if(!selectedRoom)return null

    return {
      conversation:{
        id:selectedRoom.id,
        is_group:selectedRoom.is_group,
        title:selectedRoom.title,
        created_by:selectedRoom.created_by,
        created_at:selectedRoom.created_at,
        conversation_kind:selectedRoom.conversation_kind
      },
      other:{
        id:selectedRoom.id,
        full_name:selectedRoom.title || 'Room',
        email:'',
        department:selectedRoom.conversation_kind,
        job_title:'Room'
      },
      membership:{
        conversation_id:selectedRoom.id,
        user_id:userId,
        joined_at:selectedRoom.created_at,
        last_read_at:selectedRoom.created_at,
        archived_at:null
      },
      otherReadAt:null,
      latest:null,
      unread:0
    }
  },[selectedDirect,selectedRoom,userId])

  useEffect(()=>{
    const client=supabase

    if(!client || !userId){
      setIsGlobalChatAdmin(false)
      return
    }

    let cancelled=false

    void client
      .rpc('is_workspace_chat_admin')
      .then(({data,error})=>{
        if(cancelled)return

        if(error){
          setIsGlobalChatAdmin(false)
          return
        }

        setIsGlobalChatAdmin(data === true)
      })

    return ()=>{
      cancelled=true
    }
  },[userId])

  const loadRoomDetails=useCallback(async()=>{
    const client=supabase

    if(!client || !selectedRoom){
      setRoomMembers([])
      setCanAdministerRoom(false)
      return
    }

    setRoomDetailsLoading(true)

    try{
      const [
        memberResult,
        roomAdminResult,
        globalAdminResult
      ]=await Promise.all([
        client
          .from('social_conversation_members')
          .select('user_id,room_role,removed_at')
          .eq('conversation_id',selectedRoom.id)
          .is('removed_at',null),
        client.rpc(
          'is_room_admin',
          {
            p_conversation_id:selectedRoom.id
          }
        ),
        client.rpc(
          'is_workspace_chat_admin'
        )
      ])

      if(memberResult.error)throw memberResult.error
      if(roomAdminResult.error)throw roomAdminResult.error
      if(globalAdminResult.error)throw globalAdminResult.error

      const mapped=((memberResult.data || []) as Array<{
        user_id:string
        room_role:'member'|'admin'|'owner'
        removed_at:string|null
      }>).map(member=>{
        const person=peopleRef.current.get(
          member.user_id
        )

        return {
          userId:member.user_id,
          name:
            person?.full_name?.trim() ||
            person?.email ||
            'RideArrivo employee',
          email:person?.email || undefined,
          roomRole:member.room_role
        } satisfies RoomMember
      })

      mapped.sort((a,b)=>{
        const weight={
          owner:0,
          admin:1,
          member:2
        } as const

        const roleDifference=
          weight[a.roomRole]-
          weight[b.roomRole]

        if(roleDifference)return roleDifference

        return a.name.localeCompare(b.name)
      })

      setRoomMembers(mapped)
      setCanAdministerRoom(
        roomAdminResult.data === true
      )
      setIsGlobalChatAdmin(
        globalAdminResult.data === true
      )
    }catch(error){
      setRoomMembers([])
      setCanAdministerRoom(false)
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to load room administration.'
      )
    }finally{
      setRoomDetailsLoading(false)
    }
  },[selectedRoom])

  useEffect(()=>{
    if(!selectedRoom){
      setRoomMembers([])
      setCanAdministerRoom(false)
      return
    }

    void loadRoomDetails()
  },[selectedRoom,loadRoomDetails])

  const roomCandidates=useMemo<RoomCandidate[]>(
    ()=>people.map(person=>({
      userId:person.id,
      name:
        person.full_name?.trim() ||
        person.email,
      email:person.email || undefined
    })),
    [people]
  )

  const calls=useChatCalls(userId)

  // Per chat: the latest call that has settled, and how many missed calls are new.
  const callInfo=useMemo(()=>{
    const latest=new Map<string,CallRecord>()
    for(const call of calls){
      if(call.status==='ringing')continue
      const known=latest.get(call.conversation_id)
      if(!known || Date.parse(call.created_at)>Date.parse(known.created_at))latest.set(call.conversation_id,call)
    }
    return latest
  },[calls])

  // Newest first, one line per call, only calls that have settled.
  const callHistory=useMemo(()=>{
    const byId=new Map(directs.map(row=>[row.conversation.id,row]))
    const out:Array<{call:CallRecord;row:DirectRow}>=[]
    for(const call of calls){
      if(call.status==='ringing')continue
      const row=byId.get(call.conversation_id)
      if(row)out.push({call,row})
      if(out.length>=100)break
    }
    return out
  },[calls,directs])

  const missedFor=useCallback((row:DirectRow)=>{
    if(!userId || row.conversation.id===selectedId)return 0
    const seen=[row.membership.last_read_at,callSeen[row.conversation.id]]
      .filter(Boolean)
      .sort()
      .pop()
    return unseenMissed(calls,userId,row.conversation.id,seen)
  },[calls,userId,selectedId,callSeen])

  const peopleMap=useMemo(()=>new Map(people.map(person=>[person.id,person])),[people])
  const totalUnread=useMemo(
    ()=>directs.reduce(
      (sum,row)=>row.membership.archived_at?sum:sum+row.unread,
      0
    ) + rooms.reduce(
      (sum,room)=>sum+(room.unread || 0),
      0
    ),
    [directs,rooms]
  )
  const totalMissed=useMemo(()=>directs.reduce((sum,row)=>row.membership.archived_at||row.conversation.id===selectedId?sum:sum+unseenMissed(calls,userId,row.conversation.id,[row.membership.last_read_at,callSeen[row.conversation.id]].filter(Boolean).sort().pop()),0),[directs,calls,userId,selectedId,callSeen])
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
      .filter(row=>filter!=='unread' || row.unread>0 || missedFor(row)>0)
      .filter(row=>{
        if(!normalized || newChatOpen)return true
        return displayName(row.other).toLowerCase().includes(normalized) ||
          (row.latest?.body || '').toLowerCase().includes(normalized)
      })
  },[directs,filter,query,newChatOpen,missedFor])

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
        setRooms([])
        return
      }

      const {data:conversationData,error:conversationError}=await client
        .from('social_conversations')
        .select('id,is_group,title,created_by,created_at,conversation_kind')
        .in('id',ids)
      if(conversationError)throw conversationError

      const conversations=(conversationData || []) as Conversation[]

      const {
        data:unreadSummaryData,
        error:unreadSummaryError
      }=await client.rpc('list_chat_unread_summary')

      if(unreadSummaryError)throw unreadSummaryError

      const unreadSummaryRows=(unreadSummaryData || []) as Array<{
        conversation_id:string
        unread_count:number|string
        mentioned:boolean
      }>

      const unreadSummary=new Map(
        unreadSummaryRows.map(row=>[
          row.conversation_id,
          row
        ])
      )

      const roomConversations=conversations
        .filter(conversation=>conversation.conversation_kind!=='direct')
        .map(conversation=>{
          const summary=unreadSummary.get(conversation.id)
          const isOpenNow=
            conversation.id===selectedRef.current &&
            canMarkReadNow()

          return {
            id:conversation.id,
            is_group:conversation.is_group,
            title:conversation.title,
            created_by:conversation.created_by,
            created_at:conversation.created_at,
            conversation_kind:conversation.conversation_kind,
            unread:isOpenNow
              ? 0
              : Number(summary?.unread_count || 0),
            mentioned:isOpenNow
              ? false
              : Boolean(summary?.mentioned)
          } satisfies ConversationSummary
        })

      setRooms(roomConversations)

      const directConversations=conversations
        .filter(conversation=>conversation.conversation_kind==='direct')

      const directIds=directConversations.map(conversation=>conversation.id)

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

      const rows:DirectRow[]=directConversations.map(conversation=>{
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

  const loadReceiptSummaries=useCallback(async(conversationId:string)=>{
    if(!conversationId){
      setReceiptSummaries({})
      return
    }

    try{
      const rows=
        await listReceiptSummaries(
          conversationId
        )

      setReceiptSummaries(
        Object.fromEntries(
          rows.map(row=>[
            row.message_id,
            row
          ])
        )
      )
    }catch(error){
      console.warn(
        'Unable to refresh message receipts.',
        error
      )
    }
  },[])

  const markRead=useCallback(async(conversationId:string)=>{
    const client=supabase
    if(!client || !conversationId || !canMarkReadNow())return
    setDirects(rows=>rows.map(row=>row.conversation.id===conversationId && row.unread>0
      ? {...row,unread:0}
      : row))
    setRooms(rows=>rows.map(room=>room.id===conversationId
      ? {...room,unread:0,mentioned:false}
      : room))
    setCallSeen(current=>({...current,[conversationId]:new Date().toISOString()}))
    const [
      membershipResult,
      receiptResult
    ]=await Promise.allSettled([
      client.rpc(
        'mark_social_conversation_read',
        {
          p_conversation_id:
            conversationId
        }
      ),
      ackChatRead(
        conversationId
      )
    ])

    if(
      membershipResult.status==='fulfilled' &&
      membershipResult.value.error
    ){
      setNotice(
        membershipResult.value.error.message
      )
    }

    if(
      receiptResult.status==='rejected'
    ){
      console.warn(
        'Unable to acknowledge read receipts.',
        receiptResult.reason
      )
    }

    void loadReceiptSummaries(
      conversationId
    )
  },[loadReceiptSummaries])

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
      // Keep local messages that are still sending or failed, and any older
      // pages the person already loaded.
      setMessages(current=>{
        const mine=current.filter(m=>m.conversation_id===conversationId)
        const local=mine.filter(m=>m.pending || m.failed)
        const older=keepOlderThan(mine,fresh[0]?.created_at)
        return mergeMessages(mergeMessages(older,fresh),local)
      })
      setHasOlder(current=>(current && fresh.length>=300) || (data||[]).length>=300)

      void ackChatDelivered(
        fresh
          .filter(
            message=>
              message.sender_id!==userId
          )
          .map(
            message=>message.id
          )
      ).catch(error=>{
        console.warn(
          'Unable to acknowledge message delivery.',
          error
        )
      })

      void loadReceiptSummaries(
        conversationId
      )

      void markRead(
        conversationId
      )
    }catch(error){
      if(sequence===threadRequestRef.current){
        setNotice(error instanceof Error ? error.message : 'Unable to load this conversation.')
      }
    }finally{
      if(sequence===threadRequestRef.current)setThreadLoading(false)
    }
  },[loadReceiptSummaries,markRead,userId])

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
    setSelectedMentions([])
    setMentionQuery(null)
    setMentionStart(-1)
    setMentionIndex(0)
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

  const loadOlder=async()=>{
    const client=supabase
    const first=messages.find(m=>!m.pending && !m.failed)
    if(!client || !selectedId || !first || loadingOlder)return
    setLoadingOlder(true)
    const element=scrollRef.current
    const before=element?element.scrollHeight:0
    try{
      const {data,error}=await client
        .from('social_messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id',selectedId)
        .lt('created_at',first.created_at)
        .order('created_at',{ascending:false})
        .limit(OLDER_PAGE)
      if(error)throw error
      const page=((data||[]) as Message[])
      stickToBottomRef.current=false
      setMessages(current=>mergeOlder(current,page))
      setHasOlder(page.length>=OLDER_PAGE)
      // Keep the message the person was reading where it was.
      window.requestAnimationFrame(()=>{
        const el=scrollRef.current
        if(el)el.scrollTop=el.scrollHeight-before
      })
    }catch(error){
      setNotice(error instanceof Error?error.message:'Unable to load earlier messages.')
    }finally{
      setLoadingOlder(false)
    }
  }

  const saveEdit=async()=>{
    const client=supabase
    const text=editText.trim()
    const target=messages.find(m=>m.id===editingId)
    if(!client || !target || editBusy)return
    if(!text && !target.attachment_path){
      setNotice('A message cannot be empty. Delete it instead.')
      return
    }
    if(text===target.body){
      setEditingId('')
      return
    }
    setEditBusy(true)
    const {data,error}=await client.rpc('edit_social_message',{p_id:target.id,p_body:text})
    setEditBusy(false)
    if(error){
      setNotice(error.message)
      return
    }
    setMessages(current=>current.map(m=>m.id===target.id?{...m,body:text,edited_at:typeof data==='string'?data:new Date().toISOString()}:m))
    setEditingId('')
  }

  const deleteMessage=async(message:Message)=>{
    const client=supabase
    if(!client)return
    if(!window.confirm('Delete this message for both of you? This cannot be undone.'))return
    const {data,error}=await client.rpc('delete_social_message',{p_id:message.id})
    if(error){
      setNotice(error.message)
      return
    }
    setMessages(current=>current.map(m=>m.id===message.id?{...m,body:'This message was deleted',deleted_at:new Date().toISOString(),attachment_path:null,attachment_name:null,attachment_mime:null,attachment_size:null,attachment_duration_ms:null}:m))
    // Remove the stored file too (best effort: the message is already gone).
    if(typeof data==='string' && data)void client.storage.from(ATTACH_BUCKET).remove([data]).catch(()=>{})
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

          if(!mine){
            void ackChatDelivered(
              [row.id]
            ).catch(error=>{
              console.warn(
                'Unable to acknowledge realtime delivery.',
                error
              )
            })
          }

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
        {event:'UPDATE',schema:'public',table:'social_messages'},
        payload=>{
          // The other person edited or deleted a message.
          const row=payload.new as Message
          setMessages(current=>current.some(m=>m.id===row.id)?current.map(m=>m.id===row.id?{...m,body:row.body,edited_at:row.edited_at,deleted_at:row.deleted_at,attachment_path:row.attachment_path,attachment_name:row.attachment_name,attachment_mime:row.attachment_mime,attachment_size:row.attachment_size,attachment_duration_ms:row.attachment_duration_ms}:m):current)
          setDirects(rows=>rows.map(item=>item.latest?.id===row.id?{...item,latest:{...item.latest,body:row.body,edited_at:row.edited_at,deleted_at:row.deleted_at}}:item))
        }
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'chat_message_receipts'
        },
        ()=>{
          const conversationId=
            selectedRef.current

          if(conversationId){
            void loadReceiptSummaries(
              conversationId
            )
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
  },[userId,loadBase,markRead,loadReceiptSummaries])

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

  const sendMessage=async(opts:{body:string;file?:File|null;mime?:string;durationMs?:number|null;tempId?:string;replyId?:string|null;clientMessageId?:string;mentionedUserIds?:string[]})=>{
    const client=supabase
    if(!client || !userId || !selectedId)return
    const conversationId=selectedId
    const {body,file,replyId}=opts
    const mentionedUserIds=opts.mentionedUserIds || []
    const id=opts.tempId || `temp-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    const clientMessageId=opts.clientMessageId || crypto.randomUUID()
    const optimistic:Message={
      id,
      conversation_id:conversationId,
      sender_id:userId,
      body,
      edited_at:null,
      created_at:new Date().toISOString(),
      reply_to_id:replyId || null,
      client_message_id:clientMessageId,
      mentionedUserIds,
      attachment_name:file?.name || null,
      attachment_mime:file ? opts.mime || file.type : null,
      attachment_size:file?.size ?? null,
      attachment_duration_ms:opts.durationMs ?? null,
      localUrl:file && (isImageMime(opts.mime || file.type) || isAudioMime(opts.mime || file.type)) ? URL.createObjectURL(file) : undefined,
      pending:true
    }
    forceScrollRef.current=true
    setMessages(current=>mergeMessages(current.filter(m=>m.id!==id),[optimistic]))

    if(!file){
      try{
        const data=await sendChatMessage({
          conversationId,
          body,
          replyToId:replyId || null,
          clientMessageId,
          mentionedUserIds
        })
        const saved={...(data as Message),localUrl:optimistic.localUrl}
        setNotice('')
        setMessages(current=>mergeMessages(current.filter(m=>m.id!==id),[saved]))
        setDirects(rows=>rows.map(row=>row.conversation.id===conversationId ? {...row,latest:saved} : row))
      }catch(error){
        setMessages(current=>current.map(m=>m.id===id ? {...m,pending:false,failed:true} : m))
        setNotice(error instanceof Error ? error.message : 'Unable to send message.')
      }
      return
    }

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
    if(mentionedUserIds.length){
      try{
        await registerChatMessageMentions(
          (data as Message).id,
          mentionedUserIds
        )
      }catch(error){
        setNotice(
          error instanceof Error
            ? `Message sent, but mention notification failed: ${error.message}`
            : 'Message sent, but the mention notification failed.'
        )
      }
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
    const mentionedUserIds=selectedMentions
      .filter(item=>body.includes(item.token))
      .map(item=>item.userId)

    setMessageText('')
    setSelectedMentions([])
    closeMentionSuggestions()
    setReplyTo(null)
    setStaged([])
    requestAnimationFrame(resizeComposer)
    if(!files.length){
      void sendMessage({
        body,
        replyId,
        mentionedUserIds
      })
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
          replyId:index===0 ? replyId : null,
          mentionedUserIds:index===0
            ? mentionedUserIds
            : []
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
      replyId:message.reply_to_id,
      clientMessageId:message.client_message_id||undefined,
      mentionedUserIds:message.mentionedUserIds || []
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

  const startCall=async(kind:'Voice'|'Video',target:DirectRow|null=selected)=>{
    const client=supabase
    const selected=target
    if(!client || !selected || calling)return
    if(!hasCalling){
      setCallNotice(`${kind} calling is not enabled on your account yet. Reach out to Admin to give you access.`)
      return
    }
    setCalling(true)
    setCallNotice('')
    let createdRoomId=''
    try{
      const room=await createCallRoom(`Call with ${displayName(selected.other)}`)
      createdRoomId=room.room.id
      const {data:callId,error}=await client.rpc('start_chat_call',{
        p_conversation:selected.conversation.id,
        p_kind:kind==='Video'?'video':'voice',
        p_room_code:room.room.room_code
      })
      if(error)throw error
      createdRoomId=''
      // Stay in Chat: the call opens as a small window over the conversation.
      requestJoinRoom({
        code:room.room.room_code,
        audioOnly:kind==='Voice',
        callId:typeof callId==='string'?callId:undefined,
        inPlace:true
      })
    }catch(error){
      // The ring never started, so do not leave an empty room open behind it.
      if(createdRoomId)void endCallRoom(createdRoomId)
      setCallNotice(error instanceof Error ? error.message : 'Unable to start the call.')
    }finally{
      setCalling(false)
    }
  }

  const rows=useMemo(()=>{
    const out:Array<{type:'day';key:string;label:string}|{type:'message';message:Message}|{type:'call';call:CallRecord}>=[]
    let last=''
    for(const item of mergeTimeline(messages,calls,selectedId)){
      const stamp=item.type==='message'?item.message.created_at:item.call.created_at
      const label=dayLabel(stamp)
      if(label!==last){
        out.push({type:'day',key:`${item.type==='message'?item.message.id:item.call.id}-day`,label})
        last=label
      }
      out.push(item.type==='message'?{type:'message',message:item.message}:{type:'call',call:item.call})
    }
    return out
  },[messages,calls,selectedId])

  const retryableMessage=[...messages]
    .reverse()
    .find(message=>message.failed) || null

  const composerSendState:MessageSendState=
    retryableMessage
      ? 'failed'
      : messages.some(message=>message.pending)
        ? 'sending'
        : 'sent'


  return (
    <section className="cm">
      {notice&&<div className="cmNotice" role="status">{notice}<button type="button" aria-label="Dismiss" onClick={()=>setNotice('')}><X size={14}/></button></div>}

      <div className={`cmShell ${mobileThreadOpen && selectedId?'threadOpen':'listOpen'}`}>
        <ConversationSidebar
          rooms={rooms}
          directMessages={directs.map(row=>row.conversation)}
          selectedId={selectedId}
          onSelect={conversationId=>{
            setSelectedId(conversationId)
            setMobileThreadOpen(true)
          }}
        >
          <header className="cmSideHead">
            <h2>Chats{totalUnread+totalMissed>0&&<span className="cmTotal">{totalUnread+totalMissed>99?'99+':totalUnread+totalMissed}</span>}</h2>
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

          <ConversationSearch
            value={query}
            onChange={setQuery}
            placeholder={
              newChatOpen
                ? 'Search employees'
                : 'Search or start a new chat'
            }
          />

          {!newChatOpen&&(
            <div className="cmChips">
              <button type="button" className={filter==='all'?'on':''} onClick={()=>setFilter('all')}>All</button>
              <button type="button" className={filter==='unread'?'on':''} onClick={()=>setFilter('unread')}>
                Unread{totalUnread+totalMissed>0?` ${totalUnread+totalMissed}`:''}
              </button>
              <button type="button" className={filter==='calls'?'on':''} onClick={()=>setFilter('calls')}>
                Calls{totalMissed>0?` ${totalMissed}`:''}
              </button>
              <button type="button" className={filter==='archived'?'on':''} onClick={()=>setFilter('archived')}>
                Archived{archivedCount>0?` ${archivedCount}`:''}
              </button>
            </div>
          )}

          <div className="cmList">
            {newChatOpen && isGlobalChatAdmin && (
              <RoomCreator
                canCreateRoom={isGlobalChatAdmin}
                onCreated={conversationId=>{
                  setNewChatOpen(false)
                  setQuery('')
                  setSelectedId(conversationId)
                  setMobileDetailsOpen(false)
                  setMobileThreadOpen(true)

                  void loadBase()
                }}
              />
            )}

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

            {!newChatOpen&&filter!=='calls'&&rooms.length>0&&(
              <div className="cmGroup">
                <div className="cmGroupLabel">Rooms</div>
                <RoomList
                  rooms={rooms}
                  selectedId={selectedId}
                  onSelect={conversationId=>{
                    setSelectedId(conversationId)
                    setMobileThreadOpen(true)
                    setMobileDetailsOpen(false)
                  }}
                />
              </div>
            )}

            {!newChatOpen&&filter==='calls'&&(
              <div className="cmGroup">
                {callHistory.length===0&&(
                  <div className="cmEmpty cmEmptyBlock">
                    <Phone size={26}/>
                    <strong>No calls yet</strong>
                    <span>Voice and video calls you make or receive in chat appear here.</span>
                  </div>
                )}
                {callHistory.map(({call,row})=>{
                  const label=describeCall(call,userId)
                  const Icon=label.tone==='missed' ? PhoneMissed : call.caller_id===userId ? PhoneOutgoing : PhoneIncoming
                  return (
                    <div key={call.id} className={`cmRow cmCallRow ${label.tone}`}>
                      <button type="button" className="cmCallRowMain" onClick={()=>{setFilter('all');openConversation(row.conversation.id)}}>
                        <span className="cmAvatar">{initials(displayName(row.other))}</span>
                        <span className="cmRowCopy">
                          <span className="cmRowTop">
                            <strong>{displayName(row.other)}</strong>
                            <small>{formatListTime(call.created_at)}</small>
                          </span>
                          <span className="cmRowBottom">
                            <small className={`cmCallState ${label.tone}`}>
                              {call.kind==='video'?<Video size={13}/>:<Icon size={13}/>}
                              {label.title}{label.detail&&label.detail!=='Ended'?`, ${label.detail}`:''}
                            </small>
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="cmCallRowBtn"
                        title={call.kind==='video'?'Video call back':'Call back'}
                        aria-label={`Call ${displayName(row.other)} back`}
                        disabled={calling}
                        onClick={()=>void startCall(call.kind==='video'?'Video':'Voice',row)}
                      >
                        {call.kind==='video'?<Video size={16}/>:<Phone size={16}/>}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {!newChatOpen&&filter!=='calls'&&(
              <>
                {loading&&!loadedOnceRef.current&&<div className="cmEmpty">Loading chats...</div>}
                {visibleDirects.map(row=>{
                  const mine=row.latest?.sender_id===userId
                  const lastCall=callInfo.get(row.conversation.id) || null
                  const callIsLatest=!!lastCall && (!row.latest || Date.parse(lastCall.created_at)>Date.parse(row.latest.created_at))
                  const missedNew=missedFor(row)
                  const badge=row.unread+missedNew
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
                          <small className={badge>0?'unread':''}>{formatListTime((callIsLatest&&lastCall?lastCall.created_at:row.latest?.created_at) || row.conversation.created_at)}</small>
                        </span>
                        <span className="cmRowBottom">
                          <small className={missedNew>0?'cmMissedText':''}>
                            {callIsLatest&&lastCall
                              ? callPreview(lastCall,userId)
                              : row.latest?`${mine?'You: ':''}${messagePreview(row.latest)}`:secondary(row.other)}
                          </small>
                          {badge>0&&<span className="cmBadge">{badge>99?'99+':badge}</span>}
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
        </ConversationSidebar>

        {selectedRoom&&mobileDetailsOpen&&(
          <div className="cmRoomDetailsLayer">
            {roomDetailsLoading && (
              <div
                className="cmRoomDetailsLoading"
                role="status"
              >
                Loading room details...
              </div>
            )}

            <RoomDetails
              room={selectedRoom}
              members={roomMembers}
              candidates={roomCandidates}
              canAdministerRoom={canAdministerRoom}
              isGlobalChatAdmin={isGlobalChatAdmin}
              onClose={()=>setMobileDetailsOpen(false)}
              onChanged={()=>void loadRoomDetails()}
              onArchived={()=>{
                setMobileDetailsOpen(false)
                setSelectedId('')
                void loadBase()
              }}
            />
          </div>
        )}

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

          {selectedRoom&&(
            <button
              type="button"
              className="cmMobileDetailsButton"
              onClick={()=>setMobileDetailsOpen(open=>!open)}
            >
              Room details
            </button>
          )}
          {dragging&&<div className="cmDrop">Drop files to send them to {displayName(selected?.other)}</div>}
          {selected ? (
            <>
              <header className="cmThreadHead">
                <button type="button" className="cmBack" aria-label="Back to chats" onClick={()=>setMobileThreadOpen(false)}>
                  <ArrowLeft size={20}/>
                </button>
                {selectedRoom ? (
                  <button
                    type="button"
                    className="cmRoomHeadIdentity"
                    onClick={()=>setMobileDetailsOpen(true)}
                    aria-label={`Open ${selectedRoom.title || 'room'} details`}
                  >
                    <span className="cmAvatar cmRoomHeadAvatar">
                      {initials(displayName(selected.other))}
                    </span>

                    <span className="cmHeadCopy">
                      <strong>
                        {selectedRoom.title || displayName(selected.other)}
                      </strong>

                      <small>
                        {selectedRoom.conversation_kind.charAt(0).toUpperCase()
                          + selectedRoom.conversation_kind.slice(1)}
                        {' room · '}
                        {roomMembers.length}
                        {' '}
                        {roomMembers.length === 1 ? 'member' : 'members'}
                      </small>
                    </span>

                    {roomMembers.length > 0 && (
                      <span
                        className="cmRoomHeadMembers"
                        aria-label={`${roomMembers.length} active room members`}
                      >
                        {roomMembers.slice(0, 3).map(member => (
                          <span
                            key={member.userId}
                            className="cmRoomHeadMemberAvatar"
                            title={member.name}
                          >
                            {initials(member.name)}
                          </span>
                        ))}

                        {roomMembers.length > 3 && (
                          <span className="cmRoomHeadMemberMore">
                            +{roomMembers.length - 3}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                ) : (
                  <>
                    <span className="cmAvatar">
                      {initials(displayName(selected.other))}
                    </span>

                    <div className="cmHeadCopy">
                      <strong>{displayName(selected.other)}</strong>
                      <small>{secondary(selected.other)}</small>
                    </div>
                  </>
                )}
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
                  {!selectedRoom&&(
                    <>
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
                        <button
                          type="button"
                          className="cmRound cmDanger"
                          title="Delete chat (admin only)"
                          aria-label="Delete chat (admin only)"
                          onClick={()=>void deleteChat(selected)}
                        >
                          <Trash2 size={18}/>
                        </button>
                      )}

                      <button
                        type="button"
                        className="cmRound"
                        title="Video call"
                        aria-label="Video call"
                        disabled={calling}
                        onClick={()=>void startCall('Video')}
                      >
                        <Video size={18}/>
                      </button>

                      <button
                        type="button"
                        className="cmRound"
                        title="Voice call"
                        aria-label="Voice call"
                        disabled={calling}
                        onClick={()=>void startCall('Voice')}
                      >
                        <Phone size={18}/>
                      </button>
                    </>
                  )}
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

              <MessageTimeline
                scrollRef={scrollRef}
                onScroll={onScroll}
              >
                <div className="cmLock">
                  <ShieldCheck size={13}/>
                  {selectedRoom
                    ? 'Private workspace room. Only active room members can see this conversation.'
                    : 'Private. Only the two of you can see this conversation.'}
                </div>
                {hasOlder&&(
                  <button type="button" className="cmOlder" disabled={loadingOlder} onClick={()=>void loadOlder()}>
                    {loadingOlder?'Loading...':'Load earlier messages'}
                  </button>
                )}
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
                  if(item.type==='call'){
                    const call=item.call
                    const label=describeCall(call,userId)
                    const Icon=call.status==='missed'||call.status==='cancelled'||call.status==='declined'
                      ? PhoneMissed
                      : call.caller_id===userId ? PhoneOutgoing : PhoneIncoming
                    return (
                      <div className={`cmCallLine ${label.tone}`} key={call.id} id={`cm-call-${call.id}`}>
                        <span className="cmCallIcon">{call.kind==='video'?<Video size={16}/>:<Icon size={16}/>}</span>
                        <span className="cmCallCopy">
                          <strong>{label.title}</strong>
                          <small>{label.detail} &middot; {new Date(call.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small>
                        </span>
                        {label.canCallBack&&selected&&(
                          <button type="button" className="cmCallBack" disabled={calling} onClick={()=>void startCall(call.kind==='video'?'Video':'Voice')}>
                            {call.kind==='video'?<Video size={14}/>:<Phone size={14}/>}Call back
                          </button>
                        )}
                      </div>
                    )
                  }
                  const message=item.message
                  const mine=message.sender_id===userId
                  const sender=mine ? null : peopleMap.get(message.sender_id)
                  const legacyRead=
                    mine &&
                    !message.pending &&
                    !message.failed &&
                    selected.otherReadAt &&
                    new Date(selected.otherReadAt).getTime()>=
                      new Date(message.created_at).getTime()

                  const receipt=
                    mine
                      ? receiptSummaries[
                          message.id
                        ]
                      : undefined

                  const deliveryState=
                    mine
                      ? receiptState(
                          receipt,
                          !!legacyRead
                        )
                      : 'sent'

                  const deliveryTitle=
                    mine
                      ? receiptTitle(
                          receipt,
                          selectedRoom!==null,
                          !!legacyRead
                        )
                      : ''
                  const quoted=message.reply_to_id ? messages.find(m=>m.id===message.reply_to_id) || null : null
                  const deleted=isDeleted(message)
                  const canReply=!message.pending && !message.failed && !deleted
                  const showEdit=canEdit(message,userId)
                  const showDelete=canDelete(message,userId)
                  const editing=editingId===message.id
                  return (
                    <div key={message.id} id={`cm-msg-${message.id}`} className={`cmMsg ${mine?'mine':'theirs'}${message.failed?' failed':''}${deleted?' deleted':''}`}>
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
                        {showEdit&&!editing&&(
                          <button
                            type="button"
                            className="cmReplyBtn cmEditBtn"
                            aria-label="Edit this message"
                            title="Edit"
                            onClick={()=>{setEditingId(message.id);setEditText(message.body)}}
                          >
                            <Pencil size={14}/>
                          </button>
                        )}
                        {showDelete&&!editing&&(
                          <button
                            type="button"
                            className="cmReplyBtn cmDeleteBtn"
                            aria-label="Delete this message"
                            title="Delete"
                            onClick={()=>void deleteMessage(message)}
                          >
                            <Trash2 size={14}/>
                          </button>
                        )}
                        {!deleted&&message.reply_to_id&&(
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
                        {!deleted&&(message.attachment_name||message.attachment_path)&&(()=>{
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
                        {deleted
                          ? <p className="cmDeletedText">This message was deleted</p>
                          : editing
                            ? (
                              <div className="cmEditBox">
                                <textarea
                                  value={editText}
                                  autoFocus
                                  rows={2}
                                  maxLength={10000}
                                  aria-label="Edit message"
                                  onChange={event=>setEditText(event.target.value)}
                                  onKeyDown={event=>{
                                    if(event.key==='Escape'){setEditingId('');return}
                                    if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){
                                      event.preventDefault()
                                      void saveEdit()
                                    }
                                  }}
                                />
                                <span className="cmEditActions">
                                  <button type="button" onClick={()=>setEditingId('')}>Cancel</button>
                                  <button type="button" className="primary" disabled={editBusy} onClick={()=>void saveEdit()}>{editBusy?'Saving...':'Save'}</button>
                                </span>
                              </div>
                            )
                            : message.body&&<p>{message.body}</p>}
                        <span className="cmMeta">
                          {formatTime(message.created_at)}
                          {message.edited_at&&!deleted?' edited':''}
                          {mine&&(
                            message.failed
                              ? null
                              : message.pending
                                ? <span
                                    className="cmReceipt"
                                    aria-label="Sending"
                                    title="Sending"
                                  >
                                    <Check
                                      size={14}
                                      className="cmTick pending"
                                      aria-hidden="true"
                                    />
                                  </span>
                                : deliveryState==='read'
                                  ? <span
                                      className="cmReceipt"
                                      title={deliveryTitle}
                                      aria-label={deliveryTitle}
                                    >
                                      <CheckCheck
                                        size={15}
                                        className="cmTick read"
                                      />
                                      {selectedRoom&&receipt&&(
                                        <small className="cmReceiptLabel">
                                          Seen {receipt.read_count}/{receipt.recipient_count}
                                        </small>
                                      )}
                                    </span>
                                  : deliveryState==='delivered'
                                    ? <span
                                        className="cmReceipt"
                                        title={deliveryTitle}
                                        aria-label={deliveryTitle}
                                      >
                                        <CheckCheck
                                          size={15}
                                          className="cmTick delivered"
                                        />
                                        {selectedRoom&&receipt&&(
                                          <small className="cmReceiptLabel">
                                            Delivered {receipt.delivered_count}/{receipt.recipient_count}
                                          </small>
                                        )}
                                      </span>
                                    : <span
                                        className="cmReceipt"
                                        aria-label="Sent"
                                        title="Sent"
                                      >
                                        <Check
                                          size={14}
                                          className="cmTick"
                                          aria-hidden="true"
                                        />
                                      </span>
                          )}
                        </span>
                      </div>
                      {message.failed&&(
                        <button type="button" className="cmRetry" onClick={()=>retry(message)}>Not sent. Tap to retry</button>
                      )}
                    </div>
                  )
                })}
              </MessageTimeline>

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
              {otherTyping&&<div className="cmTyping" role="status">{typingLine(displayName(selected.other))}</div>}
              <MessageComposer
                sendState={composerSendState}
                onRetry={()=>{
                  if(retryableMessage){
                    void retry(retryableMessage)
                  }
                }}
                onSubmit={submit}
                hidden={!!voice}
              >
                <MentionSuggestions
                  members={mentionSuggestions}
                  activeIndex={mentionIndex}
                  onSelect={selectMention}
                />

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
                    const next=event.target.value.slice(0,10000)
                    const caret=Math.min(
                      event.target.selectionStart ?? next.length,
                      next.length
                    )

                    setMessageText(next)
                    setSelectedMentions(current=>
                      current.filter(item=>
                        next.includes(item.token)
                      )
                    )
                    updateMentionQuery(next,caret)
                    resizeComposer()
                    if(next.trim())pingTyping()
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
                  enterKeyHint="enter"
                  aria-label={`Message ${displayName(selected.other)}`}
                  onKeyDown={event=>{
                    if(mentionQuery!==null && mentionSuggestions.length){
                      if(event.key==='ArrowDown'){
                        event.preventDefault()
                        setMentionIndex(index=>
                          (index+1)%mentionSuggestions.length
                        )
                        return
                      }

                      if(event.key==='ArrowUp'){
                        event.preventDefault()
                        setMentionIndex(index=>
                          (
                            index-1+
                            mentionSuggestions.length
                          )%mentionSuggestions.length
                        )
                        return
                      }

                      if(
                        (event.key==='Enter' || event.key==='Tab') &&
                        !event.nativeEvent.isComposing
                      ){
                        event.preventDefault()
                        selectMention(
                          mentionSuggestions[mentionIndex] ||
                          mentionSuggestions[0]
                        )
                        return
                      }

                      if(event.key==='Escape'){
                        event.preventDefault()
                        closeMentionSuggestions()
                        return
                      }
                    }

                    if(event.key==='Escape'&&replyTo){
                      setReplyTo(null)
                      return
                    }

                  }}
                />
                <button className="cmSend" type="submit" aria-label="Send" disabled={!messageText.trim() && !staged.length}>
                  <Send size={19}/>
                </button>
              </MessageComposer>
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

export default ChatShell
