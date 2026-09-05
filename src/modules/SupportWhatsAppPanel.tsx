import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  MessageCircle,
  RefreshCw,
  Send,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import WorkstationWindow, {
  type WorkstationWindowMode,
} from '../components/WorkstationWindow'
import '../workflow-unification.css'

type Conversation={
  id:string
  wa_id?:string|null
  profile_name?:string|null
  customer_name?:string|null
  display_name?:string|null
  phone_number?:string|null
  status?:string|null
  last_message_at?:string|null
  updated_at?:string|null
  created_at?:string|null
  [key:string]:unknown
}

type WhatsAppMessage={
  id:string
  conversation_id:string
  direction?:string|null
  body?:string|null
  text?:string|null
  message_text?:string|null
  text_body?:string|null
  status?:string|null
  created_at?:string|null
  [key:string]:unknown
}

function clean(value:unknown){
  return typeof value==='string'
    ? value.trim()
    : ''
}

function conversationName(
  conversation:Conversation
){
  return (
    clean(conversation.profile_name)
    || clean(conversation.customer_name)
    || clean(conversation.display_name)
    || clean(conversation.phone_number)
    || clean(conversation.wa_id)
    || `Conversation ${conversation.id.slice(0,8)}`
  )
}

function messageText(
  message:WhatsAppMessage
){
  return (
    clean(message.body)
    || clean(message.text)
    || clean(message.message_text)
    || clean(message.text_body)
    || 'WhatsApp message'
  )
}

function timestamp(value:unknown){
  const parsed=new Date(
    clean(value)
  ).getTime()

  return Number.isFinite(parsed)
    ? parsed
    : 0
}

