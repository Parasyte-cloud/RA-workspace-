import { useEffect, useRef } from 'react'

import {
  Bell,
  CheckCheck
} from 'lucide-react'

import {
  useNotificationsContext,
  type NotificationItem
} from '../context/NotificationsContext'

export function NotificationCenter({
  onOpenWork
}:{
  onOpenWork:()=>void
}){
  const {
    items,
    unreadCount,
    loading,
    open,
    setOpen,
    markRead,
    markAllRead
  }=useNotificationsContext()

  const rootRef=useRef<HTMLDivElement|null>(null)

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
          </div>

          <div className="notificationList">
            {loading&&!items.length&&
              <div className="notificationEmpty">
                Loading notifications...
              </div>
            }

            {items.map(item=>
              <button
                type="button"
                className={
                  item.read_at
                    ? 'notificationItem'
                    : 'notificationItem unread'
                }
                key={item.id}
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
