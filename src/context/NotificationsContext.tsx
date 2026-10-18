import {playChatArrival,shouldChatSound} from '../lib/chatSound'
import {SOUND_BLOCKED_EVENT,wireAudioUnlock} from '../lib/ringtone'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

import { supabase } from '../lib/supabase'
import { sectionForNotification, showDesktopAlert } from '../lib/desktopAlerts'

export type NotificationItem = {
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

type NotificationsContextValue = {
  items:NotificationItem[]
  unreadCount:number
  loading:boolean
  open:boolean
  setOpen:(value:boolean|((current:boolean)=>boolean))=>void
  markRead:(item:NotificationItem)=>Promise<void>
  markAllRead:()=>Promise<void>
  dismiss:(item:NotificationItem)=>Promise<void>
  clearRead:()=>Promise<void>
}

/*
 * Single source of truth for notifications: one query, one realtime
 * subscription, shared by the bell (NotificationCenter) and any thin
 * dashboard teaser. Do not give either consumer its own fetch/subscribe
 * logic - that's what caused the dashboard and the bell to drift out of
 * sync before (DashboardNotificationsPanel, removed).
 */
const NotificationsContext=createContext<NotificationsContextValue|null>(null)

export function NotificationsProvider({children}:{children:ReactNode}){
  const [items,setItems]=useState<NotificationItem[]>([])
  const [loading,setLoading]=useState(true)
  const [open,setOpen]=useState(false)

  const loadRequestRef=useRef(0)

  // Message sounds need the audio engine unlocked by a tap. The call ringer
  // does this too, but a message must not depend on that being mounted.
  useEffect(()=>{ wireAudioUnlock() },[])

  // The list only holds the newest 30 rows, so the real unread total is asked
  // of the database separately. Until that answer arrives we fall back to
  // what is on screen. (Sweep RA-009.)
  const [serverUnread,setServerUnread]=useState<number|null>(null)
  const loadedUnread=useMemo(
    ()=>items.filter(item=>!item.read_at).length,
    [items]
  )
  const unreadCount=serverUnread===null?loadedUnread:Math.max(serverUnread,loadedUnread)

  // Count on the app icon (installed app, where the device supports it).
  useEffect(()=>{
    const nav=navigator as Navigator&{setAppBadge?:(n?:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>}
    try{
      if(unreadCount>0) void nav.setAppBadge?.(unreadCount)?.catch(()=>{})
      else void nav.clearAppBadge?.()?.catch(()=>{})
    }catch{
      /* badges are optional */
    }
  },[unreadCount])

  const load=useCallback(async()=>{
    const client=supabase
    if(!client){
      setLoading(false)
      return
    }

    const requestSequence=++loadRequestRef.current

    const {data,error}=await client
      .from('notifications')
      .select('id,user_id,type,title,body,entity_type,entity_id,read_at,created_at')
      .order('created_at',{ascending:false})
      .limit(30)

    if(requestSequence!==loadRequestRef.current){
      return
    }

    if(error){
      console.error('[RideArrivo Notifications]',error)
      setLoading(false)
      return
    }

    setItems((data||[]) as NotificationItem[])
    setLoading(false)

    const {count}=await client
      .from('notifications')
      .select('id',{count:'exact',head:true})
      .is('read_at',null)
    if(requestSequence===loadRequestRef.current && typeof count==='number') setServerUnread(count)
  },[])

  useEffect(()=>{
    void load()
    return()=>{ loadRequestRef.current+=1 }
  },[load])

  useEffect(()=>{
    if(!supabase) return
    const client=supabase

    const channel=client
      .channel('ridearrivo-notifications')
      .on(
        'postgres_changes',
        {event:'*',schema:'public',table:'notifications'},
        payload=>{
          const row=payload.new as Partial<NotificationItem>|null
          const isChatRow=row?.type==='chat_message' || row?.type==='chat_mention'
          const fresh=payload.eventType==='INSERT'
            || (payload.eventType==='UPDATE' && isChatRow && !row?.read_at)
          if(fresh && isChatRow && shouldChatSound(
            row?.entity_id,
            document.documentElement.dataset.raOpenChat||'',
            document.visibilityState==='visible'
          )){
            // false = the browser is still keeping sound off. Tell the app, so
            // it can ask for the one tap that turns sound back on.
            if(playChatArrival()===false) window.dispatchEvent(new Event(SOUND_BLOCKED_EVENT))
          }
          if(fresh && row?.title){
            showDesktopAlert({
              title:row.title,
              body:row.body||'',
              urgent:row.type==='call',
              tag:row.type==='chat_message' ? `chat-${row.entity_id}` : row.id,
              section:sectionForNotification(row.entity_type??null,row.type||''),
              conversationId:row.entity_type==='social_conversation' ? row.entity_id : null
            })
          }
          void load()
        }
      )
      .subscribe()

    return()=>{ void client.removeChannel(channel) }
  },[load])

  const markRead=useCallback(async(item:NotificationItem)=>{
    if(!supabase || item.read_at) return

    const {error}=await supabase
      .from('notifications')
      .update({read_at:new Date().toISOString()})
      .eq('id',item.id)

    if(error){
      console.error('[RideArrivo Notifications]',error)
      return
    }

    setServerUnread(n=>n===null?n:Math.max(0,n-1))
    setItems(current=>current.map(notification=>
      notification.id===item.id
        ? {...notification,read_at:new Date().toISOString()}
        : notification
    ))
  },[])

  const markAllRead=useCallback(async()=>{
    if(!supabase) return
    if(unreadCount<=0) return

    const now=new Date().toISOString()

    // Every unread row the person owns, not only the 30 on screen.
    const {error}=await supabase
      .from('notifications')
      .update({read_at:now})
      .is('read_at',null)

    if(error){
      console.error('[RideArrivo Notifications]',error)
      return
    }

    setServerUnread(0)
    setItems(current=>current.map(item=>
      item.read_at ? item : {...item,read_at:now}
    ))
  },[unreadCount])

  // Removes notifications for good. Rows are only dropped from the screen once
  // the database confirms it deleted them, so a blocked delete never looks done.
  const removeIds=useCallback(async(ids:string[])=>{
    if(!supabase || !ids.length) return
    const {data,error}=await supabase
      .from('notifications')
      .delete()
      .in('id',ids)
      .select('id')

    if(error){
      console.error('[RideArrivo Notifications]',error)
      return
    }

    const gone=new Set((data||[]).map(row=>row.id as string))
    setItems(current=>current.filter(item=>!gone.has(item.id)))
  },[])

  const dismiss=useCallback(
    (item:NotificationItem)=>removeIds([item.id]),
    [removeIds]
  )

  const clearRead=useCallback(
    ()=>removeIds(items.filter(item=>item.read_at).map(item=>item.id)),
    [items,removeIds]
  )

  const value=useMemo(
    ()=>({items,unreadCount,loading,open,setOpen,markRead,markAllRead,dismiss,clearRead}),
    [items,unreadCount,loading,open,markRead,markAllRead,dismiss,clearRead]
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotificationsContext(){
  const ctx=useContext(NotificationsContext)
  if(!ctx){
    throw new Error('useNotificationsContext must be used within a NotificationsProvider')
  }
  return ctx
}
