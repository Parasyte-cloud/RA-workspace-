import {
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  Users
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
}

type DirectRow = {
  conversation:Conversation
  other:Person|null
  membership:Membership
  latest:Message|null
  unread:number
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

const formatListTime=(value?:string|null)=>{
  if(!value)return ''
  const date=new Date(value)
  if(Number.isNaN(date.getTime()))return ''
  const today=new Date()
  if(date.toDateString()===today.toDateString())return formatTime(value)
  return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(date)
}

const canMarkReadNow=()=>document.visibilityState==='visible' && document.hasFocus()

export function ChatModule(){
  const [userId,setUserId]=useState('')
  const [people,setPeople]=useState<Person[]>([])
  const [directs,setDirects]=useState<DirectRow[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [messages,setMessages]=useState<Message[]>([])
  const [query,setQuery]=useState('')
  const [messageText,setMessageText]=useState('')
  const [loading,setLoading]=useState(true)
  const [threadLoading,setThreadLoading]=useState(false)
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const threadRequestRef=useRef(0)
  const messageEndRef=useRef<HTMLDivElement|null>(null)

  const peopleMap=useMemo(()=>new Map(people.map(person=>[person.id,person])),[people])
  const selected=useMemo(()=>directs.find(row=>row.conversation.id===selectedId) || null,[directs,selectedId])
  const directConversationKey=useMemo(
    ()=>directs.map(row=>row.conversation.id).sort().join(','),
    [directs]
  )

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
      .slice(0,30)
  },[people,query,userId])

  const loadBase=useCallback(async(preferredConversationId?:string)=>{
    const client=supabase
    if(!client)return

    setLoading(true)
    setNotice('')
    try{
      const {data:sessionData,error:sessionError}=await client.auth.getSession()
      if(sessionError)throw sessionError
      const me=sessionData.session?.user?.id
      if(!me)throw new Error('Your workspace session is unavailable.')
      setUserId(me)

      const {data:peopleData,error:peopleError}=await client
        .from('employee_profiles')
        .select('id,full_name,email,department,job_title')
        .eq('active',true)
        .order('full_name')
      if(peopleError)throw peopleError
      const activePeople=(peopleData || []) as Person[]
      setPeople(activePeople)
      const localPeopleMap=new Map(activePeople.map(person=>[person.id,person]))

      const {data:ownMembershipData,error:membershipError}=await client
        .from('social_conversation_members')
        .select('conversation_id,user_id,joined_at,last_read_at')
        .eq('user_id',me)
        .order('joined_at',{ascending:false})
      if(membershipError)throw membershipError
      const ownMemberships=(ownMembershipData || []) as Membership[]
      const ids=ownMemberships.map(row=>row.conversation_id)

      if(!ids.length){
        setDirects([])
        setSelectedId('')
        setMessages([])
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
        setSelectedId('')
        setMessages([])
        return
      }

      const [memberResult,messageResult]=await Promise.all([
        client
          .from('social_conversation_members')
          .select('conversation_id,user_id,joined_at,last_read_at')
          .in('conversation_id',directIds),
        client
          .from('social_messages')
          .select('id,conversation_id,sender_id,body,edited_at,created_at')
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
        return {
          conversation,
          other:otherMember ? localPeopleMap.get(otherMember.user_id) || null : null,
          membership,
          latest:latestMap.get(conversation.id) || null,
          unread:unreadMap.get(conversation.id) || 0
        }
      }).sort((a,b)=>{
        const aTime=new Date(a.latest?.created_at || a.conversation.created_at).getTime()
        const bTime=new Date(b.latest?.created_at || b.conversation.created_at).getTime()
        return bTime-aTime
      })

      setDirects(rows)
      const wanted=preferredConversationId || selectedId
      const next=rows.some(row=>row.conversation.id===wanted) ? wanted : rows[0]?.conversation.id || ''
      setSelectedId(next)
    }catch(error){
      setNotice(error instanceof Error ? error.message : 'Unable to load Chat.')
    }finally{
      setLoading(false)
    }
  },[selectedId])

  const loadThread=useCallback(async(conversationId:string,markRead=true)=>{
    const client=supabase
    const requestSequence=++threadRequestRef.current
    if(!client || !conversationId){
      setMessages([])
      return
    }

    setThreadLoading(true)
    try{
      const {data,error}=await client
        .from('social_messages')
        .select('id,conversation_id,sender_id,body,edited_at,created_at')
        .eq('conversation_id',conversationId)
        .order('created_at',{ascending:false})
        .limit(300)
      if(error)throw error
      if(requestSequence!==threadRequestRef.current)return
      setMessages(((data || []) as Message[]).reverse())

      if(markRead){
        const {error:readError}=await client.rpc('mark_social_conversation_read',{
          p_conversation_id:conversationId
        })
        if(readError)throw readError
      }
    }catch(error){
      if(requestSequence===threadRequestRef.current){
        setNotice(error instanceof Error ? error.message : 'Unable to load this conversation.')
      }
    }finally{
      if(requestSequence===threadRequestRef.current)setThreadLoading(false)
    }
  },[])

  useEffect(()=>{
    void loadBase()
  },[])

  useEffect(()=>{
    if(!selectedId){
      setMessages([])
      return
    }
    void loadThread(selectedId,canMarkReadNow()).then(()=>loadBase(selectedId))
    return()=>{
      threadRequestRef.current+=1
    }
  },[selectedId,loadThread])

  useEffect(()=>{
    messageEndRef.current?.scrollIntoView({block:'end',behavior:'smooth'})
  },[messages])

  useEffect(()=>{
    if(!selectedId)return

    const markVisible=()=>{
      if(!canMarkReadNow())return
      void loadThread(selectedId,true).then(()=>loadBase(selectedId))
    }

    window.addEventListener('focus',markVisible)
    document.addEventListener('visibilitychange',markVisible)

    return()=>{
      window.removeEventListener('focus',markVisible)
      document.removeEventListener('visibilitychange',markVisible)
    }
  },[selectedId,loadBase,loadThread])

  useEffect(()=>{
    const client=supabase
    if(!client || !userId)return

    const directConversationIds=directConversationKey
      ? directConversationKey.split(',')
      : []

    let channel=client.channel(`native-chat-${userId}`)

    for(const conversationId of directConversationIds){
      channel=channel.on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'social_messages',
          filter:`conversation_id=eq.${conversationId}`
        },
        payload=>{
          const row=(payload.new || payload.old) as Partial<Message>
          if(row.conversation_id===selectedId){
            void loadThread(selectedId,canMarkReadNow()).then(()=>loadBase(selectedId))
          }else{
            void loadBase(selectedId)
          }
        }
      )
    }

    channel=channel.on(
      'postgres_changes',
      {
        event:'*',
        schema:'public',
        table:'social_conversation_members',
        filter:`user_id=eq.${userId}`
      },
      ()=>{
        void loadBase(selectedId)
      }
    )

    channel.subscribe()

    return()=>{
      void client.removeChannel(channel)
    }
  },[userId,selectedId,directConversationKey,loadBase,loadThread])

  const startDirect=async(person:Person)=>{
    const client=supabase
    if(!client || busy)return
    setBusy(true)
    setNotice('')
    try{
      const {data,error}=await client.rpc('start_or_get_social_direct_conversation',{
        p_other_user:person.id
      })
      if(error)throw error
      const conversationId=typeof data==='string' ? data : String(data || '')
      if(!conversationId)throw new Error('Chat could not create the conversation.')
      setQuery('')
      await loadBase(conversationId)
      setSelectedId(conversationId)
    }catch(error){
      setNotice(error instanceof Error ? error.message : 'Unable to start conversation.')
    }finally{
      setBusy(false)
    }
  }

  const sendMessage=async(event:FormEvent)=>{
    event.preventDefault()
    const client=supabase
    const body=messageText.trim()
    if(!client || !userId || !selectedId || !body || busy)return
    setBusy(true)
    setNotice('')
    try{
      const {error}=await client.from('social_messages').insert({
        conversation_id:selectedId,
        sender_id:userId,
        body
      })
      if(error)throw error
      setMessageText('')
      await loadThread(selectedId,true)
      await loadBase(selectedId)
    }catch(error){
      setNotice(error instanceof Error ? error.message : 'Unable to send message.')
    }finally{
      setBusy(false)
    }
  }

  const openConversation=(id:string)=>{
    setNotice('')
    setSelectedId(id)
  }

  return (
    <section className="chatModule">
      <header className="chatHero glassCard">
        <div>
          <span className="eyebrow">COMMUNICATION</span>
          <h1>Chat</h1>
          <p>Private employee-to-employee messaging inside the RideArrivo workspace.</p>
        </div>
        <div className="chatHeroSecurity">
          <ShieldCheck size={18}/>
          <span>Employee-only conversations</span>
        </div>
      </header>

      {notice&&<div className="moduleNotice chatNotice">{notice}</div>}

      <div className="chatShell glassCard">
        <aside className="chatSidebar">
          <div className="chatSidebarHead">
            <div>
              <span className="eyebrow">DIRECT MESSAGES</span>
              <strong>{directs.length} conversation{directs.length===1?'':'s'}</strong>
            </div>
            <button className="chatIconButton" type="button" title="Refresh Chat" onClick={()=>void loadBase(selectedId)} disabled={loading}>
              <RefreshCw size={17}/>
            </button>
          </div>

          <label className="chatSearch">
            <Search size={17}/>
            <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find an employee"/>
          </label>

          {query.trim()&&(
            <div className="chatPeopleResults">
              <div className="chatResultLabel"><UserPlus size={15}/>Start a conversation</div>
              {matchingPeople.map(person=>(
                <button key={person.id} type="button" className="chatPersonResult" onClick={()=>void startDirect(person)} disabled={busy}>
                  <span className="chatAvatar">{initials(displayName(person))}</span>
                  <span className="chatPersonCopy">
                    <strong>{displayName(person)}</strong>
                    <small>{secondary(person)}</small>
                  </span>
                </button>
              ))}
              {matchingPeople.length===0&&<div className="chatEmptySmall">No active employee matches your search.</div>}
            </div>
          )}

          <div className="chatConversationList">
            {loading&&<div className="chatEmptySmall">Loading conversations…</div>}
            {!loading&&directs.map(row=>(
              <button
                key={row.conversation.id}
                type="button"
                className={`chatConversation ${selectedId===row.conversation.id?'active':''}`}
                onClick={()=>openConversation(row.conversation.id)}
              >
                <span className="chatAvatar">{initials(displayName(row.other))}</span>
                <span className="chatConversationCopy">
                  <span className="chatConversationTop">
                    <strong>{displayName(row.other)}</strong>
                    <small>{formatListTime(row.latest?.created_at || row.conversation.created_at)}</small>
                  </span>
                  <span className="chatConversationBottom">
                    <small>{row.latest?.body || secondary(row.other)}</small>
                    {row.unread>0&&<span className="chatUnread">{row.unread>99?'99+':row.unread}</span>}
                  </span>
                </span>
              </button>
            ))}
            {!loading&&directs.length===0&&!query.trim()&&(
              <div className="chatEmptySidebar">
                <Users size={24}/>
                <strong>No direct messages yet</strong>
                <small>Search for an employee above to start a private conversation.</small>
              </div>
            )}
          </div>
        </aside>

        <div className="chatThread">
          {selected ? (
            <>
              <header className="chatThreadHead">
                <span className="chatAvatar large">{initials(displayName(selected.other))}</span>
                <div>
                  <strong>{displayName(selected.other)}</strong>
                  <small>{secondary(selected.other)}</small>
                </div>
                <span className="chatPrivateBadge"><ShieldCheck size={14}/>Private</span>
              </header>

              <div className="chatMessages" aria-live="polite">
                {threadLoading&&<div className="chatThreadState">Loading messages…</div>}
                {!threadLoading&&messages.length===0&&(
                  <div className="chatThreadState chatThreadWelcome">
                    <MessageSquareText size={30}/>
                    <strong>Start the conversation</strong>
                    <span>Messages here are visible only to members of this direct conversation.</span>
                  </div>
                )}
                {messages.map(message=>{
                  const mine=message.sender_id===userId
                  const sender=mine ? null : peopleMap.get(message.sender_id)
                  return (
                    <div key={message.id} className={`chatMessageRow ${mine?'mine':'theirs'}`}>
                      {!mine&&<span className="chatAvatar messageAvatar">{initials(displayName(sender))}</span>}
                      <div className="chatBubble">
                        {!mine&&<strong>{displayName(sender)}</strong>}
                        <p>{message.body}</p>
                        <small>{formatTime(message.created_at)}{message.edited_at?' · edited':''}</small>
                      </div>
                    </div>
                  )
                })}
                <div ref={messageEndRef}/>
              </div>

              <form className="chatComposer" onSubmit={sendMessage}>
                <textarea
                  value={messageText}
                  onChange={event=>setMessageText(event.target.value.slice(0,10000))}
                  placeholder={`Message ${displayName(selected.other)}`}
                  rows={1}
                  onKeyDown={event=>{
                    if(event.key==='Enter'&&!event.shiftKey){
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                />
                <button className="primaryButton chatSendButton" disabled={busy||!messageText.trim()}>
                  <Send size={17}/>Send
                </button>
              </form>
            </>
          ) : (
            <div className="chatNoSelection">
              <MessageSquareText size={36}/>
              <h2>RideArrivo Chat</h2>
              <p>Select a direct message or search for an employee to start a secure conversation.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default ChatModule
