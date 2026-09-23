import {
  Bell,
  ChevronRight
} from 'lucide-react'

import {
  useNotificationsContext,
  type NotificationItem
} from '../context/NotificationsContext'

/*
 * Thin dashboard teaser: no query of its own, no realtime subscription
 * of its own. It reads the same shared state the bell (NotificationCenter)
 * reads and just "View all"s into the bell, so the two can never drift
 * out of sync the way the old DashboardNotificationsPanel did.
 */
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

export default function DashboardNotificationsTeaser({
  onOpenWork
}:{
  onOpenWork?:()=>void
}){
  const {
    items,
    unreadCount,
    loading,
    setOpen,
    markRead
  }=useNotificationsContext()

  const preview=items.slice(0,3)

  const openItem=async(item:NotificationItem)=>{
    await markRead(item)

    if(item.entity_type==='work_item' && onOpenWork){
      onOpenWork()
      return
    }

    setOpen(true)
  }

  if(!loading && !items.length){
    return null
  }

  return (
    <div className="dashboardNotificationsTeaser glassCard">
      <div className="dashboardNotificationsTeaserHeader">
        <span className="eyebrow">NEEDS YOUR ATTENTION</span>
        <strong>
          <Bell size={16}/>
          Notifications
          {unreadCount>0 && (
            <span className="dashboardNotificationsTeaserBadge">
              {unreadCount>99?'99+':unreadCount}
            </span>
          )}
        </strong>
      </div>

      {loading && !items.length && (
        <div className="dashboardNotificationsTeaserEmpty">
          Loading...
        </div>
      )}

      <div className="dashboardNotificationsTeaserList">
        {preview.map(item=>(
          <button
            type="button"
            key={item.id}
            className={
              item.read_at
                ? 'dashboardNotificationsTeaserItem'
                : 'dashboardNotificationsTeaserItem unread'
            }
            onClick={()=>{ void openItem(item) }}
          >
            <span className="dashboardNotificationsTeaserDot"/>
            <span className="dashboardNotificationsTeaserContent">
              <strong>{item.title}</strong>
            </span>
            <small>{timeAgo(item.created_at)}</small>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="dashboardNotificationsTeaserViewAll"
        onClick={()=>setOpen(true)}
      >
        View all in Notifications
        <ChevronRight size={14}/>
      </button>
    </div>
  )
}
