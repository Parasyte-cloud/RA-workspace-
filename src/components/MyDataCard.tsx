import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, Wifi } from 'lucide-react'
import { deliveryLabel, formatBytes, formatDuration, loadMyDelivery, type MyDelivery } from '../lib/dataAllocation'
import '../data-allocation.css'

// Shows a person their own daily data plan and whether today's bundle has reached their MTN
// number. Renders nothing until Administration has given them a plan.
export default function MyDataCard() {
  const [status, setStatus] = useState<MyDelivery | null>(null)

  useEffect(() => {
    let alive = true
    loadMyDelivery()
      .then((value) => { if (alive) setStatus(value) })
      .catch(() => { if (alive) setStatus(null) })
    return () => { alive = false }
  }, [])

  if (!status || !status.has_plan) return null

  const delivered = status.today_status === 'delivered'
  const waiting = status.today_status === 'pending'

  return (
    <article className="glassCard myData" aria-label="My data">
      <h4><Wifi size={15} /> My data today</h4>
      {status.status === 'suspended' ? (
        <p>Your data plan is suspended. Contact Administration.</p>
      ) : (
        <>
          <div className="myDataNumbers">
            <div><span>Daily plan</span><strong>{status.tier_label}</strong></div>
            <div>
              <span>Today</span>
              <strong>{delivered ? 'Delivered' : deliveryLabel(status.today_status)}</strong>
            </div>
            <div><span>Your number</span><strong>{status.phone_masked ?? 'Not set'}</strong></div>
          </div>
          {delivered && (
            <p className="myDataLine"><CheckCircle2 size={14} /> {formatBytes(status.daily_bytes)} was sent to {status.phone_masked}. Open your MTN app to see it.</p>
          )}
          {waiting && <p className="myDataLine"><Clock size={14} /> Your bundle is on its way. MTN can take a few minutes.</p>}
          {!status.has_phone && <p>Administration needs your MTN number before they can send your daily data. Ask them to add it.</p>}
          {status.has_phone && !status.delivery_enabled && !status.today_status && (
            <p>Daily delivery has not started yet. You will get {formatBytes(status.daily_bytes)} every morning once it does.</p>
          )}
          {status.today_status === 'failed' && <p>Today's bundle could not be delivered. Administration has been told and it will be retried.</p>}
          <small>A new bundle arrives every morning. The day changes in {formatDuration(status.resets_in_seconds)}. Unused data does not carry over.</small>
        </>
      )}
    </article>
  )
}
