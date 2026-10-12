import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  CheckCheck,
  MessageSquareText,
  Phone,
  Plus,
  Reply,
  Search,
  Send,
  ShieldCheck,
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
import { createCallRoom, requestJoinRoom } from '../lib/roomApi'

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

const MESSAGE_COLUMNS='id,conversation_id,sender_id,body,edited_at,created_at,reply_to_id'
const OPEN_KEY='ra.chat.open'

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
                ? current.filter(m=>!(m.pending && m.body===row.body))
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

  const sendBody=async(body:string,tempId?:string,replyId?:string|null)=>{
    const client=supabase
    if(!client || !userId || !selectedId)return
    const conversationId=selectedId
    const id=tempId || `temp-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    const optimistic:Message={
      id,
      conversation_id:conversationId,
      sender_id:userId,
      body,
      edited_at:null,
      created_at:new Date().toISOString(),
      reply_to_id:replyId || null,
      pending:true
    }
    forceScrollRef.current=true
    setMessages(current=>mergeMessages(current.filter(m=>m.id!==id),[optimistic]))

    const {data,error}=await client
      .from('social_messages')
      .insert({conversation_id:conversationId,sender_id:userId,body,...(replyId?{reply_to_id:replyId}:{})})
      .select(MESSAGE_COLUMNS)
      .single()

    if(error || !data){
      setMessages(current=>current.map(m=>m.id===id ? {...m,pending:false,failed:true} : m))
      setNotice(error?.message || 'Unable to send message.')
      return
    }
    const saved=data as Message
    setNotice('')
    setMessages(current=>mergeMessages(current.filter(m=>m.id!==id),[saved]))
    setDirects(rows=>rows.map(row=>row.conversation.id===conversationId ? {...row,latest:saved} : row))
  }

  const submit=(event:FormEvent)=>{
    event.preventDefault()
    const body=messageText.trim()
    if(!body)return
    const replyId=replyTo && replyTo.conversation_id===selectedId && !replyTo.pending && !replyTo.failed ? replyTo.id : null
    setMessageText('')
    setReplyTo(null)
    requestAnimationFrame(resizeComposer)
    void sendBody(body,undefined,replyId)
  }

  const retry=(message:Message)=>{
    setMessages(current=>current.map(m=>m.id===message.id ? {...m,failed:false,pending:true} : m))
    void sendBody(message.body,message.id,message.reply_to_id)
  }

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
                          <small>{row.latest?`${mine?'You: ':''}${row.latest.body}`:secondary(row.other)}</small>
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

        <div className="cmThread">
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
                            <span>{quoted ? quoted.body : 'Open the older history to see it.'}</span>
                          </button>
                        )}
                        <p>{message.body}</p>
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
                    <span>{replyTo.body}</span>
                  </div>
                  <button type="button" aria-label="Cancel reply" onClick={()=>setReplyTo(null)}><X size={14}/></button>
                </div>
              )}
              <form className="cmComposer" onSubmit={submit}>
                <textarea
                  ref={composerRef}
                  value={messageText}
                  onChange={event=>{
                    setMessageText(event.target.value.slice(0,10000))
                    resizeComposer()
                  }}
                  placeholder="Type a message"
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
                <button className="cmSend" type="submit" aria-label="Send" disabled={!messageText.trim()}>
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
    </section>
  )
}

export default ChatModule
