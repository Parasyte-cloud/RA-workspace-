import { AlertTriangle, BarChart3, Clock3, Headphones, PhoneCall, PhoneMissed, UsersRound } from 'lucide-react'
import { useMemo } from 'react'
import { formatDuration, label, timeAgo, type SupportSnapshot } from '../lib/supportCommandCentre'
import SupportTelephonyHealth from './SupportTelephonyHealth'

// Head of Support view. Everything here is read from supervisor-only or
// staff-visible views; nothing is computed in the browser that the database
// can compute, so two supervisors always see the same numbers.
export default function SupportControlTower({ snapshot, onOpenTicket }: { snapshot: SupportSnapshot; onOpenTicket: (id: string) => void }) {
  const k = snapshot.kpis
  const breached = snapshot.tickets.filter((t) => t.sla_state === 'breached' && t.status !== 'resolved').slice(0, 8)
  const live = snapshot.calls.filter((c) => !c.ended_at)
  const onShift = snapshot.agents.filter((a) => a.active_shift)
  const covered = onShift.filter((a) => a.state === 'available' || a.state === 'on_call' || a.state === 'wrap_up').length
  const gap = onShift.length - covered
  const names = useMemo(() => new Map(snapshot.agents.map((a) => [a.employee_id, a.display_name])), [snapshot.agents])

  return <section className="sccTower" aria-label="Control tower">
    {k ? <div className="sccMetrics six">
      <article><PhoneCall /><span>Calls today</span><strong>{k.calls_offered}</strong><small>{k.calls_answered} answered</small></article>
      <article><PhoneMissed /><span>Abandoned</span><strong>{k.calls_abandoned}</strong><small>{k.answer_rate == null ? 'no calls yet' : `${k.answer_rate}% answered`}</small></article>
      <article><Clock3 /><span>Avg wait</span><strong>{k.avg_wait_seconds == null ? '-' : formatDuration(k.avg_wait_seconds)}</strong><small>handle {k.avg_handle_seconds == null ? '-' : formatDuration(k.avg_handle_seconds)}</small></article>
      <article><BarChart3 /><span>Open tickets</span><strong>{k.open_tickets}</strong><small>{k.unassigned_tickets} unassigned</small></article>
      <article className={k.sla_breached ? 'bad' : ''}><AlertTriangle /><span>SLA breached</span><strong>{k.sla_breached}</strong><small>{k.sla_at_risk} at risk</small></article>
      <article><Headphones /><span>Callbacks</span><strong>{k.callbacks_pending}</strong><small>{k.resolved_today} resolved today</small></article>
    </div> : <div className="sccEmpty">KPIs load for supervisors only.</div>}

    {k ? <SupportTelephonyHealth agentNames={names} /> : null}

    {gap > 0 ? <div className="sccNotice"><AlertTriangle size={16} /><span>{gap} officer{gap === 1 ? ' is' : 's are'} on shift but not taking work. Check the board below.</span></div> : null}

    <div className="sccTowerGrid">
      <div className="sccPanel">
        <div className="sccPanelTitle"><UsersRound size={17} /><strong>Officer board</strong><small className="sccMuted">{onShift.length} on shift</small></div>
        {snapshot.agents.length ? snapshot.agents.map((a) => <article className="sccAgent" key={a.employee_id}>
          <div className={`sccPresence ${a.state}`} />
          <span><b>{a.display_name}{a.is_supervisor ? ' (lead)' : ''}</b><small>{a.active_shift ? 'On shift' : 'Off shift'} · {label(a.state)}{a.state_reason ? ` (${label(a.state_reason)})` : ''} · seen {timeAgo(a.last_seen_at)}</small></span>
          <span className="sccCapacity">Voice {a.voice_active}/{a.voice_capacity}<br />Chat {a.messaging_active}/{a.messaging_capacity}</span>
        </article>) : <div className="sccEmpty">No officers provisioned yet. Use Administration, Support Routing.</div>}
      </div>

      <div className="sccPanel">
        <div className="sccPanelTitle"><PhoneCall size={17} /><strong>Live calls</strong><small className="sccMuted">{live.length}</small></div>
        {live.length ? live.map((c) => <article className="sccAgent" key={c.id}>
          <div className={`sccPresence ${c.status === 'in-progress' ? 'on_call' : 'available'}`} />
          <span><b>{c.customer_name || c.from_number || c.to_number || 'Unknown'}</b><small>{c.direction} · {label(c.status)}{c.assigned_agent_name ? ` · ${c.assigned_agent_name}` : ''}</small></span>
          <span className="sccCapacity">{c.public_id || ''}<br />{formatDuration(Math.floor((Date.now() - Date.parse(c.answered_at || c.created_at)) / 1000))}</span>
        </article>) : <div className="sccEmpty">No calls right now.</div>}

        <div className="sccPanelTitle"><AlertTriangle size={17} /><strong>SLA breached</strong></div>
        {breached.length ? breached.map((t) => <button type="button" key={t.id} className="sccQueue" onClick={() => onOpenTicket(t.id)}>
          <span><b>{t.public_id} · {t.subject}</b><small>{label(t.channel)} · {t.assigned_agent_name || 'Unassigned'}</small></span><span className="sccQueueNumbers"><b>{t.priority}</b></span>
        </button>) : <div className="sccEmpty">Nothing breached.</div>}
      </div>

      <div className="sccPanel">
        <div className="sccPanelTitle"><BarChart3 size={17} /><strong>Channels</strong></div>
        {snapshot.channels.map((c) => <article className="sccAgent" key={c.channel}>
          <span /><span><b>{label(c.channel)}</b><small>{c.created_today} today</small></span><span className="sccCapacity">{c.open_tickets} open<br />{c.waiting} waiting</span>
        </article>)}
      </div>
    </div>
  </section>
}
