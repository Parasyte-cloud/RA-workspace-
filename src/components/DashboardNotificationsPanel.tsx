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

function timeAgo(iso:string){
  const then=new Date(iso).getTime()
  const diffMs=Date.now()-then
  const mins=Math.round(diffMs/60000)
  if(mins<1) return 'just now'
  if(mins<60) return `${mins}m ago`
  const hours=Math.round(mins/60)
  if(hours<24) return `${hours}h ago`
  const days=Math.round(hours/24)
  if(days<7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function DashboardNotificationsPanel({
  onOpenWork
}:{
  onOpenWork?:()=>void
}){
  const [items,setItems]=useState<NotificationItem[]>([])
  const [loading,setLoading]=useState(true)

  const loadRequestRef=useRef(0)

  const unreadCount=useMemo(
    ()=>items.filter(item=>!item.read_at).length,
    [items]
  )

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){
      setLoading(false)
      return
    }

    const requestSequence=++loadRequestRef.current

    const {data,error}=await client
      .from('notifications')
      .select(
        'id,user_id,type,title,body,entity_type,entity_id,read_at,created_at'
      )
      .order('created_at',{ascending:false})
      .limit(8)

    if(requestSequence!==loadRequestRef.current){
      return
    }

    if(error){
      console.error('[RideArrivo Dashboard Notifications]',error)
      setLoading(false)
      return
    }

    setItems((data||[]) as NotificationItem[])
    setLoading(false)
  },[])

  useEffect(()=>{
    void load()
    return()=>{ loadRequestRef.current+=1 }
  },[load])

  useEffect(()=>{
    if(!supabase) return
    const client=supabase

    const channel=client
      .channel('ridearrivo-dashboard-notifications')
      .on(
        'postgres_changes',
        {event:'*',schema:'public',table:'notifications'},
        ()=>{ void load() }
      )
      .subscribe()

    return()=>{ void client.removeChannel(channel) }
  },[load])

  const markRead=async(item:NotificationItem)=>{
    if(!supabase || item.read_at) return

    const {error}=await supabase
      .from('notifications')
      .update({read_at:new Date().toISOString()})
      .eq('id',item.id)

    if(error){
      console.error('[RideArrivo Dashboard Notifications]',error)
      return
    }

    setItems(current=>current.map(notification=>
      notification.id===item.id
        ? {...notification,read_at:new Date().toISOString()}
        : notification
    ))
  }

  const markAllRead=async()=>{
    if(!supabase) return
    const unreadIds=items.filter(item=>!item.read_at).map(item=>item.id)
    if(!unreadIds.length) return

    const now=new Date().toISOString()

    const {error}=await supabase
      .from('notifications')
      .update({read_at:now})
      .in('id',unreadIds)

    if(error){
      console.error('[RideArrivo Dashboard Notifications]',error)
      return
    }

    setItems(current=>current.map(item=>
      unreadIds.includes(item.id) ? {...item,read_at:now} : item
    ))
  }

  const openNotification=async(item:NotificationItem)=>{
    await markRead(item)
    if(item.entity_type==='work_item' && onOpenWork){
      onOpenWork()
    }
  }

  return (
    <div className="dashboardNotifications glassCard">
      <div className="dashboardNotificationsHeader">
        <div>
          <span className="eyebrow">RECENT ACTIVITY</span>
          <strong>
            <Bell size={16}/>
            Notifications
            {unreadCount>0 && (
              <span className="dashboardNotificationsBadge">
                {unreadCount>99?'99+':unreadCount}
              </span>
            )}
          </strong>
        </div>

        {unreadCount>0 && (
          <button
            type="button"
            className="dashboardNotificationsMarkAll"
            onClick={()=>{ void markAllRead() }}
          >
            <CheckCheck size={14}/>
            Mark all read
          </button>
        )}
      </div>

      <div className="dashboardNotificationsList">
        {loading && !items.length && (
          <div className="dashboardNotificationsEmpty">
            Loading your recent activity...
          </div>
        )}

        {items.map(item=>(
          <button
            type="button"
            key={item.id}
            className={
              item.read_at
                ? 'dashboardNotificationItem'
                : 'dashboardNotificationItem unread'
            }
            onClick={()=>{ void openNotification(item) }}
          >
            <span className="dashboardNotificationDot"/>
            <span className="dashboardNotificationContent">
              <strong>{item.title}</strong>
              {item.body && <span>{item.body}</span>}
            </span>
            <small>{timeAgo(item.created_at)}</small>
          </button>
        ))}

        {!loading && !items.length && (
          <div className="dashboardNotificationsEmpty">
            Nothing new. Assignments, approvals and requests that need your attention will show up here.
          </div>
        )}
      </div>
    </div>
  )
}
