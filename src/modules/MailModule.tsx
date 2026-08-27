import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  PenSquare,
  RefreshCw,
  Reply,
  Search,
  Send,
  X
} from 'lucide-react'
import DOMPurify from 'dompurify'
import { supabase } from '../lib/supabase'

type MailMessage = {
  messageId:string
  folderId?:string
  fromAddress?:string
  sender?:string
  toAddress?:string
  subject?:string
  summary?:string
  receivedTime?:string
  sentDateInGMT?:string
  isRead?:boolean|string
}

type MailContent = MailMessage & {
  content?:string
}

export function MailModule(){
  const [connected,setConnected]=
    useState<boolean|null>(null)

  const [messages,setMessages]=
    useState<MailMessage[]>([])

  const [selected,setSelected]=
    useState<MailContent|null>(null)

  const [loading,setLoading]=useState(false)
  const [sending,setSending]=useState(false)
  const [message,setMessage]=useState('')
  const [search,setSearch]=useState('')

  const [compose,setCompose]=useState(false)
  const [to,setTo]=useState('')
  const [subject,setSubject]=useState('')
  const [body,setBody]=useState('')

  const invoke=async(
    name:string,
    body?:Record<string,unknown>
  )=>{
    if(!supabase){
      throw new Error(
        'Supabase is not configured.'
      )
    }

    const {
      data:{ session }
    } = await supabase.auth.getSession()

    if(!session){
      throw new Error(
        'Your Workspace session has expired. Sign in again.'
      )
    }

    const {data,error}=
      await supabase.functions.invoke(
        name,
        {
          body:body || {},
          headers:{
            Authorization:
              `Bearer ${session.access_token}`
          }
        }
      )

    if(error){
      let errorMessage=
        error.message ||
        'Mail service request failed.'

      try{
        const context=(error as any).context

        if(
          context &&
          typeof context.json==='function'
        ){
          const payload=await context.json()

          errorMessage=
            payload?.error ||
            payload?.message ||
            errorMessage
        }
      }catch{
        // Use Supabase error.
      }

      throw new Error(errorMessage)
    }

    if(data?.error){
      throw new Error(data.error)
    }

    return data
  }

  const checkConnection=async()=>{
    setMessage('')

    try{
      const data=
        await invoke('zoho-mail-status')

      setConnected(Boolean(data?.connected))
    }catch(error:any){
      setConnected(false)
      setMessage(
        error?.message ||
        'Unable to check Zoho Mail connection.'
      )
    }
  }

  const loadInbox=async()=>{
    setLoading(true)
    setMessage('')

    try{
      const data=
        await invoke('zoho-mail-inbox')

      const raw=
        Array.isArray(data?.messages)
          ? data.messages
          : Array.isArray(data?.data)
            ? data.data
            : []

      const defaultFolderId=
        data?.folderId
          ? String(data.folderId)
          : ''

      setMessages(
        raw.map((item:any)=>({
          ...item,
          folderId:
            item?.folderId ||
            defaultFolderId ||
            undefined
        }))
      )
    }catch(error:any){
      setMessages([])
      setMessage(
        error?.message ||
        'Unable to load mailbox.'
      )
    }finally{
      setLoading(false)
    }
  }

  const connect=async()=>{
    setLoading(true)
    setMessage('')

    try{
      const data=
        await invoke('zoho-mail-auth-url')

      if(!data?.url){
        throw new Error(
          'Zoho authorization URL was not returned.'
        )
      }

      window.location.assign(data.url)
    }catch(error:any){
      setMessage(
        error?.message ||
        'Unable to connect Zoho Mail.'
      )
      setLoading(false)
    }
  }

  const openMessage=async(
    item:MailMessage
  )=>{
    setLoading(true)
    setMessage('')

    try{
      const data=
        await invoke(
          'zoho-mail-message',
          {
            messageId:item.messageId,
            folderId:item.folderId
          }
        )

      setSelected({
        ...item,
        ...(data?.message ||
          data?.data ||
          {})
      })
    }catch(error:any){
      setMessage(
        error?.message ||
        'Unable to open email.'
      )
    }finally{
      setLoading(false)
    }
  }

  const startCompose=()=>{
    setSelected(null)
    setTo('')
    setSubject('')
    setBody('')
    setMessage('')
    setCompose(true)
  }

  const startReply=()=>{
    if(!selected) return

    const recipient=
      selected.fromAddress ||
      selected.sender ||
      ''

    setTo(recipient)

    const current=
      String(selected.subject || '').trim()

    setSubject(
      current.toLowerCase().startsWith('re:')
        ? current
        : `Re: ${current}`
    )

    setBody('')
    setMessage('')
    setCompose(true)
  }

  const sendMail=async()=>{
    const recipient=to.trim()
    const cleanSubject=subject.trim()
    const cleanBody=body.trim()

    setMessage('')

    if(!recipient){
      setMessage(
        'Enter a recipient email address.'
      )
      return
    }

    if(
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(recipient)
    ){
      setMessage(
        'Enter a valid recipient email address.'
      )
      return
    }

    if(!cleanSubject){
      setMessage('Enter an email subject.')
      return
    }

    if(!cleanBody){
      setMessage(
        'Enter a message before sending.'
      )
      return
    }

    if(sending) return

    setSending(true)

    try{
      const htmlContent=
        cleanBody
          .split('\n')
          .map(line=>
            line
              ? `<p>${line
                  .replace(/&/g,'&amp;')
                  .replace(/</g,'&lt;')
                  .replace(/>/g,'&gt;')}</p>`
              : '<br>'
          )
          .join('')

      const result=
        await invoke(
          'zoho-mail-send',
          {
            toAddress:recipient,
            subject:cleanSubject,
            content:htmlContent
          }
        )

      if(!result?.success){
        throw new Error(
          result?.error ||
          'Zoho did not confirm the email was sent.'
        )
      }

      setCompose(false)
      setTo('')
      setSubject('')
      setBody('')
      setMessage('Email sent successfully.')

      await loadInbox()
    }catch(error:any){
      setMessage(
        error?.message ||
        'Unable to send email.'
      )
    }finally{
      setSending(false)
    }
  }

  useEffect(()=>{
    void checkConnection()
  },[])

  useEffect(()=>{
    if(connected){
      void loadInbox()
    }
  },[connected])

  if(connected===null){
    return (
      <section className="mailLoading">
        <Loader2 className="mailSpinner"/>
        <span>Loading Mail...</span>
      </section>
    )
  }

  if(!connected){
    return (
      <section>
        <div className="sectionTitle">
          <div>
            <span className="eyebrow">
              RIDEARRIVO MAIL
            </span>
            <h2>Company Mail</h2>
            <p>
              Secure access to your RideArrivo
              Zoho mailbox.
            </p>
          </div>
        </div>

        <div className="mailConnect glassCard">
          <Mail size={34}/>

          <div>
            <span className="eyebrow">
              ZOHO MAIL
            </span>

            <h2>
              Connect your RideArrivo mailbox
            </h2>

            <p>
              Authorize your company mailbox
              using Zoho OAuth.
            </p>

            <div className="mailSecurity">
              <CheckCircle2 size={16}/>
              OAuth 2.0 secure authorization
            </div>

            <button
              className="primaryButton"
              onClick={connect}
              disabled={loading}
            >
              {loading
                ? <Loader2 size={16}/>
                : <Mail size={16}/>
              }
              Connect Zoho Mail
            </button>

            {message &&
              <div className="authMessage">
                {message}
              </div>
            }
          </div>
        </div>
      </section>
    )
  }

  const filtered=
    messages.filter(item=>{
      const q=search.trim().toLowerCase()

      if(!q) return true

      return (
        String(item.subject || '')
          .toLowerCase()
          .includes(q) ||
        String(item.fromAddress || '')
          .toLowerCase()
          .includes(q) ||
        String(item.sender || '')
          .toLowerCase()
          .includes(q)
      )
    })

  return (
    <section className="mailModule">
      <div className="sectionTitle">
        <div>
          <span className="eyebrow">
            RIDEARRIVO MAIL
          </span>

          <h2>Company Mail</h2>

          <p>
            Inbox, compose and reply from your
            connected RideArrivo mailbox.
          </p>
        </div>

        <div className="buttonRow">
          <button
            className="glassButton"
            onClick={()=>void loadInbox()}
            disabled={loading}
          >
            <RefreshCw size={16}/>
            Refresh
          </button>

          <button
            className="primaryButton"
            onClick={startCompose}
          >
            <PenSquare size={16}/>
            Compose
          </button>
        </div>
      </div>

      {message &&
        <div
          className="glassCard"
          style={{padding:14,marginBottom:14}}
        >
          {message}
        </div>
      }

      {compose &&
        <div
          className="glassCard"
          style={{
            padding:20,
            marginBottom:18,
            display:'grid',
            gap:12
          }}
        >
          <div
            style={{
              display:'flex',
              justifyContent:'space-between',
              alignItems:'center'
            }}
          >
            <strong>
              {selected
                ? 'Reply'
                : 'New message'
              }
            </strong>

            <button
              className="iconButton"
              onClick={()=>setCompose(false)}
              aria-label="Close composer"
            >
              <X size={18}/>
            </button>
          </div>

          <input
            type="email"
            value={to}
            onChange={e=>setTo(e.target.value)}
            placeholder="Recipient email"
            autoComplete="off"
          />

          <input
            value={subject}
            onChange={e=>
              setSubject(e.target.value)
            }
            placeholder="Subject"
          />

          <textarea
            value={body}
            onChange={e=>setBody(e.target.value)}
            placeholder="Write your message..."
            rows={10}
          />

          <div className="buttonRow">
            <button
              className="primaryButton"
              onClick={()=>void sendMail()}
              disabled={sending}
            >
              {sending
                ? <Loader2 size={16}/>
                : <Send size={16}/>
              }

              {sending
                ? 'Sending...'
                : 'Send'
              }
            </button>
          </div>
        </div>
      }

      <div
        style={{
          display:'grid',
          gridTemplateColumns:
            selected
              ? 'minmax(280px,.8fr) minmax(360px,1.2fr)'
              : '1fr',
          gap:18
        }}
      >
        <div className="glassCard">
          <div
            style={{
              padding:16,
              display:'flex',
              gap:10,
              alignItems:'center'
            }}
          >
            <Search size={17}/>

            <input
              value={search}
              onChange={e=>
                setSearch(e.target.value)
              }
              placeholder="Search mail"
              style={{width:'100%'}}
            />
          </div>

          {loading &&
            <div style={{padding:18}}>
              <Loader2 size={18}/>
              Loading…
            </div>
          }

          {!loading &&
            filtered.length===0 &&
            <div style={{padding:22}}>
              <Inbox size={24}/>
              <p>No messages found.</p>
            </div>
          }

          {filtered.map(item=>(
            <button
              key={item.messageId}
              onClick={()=>
                void openMessage(item)
              }
              style={{
                width:'100%',
                textAlign:'left',
                padding:16,
                border:0,
                borderTop:
                  '1px solid rgba(0,0,0,.08)',
                background:'transparent',
                cursor:'pointer'
              }}
            >
              <strong>
                {item.sender ||
                 item.fromAddress ||
                 'Unknown sender'}
              </strong>

              <div>
                {item.subject ||
                 '(No subject)'}
              </div>

              {item.summary &&
                <small>
                  {item.summary}
                </small>
              }
            </button>
          ))}
        </div>

        {selected &&
          <article
            className="glassCard"
            style={{padding:20}}
          >
            <div className="buttonRow">
              <button
                className="glassButton"
                onClick={()=>
                  setSelected(null)
                }
              >
                <ArrowLeft size={16}/>
                Back
              </button>

              <button
                className="primaryButton"
                onClick={startReply}
              >
                <Reply size={16}/>
                Reply
              </button>
            </div>

            <h2>
              {selected.subject ||
               '(No subject)'}
            </h2>

            <p>
              From:{' '}
              {selected.fromAddress ||
               selected.sender ||
               'Unknown'}
            </p>

            <div
              style={{
                marginTop:20,
                lineHeight:1.6
              }}
              dangerouslySetInnerHTML={{
                __html:DOMPurify.sanitize(
                  selected.content ||
                  selected.summary ||
                  ''
                )
              }}
            />
          </article>
        }
      </div>
    </section>
  )
}
