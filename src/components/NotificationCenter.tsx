import { useEffect, useRef } from 'react'
import { OPEN_SECTION_EVENT, type OpenSectionDetail } from '../lib/desktopAlerts'

import {
  Bell,
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
        !rootRef.current.contains(target)
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
      item.entity_type==='workspace_announcement' &&
      onOpenSection
    ){
      setOpen(false)
      onOpenSection('announcements')
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

      {open&&
        <div className="notificationMenu glassPanel">
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
      }
    </div>
  )
}
