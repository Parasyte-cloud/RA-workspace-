import { useEffect, useState } from 'react'
import {
  Archive,
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
  ShieldAlert,
  Star,
  Bell,
  Trash2,
  Settings,
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

type MailFolder = {
  folderId:string
  name:string
  type:string
  unreadCount:number
  messageCount:number
}

type MailFolderKey =
  | 'inbox'
  | 'starred'
  | 'sent'
  | 'drafts'
  | 'spam'
  | 'trash'
  | 'archive'

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

  const [folders,setFolders]=
    useState<MailFolder[]>([])

  const [activeFolder,setActiveFolder]=
    useState<MailFolder|null>(null)

  const [folderLoading,setFolderLoading]=
    useState(false)

  const [activeFolderKey,setActiveFolderKey]=
    useState<MailFolderKey>('inbox')

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

  const normaliseFolderName=(value:string)=>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,'')

  const folderMatches=(
    folder:MailFolder,
    key:MailFolderKey
  )=>{
    const name=normaliseFolderName(folder.name)
    const type=normaliseFolderName(folder.type)

    const haystack=`${name} ${type}`

    if(key==='inbox'){
      return (
        haystack.includes('inbox') ||
        haystack.includes('incoming')
      )
    }

    if(key==='sent'){
      return (
        haystack.includes('sent') ||
        haystack.includes('sentitems')
      )
    }

    if(key==='drafts'){
      return (
        haystack.includes('draft') ||
        haystack.includes('drafts')
      )
    }

    if(key==='spam'){
      return (
        haystack.includes('spam') ||
        haystack.includes('junk')
      )
    }

    if(key==='trash'){
      return (
        haystack.includes('trash') ||
        haystack.includes('deleted') ||
        haystack.includes('bin')
      )
    }

    if(key==='archive'){
      return haystack.includes('archive')
    }

    return false
  }

  const getFolder=(key:MailFolderKey)=>
    folders.find(folder=>
      folderMatches(folder,key)
    ) || null

  const loadCanonicalFolder=async(
    key:MailFolderKey
  )=>{
    setActiveFolderKey(key)
    setSelected(null)
    setMessage('')

    if(key==='starred'){
      setMessages(prev=>
        prev.filter((item:any)=>
          Boolean(
            item?.isFlagged ||
            item?.flagged ||
            item?.isStarred ||
            item?.starred
          )
        )
      )
      return
    }

    const folder=getFolder(key)

    if(!folder){
      setMessages([])

      setMessage(
        `${
          key.charAt(0).toUpperCase()+
          key.slice(1)
        } folder is not available from Zoho yet.`
      )

      return
    }

    await loadFolder(folder)
  }

  const loadFolders=async()=>{
    try{
      const data=
        await invoke('zoho-mail-folders')

      const rows:MailFolder[] =
        Array.isArray(data?.folders)
          ? data.folders
          : []

      setFolders(rows)

      const inbox=
        rows.find(folder =>
          folder.name
            .trim()
            .toLowerCase()==='inbox'
        ) || null

      if(
        inbox &&
        !activeFolder
      ){
        setActiveFolder(inbox)
      }

    }catch(error:any){
      setMessage(
        error?.message ||
        'Unable to load mail folders.'
      )
    }
  }

  const loadFolder=async(
    folder:MailFolder
  )=>{
    if(folderLoading) return

    setFolderLoading(true)
    setMessage('')
    setSelected(null)
    setActiveFolder(folder)

    try{
      const data=
        await invoke(
          'zoho-mail-folder-messages',
          {
            folderId:folder.folderId
          }
        )

      const raw=
        Array.isArray(data?.messages)
          ? data.messages
          : []

      setMessages(
        raw.map((item:any)=>({
          ...item,
          folderId:
            item?.folderId ||
            folder.folderId
        }))
      )

    }catch(error:any){
      setMessages([])

      setMessage(
        error?.message ||
        `Unable to load ${folder.name}.`
      )

    }finally{
      setFolderLoading(false)
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
            <h2>
            {activeFolder?.name ||
             activeFolderKey.charAt(0).toUpperCase()+
             activeFolderKey.slice(1) ||
             'Company Mail'}
          </h2>
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
            Your RideArrivo inbox, compose, reply
            and notifications.
          </p>
        </div>

        <div className="buttonRow">
          <button
            className="glassButton"
            onClick={()=>{
              if(activeFolder){
                void loadFolder(activeFolder)
              }else{
                void loadInbox()
              }

              void loadFolders()
            }}
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
        <div className="mailNotice">
          {message}
        </div>
      }

      <div className="mailWorkspace">

        <aside className="mailFolders">

          <div className="mailFolderTitle">
            <span>MAILBOX</span>
          </div>

          <button
            className={
              activeFolderKey==='inbox'
                ? 'active'
                : ''
            }
            onClick={()=>
              void loadCanonicalFolder('inbox')
            }
          >
            <Inbox size={18}/>
            <strong>Inbox</strong>

            <span>
              {getFolder('inbox')?.unreadCount ||
               getFolder('inbox')?.messageCount ||
               messages.length}
            </span>
          </button>

          <button
            className={
              activeFolderKey==='starred'
                ? 'active'
                : ''
            }
            onClick={()=>
              void loadCanonicalFolder('starred')
            }
          >
            <Star size={18}/>
            <strong>Starred</strong>
          </button>

          <button
            className={
              activeFolderKey==='sent'
                ? 'active'
                : ''
            }
            onClick={()=>
              void loadCanonicalFolder('sent')
            }
          >
            <Send size={18}/>
            <strong>Sent</strong>

            {getFolder('sent') &&
              <span>
                {getFolder('sent')?.messageCount || ''}
              </span>
            }
          </button>

          <button
            className={
              activeFolderKey==='drafts'
                ? 'active'
                : ''
            }
            onClick={()=>
              void loadCanonicalFolder('drafts')
            }
          >
            <PenSquare size={18}/>
            <strong>Drafts</strong>

            {getFolder('drafts') &&
              <span>
                {getFolder('drafts')?.messageCount || ''}
              </span>
            }
          </button>

          <button
            className={
              activeFolderKey==='spam'
                ? 'active'
                : ''
            }
            onClick={()=>
              void loadCanonicalFolder('spam')
            }
          >
            <ShieldAlert size={18}/>
            <strong>Spam / Junk</strong>

            {getFolder('spam') &&
              <span>
                {getFolder('spam')?.unreadCount ||
                 getFolder('spam')?.messageCount ||
                 ''}
              </span>
            }
          </button>

          <button
            className={
              activeFolderKey==='trash'
                ? 'active'
                : ''
            }
            onClick={()=>
              void loadCanonicalFolder('trash')
            }
          >
            <Trash2 size={18}/>
            <strong>Trash</strong>

            {getFolder('trash') &&
              <span>
                {getFolder('trash')?.messageCount || ''}
              </span>
            }
          </button>

          <button
            className={
              activeFolderKey==='archive'
                ? 'active'
                : ''
            }
            onClick={()=>
              void loadCanonicalFolder('archive')
            }
          >
            <Archive size={18}/>
            <strong>Archive</strong>
          </button>

          <div className="mailFolderDivider"/>

          {folders
            .filter(folder=>
              !(
                folderMatches(folder,'inbox') ||
                folderMatches(folder,'sent') ||
                folderMatches(folder,'drafts') ||
                folderMatches(folder,'spam') ||
                folderMatches(folder,'trash') ||
                folderMatches(folder,'archive')
              )
            )
            .map(folder=>(
              <button
                key={folder.folderId}
                onClick={()=>
                  void loadFolder(folder)
                }
              >
                <Mail size={18}/>

                <strong>
                  {folder.name}
                </strong>

                {(folder.unreadCount > 0 ||
                  folder.messageCount > 0) &&
                  <span>
                    {folder.unreadCount ||
                     folder.messageCount}
                  </span>
                }
              </button>
            ))
          }

          <div className="mailFolderDivider"/>

          <button disabled>
            <Settings size={18}/>
            <strong>Mail settings</strong>
          </button>

          <button
            className="mailTrayCompose"
            onClick={startCompose}
          >
            <PenSquare size={18}/>
            Compose
          </button>

        </aside>

        <div className="mailListPane">

          <div className="mailSearchBar">
            <div className="mailSearchBarInner">
              <Search size={18}/>

              <input
                value={search}
                onChange={e=>
                  setSearch(e.target.value)
                }
                placeholder="Search mail"
              />
            </div>
          </div>

          <div className="mailListScroller">

            {loading &&
              <div className="mailLoadingState">
                <Loader2 size={18}/>
                Loading messages…
              </div>
            }

            {!loading &&
              filtered.length===0 &&
              <div className="mailLoadingState">
                <Inbox size={24}/>
                <p>No messages found.</p>
              </div>
            }

            {!loading &&
              filtered.map(item=>(
                <button
                  key={item.messageId}
                  className={
                    selected?.messageId===item.messageId
                      ? 'mailMessageRow active'
                      : 'mailMessageRow'
                  }
                  onClick={()=>
                    void openMessage(item)
                  }
                >

                  <div className="mailSender">
                    {item.sender ||
                     item.fromAddress ||
                     'Unknown sender'}
                  </div>

                  <div className="mailMessageSummary">
                    <strong>
                      {item.subject ||
                       '(No subject)'}
                    </strong>

                    {item.summary &&
                      <span>
                        {item.summary}
                      </span>
                    }
                  </div>

                  <span className="mailMessageTime">
                    {item.receivedTime ||
                     item.sentDateInGMT ||
                     ''}
                  </span>

                </button>
              ))
            }

          </div>
        </div>

        <article className="mailReader">

          {!selected ? (
            <div className="mailEmpty">
              <Mail size={52}/>

              <h3>Select an email</h3>

              <p>
                Choose a message to read it here.
              </p>
            </div>
          ) : (
            <>
              <div className="mailReaderHeader">

                <div>
                  <span className="eyebrow">
                    MESSAGE
                  </span>

                  <h3>
                    {selected.subject ||
                     '(No subject)'}
                  </h3>

                  <span>
                    From:{' '}
                    {selected.fromAddress ||
                     selected.sender ||
                     'Unknown sender'}
                  </span>
                </div>

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
              </div>

              <div
                className="mailReaderBody"
                dangerouslySetInnerHTML={{
                  __html:DOMPurify.sanitize(
                    selected.content ||
                    selected.summary ||
                    ''
                  )
                }}
              />
            </>
          )}

        </article>

      </div>

      {compose &&
        <div className="mailComposer">

          <div className="mailComposerHeader">
            <strong>
              {selected
                ? 'Reply'
                : 'New message'
              }
            </strong>

            <button
              className="iconButton"
              onClick={()=>
                setCompose(false)
              }
              aria-label="Close composer"
            >
              <X size={18}/>
            </button>
          </div>

          <div className="mailComposerBody">

            <input
              type="email"
              value={to}
              onChange={e=>
                setTo(e.target.value)
              }
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
              onChange={e=>
                setBody(e.target.value)
              }
              placeholder="Write your message..."
              rows={10}
            />

          </div>

          <div className="mailComposerFooter">

            <button
              className="primaryButton"
              onClick={()=>
                void sendMail()
              }
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

    </section>
  )}
