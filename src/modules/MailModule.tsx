import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  PenSquare,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  Star
} from 'lucide-react'
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
  isRead?:boolean | string
}

type MailContent = MailMessage & {
  content?:string
}

export function MailModule(){
  const [connected,setConnected]=useState<boolean|null>(null)
  const [messages,setMessages]=useState<MailMessage[]>([])
  const [selected,setSelected]=useState<MailContent|null>(null)
  const [loading,setLoading]=useState(false)
  const [message,setMessage]=useState('')
  const [search,setSearch]=useState('')
  const [compose,setCompose]=useState(false)
  const [to,setTo]=useState('')
  const [subject,setSubject]=useState('')
  const [body,setBody]=useState('')

  const invoke=async(name:string,body?:Record<string,unknown>)=>{
    if(!supabase) throw new Error('Supabase is not configured.')

    const {data,error}=await supabase.functions.invoke(name,{
      body:body || {}
    })

    if(error) throw error
    return data
  }

  const checkConnection=async()=>{
    try{
      const data=await invoke('zoho-mail-status')
      setConnected(Boolean(data?.connected))
    }catch{
      setConnected(false)
    }
  }

  const loadInbox=async()=>{
    setLoading(true)
    setMessage('')

    try{
      const data=await invoke('zoho-mail-inbox')

      const rows =
        Array.isArray(data?.messages)
          ? data.messages
          : Array.isArray(data?.data)
            ? data.data
            : []

      setMessages(rows)
    }catch(error:any){
      setMessage(error?.message || 'Unable to load mailbox.')
    }finally{
      setLoading(false)
    }
  }

  const connect=async()=>{
    setLoading(true)
    setMessage('')

    try{
      const data=await invoke('zoho-mail-auth-url')

      if(!data?.url) throw new Error('Zoho authorization URL was not returned.')

      window.location.href=data.url
    }catch(error:any){
      setMessage(error?.message || 'Unable to connect Zoho Mail.')
      setLoading(false)
    }
  }

  const openMessage=async(item:MailMessage)=>{
    setLoading(true)
    setMessage('')

    try{
      const data=await invoke('zoho-mail-message',{
        messageId:item.messageId,
        folderId:item.folderId
      })

      setSelected({
        ...item,
        ...(data?.message || data?.data || {})
      })
    }catch(error:any){
      setMessage(error?.message || 'Unable to open email.')
    }finally{
      setLoading(false)
    }
  }

  const sendMail=async()=>{
    if(!to.trim() || !subject.trim()) return

    setLoading(true)
    setMessage('')

    try{
      await invoke('zoho-mail-send',{
        toAddress:to.trim(),
        subject:subject.trim(),
        content:body
      })

      setCompose(false)
      setTo('')
      setSubject('')
      setBody('')
      setMessage('Email sent successfully.')
      await loadInbox()
    }catch(error:any){
      setMessage(error?.message || 'Unable to send email.')
    }finally{
      setLoading(false)
    }
  }

  const reply=()=>{
    if(!selected) return

    setTo(selected.fromAddress || '')
    setSubject(
      selected.subject?.toLowerCase().startsWith('re:')
        ? selected.subject
        : `Re: ${selected.subject || ''}`
    )
    setBody('')
    setCompose(true)
  }

  useEffect(()=>{
    checkConnection()
  },[])

  useEffect(()=>{
    if(connected) loadInbox()
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
            <span className="eyebrow">RIDEARRIVO MAIL</span>
            <h2>Company Mail</h2>
            <p>
              Access your RideArrivo Zoho mailbox securely from the internal workspace.
            </p>
          </div>
        </div>

        <div className="mailConnect glassCard">
          <div className="mailConnectIcon">
            <Mail size={34}/>
          </div>

          <div>
            <span className="eyebrow">ZOHO MAIL</span>
            <h2>Connect your RideArrivo mailbox</h2>

            <p>
              Connect your company Zoho Mail account once. RideArrivo Workspace
              never stores your Zoho password.
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
                ? <><Loader2 size={16}/>Connecting...</>
                : <><Mail size={16}/>Connect Zoho Mail</>
              }
            </button>

            {message&&<div className="authMessage">{message}</div>}
          </div>
        </div>
      </section>
    )
  }

  const filtered=messages.filter(item=>{
    const q=search.toLowerCase()

    return (
      (item.subject || '').toLowerCase().includes(q) ||
      (item.fromAddress || '').toLowerCase().includes(q) ||
      (item.sender || '').toLowerCase().includes(q)
    )
  })

  return (
    <section className="mailModule">
      <div className="sectionTitle">
        <div>
          <span className="eyebrow">RIDEARRIVO MAIL</span>
          <h2>Company Mail</h2>
          <p>Your RideArrivo inbox, compose, reply and notifications.</p>
        </div>

        <div className="buttonRow">
          <button className="glassButton" onClick={loadInbox}>
            <RefreshCw size={16}/>
            Refresh
          </button>

          <button className="primaryButton" onClick={()=>setCompose(true)}>
            <PenSquare size={16}/>
            Compose
          </button>
        </div>
      </div>

      {message&&<div className="mailNotice">{message}</div>}

      <div className="mailShell glassCard">
        <aside className="mailFolders">
          <button className="active">
            <Inbox size={18}/>
            Inbox
            <span>{messages.length}</span>
          </button>

          <button>
            <Star size={18}/>
            Starred
          </button>

          <button>
            <Send size={18}/>
            Sent
          </button>

          <button>
            <Bell size={18}/>
            Notifications
          </button>

          <button>
            <Settings size={18}/>
            Mail settings
          </button>
        </aside>

        <div className="mailList">
          <div className="mailSearch">
            <Search size={17}/>
            <input
              placeholder="Search mail"
              value={search}
              onChange={e=>setSearch(e.target.value)}
            />
          </div>

          {loading&&
            <div className="mailEmpty">
              <Loader2 className="mailSpinner"/>
              Loading mail...
            </div>
          }

          {!loading&&filtered.length===0&&
            <div className="mailEmpty">
              <Mail size={28}/>
              <strong>No emails found</strong>
            </div>
          }

          {!loading&&filtered.map(item=>(
            <button
              key={item.messageId}
              className={`mailRow ${item.isRead===false || item.isRead==='false'?'unread':''}`}
              onClick={()=>openMessage(item)}
            >
              <div className="mailSender">
                {item.sender || item.fromAddress || 'Unknown sender'}
              </div>

              <div className="mailSubject">
                <strong>{item.subject || '(No subject)'}</strong>
                <span>{item.summary || ''}</span>
              </div>

              <time>
                {item.receivedTime || item.sentDateInGMT || ''}
              </time>
            </button>
          ))}
        </div>

        <div className="mailReader">
          {!selected&&
            <div className="mailEmpty">
              <Mail size={34}/>
              <strong>Select an email</strong>
              <span>Choose a message to read it here.</span>
            </div>
          }

          {selected&&
            <>
              <div className="mailReaderHeader">
                <button className="iconButton" onClick={()=>setSelected(null)}>
                  <ArrowLeft size={17}/>
                </button>

                <div>
                  <h3>{selected.subject || '(No subject)'}</h3>
                  <span>
                    {selected.sender || selected.fromAddress}
                  </span>
                </div>

                <button className="glassButton" onClick={reply}>
                  <Reply size={16}/>
                  Reply
                </button>
              </div>

              <div
                className="mailBody"
                dangerouslySetInnerHTML={{
                  __html:selected.content || selected.summary || ''
                }}
              />
            </>
          }
        </div>
      </div>

      {compose&&
        <div className="modalBackdrop">
          <div className="mailCompose glassCard">
            <div className="cardHeader">
              <h3>New email</h3>
              <button className="iconButton" onClick={()=>setCompose(false)}>
                ×
              </button>
            </div>

            <label>
              To
              <input
                type="email"
                value={to}
                onChange={e=>setTo(e.target.value)}
                placeholder="recipient@example.com"
              />
            </label>

            <label>
              Subject
              <input
                value={subject}
                onChange={e=>setSubject(e.target.value)}
                placeholder="Email subject"
              />
            </label>

            <label>
              Message
              <textarea
                rows={10}
                value={body}
                onChange={e=>setBody(e.target.value)}
                placeholder="Write your message..."
              />
            </label>

            <div className="buttonRow">
              <button className="glassButton" onClick={()=>setCompose(false)}>
                Cancel
              </button>

              <button
                className="primaryButton"
                onClick={sendMail}
                disabled={loading}
              >
                <Send size={16}/>
                Send
              </button>
            </div>
          </div>
        </div>
      }
    </section>
  )
}
