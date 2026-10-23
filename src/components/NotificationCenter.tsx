import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PhoneAlertsToggle from './PhoneAlertsToggle'
import { OPEN_SECTION_EVENT, type OpenSectionDetail } from '../lib/desktopAlerts'
import { pickFreshToast, rememberAll, type ToastMemory } from '../lib/toastPick'
import { shouldChatSound } from '../lib/chatSound'
import { setSearchFocus } from '../lib/searchFocus'

import {
  Bell,
  MessageCircle,
  CheckCheck,
  Trash2,
  X
} from 'lucide-react'

import {
  useNotificationsContext,
  type NotificationItem
} from '../context/NotificationsContext'

export function NotificationCenter({
  onOpenWork,
  onOpenSection
}:{
  onOpenWork:()=>void
  onOpenSection?:(section:string)=>void
}){
  const {
    items,
    unreadCount,
    loading,
    open,
    setOpen,
    markRead,
    markAllRead,
    dismiss,
    clearRead
  }=useNotificationsContext()

  const readCount=items.filter(item=>item.read_at).length

  const rootRef=useRef<HTMLDivElement|null>(null)
  const menuRef=useRef<HTMLDivElement|null>(null)
  const bellRef=useRef<HTMLButtonElement|null>(null)

  // On phones the top bar is frosted glass. A panel inside it cannot blur the
  // page behind it (a blur only sees what is inside the nearest blurred parent),
  // so it showed the page sharply through a pale film. On phones the panel is
  // moved out to the page itself, where it can be real glass.
  const [phone,setPhone]=useState(()=>typeof window!=='undefined' && typeof window.matchMedia==='function' && window.matchMedia('(max-width: 599px)').matches)
  const [menuTop,setMenuTop]=useState(66)
  useEffect(()=>{
    if(typeof window.matchMedia!=='function')return
    const query=window.matchMedia('(max-width: 599px)')
    const sync=()=>setPhone(query.matches)
    query.addEventListener('change',sync)
    return()=>query.removeEventListener('change',sync)
  },[])
  useEffect(()=>{
    if(!open || !phone)return
    const place=()=>{
      const bell=bellRef.current
      if(bell)setMenuTop(Math.round(bell.getBoundingClientRect().bottom+12))
    }
    place()
    const watcher=new MutationObserver(place)
    watcher.observe(document.documentElement,{attributes:true,attributeFilter:['data-ra-island']})
    window.addEventListener('resize',place)
    const settle=window.setTimeout(place,650)
    return()=>{watcher.disconnect();window.removeEventListener('resize',place);window.clearTimeout(settle)}
  },[open,phone])

// RA_WHATSAPP_NOTIFICATION_TOAST_STATE_START

/*
 * Foreground notifications:
 *
 * - Do not replay old notifications when the workspace first loads.
 * - Only surface IDs that arrive after the initial notification snapshot.
 * - Closing this banner does NOT delete or mark the underlying notification.
 * - Opening it goes through the same governed notification routing as the bell.
 */
const [toastItem,setToastItem]=useState<NotificationItem|null>(null)

const knownToastIdsRef=useRef<ToastMemory>(new Map())

const toastBootstrappedRef=useRef(false)

const toastTimerRef=useRef<number|undefined>(undefined)

const hideToast=()=>{

  if(toastTimerRef.current!==undefined){

    window.clearTimeout(
      toastTimerRef.current
    )

    toastTimerRef.current=undefined

  }

  setToastItem(null)

}

useEffect(()=>{

  if(loading)return

  /*
   * The first database snapshot is history, not a new incoming alert.
   */
  if(!toastBootstrappedRef.current){

    rememberAll(items,knownToastIdsRef.current)

    toastBootstrappedRef.current=true

    return

  }

  /*
   * A new notification, or a chat notification that was updated by another
   * message (same row, newer created_at). See lib/toastPick.ts.
   */
  const fresh=pickFreshToast(items,knownToastIdsRef.current)

  if(!fresh)return

  /*
   * Nobody needs a banner for the conversation they are reading right now.
   */
  const isChat=fresh.type==='chat_message'||fresh.type==='chat_mention'
  if(isChat && !shouldChatSound(
    fresh.entity_id,
    document.documentElement.dataset.raOpenChat||'',
    document.visibilityState==='visible'
  ))return

  if(
    toastTimerRef.current!==undefined
  ){

    window.clearTimeout(
      toastTimerRef.current
    )

  }

  setToastItem(fresh)

  toastTimerRef.current=
    window.setTimeout(
      ()=>{

        setToastItem(null)

        toastTimerRef.current=undefined

      },
      5500
    )

},[
  items,
  loading
])

useEffect(
  ()=>()=>{

    if(
      toastTimerRef.current!==undefined
    ){

      window.clearTimeout(
        toastTimerRef.current
      )

    }

  },
  []
)

// RA_WHATSAPP_NOTIFICATION_TOAST_STATE_END

  useEffect(()=>{
    if(!onOpenSection) return
    const handleOpen=(event:Event)=>{
      const detail=(event as CustomEvent<OpenSectionDetail>).detail
      if(!detail?.section) return
      try{
        if(detail.section==='chat' && detail.conversationId){
          sessionStorage.setItem('ra.chat.open',detail.conversationId)
        }
      }catch{
        // Opening Chat still works without the remembered conversation.
      }
      onOpenSection(detail.section)
    }
    window.addEventListener(OPEN_SECTION_EVENT,handleOpen)
    return()=>window.removeEventListener(OPEN_SECTION_EVENT,handleOpen)
  },[onOpenSection])

  useEffect(()=>{
    if(!open){
      return
    }

    const handlePointer=(event:PointerEvent)=>{
      const target=event.target

      if(
        target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !(menuRef.current && menuRef.current.contains(target))
      ){
        setOpen(false)
      }
    }

    const handleKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        setOpen(false)
      }
    }

    window.addEventListener(
      'pointerdown',
      handlePointer
    )

    window.addEventListener(
      'keydown',
      handleKey
    )

    return()=>{
      window.removeEventListener(
        'pointerdown',
        handlePointer
      )

      window.removeEventListener(
        'keydown',
        handleKey
      )
    }
  },[open,setOpen])

  const openNotification=async(
    item:NotificationItem
  )=>{
    await markRead(item)

    if(
      item.entity_type==='work_item'
    ){
      setOpen(false)
      onOpenWork()
      return
    }

    if(
      item.entity_type==='social_conversation' &&
      onOpenSection
    ){
      try{
        if(item.entity_id){
          sessionStorage.setItem('ra.chat.open',item.entity_id)
        }
      }catch{
        // Opening Chat still works without the remembered conversation.
      }
      setOpen(false)
      onOpenSection('chat')
      return
    }

    if(
      item.entity_type==='workspace_note' &&
      onOpenSection
    ){
      try{
        if(item.entity_id){
          sessionStorage.setItem('ra.notes.open',item.entity_id)
        }
      }catch{
        // Notes still opens without the remembered note.
      }
      setOpen(false)
      onOpenSection('notes')
      return
    }

    if(
      item.entity_type==='workspace_announcement' &&
      onOpenSection
    ){
      setOpen(false)
      onOpenSection('announcements')
      return
    }

    if(
      item.entity_type==='leave_request' &&
      onOpenSection
    ){
      setOpen(false)
      // The person who asked sees the decision on My Profile; approvers open People & HR.
      onOpenSection(item.type==='leave_request_decided' ? 'profile' : 'people')
      return
    }

    if(
      item.entity_type==='workspace_event' &&
      onOpenSection
    ){
      try{
        if(item.entity_id){
          sessionStorage.setItem('ra.calendar.event',item.entity_id)
        }
      }catch{
        // The calendar still opens without jumping to the event.
      }
      setOpen(false)
      onOpenSection('calendar')
      return
    }

    if(
      item.entity_type==='collaboration_space' &&
      onOpenSection
    ){
      if(item.entity_id){
        setSearchFocus('shared',item.entity_id)
      }
      setOpen(false)
      onOpenSection('shared')
      return
    }

    if(
      item.entity_type==='social_post' &&
      onOpenSection
    ){
      setOpen(false)
      onOpenSection('social')
    }
  }

  return (
    <div
      className="notificationCenter"
      ref={rootRef}
    >
      <button
        type="button"
        ref={bellRef}
        className="iconButton notificationButton"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={()=>
          setOpen(value=>!value)
        }
      >
        <Bell size={17}/>

        {unreadCount>0&&
          <span className="notificationBadge">
            {unreadCount>99
              ? '99+'
              : unreadCount
            }
          </span>
        }
      </button>

      
{/* RA_WHATSAPP_NOTIFICATION_TOAST_VIEW_START */}

{toastItem&&(

  <div
    className="notificationToast"
    aria-live="polite"
    aria-atomic="true"
  >

    <button
      type="button"
      className="notificationToastMain uiFocusRing"
      aria-label={`Open notification: ${toastItem.title}`}
      onClick={()=>{

        hideToast()

        void openNotification(
          toastItem
        )

      }}
    >

      <span
        className="notificationToastIcon"
        aria-hidden="true"
      >

        {toastItem.type==='chat_message'||toastItem.type==='chat_mention'

          ? <MessageCircle size={19}/>

          : <Bell size={19}/>

        }

      </span>

      <span className="notificationToastCopy">

        <strong>
          {toastItem.title}
        </strong>

        {toastItem.body&&(

          <span>
            {toastItem.body}
          </span>

        )}

      </span>

    </button>

    <button
      type="button"
      className="notificationToastClose uiFocusRing"
      aria-label="Dismiss notification banner"
      onClick={hideToast}
    >

      <X size={16}/>

    </button>

  </div>

)}

{/* RA_WHATSAPP_NOTIFICATION_TOAST_VIEW_END */}

{open&&(()=>{
        const menu=(
        <div
          className="notificationMenu glassPanel"
          ref={menuRef}
          style={phone?{top:menuTop}:undefined}
          role="dialog"
          aria-label="Notifications"
        >
          <div className="notificationHeader">
            <div>
              <span className="eyebrow">
                NOTIFICATIONS
              </span>

              <h3>
                Activity
              </h3>
            </div>

            <div className="notificationHeaderActions">
              {unreadCount>0&&
                <button
                  type="button"
                  className="notificationMarkAll"
                  onClick={()=>
                    void markAllRead()
                  }
                >
                  <CheckCheck size={15}/>
                  Mark all read
                </button>
              }

              {readCount>0&&
                <button
                  type="button"
                  className="notificationMarkAll"
                  onClick={()=>
                    void clearRead()
                  }
                >
                  <Trash2 size={15}/>
                  Clear read
                </button>
              }
            </div>
          </div>

          <PhoneAlertsToggle/>

          <div className="notificationList">
            {loading&&!items.length&&
              <div className="notificationEmpty">
                Loading notifications...
              </div>
            }

            {items.map(item=>
              <div className="notificationRow" key={item.id}>
              <button
                type="button"
                className={
                  item.read_at
                    ? 'notificationItem'
                    : 'notificationItem unread'
                }
                onClick={()=>
                  void openNotification(item)
                }
              >
                <span className="notificationDot"/>

                <span className="notificationContent">
                  <strong>
                    {item.title}
                  </strong>

                  {item.body&&
                    <span>
                      {item.body}
                    </span>
                  }

                  <small>
                    {new Date(
                      item.created_at
                    ).toLocaleString()}
                  </small>
                </span>
              </button>

              <button
                type="button"
                className="notificationDismiss"
                aria-label={`Dismiss notification: ${item.title}`}
                title="Dismiss"
                onClick={()=>
                  void dismiss(item)
                }
              >
                <X size={14}/>
              </button>
              </div>
            )}

            {!loading&&!items.length&&
              <div className="notificationEmpty">
                No notifications yet.
              </div>
            }
          </div>
        </div>
        )
        return phone ? createPortal(menu,document.body) : menu
      })()}
    </div>
  )
}