export default function SupportWhatsAppPanel(){
  const [open,setOpen]=useState(false)
  const [mode,setMode]=
    useState<WorkstationWindowMode>('split')

  const [conversations,setConversations]=
    useState<Conversation[]>([])

  const [selectedId,setSelectedId]=
    useState('')

  const [messages,setMessages]=
    useState<WhatsAppMessage[]>([])

  const [draft,setDraft]=useState('')
  const [loading,setLoading]=useState(false)
  const [sending,setSending]=useState(false)
  const [notice,setNotice]=useState('')

  const selected=useMemo(
    ()=>conversations.find(
      item=>item.id===selectedId
    ) || null,
    [conversations,selectedId]
  )

  const loadMessages=useCallback(
    async(conversationId:string)=>{
      const client=supabase

      if(!client || !conversationId){
        setMessages([])
        return
      }

      const result=await client
        .from('support_whatsapp_messages')
        .select('*')
        .eq(
          'conversation_id',
          conversationId
        )
        .order(
          'created_at',
          {ascending:true}
        )
        .limit(500)

      if(result.error){
        throw result.error
      }

      setMessages(
        (result.data || []) as WhatsAppMessage[]
      )
    },
    []
  )

  const load=useCallback(async()=>{
    const client=supabase

    if(!client){
      return
    }

    setLoading(true)
    setNotice('')

    try{
      const result=await client
        .from('support_whatsapp_conversations')
        .select('*')
        .limit(250)

      if(result.error){
        throw result.error
      }

      const next=[
        ...((result.data || []) as Conversation[])
      ].sort(
        (left,right)=>
          Math.max(
            timestamp(right.last_message_at),
            timestamp(right.updated_at),
            timestamp(right.created_at)
          )
          -
          Math.max(
            timestamp(left.last_message_at),
            timestamp(left.updated_at),
            timestamp(left.created_at)
          )
      )

      setConversations(next)

      const nextSelected=
        next.some(
          item=>item.id===selectedId
        )
          ? selectedId
          : next[0]?.id || ''

      setSelectedId(nextSelected)

      if(nextSelected){
        await loadMessages(nextSelected)
      }else{
        setMessages([])
      }
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to load Support WhatsApp.'
      )
    }finally{
      setLoading(false)
    }
  },[
    selectedId,
    loadMessages,
  ])

  useEffect(()=>{
    if(open){
      void load()
    }
  },[
    open,
    load,
  ])

  useEffect(()=>{
    if(open && selectedId){
      void loadMessages(selectedId)
    }
  },[
    open,
    selectedId,
    loadMessages,
  ])

  useEffect(()=>{
    const client=supabase

    if(!client || !open){
      return
    }

    const channel=client
      .channel('support-whatsapp-workstation')
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'support_whatsapp_conversations',
        },
        ()=>{
          void load()
        }
      )
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'support_whatsapp_messages',
        },
        payload=>{
          const row=
            (
              payload.new
              || payload.old
              || {}
            ) as Record<string,unknown>

          if(
            selectedId
            && String(
              row.conversation_id || ''
            )===selectedId
          ){
            void loadMessages(selectedId)
          }
        }
      )
      .subscribe()

    return ()=>{
      void client.removeChannel(channel)
    }
  },[
    open,
    selectedId,
    load,
    loadMessages,
  ])

  const send=async()=>{
    const client=supabase

    if(
      !client
      || !selectedId
      || !draft.trim()
    ){
      return
    }

    setSending(true)
    setNotice('')

    try{
      const result=
        await client.functions.invoke(
          'whatsapp-send',
          {
            body:{
              conversationId:selectedId,
              body:draft.trim(),
            },
          }
        )

      if(result.error){
        throw result.error
      }

      const payload=
        result.data as
          | Record<string,unknown>
          | null

      if(
        payload
        && typeof payload.error==='string'
        && payload.error
      ){
        throw new Error(payload.error)
      }

      setDraft('')
      await loadMessages(selectedId)
    }catch(error){
      setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to send WhatsApp message.'
      )
    }finally{
      setSending(false)
    }
  }

  return (
    <>
      <section className="supportWhatsAppLauncher glassCard">
        <div>
          <span className="eyebrow">
            WHATSAPP
          </span>
          <h3>
            Support WhatsApp
          </h3>
          <p>
            Handle persisted customer conversations without
            navigating away from the Support workstation.
            Customer destination is resolved server-side.
          </p>
        </div>

        <button
          type="button"
          className="whatsappButton"
          onClick={()=>{
            setMode('split')
            setOpen(true)
          }}
        >
          <MessageCircle size={17}/>
          Open WhatsApp
        </button>
      </section>

      {open&&
        <WorkstationWindow
          title="Support WhatsApp"
          subtitle="Persisted customer conversations"
          badge="SUPPORT COMMUNICATIONS"
          mode={mode}
          onModeChange={setMode}
          onClose={()=>{
            setOpen(false)
          }}
        >
          <div className="supportWhatsAppWorkspace">
            <aside className="supportWhatsAppList">
              <button
                type="button"
                className="supportWhatsAppRefresh"
                disabled={loading}
                onClick={()=>{
                  void load()
                }}
              >
                <RefreshCw size={16}/>
                <span>
                  <strong>
                    Refresh
                  </strong>
                  <small>
                    {loading
                      ? 'Loading...'
                      : `${conversations.length} conversations`
                    }
                  </small>
                </span>
              </button>

              {conversations.map(
                conversation=>(
                  <button
                    type="button"
                    key={conversation.id}
                    className={
                      conversation.id===selectedId
                        ? 'active'
                        : ''
                    }
                    onClick={()=>{
                      setSelectedId(
                        conversation.id
                      )
                    }}
                  >
                    <MessageCircle size={16}/>
                    <span>
                      <strong>
                        {conversationName(
                          conversation
                        )}
                      </strong>
                      <small>
                        {clean(
                          conversation.status
                        ) || 'WhatsApp'}
                      </small>
                    </span>
                  </button>
                )
              )}
            </aside>

            <section className="supportWhatsAppConversation">
              {notice&&
                <div className="moduleNotice">
                  {notice}
                </div>
              }

              {selected
                ? (
                  <>
                    <header className="supportWhatsAppConversationHeader">
                      <strong>
                        {conversationName(selected)}
                      </strong>
                      <small>
                        Destination is resolved from the
                        persisted conversation by the
                        secured server function.
                      </small>
                    </header>

                    <div className="supportWhatsAppMessages">
                      {messages.map(message=>(
                        <article
                          key={message.id}
                          className={
                            `supportWhatsAppMessage ${
                              message.direction==='outbound'
                                ? 'outbound'
                                : 'inbound'
                            }`
                          }
                        >
                          <p>
                            {messageText(message)}
                          </p>

                          <small>
                            {message.created_at
                              ? new Date(
                                  message.created_at
                                ).toLocaleString()
                              : 'Recorded message'
                            }
                            {message.status
                              ? ` · ${message.status}`
                              : ''
                            }
                          </small>
                        </article>
                      ))}

                      {!loading&&!messages.length&&
                        <div className="supportWhatsAppEmpty">
                          <MessageCircle size={28}/>
                          <strong>
                            No messages yet
                          </strong>
                        </div>
                      }
                    </div>

                    <div className="supportWhatsAppComposer">
                      <textarea
                        value={draft}
                        maxLength={4096}
                        placeholder="Reply to customer..."
                        onChange={event=>{
                          setDraft(
                            event.target.value
                          )
                        }}
                      />

                      <button
                        type="button"
                        className="primaryButton"
                        disabled={
                          sending
                          || !draft.trim()
                        }
                        onClick={()=>{
                          void send()
                        }}
                      >
                        <Send size={16}/>
                        {sending
                          ? 'Sending...'
                          : 'Send'
                        }
                      </button>
                    </div>
                  </>
                )
                : (
                  <div className="supportWhatsAppEmpty">
                    <MessageCircle size={28}/>
                    <strong>
                      No conversation selected
                    </strong>
                  </div>
                )
              }
            </section>
          </div>
        </WorkstationWindow>
      }
    </>
  )
}
