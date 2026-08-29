import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  Bell,
  CheckCheck
} from 'lucide-react'

import { supabase } from '../lib/supabase'

type NotificationItem = {
  id:string
  user_id:string
  type:string
  title:string
  body:string
  entity_type:string|null
  entity_id:string|null
  read_at:string|null
  created_at:string
}

export function NotificationCenter({
  onOpenWork
}:{
  onOpenWork:()=>void
}){
  const [items,setItems]=useState<NotificationItem[]>([])
  const [open,setOpen]=useState(false)
  const [loading,setLoading]=useState(false)

  const rootRef=useRef<HTMLDivElement|null>(null)
  const loadRequestRef=useRef(0)

  const unreadCount=useMemo(
    ()=>items.filter(item=>!item.read_at).length,
    [items]
  )

  const loadNotifications=useCallback(async()=>{
    const client=supabase
    if(!client){
      return
    }

    const requestSequence=++loadRequestRef.current
    setLoading(true)

    const {data,error}=await client
      .from('notifications')
      .select(`
        id,
        user_id,
        type,
        title,
        body,
        entity_type,
        entity_id,
        read_at,
        created_at
      `)
      .order('created_at',{
        ascending:false
      })
      .limit(30)

    if(requestSequence!==loadRequestRef.current){
      return
    }

    if(error){
      console.error(
        '[RideArrivo Notifications]',
        error
      )
      setLoading(false)
      return
    }

    setItems((data || []) as NotificationItem[])
    setLoading(false)
  },[])

  useEffect(()=>{
    void loadNotifications()
    return()=>{
      loadRequestRef.current+=1
    }
  },[loadNotifications])

  useEffect(()=>{
    if(!supabase){
      return
    }

    const client=supabase

    const channel=client
      .channel('ridearrivo-notifications')
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'notifications'
        },
        ()=>{
          void loadNotifications()
        }
      )
      .subscribe()

    return()=>{
      void client.removeChannel(channel)
    }
  },[loadNotifications])

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
  },[open])

  const markRead=async(
    item:NotificationItem
  )=>{
    if(
      !supabase ||
      item.read_at
    ){
      return
    }

    const {error}=await supabase
      .from('notifications')
      .update({
        read_at:new Date().toISOString()
      })
      .eq('id',item.id)

    if(error){
      console.error(
        '[RideArrivo Notifications]',
        error
      )
      return
    }

    setItems(current=>
      current.map(notification=>
        notification.id===item.id
          ? {
              ...notification,
              read_at:new Date().toISOString()
            }
          : notification
      )
    )
  }

  const markAllRead=async()=>{
    if(!supabase){
      return
    }

    const unreadIds=items
      .filter(item=>!item.read_at)
      .map(item=>item.id)

    if(!unreadIds.length){
      return
    }

    const now=new Date().toISOString()

    const {error}=await supabase
      .from('notifications')
      .update({
        read_at:now
      })
      .in('id',unreadIds)

    if(error){
      console.error(
        '[RideArrivo Notifications]',
        error
      )
      return
    }

    setItems(current=>
      current.map(item=>
        unreadIds.includes(item.id)
          ? {
              ...item,
              read_at:now
            }
          : item
      )
    )
  }

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
